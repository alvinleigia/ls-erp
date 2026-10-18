import { createTermResolver } from "@/platform/terminology/resolver"
import { reportLabel } from "./report-labels"
import type { TermReader } from "@/platform/terminology/read"
import { salesRecordAccess } from "@/platform/access/record-scope"
import type { PermissionRun } from "@/platform/access/server"
import { Prisma } from "@prisma/client"
import { CrmError, canManageCrm, type CrmActor } from "./policy"
import { salesReportSchema, type SalesReportQuery } from "./sales-report-validation"
import { businessDate, startOfBusinessDate } from "./work-time"
import type { CrmExtensions, CrmExtensionQuery, CrmReportDimension } from "./extensions"
import { checkExportLimit, CRM_EXPORT_LIMIT, crmCsv } from "./csv"
import type { SalesReportRecord, SalesLeadGroup, SalesValueGroup, SalesReportView } from "@/types/crm-sales-report"

type Tx = Prisma.TransactionClient
type Context = { readTerms: TermReader; run: PermissionRun }
const nextDay = (day: string, offset = 1) => new Date(Date.parse(`${day}T00:00:00Z`) + offset * 86400000).toISOString().slice(0, 10)
const pageResult = <T>(items: T[], total: number, q: SalesReportQuery) => ({ items, total, page: q.page, pageSize: q.pageSize, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) })

