import { hasIntroductionFilter } from "@/platform/collaborators/report-validation"
import { introductionWhere, responsibleUserWhere, introductionSql, responsibleUserSql } from "@/platform/collaborators/report-scope"
import { workAttributionWhere } from "./attribution-scope"
import { permits } from "@/platform/access/policy"
import { ownedRecordSql } from "@/platform/access/record-scope"
import { attributionChoiceSchema } from "@/platform/collaborators/report-validation"
import { peopleScope } from "@/platform/access/people-scope"
import { opportunityScope } from "@/modules/crm/policy"
import { termText } from "@/platform/terminology/message"
import { activityTeamFilter, requireSalesTeamFilter } from "./team-filter"
import { recordLimits, scopeAllowsOthers } from "@/platform/access/rules"
import { accessListSchema } from "@/platform/access/validation"
import type { PermissionRun } from "@/platform/access/server"
import { Prisma } from "@prisma/client"
import { CrmError, type CrmActor } from "./policy"
import { activityReportSchema, activityReportPageSchema, type ActivityReportInput } from "./report-validation"
import { businessDate, startOfBusinessDate } from "./work-time"
import { workScope, workScopeSql } from "./work-scope"
import { workTypes } from "./work-validation"

type Tx = Prisma.TransactionClient
type Context = { run: PermissionRun }
const open = ["OPEN", "IN_PROGRESS"] as const
const dateAfter = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10)
const pageResult = <T>(items: T[], total: number, page: number, pageSize: number) => ({ items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) })

