import { Prisma } from "@prisma/client"
import { moduleEnabled, type ModuleFlag } from "@/platform/modules"
import { permits } from "@/platform/access/policy"
import type { BusinessActor } from "@/platform/policy"
import type { DashboardPeriod } from "@/types/dashboard"
import { ownedRecordSql, sharingGrantSql, quotationRecordScope } from "@/platform/access/record-scope"
import type { DocumentDashboard } from "./dashboard-types"

export async function documentDashboard(tx: Prisma.TransactionClient, actor: BusinessActor, flags: ModuleFlag[], period: DashboardPeriod): Promise<DocumentDashboard> {
  const quotes = moduleEnabled(flags, "salesDocuments") && permits(actor, "quotations.read")
  const plans = quotes && moduleEnabled(flags, "paymentPlans")
  const createdAt = { gte: period.start, lt: period.end }
  const result: DocumentDashboard = { quotations: null, paymentPlans: null }
  await Promise.all([
    quotes ? (async () => {
      const where = { ...quotationRecordScope(actor, "read"), createdAt }
      const [total, values, recent] = await Promise.all([
        tx.crmQuotation.count({ where }),
        tx.crmQuotation.groupBy({ by: ["currency"], where, _sum: { consideration: true }, _count: { _all: true }, orderBy: { currency: "asc" } }),
        tx.crmQuotation.findMany({ where, select: { id: true, title: true, currency: true, consideration: true, version: true, createdAt: true }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 6 }),
      ])
      result.quotations = { total, values: values.map(row => ({ currency: row.currency, count: row._count._all, amount: row._sum.consideration?.toString() || "0" })), recent: recent.map(row => ({ id: row.id, title: row.title, currency: row.currency, amount: row.consideration.toString(), version: row.version, createdAt: row.createdAt.toISOString() })) }
    })() : undefined,
    plans ? (async () => {
      const access = Prisma.sql`AND ((${ownedRecordSql(actor, "quotations", "o", "read")}) OR ${sharingGrantSql(actor, "quotations", "q", "read")})`
      // Current revisions only: editing a quotation must never double-count its plan.
      // No paid/overdue balance is inferred; these are proposed schedules, not receipts.
      const [data] = await tx.$queryRaw<NonNullable<DocumentDashboard["paymentPlans"]>[]>(Prisma.sql`
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
