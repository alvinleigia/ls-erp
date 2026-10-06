import { Prisma } from "@prisma/client"
import { enquiryScope } from "@/modules/crm/policy"
import { workScope } from "@/modules/crm/work-service"
import { projectScope } from "@/modules/real-estate/service"
import { moduleEnabled, type ModuleFlag } from "@/platform/modules"
import { permits } from "@/platform/access/policy"
import { salesRecordAccess } from "@/platform/access/record-scope"
import type { BusinessActor } from "@/platform/policy"
import type { SalesDashboard } from "@/types/dashboard"

type Period = { start: Date; end: Date; now: Date; today: string }
const label = (value: string) => value.toLowerCase().replace(/_/g, " ").replace(/^./, c => c.toUpperCase())
const rate = (part: number, total: number) => total ? Math.round(part / total * 1000) / 10 : null

// Aggregations stay in Postgres; previews are capped at six rows. Every section
// uses the same record scopes as its source module, in the caller's RLS context.
export async function salesDashboard(tx: Prisma.TransactionClient, actor: BusinessActor, flags: ModuleFlag[], period: Period): Promise<SalesDashboard> {
  const crm = moduleEnabled(flags, "crm") && permits(actor, "reports.read")
  const leads = crm && permits(actor, "enquiries.read")
  const deals = crm && permits(actor, "opportunities.read")
  const work = crm && permits(actor, "activities.read")
  const projects = moduleEnabled(flags, "realEstate") && permits(actor, "projects.read")
  const quotes = moduleEnabled(flags, "salesDocuments") && permits(actor, "quotations.read")
  const plans = quotes && moduleEnabled(flags, "paymentPlans")
  const createdAt = { gte: period.start, lt: period.end }
  const sales = enquiryScope(actor)
  const activeDeal: Prisma.CrmOpportunityWhereInput = { AND: [sales], stage: { kind: "OPEN", archived: false }, pipeline: { archived: false }, contact: { archived: false } }
  const pending: Prisma.CrmTaskWhereInput = { AND: [workScope(actor)], status: { in: ["OPEN", "IN_PROGRESS"] } }
  const completed: Prisma.CrmTaskWhereInput = { AND: [workScope(actor)], status: "COMPLETED", completedAt: createdAt }
  const result: SalesDashboard = { enquiries: null, opportunities: null, activities: null, projects: null, quotations: null, paymentPlans: null }
  await Promise.all([
    leads ? (async () => {
      const where = { AND: [sales], createdAt }
      const [statuses, converted] = await Promise.all([
        tx.crmEnquiry.groupBy({ by: ["status"], where, _count: { _all: true }, orderBy: { status: "asc" } }),
        deals ? tx.crmEnquiry.count({ where: { ...where, opportunities: { some: sales } } }) : Promise.resolve(null),
      ])
      const total = statuses.reduce((sum, row) => sum + row._count._all, 0)
      result.enquiries = { total, converted, conversionPercent: converted === null ? null : rate(converted, total), statuses: statuses.map(row => ({ label: row.status === "CLOSED" ? "Lost" : label(row.status), count: row._count._all })) }
    })() : undefined,
    deals ? (async () => {
      const [open, won, lost, stages, values] = await Promise.all([
        tx.crmOpportunity.count({ where: activeDeal }),
        tx.crmOpportunity.count({ where: { AND: [sales], stage: { kind: "WON" }, closedAt: createdAt } }),
        tx.crmOpportunity.count({ where: { AND: [sales], stage: { kind: "LOST" }, closedAt: createdAt } }),
        tx.crmOpportunity.groupBy({ by: ["stageId"], where: activeDeal, _count: { _all: true }, orderBy: [{ _count: { stageId: "desc" } }, { stageId: "asc" }], take: 8 }),
        tx.crmOpportunity.groupBy({ by: ["currency"], where: activeDeal, _sum: { amount: true }, _count: { _all: true }, orderBy: { currency: "asc" } }),
      ])
      const names = await tx.crmStage.findMany({ where: { tenantId: actor.tenantId, id: { in: stages.map(row => row.stageId) } }, select: { id: true, name: true, pipeline: { select: { name: true } } } })
      result.opportunities = { open, won, lost, winPercent: rate(won, won + lost), stages: stages.map(row => { const stage = names.find(s => s.id === row.stageId); return { label: `${stage?.pipeline.name} / ${stage?.name}`, count: row._count._all } }), values: values.map(row => ({ currency: row.currency, count: row._count._all, amount: row._sum.amount?.toString() || "0" })) }
    })() : undefined,
    work ? (async () => {
      const [calls, connected, overdue, total, types, upcoming] = await Promise.all([
        tx.crmTask.count({ where: { ...completed, type: "CALL" } }),
        tx.crmTask.count({ where: { ...completed, type: "CALL", outcome: "CONNECTED" } }),
        tx.crmTask.count({ where: { ...pending, OR: [{ startsAt: { lt: period.now } }, { startsAt: null, dueOn: { lt: new Date(`${period.today}T00:00:00Z`) } }] } }),
        tx.crmTask.count({ where: completed }),
        tx.crmTask.groupBy({ by: ["type", "activityTypeId", "activityTypeName"], where: completed, _count: { _all: true }, orderBy: [{ _count: { type: "desc" } }, { activityTypeId: "asc" }, { activityTypeName: "asc" }, { type: "asc" }], take: 8 }),
        tx.crmTask.findMany({ where: pending, select: { id: true, title: true, type: true, activityTypeName: true, dueOn: true, startsAt: true }, orderBy: [{ dueOn: "asc" }, { startsAt: "asc" }, { id: "asc" }], take: 6 }),
      ])
      result.activities = { calls, connected, overdue, completed: total, types: types.map(row => ({ label: row.activityTypeName || label(row.type), count: row._count._all })), upcoming: upcoming.map(row => ({ id: row.id, title: row.title, type: row.activityTypeName || label(row.type), dueOn: row.dueOn.toISOString().slice(0, 10), startsAt: row.startsAt?.toISOString() || null })) }
    })() : undefined,
    projects ? (async () => {
      const where = { AND: [projectScope(actor)], archived: false, parentId: null }
      const [active, subprojects, items] = await Promise.all([
        tx.realEstateProject.count({ where }),
        tx.realEstateProject.count({ where: { AND: [projectScope(actor)], archived: false, parentId: { not: null }, parent: { archived: false } } }),
        tx.realEstateProject.findMany({ where, select: { id: true, name: true, _count: leads || deals ? { select: {
          ...(leads ? { enquiryContexts: { where: { enquiry: { AND: [sales], createdAt } } } } : {}),
          ...(deals ? { opportunityContexts: { where: { opportunity: activeDeal } } } : {}),
        } } : false }, orderBy: [{ name: "asc" }, { id: "asc" }], take: 6 }),
      ])
      result.projects = { active, subprojects, items: items.map(row => ({ id: row.id, name: row.name, enquiries: leads ? row._count.enquiryContexts : null, opportunities: deals ? row._count.opportunityContexts : null })) }
    })() : undefined,
    quotes ? (async () => {
      const where = { tenantId: actor.tenantId, opportunity: sales, createdAt }
      const [total, values, recent] = await Promise.all([
        tx.crmQuotation.count({ where }),
        tx.crmQuotation.groupBy({ by: ["currency"], where, _sum: { consideration: true }, _count: { _all: true }, orderBy: { currency: "asc" } }),
        tx.crmQuotation.findMany({ where, select: { id: true, title: true, currency: true, consideration: true, version: true, createdAt: true }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 6 }),
      ])
      result.quotations = { total, values: values.map(row => ({ currency: row.currency, count: row._count._all, amount: row._sum.consideration?.toString() || "0" })), recent: recent.map(row => ({ id: row.id, title: row.title, currency: row.currency, amount: row.consideration.toString(), version: row.version, createdAt: row.createdAt.toISOString() })) }
    })() : undefined,
    plans ? (async () => {
      const scope = salesRecordAccess(actor)
      const access = scope === "ALL" ? Prisma.empty : Prisma.sql`AND (o."assignedUserId"=${actor.userId} ${scope === "MANAGED_TEAMS" && actor.managedTeamIds?.length ? Prisma.sql`OR o."salesTeamId" IN (${Prisma.join(actor.managedTeamIds)})` : Prisma.empty})`
      // Current revisions only: editing a quotation must never double-count its plan.
      // No paid/overdue balance is inferred; these are proposed schedules, not receipts.
      const [data] = await tx.$queryRaw<NonNullable<SalesDashboard["paymentPlans"]>[]>(Prisma.sql`
        WITH documents AS (
          SELECT q.id, q.title, q.currency, r.snapshot->'calculation'->'instalments' AS schedule
          FROM "CrmQuotation" q JOIN "CrmOpportunity" o ON o."tenantId"=q."tenantId" AND o.id=q."opportunityId"
          JOIN "CrmQuotationRevision" r ON r."tenantId"=q."tenantId" AND r."quotationId"=q.id AND r.number=q.version
          WHERE q."tenantId"=${actor.tenantId} ${access}
        ), instalments AS (
          SELECT d.id,d.title,d.currency,i.value->>'label' AS label,i.value->>'dueDate' AS "dueDate",i.value->>'amount' AS amount,i.ordinality AS position
          FROM documents d CROSS JOIN LATERAL jsonb_array_elements(COALESCE(d.schedule,'[]'::jsonb)) WITH ORDINALITY i(value,ordinality)
        ), upcoming AS (SELECT * FROM instalments WHERE "dueDate">=${period.today} AND "dueDate"<to_char(${new Date(`${period.today}T00:00:00Z`)}::date + 30,'YYYY-MM-DD'))
        SELECT (SELECT count(*)::int FROM documents WHERE jsonb_array_length(schedule)>0) AS documents,
          (SELECT count(*)::int FROM instalments WHERE COALESCE("dueDate",'')='') AS undated,
          (SELECT count(*)::int FROM upcoming) AS "upcomingCount",
          COALESCE((SELECT jsonb_agg(v ORDER BY currency) FROM (SELECT currency,count(*)::int AS count,sum(amount::numeric)::text AS amount FROM upcoming GROUP BY currency) v),'[]'::jsonb) AS "values",
          COALESCE((SELECT jsonb_agg(v ORDER BY "dueDate",id,position) FROM (SELECT * FROM upcoming ORDER BY "dueDate",id,position LIMIT 6) v),'[]'::jsonb) AS upcoming`)
      result.paymentPlans = data
    })() : undefined,
  ])
  return result
}
