import type { Prisma } from "@prisma/client"
import { CrmError, canManageCrm, type CrmActor } from "./policy"
import { activityReportSchema, activityReportPageSchema, type ActivityReportInput } from "./report-validation"
import { businessDate, startOfBusinessDate } from "./work-time"
import { workTypes } from "./work-validation"

type Tx = Prisma.TransactionClient
type Context = { run: <T>(operation: (tx: Tx, actor: CrmActor) => Promise<T>) => Promise<T> }
const open = ["OPEN", "IN_PROGRESS"] as const
const dateAfter = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10)
const pageResult = <T>(items: T[], total: number, page: number, pageSize: number) => ({ items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) })

export function createReportService({ run }: Context) {
  async function context(tx: Tx, actor: CrmActor, query: ActivityReportInput) {
    const canManage = canManageCrm(actor.role)
    if (!canManage && (query.scope === "team" || (query.assignedUserId && query.assignedUserId !== actor.userId))) throw new CrmError(403, "Team activity reporting is available to managers only.")
    if (query.scope === "mine" && query.assignedUserId && query.assignedUserId !== actor.userId) throw new CrmError(400, "Choose team scope to report on another staff member.")
    const timeZone = (await tx.appSetting.findUnique({ where: { tenantId: actor.tenantId }, select: { timeZone: true } }))?.timeZone || "UTC"
    const now = new Date(), today = businessDate(now, timeZone)
    const from = query.from || dateAfter(today, -29), through = query.through || today
    const owner = query.scope === "mine" ? actor.userId : query.assignedUserId
    const base: Prisma.CrmTaskWhereInput = { tenantId: actor.tenantId, assignedUserId: owner, type: query.type, activityTypeId: query.activityTypeId }
    const completed: Prisma.CrmTaskWhereInput = { status: "COMPLETED", completedAt: { gte: startOfBusinessDate(from, timeZone), lt: startOfBusinessDate(dateAfter(through, 1), timeZone) } }
    const overdue: Prisma.CrmTaskWhereInput = { status: { in: [...open] }, OR: [{ startsAt: { lt: now } }, { startsAt: null, dueOn: { lt: new Date(`${today}T00:00:00Z`) } }] }
    const dueToday: Prisma.CrmTaskWhereInput = { status: { in: [...open] }, dueOn: new Date(`${today}T00:00:00Z`) }
    const gaps: Prisma.CrmOpportunityWhereInput = { tenantId: actor.tenantId, assignedUserId: owner, pipeline: { archived: false }, stage: { kind: "OPEN", archived: false }, contact: { archived: false }, workItems: { none: { tenantId: actor.tenantId, status: { in: [...open] } } } }
    return { base, completed, overdue, dueToday, gaps, owner, metadata: { from, through, today, timeZone, scope: query.scope, canManage, generatedAt: now.toISOString() } }
  }
  return {
    activityOverview(input: unknown) {
      const query = activityReportSchema.parse(input)
      return run(async (tx, actor) => {
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
      return run(async (tx, actor) => {
        const c = await context(tx, actor, query)
        // Include former staff who still own activities, so their backlog cannot disappear.
        const where: Prisma.UserWhereInput = { tenantId: actor.tenantId, id: c.owner, OR: [{ role: { in: ["ADMIN", "MANAGER", "STAFF"] } }, { crmAssignedWork: { some: { tenantId: actor.tenantId } } }] }
        const [users, total] = await Promise.all([tx.user.findMany({ where, select: { id: true, name: true, status: true }, orderBy: [{ name: "asc" }, { id: "asc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }), tx.user.count({ where })])
        const base = { ...c.base, assignedUserId: { in: users.map(user => user.id) } }
        const counts = await Promise.all([{ status: { in: [...open] } }, c.overdue, c.dueToday, c.completed].map(filter => tx.crmTask.groupBy({ by: ["assignedUserId"], where: { AND: [base, filter] }, _count: { _all: true } })))
        return { ...c.metadata, ...pageResult(users.map(user => ({ ...user, open: counts[0].find(row => row.assignedUserId === user.id)?._count._all || 0, overdue: counts[1].find(row => row.assignedUserId === user.id)?._count._all || 0, dueToday: counts[2].find(row => row.assignedUserId === user.id)?._count._all || 0, completed: counts[3].find(row => row.assignedUserId === user.id)?._count._all || 0 })), total, query.page, query.pageSize) }
      })
    },
    opportunitiesWithoutActivity(input: unknown) {
      const query = activityReportPageSchema.parse(input)
      return run(async (tx, actor) => {
        const c = await context(tx, actor, query)
        const [items, total] = await Promise.all([tx.crmOpportunity.findMany({ where: c.gaps, select: { id: true, title: true, expectedCloseOn: true, contact: { select: { id: true, name: true } }, assignee: { select: { id: true, name: true } }, pipeline: { select: { name: true } }, stage: { select: { name: true } } }, orderBy: [{ expectedCloseOn: "asc" }, { id: "asc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }), tx.crmOpportunity.count({ where: c.gaps })])
        return pageResult(items, total, query.page, query.pageSize)
      })
    },
  }
}