export function createReportService({ run }: Context) {
  async function context(tx: Tx, actor: CrmActor, query: ActivityReportInput) {
    const canManage = scopeAllowsOthers(actor, "reports")
    if (!canManage && (query.scope === "team" || (query.assignedUserId && query.assignedUserId !== actor.userId))) throw new CrmError(403, termText("crm.activity.singular", "Your record limits do not include team reporting.", "Your record limits do not include team reporting."))
    if (query.scope === "mine" && query.assignedUserId && query.assignedUserId !== actor.userId) throw new CrmError(400, "Choose team scope to report on another staff member.")
    const timeZone = (await tx.appSetting.findUnique({ where: { tenantId: actor.tenantId }, select: { timeZone: true } }))?.timeZone || "UTC"
    const now = new Date(), today = businessDate(now, timeZone)
    const from = query.from || dateAfter(today, -29), through = query.through || today
    const owner = query.scope === "mine" ? actor.userId : query.assignedUserId
    if (query.salesTeamId && query.scope !== "team") throw new CrmError(400, "Choose all accessible work before filtering a team.")
    await requireSalesTeamFilter(tx, actor, query.salesTeamId)
    const base: Prisma.CrmTaskWhereInput = { AND: [workScope(actor), workAttributionWhere(actor, query), ...(query.salesTeamId ? [activityTeamFilter(query.salesTeamId)] : [])], tenantId: actor.tenantId, assignedUserId: owner, type: query.type, activityTypeId: query.activityTypeId }
    const completed: Prisma.CrmTaskWhereInput = { status: "COMPLETED", completedAt: { gte: startOfBusinessDate(from, timeZone), lt: startOfBusinessDate(dateAfter(through, 1), timeZone) } }
    const overdue: Prisma.CrmTaskWhereInput = { status: { in: [...open] }, OR: [{ startsAt: { lt: now } }, { startsAt: null, dueOn: { lt: new Date(`${today}T00:00:00Z`) } }] }
    const dueToday: Prisma.CrmTaskWhereInput = { status: { in: [...open] }, dueOn: new Date(`${today}T00:00:00Z`) }
    const gaps: Prisma.CrmOpportunityWhereInput = { AND: [opportunityScope(actor, "read"), introductionWhere(query)], assignee: responsibleUserWhere(query), salesTeamId: query.salesTeamId, assignedUserId: owner, pipeline: { archived: false }, stage: { kind: "OPEN", archived: false }, contact: { archived: false }, workItems: { none: { tenantId: actor.tenantId, status: { in: [...open] } } } }
    return { base, completed, overdue, dueToday, gaps, owner, metadata: { from, through, today, timeZone, scope: query.scope, canManage, canFilterOrigin: permits(actor, "enquiries.read") && permits(actor, "opportunities.read"), generatedAt: now.toISOString() } }
  }
  return {
    activityAttributionChoices(input: unknown) {
      const { choice, q: search, selectedId, ...filters } = (input && typeof input === "object" && !Array.isArray(input) ? input : {}) as Record<string, unknown>
      const query = attributionChoiceSchema.parse({ choice, q: search, selectedId }), q = activityReportPageSchema.parse(filters)
      return run(["reports.read", "activities.read", "enquiries.read", "opportunities.read"], async (tx, actor) => {
        const c = await context(tx, actor, q), begin = startOfBusinessDate(c.metadata.from, c.metadata.timeZone), end = startOfBusinessDate(dateAfter(c.metadata.through, 1), c.metadata.timeZone)
        const owner = (alias: string) => c.owner ? Prisma.sql`AND ${Prisma.raw(alias)}."assignedUserId"=${c.owner}` : Prisma.empty
        const source = (alias: string, resource: "enquiries" | "opportunities") => Prisma.sql`(${Prisma.raw(alias)}.id IS NOT NULL AND ${ownedRecordSql(actor, resource, alias, "read")} AND ${introductionSql(q, alias)})`
        const cte = Prisma.sql`WITH visible_sources AS (
          SELECT t.id,t."createdAt",COALESCE(e."introducedByCollaboratorId",p."introducedByCollaboratorId") AS partner,
            COALESCE(e."partnerAttribution",p."partnerAttribution") AS evidence
          FROM "CrmTask" t JOIN "User" u ON u."tenantId"=t."tenantId" AND u.id=t."assignedUserId"
          LEFT JOIN "CrmEnquiry" e ON e."tenantId"=t."tenantId" AND e.id=t."enquiryId"
          LEFT JOIN "CrmOpportunity" p ON p."tenantId"=t."tenantId" AND p.id=t."opportunityId"
          WHERE ${workScopeSql(actor, "t")} AND ${responsibleUserSql(q, "u")} ${owner("t")}
            ${q.type ? Prisma.sql`AND t.type::text=${q.type}` : Prisma.empty} ${q.activityTypeId ? Prisma.sql`AND t."activityTypeId"=${q.activityTypeId}` : Prisma.empty}
            ${q.salesTeamId ? Prisma.sql`AND (e."salesTeamId"=${q.salesTeamId} OR p."salesTeamId"=${q.salesTeamId})` : Prisma.empty}
            AND (t.status IN ('OPEN','IN_PROGRESS') OR (t.status='COMPLETED' AND t."completedAt">=${begin} AND t."completedAt"<${end}))
            AND (${source("e", "enquiries")} OR ${source("p", "opportunities")})
          UNION ALL
          SELECT p.id,p."createdAt",p."introducedByCollaboratorId",p."partnerAttribution"
          FROM "CrmOpportunity" p JOIN "User" u ON u."tenantId"=p."tenantId" AND u.id=p."assignedUserId"
          JOIN "CrmStage" st ON st."tenantId"=p."tenantId" AND st.id=p."stageId" AND st.kind='OPEN' AND NOT st.archived
          JOIN "CrmPipeline" pl ON pl."tenantId"=p."tenantId" AND pl.id=p."pipelineId" AND NOT pl.archived
          JOIN "CrmContact" buyer ON buyer."tenantId"=p."tenantId" AND buyer.id=p."contactId" AND NOT buyer.archived
          WHERE p."tenantId"=${actor.tenantId} AND ${source("p", "opportunities")} AND ${responsibleUserSql(q, "u")} ${owner("p")}
            ${q.salesTeamId ? Prisma.sql`AND p."salesTeamId"=${q.salesTeamId}` : Prisma.empty}
            AND NOT EXISTS(SELECT 1 FROM "CrmTask" t WHERE t."tenantId"=p."tenantId" AND t."opportunityId"=p.id AND t.status IN ('OPEN','IN_PROGRESS'))
        ), projected AS (
          SELECT s.id,s."createdAt",s.partner,s.evidence->>'supervisorUserId' AS supervisor,
            s.evidence->>'name'||' ('||(s.evidence->>'code')||')' AS "partnerName",
            COALESCE(NULLIF(btrim(u.name),''),CASE WHEN u.id IS NULL THEN 'Former supervisor' ELSE 'Unnamed supervisor' END) AS "supervisorName"
          FROM visible_sources s LEFT JOIN "User" u ON u."tenantId"=${actor.tenantId} AND u.id=s.evidence->>'supervisorUserId'
        )`
        const key = query.choice === "partner" ? Prisma.sql`partner` : Prisma.sql`supervisor`, name = query.choice === "partner" ? Prisma.sql`"partnerName"` : Prisma.sql`"supervisorName"`
        const choices = Prisma.sql`${cte}, labels AS (SELECT DISTINCT ON (${key}) ${key} AS id,${name} AS name FROM projected WHERE ${key} IS NOT NULL ORDER BY ${key},"createdAt" DESC,projected.id), choices AS (SELECT * FROM labels WHERE name ILIKE ${"%"+query.q+"%"} ${query.selectedId ? Prisma.sql`AND id=${query.selectedId}` : Prisma.empty})`
        const [{ total }] = await tx.$queryRaw<{ total: number }[]>(Prisma.sql`${choices} SELECT COUNT(*)::int AS total FROM choices`)
        const items = await tx.$queryRaw<{ id: string; name: string }[]>(Prisma.sql`${choices} SELECT * FROM choices ORDER BY name,id LIMIT ${q.pageSize} OFFSET ${(q.page-1)*q.pageSize}`)
        return pageResult(items,total,q.page,q.pageSize)
      })
    },
    listReportTeams(input: unknown) {
      const q = accessListSchema.parse(input)
      return run(["reports.read", "activities.read", "opportunities.read"], async (tx, actor) => {
        if (!scopeAllowsOthers(actor, "reports")) throw new CrmError(403, "Your record limits do not include team reporting.")
        const where = { tenantId: actor.tenantId, ...(recordLimits(actor, "activities", "read").length === 0 ? {} : { id: { in: actor.managedTeamIds ?? [] } }), name: { contains: q.q, mode: "insensitive" as const } }
        const [items, total] = await Promise.all([tx.businessTeam.findMany({ where, select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }), tx.businessTeam.count({ where })])
        return pageResult(items, total, q.page, q.pageSize)
      })
    },
    activityOverview(input: unknown) {
      const query = activityReportSchema.parse(input)
      return run(["reports.read", "activities.read", "opportunities.read"], async (tx, actor) => {
        const c = await context(tx, actor, query)
        const [pending, overdue, dueToday, completed, outcomes, withoutActivity] = await Promise.all([
          tx.crmTask.groupBy({ by: ["type"], where: { AND: [c.base, { status: { in: [...open] } }] }, _count: { _all: true } }),
          tx.crmTask.count({ where: { AND: [c.base, c.overdue] } }),
          tx.crmTask.count({ where: { AND: [c.base, c.dueToday] } }),
          tx.crmTask.groupBy({ by: ["type"], where: { AND: [c.base, c.completed] }, _count: { _all: true } }),
          tx.crmTask.groupBy({ by: ["outcome"], where: { AND: [c.base, c.completed, { type: "CALL" }] }, _count: { _all: true }, orderBy: { outcome: "asc" } }),
          tx.crmOpportunity.count({ where: c.gaps }),
        ])
        const activityType = query.activityTypeId ? await tx.crmActivityType.findFirst({ where: { tenantId: actor.tenantId, id: query.activityTypeId }, select: { name: true, baseType: true } }) : null
        const byType = workTypes.filter(type => (!query.type || query.type === type) && (!activityType || activityType.baseType === type)).map(type => ({ type, open: pending.find(row => row.type === type)?._count._all || 0, completed: completed.find(row => row.type === type)?._count._all || 0 }))
        return { ...c.metadata, activityTypeName: activityType?.name || null, totals: { open: byType.reduce((sum, row) => sum + row.open, 0), overdue, dueToday, completed: byType.reduce((sum, row) => sum + row.completed, 0), withoutActivity }, byType,
          callOutcomes: outcomes.map(row => ({ outcome: row.outcome || "UNKNOWN", count: row._count._all })) }
      })
    },
    staffActivityReport(input: unknown) {
      const query = activityReportPageSchema.parse(input)
      return run(["reports.read", "activities.read", "opportunities.read"], async (tx, actor) => {
        const c = await context(tx, actor, query)
        // Include former staff who still own activities, so their backlog cannot disappear.
        const where: Prisma.UserWhereInput = { AND: [responsibleUserWhere(query), ...(hasIntroductionFilter(query) ? [{ crmAssignedWork: { some: { AND: [c.base, { OR: [{ status: { in: [...open] } }, c.completed] }] } } }] : []),{ OR: [peopleScope(actor), { crmAssignedWork: { some: workScope(actor) } }] }, ...(query.salesTeamId ? [{ OR: [{ businessTeamMemberships: { some: { tenantId: actor.tenantId, teamId: query.salesTeamId } } }, { crmAssignedWork: { some: c.base } }] }] : [])], tenantId: actor.tenantId, id: c.owner, OR: [{ role: { in: ["ADMIN", "MANAGER", "STAFF"] } }, { crmAssignedWork: { some: { tenantId: actor.tenantId } } }] }
        const [users, total] = await Promise.all([tx.user.findMany({ where, select: { id: true, name: true, status: true, collaboratorId: true }, orderBy: [{ name: "asc" }, { id: "asc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }), tx.user.count({ where })])
        const base = { ...c.base, assignedUserId: { in: users.map(user => user.id) } }
        const counts = await Promise.all([{ status: { in: [...open] } }, c.overdue, c.dueToday, c.completed].map(filter => tx.crmTask.groupBy({ by: ["assignedUserId"], where: { AND: [base, filter] }, _count: { _all: true } })))
        return { ...c.metadata, ...pageResult(users.map(({ collaboratorId, ...user }) => ({ ...user, userType: collaboratorId ? "external" : "internal", open: counts[0].find(row => row.assignedUserId === user.id)?._count._all || 0, overdue: counts[1].find(row => row.assignedUserId === user.id)?._count._all || 0, dueToday: counts[2].find(row => row.assignedUserId === user.id)?._count._all || 0, completed: counts[3].find(row => row.assignedUserId === user.id)?._count._all || 0 })), total, query.page, query.pageSize) }
      })
    },
    opportunitiesWithoutActivity(input: unknown) {
      const query = activityReportPageSchema.parse(input)
      return run(["reports.read", "activities.read", "opportunities.read"], async (tx, actor) => {
        const c = await context(tx, actor, query)
        const [items, total] = await Promise.all([tx.crmOpportunity.findMany({ where: c.gaps, select: { id: true, title: true, expectedCloseOn: true, contact: { select: { id: true, name: true } }, assignee: { select: { id: true, name: true } }, pipeline: { select: { name: true } }, stage: { select: { name: true } } }, orderBy: [{ expectedCloseOn: "asc" }, { id: "asc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }), tx.crmOpportunity.count({ where: c.gaps })])
        return pageResult(items, total, query.page, query.pageSize)
      })
    },
  }
}
