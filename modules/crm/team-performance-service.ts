import { Prisma } from "@prisma/client"
import type { PermissionRun } from "@/platform/access/server"
import { permits } from "@/platform/access/policy"
import { recordLimits, scopeAllowsOthers } from "@/platform/access/rules"
import { responsibleUserSql } from "@/platform/collaborators/report-scope"
import { hasIntroductionFilter, attributionChoiceSchema } from "@/platform/collaborators/report-validation"
import type { SalesReportSummary } from "@/types/crm-sales-report"
import type { CrmActor } from "./policy"
import { CrmError } from "./policy"
import type { CrmExtensions, CrmExtensionQuery } from "./extensions"
import type { SalesReportQuery } from "./sales-report-validation"
import { teamPerformanceSchema, type TeamPerformanceQuery } from "./team-performance-validation"
import { teamMetricKeys, teamMetricLabel, type TeamMetric, type TeamPerformanceRow, type TeamPerformanceRecord } from "./team-performance-contract"
import { createTermResolver } from "@/platform/terminology/resolver"
import type { TermReader } from "@/platform/terminology/read"
import { workScopeSql } from "./work-scope"
import { requireSalesTeamFilter } from "./team-filter"
import { startOfBusinessDate } from "./work-time"
import { checkExportLimit, CRM_EXPORT_LIMIT, crmCsv } from "./csv"

type Tx = Prisma.TransactionClient
type Sources = { cte: Prisma.Sql; metadata: Pick<SalesReportSummary, "from" | "through" | "timeZone" | "today" | "generatedAt"> }
type Context = {
  run: PermissionRun
  readTerms: TermReader
  context: (tx: Tx, actor: CrmActor, q: SalesReportQuery, extension: CrmExtensionQuery) => Promise<Sources>
  extensions: Pick<CrmExtensions, "splitQuery">
}
const requirements = ["reports.read", "enquiries.read", "opportunities.read", "activities.read"] as const
const exportRequirements = [...requirements, "reports.export", "enquiries.export", "opportunities.export", "activities.export"] as const
const page = <T>(items: T[], total: number, q: TeamPerformanceQuery) => ({ items, total, page: q.page, pageSize: q.pageSize, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) })
const conversion = (r: { enquiries: number; converted: number }) => r.enquiries ? Math.round(10000 * r.converted / r.enquiries) / 100 : null