export function createSalesReportService({ run, readTerms }: Context, extensions: Pick<CrmExtensions, "report" | "splitQuery">) {
  async function context(tx: Tx, actor: CrmActor, q: SalesReportQuery, extensionQuery: CrmExtensionQuery) {
    const canManage = canManageCrm(actor.role)
    if (!canManage && (q.scope === "team" || (q.assignedUserId && q.assignedUserId !== actor.userId))) throw new CrmError(403, "Team sales reporting is available to managers only.")
    if (q.scope === "mine" && q.assignedUserId && q.assignedUserId !== actor.userId) throw new CrmError(400, "Choose team scope to report on another salesperson.")
    const extension = await extensions.report(tx, actor, extensionQuery)
    const dimensions: CrmReportDimension[] = [
      { key: "source", label: "Source", emptyLabel: "Unclassified / legacy source", value: Prisma.sql`"sourceId"`, display: Prisma.sql`source` },
      { key: "salesperson", label: "Salesperson", emptyLabel: "Unassigned", value: Prisma.sql`"assignedUserId"`, display: Prisma.sql`owner` },
      { key: "lostReason", label: "Lost reason", emptyLabel: "No reason / legacy closure", value: Prisma.sql`"lostReasonId"`, display: Prisma.sql`"lostReasonName"` },
      ...extension.dimensions,
    ]
    const dimension = dimensions.find(item => item.key === q.dimension)
    if (!dimension) throw new CrmError(403, "This report grouping is not available.")
    const timeZone = (await tx.appSetting.findUnique({ where: { tenantId: actor.tenantId }, select: { timeZone: true } }))?.timeZone || "UTC"
    const now = new Date(), today = businessDate(now, timeZone)
    const from = q.from || nextDay(today, -29), through = q.through || today
    const begin = startOfBusinessDate(from, timeZone), end = startOfBusinessDate(nextDay(through), timeZone)
    const owner = q.scope === "mine" ? actor.userId : q.assignedUserId
    // All identifiers are fixed application SQL; every user value is a bound
    // parameter. The same scoped sets power counts, drill-downs and downloads.
    const salesScopeSql = (alias: "r" | "o") => {
      const column = (name: string) => Prisma.raw(`${alias}."${name}"`)
      return salesRecordAccess(actor) === "ALL" ? Prisma.empty : Prisma.sql`AND (${column("assignedUserId")} = ${actor.userId}
        ${salesRecordAccess(actor) === "MANAGED_TEAMS" && actor.managedTeamIds?.length ? Prisma.sql`OR ${column("salesTeamId")} IN (${Prisma.join(actor.managedTeamIds)})` : Prisma.empty})`
    }
    const filter = Prisma.sql`r."tenantId" = ${actor.tenantId} ${salesScopeSql("r")}
      ${owner ? Prisma.sql`AND r."assignedUserId" = ${owner}` : Prisma.empty}
      ${q.lostReasonId ? Prisma.sql`AND r."lostReasonId" = ${q.lostReasonId}` : Prisma.empty}
      ${q.salesTeamId ? Prisma.sql`AND r."salesTeamId" = ${q.salesTeamId}` : Prisma.empty}
      ${q.sourceId ? Prisma.sql`AND r."sourceId" = ${q.sourceId}` : Prisma.empty}
      ${extension.filter}`
    const sharedColumns = Prisma.sql`r.id, r.title, r."tenantId", r."assignedUserId", r."sourceId", r."createdAt", r."lostReasonId", r."lostReasonName",
      c.name AS customer, u.name AS owner, COALESCE(s.name, r.source) AS source,
      ${extension.values} AS "extensionValues"`
    const joins = Prisma.sql`
      JOIN "CrmContact" c ON c.id = r."contactId" AND c."tenantId" = r."tenantId"
      JOIN "User" u ON u.id = r."assignedUserId" AND u."tenantId" = r."tenantId"
      LEFT JOIN "CrmLeadSource" s ON s.id = r."sourceId" AND s."tenantId" = r."tenantId"`
    const cte = Prisma.sql`WITH leads_all AS (
      SELECT ${sharedColumns}, r.status::text AS status,
        EXISTS (SELECT 1 FROM "CrmOpportunity" o WHERE o."tenantId" = r."tenantId" AND o."enquiryId" = r.id
          ${salesScopeSql("o")}) AS converted
      FROM "CrmEnquiry" r
      ${extension.enquiryJoins}
      ${joins} WHERE ${filter}
    ), leads AS (SELECT * FROM leads_all WHERE "createdAt" >= ${begin} AND "createdAt" < ${end}),
    deals AS (
      SELECT ${sharedColumns}, st.kind::text AS status, st.id AS "stageId", st.name AS stage, pl.name AS pipeline,
        r.amount, r.currency, r."closedAt", (NOT c.archived AND NOT st.archived AND NOT pl.archived) AS active
      FROM "CrmOpportunity" r
      ${extension.opportunityJoins}
      ${joins}
      JOIN "CrmStage" st ON st.id = r."stageId" AND st."tenantId" = r."tenantId"
      JOIN "CrmPipeline" pl ON pl.id = r."pipelineId" AND pl."tenantId" = r."tenantId"
      WHERE ${filter}
    ), pipeline AS (SELECT * FROM deals WHERE status = 'OPEN' AND active),
    won AS (SELECT * FROM deals WHERE status = 'WON' AND "closedAt" >= ${begin} AND "closedAt" < ${end}),
    lost AS (SELECT * FROM deals WHERE status = 'LOST' AND "closedAt" >= ${begin} AND "closedAt" < ${end}),
    gaps AS (SELECT * FROM pipeline d WHERE NOT EXISTS (SELECT 1 FROM "CrmTask" t WHERE t."tenantId" = d."tenantId" AND t."opportunityId" = d.id AND t.status IN ('OPEN', 'IN_PROGRESS'))),
    overdue AS (
      SELECT t.id, t.title, t.status::text AS status, t."createdAt", t."dueOn", COALESCE(l.customer, d.customer) AS customer,
        u.name AS owner, COALESCE(l.source, d.source) AS source, COALESCE(l."extensionValues", d."extensionValues") AS "extensionValues", COALESCE(l."lostReasonName", d."lostReasonName") AS "lostReasonName"
      FROM "CrmTask" t
      LEFT JOIN leads_all l ON l.id = t."enquiryId" AND l."tenantId" = t."tenantId"
      LEFT JOIN deals d ON d.id = t."opportunityId" AND d."tenantId" = t."tenantId"
      JOIN "User" u ON u.id = t."assignedUserId" AND u."tenantId" = t."tenantId"
      WHERE t."tenantId" = ${actor.tenantId} AND (l.id IS NOT NULL OR d.id IS NOT NULL)
        AND t.status IN ('OPEN', 'IN_PROGRESS') AND (t."startsAt" < ${now} OR (t."startsAt" IS NULL AND t."dueOn" < ${new Date(`${today}T00:00:00Z`)}))
    )`
    return { cte, dimension, columns: extension.columns, metadata: { from, through, today, timeZone, canManage, extensionColumns: extension.columns, dimensions: dimensions.map(({ key, label, emptyLabel, terminologyKey }) => ({ key, label, emptyLabel, ...(terminologyKey ? { terminologyKey } : {}) })), generatedAt: now.toISOString() } }
  }
  const table = (view: SalesReportView) => ({ leads: Prisma.sql`leads`, converted: Prisma.sql`leads`, pipeline: Prisma.sql`pipeline`, won: Prisma.sql`won`, lost: Prisma.sql`lost`, overdue: Prisma.sql`overdue`, gaps: Prisma.sql`gaps` })[view]

  function selection(q: SalesReportQuery, dimension: CrmReportDimension) {
    const lead = q.view === "leads" || q.view === "converted"
    return Prisma.sql`WHERE true ${lead && q.dimension === "lostReason" ? Prisma.sql`AND status = 'CLOSED'` : Prisma.empty} ${q.view === "converted" ? Prisma.sql`AND converted` : Prisma.empty}
      ${lead && q.bucket ? Prisma.sql`AND COALESCE(${dimension.value}, '__none__') = ${q.bucket}` : Prisma.empty}
      ${!lead && q.view !== "overdue" && q.stageId ? Prisma.sql`AND "stageId" = ${q.stageId}` : Prisma.empty}
      ${!lead && q.view !== "overdue" && q.currency ? Prisma.sql`AND currency = ${q.currency}` : Prisma.empty}`
  }
  async function records(tx: Tx, c: Awaited<ReturnType<typeof context>>, q: SalesReportQuery, exporting: boolean) {
    const { cte, dimension } = c
    const [{ total }] = await tx.$queryRaw<{ total: number }[]>(Prisma.sql`${cte} SELECT COUNT(*)::int AS total FROM ${table(q.view)} ${selection(q, dimension)}`)
    if (exporting) checkExportLimit(total)
    const lead = q.view === "leads" || q.view === "converted", work = q.view === "overdue"
    const items = await tx.$queryRaw<SalesReportRecord[]>(Prisma.sql`${cte}
      SELECT id, title, customer, owner, source, "extensionValues", status, "createdAt", "lostReasonName",
        ${lead || work ? Prisma.sql`NULL::text AS amount, NULL::text AS currency, NULL::timestamp AS "closedAt"` : Prisma.sql`amount::text, currency, "closedAt"`},
        ${work ? Prisma.sql`"dueOn"` : Prisma.sql`NULL::date`} AS "dueOn",
        ${lead ? "enquiries" : work ? "activities" : "opportunities"}::text AS "recordKind"
      FROM ${table(q.view)} ${selection(q, dimension)} ORDER BY "createdAt" DESC, id ASC
      LIMIT ${exporting ? CRM_EXPORT_LIMIT : q.pageSize} OFFSET ${exporting ? 0 : (q.page - 1) * q.pageSize}`)
    return pageResult(items.map(r => ({ ...r, createdAt: new Date(r.createdAt).toISOString(), closedAt: r.closedAt ? new Date(r.closedAt).toISOString() : null, dueOn: r.dueOn ? new Date(r.dueOn).toISOString().slice(0, 10) : null })), total, q)
  }
  return {
    salesOverview(input: unknown) {
      const split = extensions.splitQuery(input), q = salesReportSchema.parse(split.core)
      return run(["reports.read", "enquiries.read", "opportunities.read", "activities.read"], async (tx, actor) => {
        const c = await context(tx, actor, q, split.extension)
        const [totals] = await tx.$queryRaw<Record<SalesReportView, number>[]>(Prisma.sql`${c.cte} SELECT
          (SELECT COUNT(*)::int FROM leads) AS leads, (SELECT COUNT(*)::int FROM leads WHERE converted) AS converted,
          (SELECT COUNT(*)::int FROM pipeline) AS pipeline, (SELECT COUNT(*)::int FROM won) AS won,
          (SELECT COUNT(*)::int FROM lost) AS lost, (SELECT COUNT(*)::int FROM overdue) AS overdue, (SELECT COUNT(*)::int FROM gaps) AS gaps`)
        return { ...c.metadata, totals, conversionPercent: totals.leads ? Math.round(totals.converted / totals.leads * 10000) / 100 : 0 }
      })
    },
    salesLeadBreakdown(input: unknown) {
      const split = extensions.splitQuery(input), q = salesReportSchema.parse(split.core)
      return run(["reports.read", "enquiries.read", "opportunities.read", "activities.read"], async (tx, actor) => {
        const c = await context(tx, actor, q, split.extension), key = c.dimension.value
        const label = c.dimension.display
        const grouped = Prisma.sql`${c.cte}, groups AS (SELECT COALESCE(${key}, '__none__') AS id,
          CASE WHEN ${key} IS NULL THEN ${c.dimension.emptyLabel} ELSE COALESCE(MAX(${label}), 'Unnamed') END AS label,
          COUNT(*)::int AS leads, COUNT(*) FILTER (WHERE converted)::int AS converted FROM leads ${q.dimension === "lostReason" ? Prisma.sql`WHERE status = 'CLOSED'` : Prisma.empty} GROUP BY ${key})`
        const [{ total }] = await tx.$queryRaw<{ total: number }[]>(Prisma.sql`${grouped} SELECT COUNT(*)::int AS total FROM groups`)
        const items = await tx.$queryRaw<SalesLeadGroup[]>(Prisma.sql`${grouped} SELECT * FROM groups ORDER BY label, id LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`)
        return pageResult(items, total, q)
      })
    },
    salesValueBreakdown(input: unknown) {
      const split = extensions.splitQuery(input), q = salesReportSchema.parse(split.core)
      if (!["pipeline", "won", "lost"].includes(q.view)) throw new CrmError(400, "Choose pipeline, won or lost values.")
      return run(["reports.read", "enquiries.read", "opportunities.read", "activities.read"], async (tx, actor) => {
        const c = await context(tx, actor, q, split.extension)
        const grouped = Prisma.sql`${c.cte}, groups AS (SELECT "stageId", stage, pipeline, currency, COUNT(*)::int AS count, SUM(amount)::text AS amount FROM ${table(q.view)} GROUP BY "stageId", stage, pipeline, currency)`
        const [{ total }] = await tx.$queryRaw<{ total: number }[]>(Prisma.sql`${grouped} SELECT COUNT(*)::int AS total FROM groups`)
        const items = await tx.$queryRaw<SalesValueGroup[]>(Prisma.sql`${grouped} SELECT * FROM groups ORDER BY pipeline, stage, "stageId", currency LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`)
        return pageResult(items, total, q)
      })
    },
    salesReportRecords(input: unknown) {
      const split = extensions.splitQuery(input), q = salesReportSchema.parse(split.core)
      return run(["reports.read", "enquiries.read", "opportunities.read", "activities.read"], async (tx, actor) => records(tx, await context(tx, actor, q, split.extension), q, false))
    },
    exportSalesReport(input: unknown) {
      const split = extensions.splitQuery(input), q = salesReportSchema.parse(split.core)
      return run(["reports.read", "reports.export", "enquiries.read", "opportunities.read", "activities.read", q.view === "leads" || q.view === "converted" ? "enquiries.export" : q.view === "overdue" ? "activities.export" : "opportunities.export"], async (tx, actor) => {
        const c = await context(tx, actor, q, split.extension), result = await records(tx, c, q, true)
        const term = createTermResolver(await readTerms(tx, actor))
        return crmCsv(["ID", "Title", "Record type", term("crm.contact.singular", "Customer"), "Assigned staff", "Source", ...c.columns.map(column => reportLabel(term, column)), "Status / outcome", "Lost reason", term("crm.opportunity.singular", "Deal value", "{label} value"), "Currency", "Created (UTC)", "Closed (UTC)", "Due date"],
          result.items.map(r => [r.id, r.title, r.recordKind, r.customer, r.owner, r.source, ...c.columns.map(column => r.extensionValues[column.key]), r.status === "CLOSED" ? "Lost" : r.status, r.lostReasonName, r.amount, r.currency, r.createdAt, r.closedAt, r.dueOn]))
      })
    },
  }
}
