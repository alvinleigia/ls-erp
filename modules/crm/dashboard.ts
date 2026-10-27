import type { Prisma } from "@prisma/client"
import { moduleEnabled, type ModuleFlag } from "@/platform/modules"
import { permits } from "@/platform/access/policy"
import type { BusinessActor } from "@/platform/policy"
import type { DashboardPeriod } from "@/types/dashboard"
import { enquiryScope, opportunityScope } from "./policy"
import { workScope } from "./work-scope"
import type { CrmDashboard } from "./dashboard-types"

const label = (value: string) => value.toLowerCase().replace(/_/g, " ").replace(/^./, c => c.toUpperCase())
const rate = (part: number, total: number) => total ? Math.round(part / total * 1000) / 10 : null

// Shared with dashboard contributions through application composition. Null scopes
// mean the corresponding record counts must not be queried or exposed.
export function dashboardSalesScopes(actor: BusinessActor, flags: ModuleFlag[], period: DashboardPeriod) {
  const crm = moduleEnabled(flags, "crm") && permits(actor, "reports.read")
  const sales = enquiryScope(actor)
  const activeDeal: Prisma.CrmOpportunityWhereInput = { AND: [opportunityScope(actor, "read")], stage: { kind: "OPEN", archived: false }, pipeline: { archived: false }, contact: { archived: false } }
  return {
    enquiries: crm && permits(actor, "enquiries.read") ? { AND: [sales], createdAt: { gte: period.start, lt: period.end } } : null,
    opportunities: crm && permits(actor, "opportunities.read") ? activeDeal : null,
  }
}

// Aggregation stays in Postgres; preview rows are bounded and tenant scoped.
export async function crmDashboard(tx: Prisma.TransactionClient, actor: BusinessActor, flags: ModuleFlag[], period: DashboardPeriod): Promise<CrmDashboard> {
  const scopes = dashboardSalesScopes(actor, flags, period)
  const leads = scopes.enquiries !== null, deals = scopes.opportunities !== null
  const work = moduleEnabled(flags, "crm") && permits(actor, "reports.read") && permits(actor, "activities.read")
  const createdAt = { gte: period.start, lt: period.end }
  const sales = opportunityScope(actor, "read")
  const activeDeal = scopes.opportunities!
  const pending: Prisma.CrmTaskWhereInput = { AND: [workScope(actor)], status: { in: ["OPEN", "IN_PROGRESS"] } }
  const completed: Prisma.CrmTaskWhereInput = { AND: [workScope(actor)], status: "COMPLETED", completedAt: createdAt }
  const result: CrmDashboard = { enquiries: null, opportunities: null, activities: null }
  await Promise.all([
    leads ? (async () => {
      const where = scopes.enquiries!
      const [statuses, converted] = await Promise.all([
        tx.crmEnquiry.groupBy({ by: ["status"], where, _count: { _all: true }, orderBy: { status: "asc" } }),
        deals ? tx.crmEnquiry.count({ where: { ...where, opportunities: { some: opportunityScope(actor, "read") } } }) : Promise.resolve(null),
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
  ])
  return result
}