export function createTeamPerformanceService({ run, context, extensions, readTerms }: Context) {
  async function prepare(tx: Tx, actor: CrmActor, q: TeamPerformanceQuery, extension: CrmExtensionQuery) {
    if (q.bucket || q.stageId || q.currency || q.activityTypeId || q.dimension !== "source" || q.view !== "leads") throw new CrmError(400, "Use the team performance filters and metric selection.")
    if (!scopeAllowsOthers(actor, "reports")) throw new CrmError(403, "Your record limits do not include team reporting.")
    const team = await requireSalesTeamFilter(tx, actor, q.salesTeamId)
    // Source-owner and activity-owner are independent. Apply the selected user
    // and user type after source resolution, never to an activity's parent owner.
    const c = await context(tx, actor, { ...q, assignedUserId: undefined, responsibleType: "all" }, extension)
    const { from, through, today, timeZone } = c.metadata
    const begin = startOfBusinessDate(from, timeZone)
    const end = startOfBusinessDate(new Date(Date.parse(through + "T00:00:00Z") + 86400000).toISOString().slice(0, 10), timeZone)
    const sourceFiltered = !!(q.salesTeamId || q.sourceId || q.lostReasonId || Object.values(extension).some(Boolean) || hasIntroductionFilter(q))
    const canReadRoster = permits(actor, "teamMembers.read")
    const rosterBounds = Prisma.join([Prisma.sql`TRUE`, ...recordLimits(actor, "teamMembers", "read").map(limit => {
      const ids = limit === "MANAGED_TEAMS" ? actor.managedTeamIds : actor.memberTeamIds
      return limit === "NONE" ? Prisma.sql`FALSE` : ids?.length ? Prisma.sql`m."teamId" IN (${Prisma.join(ids)})` : Prisma.sql`FALSE`
    })], " AND ")
    const roster = canReadRoster ? Prisma.sql`EXISTS(SELECT 1 FROM "BusinessTeamMember" m WHERE m."tenantId"=u."tenantId" AND m."userId"=u.id AND ${rosterBounds} ${q.salesTeamId ? Prisma.sql`AND m."teamId"=${q.salesTeamId}` : Prisma.empty})` : Prisma.sql`FALSE`
    const sourceFacts: Record<TeamMetric, { set: string; condition: string }> = {
      enquiries: { set: "leads", condition: "TRUE" }, new: { set: "leads", condition: "status='NEW'" }, contacted: { set: "leads", condition: "status='CONTACTED'" }, qualified: { set: "leads", condition: "status='QUALIFIED'" }, closed: { set: "leads", condition: "status='CLOSED'" }, converted: { set: "leads", condition: "converted" },
      pipeline: { set: "pipeline", condition: "TRUE" }, won: { set: "won", condition: "TRUE" }, lost: { set: "lost", condition: "TRUE" }, gaps: { set: "gaps", condition: "TRUE" },
      activitiesOpen: { set: "work", condition: "status='OPEN'" }, activitiesInProgress: { set: "work", condition: "status='IN_PROGRESS'" }, activitiesOverdue: { set: "work", condition: "pending AND overdue" }, activitiesDueToday: { set: "work", condition: "pending AND today" },
      activitiesCompleted: { set: "work", condition: "completed" }, activitiesCancelled: { set: "work", condition: "status='CANCELLED' AND created" },
      callsCompleted: { set: "work", condition: "completed AND type='CALL'" },
      ...Object.fromEntries(([['connected', 'CONNECTED'], ['noAnswer', 'NO_ANSWER'], ['busy', 'BUSY'], ['voicemail', 'VOICEMAIL'], ['wrongNumber', 'WRONG_NUMBER'], ['notInterested', 'NOT_INTERESTED']] as const).map(([key, value]) => [key, { set: "work", condition: `completed AND type='CALL' AND outcome='${value}'` }])),
      unknownOutcome: { set: "work", condition: "completed AND type='CALL' AND (outcome IS NULL OR outcome NOT IN ('CONNECTED','NO_ANSWER','BUSY','VOICEMAIL','WRONG_NUMBER','NOT_INTERESTED'))" },
    } as Record<TeamMetric, { set: string; condition: string }>
    // This closed UNION is the single population for counts, values, details and
    // exports. Native source/sharing/office RLS remains active for every table.
    const facts = Prisma.join(teamMetricKeys.map(metric => {
      const { set, condition } = sourceFacts[metric], work = set === "work", lead = set === "leads"
      return Prisma.sql`SELECT id,title,"assignedUserId",status,${metric}::text AS metric,${work ? "activities" : lead ? "enquiries" : "opportunities"}::text AS kind,
        "introducedByCollaboratorId","partnerName","partnerCode","introductionSupervisorId","introductionSupervisorName",
        ${work || lead ? Prisma.sql`NULL::numeric AS amount,NULL::text AS currency` : Prisma.sql`amount,currency`} FROM ${Prisma.raw(set)} WHERE ${Prisma.raw(condition)}`
    }), " UNION ALL ")
    const counts = Prisma.join(teamMetricKeys.map(key => Prisma.sql`COUNT(f.id) FILTER(WHERE f.metric=${key})::int AS ${Prisma.raw('"' + key + '"')}`))
    const cte = Prisma.sql`${c.cte}, work AS (
      SELECT t.id,t.title,t."assignedUserId",t.status::text,t.type::text,t.outcome,
        COALESCE(e."introducedByCollaboratorId",d."introducedByCollaboratorId") AS "introducedByCollaboratorId",
        COALESCE(e."partnerName",d."partnerName") AS "partnerName",COALESCE(e."partnerCode",d."partnerCode") AS "partnerCode",
        COALESCE(e."introductionSupervisorId",d."introductionSupervisorId") AS "introductionSupervisorId",COALESCE(e."introductionSupervisorName",d."introductionSupervisorName") AS "introductionSupervisorName",
        t.status IN ('OPEN','IN_PROGRESS') AS pending,
        (t."startsAt"<${new Date(c.metadata.generatedAt)} OR (t."startsAt" IS NULL AND t."dueOn"<${new Date(today + 'T00:00:00Z')})) AS overdue,
        t."dueOn"=${new Date(today + 'T00:00:00Z')} AS today,
        t.status='COMPLETED' AND t."completedAt">=${begin} AND t."completedAt"<${end} AS completed,
        t."createdAt">=${begin} AND t."createdAt"<${end} AS created
      FROM "CrmTask" t
      LEFT JOIN leads_all e ON e.id=t."enquiryId" AND e."tenantId"=t."tenantId"
      LEFT JOIN deals d ON d.id=t."opportunityId" AND d."tenantId"=t."tenantId"
      WHERE ${workScopeSql(actor, "t")} ${sourceFiltered ? Prisma.sql`AND (e.id IS NOT NULL OR d.id IS NOT NULL)` : Prisma.empty}
    ), facts AS (${facts}), members AS (
      SELECT u.id,COALESCE(NULLIF(btrim(u.name),''),'Unnamed user') AS name,u.status::text,
        CASE WHEN u."collaboratorId" IS NULL THEN 'internal' ELSE 'external' END AS "userType",${roster} AS "isMember"
      FROM "User" u WHERE u."tenantId"=${actor.tenantId} AND ${responsibleUserSql(q, "u")}
        ${q.assignedUserId ? Prisma.sql`AND u.id=${q.assignedUserId}` : Prisma.empty}
        AND COALESCE(u.name,'') ILIKE ${"%" + q.q + "%"}
        AND (${roster} OR EXISTS(SELECT 1 FROM facts f WHERE f."assignedUserId"=u.id))
    ), stats AS (
      SELECT m.*,${counts} FROM members m LEFT JOIN facts f ON f."assignedUserId"=m.id GROUP BY m.id,m.name,m.status,m."userType",m."isMember"
    ), ranked AS (SELECT *,CASE WHEN enquiries=0 THEN NULL ELSE round(converted::numeric/enquiries*100,2)::float8 END AS "conversionPercent" FROM stats)`
    return { cte, metadata: { ...c.metadata, canReadRoster, team } }
  }
  const order = (q: TeamPerformanceQuery) => Prisma.sql`${Prisma.raw('"' + q.sort + '"')} ${Prisma.raw(q.order.toUpperCase())} NULLS LAST,name,id`
  async function results(tx: Tx, c: Awaited<ReturnType<typeof prepare>>, q: TeamPerformanceQuery, exporting = false) {
    const [{ total }] = await tx.$queryRaw<{ total: number }[]>(Prisma.sql`${c.cte} SELECT count(*)::int AS total FROM members`)
    if (exporting) checkExportLimit(total)
    const sums = Prisma.join(teamMetricKeys.map(key => Prisma.sql`COALESCE(SUM(${Prisma.raw('"' + key + '"')}),0)::int AS ${Prisma.raw('"' + key + '"')}`))
    const [totals] = await tx.$queryRaw<TeamPerformanceRow[]>(Prisma.sql`${c.cte} SELECT ${sums} FROM stats`)
    const items = await tx.$queryRaw<TeamPerformanceRow[]>(Prisma.sql`${c.cte} SELECT * FROM ranked ORDER BY ${order(q)} LIMIT ${exporting ? CRM_EXPORT_LIMIT : q.pageSize} OFFSET ${exporting ? 0 : (q.page - 1) * q.pageSize}`)
    const values = items.length ? await tx.$queryRaw<{ assignedUserId: string; currency: string; amount: string }[]>(Prisma.sql`${c.cte} SELECT f."assignedUserId",f.currency,SUM(f.amount)::text AS amount FROM facts f WHERE metric='pipeline' AND f."assignedUserId" IN (${Prisma.join(items.map(r => r.id))}) GROUP BY f."assignedUserId",f.currency ORDER BY f.currency`) : []
    const totalValues = await tx.$queryRaw<{ currency: string; amount: string }[]>(Prisma.sql`${c.cte} SELECT currency,SUM(amount)::text AS amount FROM facts f JOIN members m ON m.id=f."assignedUserId" WHERE metric='pipeline' GROUP BY currency ORDER BY currency`)
    return { ...c.metadata, ...page(items.map(row => ({ ...row, pipelineValues: values.filter(v => v.assignedUserId === row.id).map(({ currency, amount }) => ({ currency, amount })) })), total, q), totals: { ...totals, conversionPercent: conversion(totals), pipelineValues: totalValues } }
  }
  const parse = (input: unknown) => { const split = extensions.splitQuery(input); return { q: teamPerformanceSchema.parse(split.core), extension: split.extension } }
  return {
    teamPerformanceAttributionChoices(input: unknown) {
      const { choice, q: search, selectedId, ...filters } = (input && typeof input === "object" && !Array.isArray(input) ? input : {}) as Record<string, unknown>
      const query = attributionChoiceSchema.parse({ choice, q: search, selectedId }), { q, extension } = parse(filters)
      return run(requirements, async (tx, actor) => {
        const c = await prepare(tx, actor, q, extension)
        const key = query.choice === "partner" ? Prisma.sql`"introducedByCollaboratorId"` : Prisma.sql`"introductionSupervisorId"`
        const label = query.choice === "partner" ? Prisma.sql`"partnerName"||' ('||"partnerCode"||')'` : Prisma.sql`COALESCE("introductionSupervisorName",'Former supervisor')`
        const choices = Prisma.sql`${c.cte}, labels AS (SELECT DISTINCT ON (${key}) ${key} AS id,${label} AS name FROM facts f JOIN members m ON m.id=f."assignedUserId" WHERE ${key} IS NOT NULL ORDER BY ${key},f.id), choices AS (SELECT * FROM labels WHERE name ILIKE ${"%"+query.q+"%"} ${query.selectedId ? Prisma.sql`AND id=${query.selectedId}` : Prisma.empty})`
        const [{ total }] = await tx.$queryRaw<{ total: number }[]>(Prisma.sql`${choices} SELECT count(*)::int AS total FROM choices`)
        const items = await tx.$queryRaw<{ id: string; name: string }[]>(Prisma.sql`${choices} SELECT * FROM choices ORDER BY name,id LIMIT ${q.pageSize} OFFSET ${(q.page-1)*q.pageSize}`)
        return page(items, total, q)
      })
    },
    teamPerformance(input: unknown) {
      const { q, extension } = parse(input)
      return run(requirements, async (tx, actor) => results(tx, await prepare(tx, actor, q, extension), q))
    },
    teamPerformanceRecords(input: unknown) {
      const { q, extension } = parse(input)
      return run(requirements, async (tx, actor) => {
        const c = await prepare(tx, actor, q, extension)
        const [{ total }] = await tx.$queryRaw<{ total: number }[]>(Prisma.sql`${c.cte} SELECT count(*)::int AS total FROM facts f JOIN members m ON m.id=f."assignedUserId" WHERE metric=${q.metric}`)
        const items = await tx.$queryRaw<TeamPerformanceRecord[]>(Prisma.sql`${c.cte} SELECT f.id,f.title,f.kind,f."assignedUserId",m.name AS owner,f.status,f.currency,f.amount::text FROM facts f JOIN members m ON m.id=f."assignedUserId" WHERE metric=${q.metric} ORDER BY m.name,f.title,f.id LIMIT ${q.pageSize} OFFSET ${(q.page-1)*q.pageSize}`)
        return page(items, total, q)
      })
    },
    exportTeamPerformance(input: unknown) {
      const { q, extension } = parse(input)
      return run(exportRequirements, async (tx, actor) => {
        if (!scopeAllowsOthers(actor, "reports", "export")) throw new CrmError(403, "Your export record limits do not include team reporting.")
        const result = await results(tx, await prepare(tx, actor, q, extension), q, true)
        const term = createTermResolver(await readTerms(tx, actor))
        const values = (r: typeof result.totals) => [...teamMetricKeys.map(key => r[key]), r.conversionPercent, r.pipelineValues.map(v => `${v.currency} ${v.amount}`).join("; ")]
        return crmCsv(["User", "Account status", "User type", "Current team member", "Sales team", "From", "Through", "Time zone", ...teamMetricKeys.map(key => teamMetricLabel(term, key)), "Conversion %", "Open pipeline values (by currency)"], [
          ...result.items.map(r => [r.name,r.status,r.userType,r.isMember ? "Yes" : "No",result.team?.name || "All accessible teams",result.from,result.through,result.timeZone,...values(r)]),
          ["Team total","","","",result.team?.name || "All accessible teams",result.from,result.through,result.timeZone,...values(result.totals)],
        ])
      })
    },
  }
}
