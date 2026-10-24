import { termText } from "@/platform/terminology/message"
import { recordLimits } from "@/platform/access/rules"
import type { Resource, PermissionAction } from "@/platform/access/catalog"
import { requireWriteFields, permits } from "@/platform/access/policy"
import type { PermissionRun } from "@/platform/access/server"
import type { Prisma } from "@prisma/client"
import { z } from "zod"
import { accessListSchema } from "@/platform/access/validation"
import { BusinessError, type BusinessActor } from "@/platform/policy"
const teamListSchema = accessListSchema.extend({ includeArchived: z.enum(["true", "false"]).default("false"), assignment: z.enum(["sales", "projects"]).optional() })

type Tx = Prisma.TransactionClient
type Context = {
  allowSalesWorkflow?: boolean
  run: PermissionRun
  audit: (tx: Tx, actor: BusinessActor, event: string, id: string, before?: Prisma.InputJsonValue, after?: Prisma.InputJsonValue) => Promise<void>
}
export const salesTeamSchema = z.object({
  name: z.string().trim().min(1).max(100).transform(value => value.replace(/\s+/g, " ")),
  workflow: z.enum(["BOTH", "ENQUIRY_FIRST", "DIRECT"]).optional(),
  archived: z.boolean().default(false), version: z.number().int().positive().optional(),
}).strict()
const memberSchema = z.object({ userId: z.string().min(1).max(100), version: z.number().int().positive(), remove: z.boolean().default(false), isManager: z.boolean().optional() }).strict()
export const teamSelect = { id: true, name: true, workflow: true, archived: true } as const
const snapshot = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value))
const administerTeams = (actor: BusinessActor) => recordLimits(actor, "teams", "create").length === 0
const manageTeam = (actor: BusinessActor, id: string, action: PermissionAction = "edit", resource: Resource = "teams") => recordLimits(actor, resource, action).every(scope => scope !== "NONE" && (scope === "MANAGED_TEAMS" ? !!actor.managedTeamIds?.includes(id) : !!actor.memberTeamIds?.includes(id)))
export function teamScope(actor: BusinessActor, resource: Resource = "teams", action?: PermissionAction) {
  return { tenantId: actor.tenantId, AND: recordLimits(actor, resource, action).map(scope => ({ id: { in: scope === "NONE" ? [] : scope === "MANAGED_TEAMS" ? actor.managedTeamIds ?? [] : actor.memberTeamIds ?? [] } })) }
}

export function createTeamService({ run, audit, allowSalesWorkflow = false }: Context) {
  return {
    listAssignableUsers(input: unknown) {
      const q = teamListSchema.parse(input)
      return run("teamMembers.assign", async (tx, actor) => {
        const where = { tenantId: actor.tenantId, status: "ACTIVE" as const, role: { in: ["ADMIN", "MANAGER", "STAFF"] as ("ADMIN" | "MANAGER" | "STAFF")[] }, ...(q.q ? { name: { contains: q.q, mode: "insensitive" as const } } : {}) }
        const [items, total] = await Promise.all([tx.user.findMany({ where, select: { id: true, name: true, role: true }, orderBy: [{ name: "asc" }, { id: "asc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }), tx.user.count({ where })])
        return { items, total, page: q.page, pageSize: q.pageSize, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) }
      })
    },
    listTeams(input: unknown) {
      const q = teamListSchema.parse(input)
      return run("teams.read", async (tx, actor) => {
        const where = { ...teamScope(actor), ...(q.assignment && recordLimits(actor, q.assignment === "sales" ? "enquiries" : "projects", "assign").length !== 0 ? { id: { in: actor.managedTeamIds ?? [] } } : {}), ...(q.includeArchived === "true" ? {} : { archived: q.archived === "true" }), name: { contains: q.q, mode: "insensitive" as const } }
        const [items, total] = await Promise.all([
          tx.businessTeam.findMany({ where, orderBy: [{ name: "asc" }, { id: "asc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { _count: { select: { members: true } } } }), tx.businessTeam.count({ where }),
        ])
        return { items, total, page: q.page, pageSize: q.pageSize, totalPages: Math.max(1, Math.ceil(total / q.pageSize)), canManage: administerTeams(actor) && permits(actor, "teams.create") }
      })
    },
    getTeam(id: string) {
      return run("teams.read", async (tx, actor) => {
        const team = await tx.businessTeam.findFirst({ where: { ...teamScope(actor), id } })
        if (!team) throw new BusinessError(404, "Team not found.")
        return { ...team, canReadMembers: permits(actor, "teamMembers.read") && manageTeam(actor, id, "read", "teamMembers"), canManage: manageTeam(actor, id) && permits(actor, "teams.edit"), canAssign: manageTeam(actor, id, "assign", "teamMembers") && permits(actor, "teamMembers.assign"), canManageTeamAccess: actor.role === "ADMIN" }
      })
    },
    saveTeam(input: unknown, id?: string) {
      const { version, ...parsed } = (allowSalesWorkflow ? salesTeamSchema : salesTeamSchema.omit({ workflow: true })).parse(input) as ReturnType<typeof salesTeamSchema.parse>
      return run(id ? "teams.edit" : "teams.create", async (tx, actor) => {
        const before = id ? await tx.businessTeam.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id } } }) : null
        if (before ? !manageTeam(actor, before.id) : !administerTeams(actor)) throw new BusinessError(403, "Only a team manager can change this team. Ask a tenant administrator to create or assign teams.")
        const data = { ...parsed, workflow: parsed.workflow ?? before?.workflow ?? "BOTH" }
        requireWriteFields(actor, "teams", before ?? undefined, data)
        if (id && !before) throw new BusinessError(404, "Team not found.")
        if (before && before.version !== version) throw new BusinessError(409, "This team changed. Refresh before saving.")
        const record = before
          ? await tx.businessTeam.update({ where: { tenantId_id: { tenantId: actor.tenantId, id: before.id }, version }, data: { ...data, nameKey: data.name.toLowerCase(), version: { increment: 1 } } })
          : await tx.businessTeam.create({ data: { ...data, tenantId: actor.tenantId, nameKey: data.name.toLowerCase() } })
        await audit(tx, actor, `crm.team.${before ? "updated" : "created"}`, record.id, before ? snapshot(before) : undefined, snapshot(record))
        return { ...record, canManage: permits(actor, "teams.edit"), canAssign: permits(actor, "teamMembers.assign"), canManageTeamAccess: actor.role === "ADMIN" }
      })
    },
    listTeamMembers(id: string, input: unknown) {
      const q = teamListSchema.parse(input)
      return run("teamMembers.read", async (tx, actor) => {
        if (!await tx.businessTeam.findFirst({ where: { ...teamScope(actor, "teamMembers"), id } })) throw new BusinessError(404, "Team not found.")
        const where = { tenantId: actor.tenantId, teamId: id, user: { name: { contains: q.q, mode: "insensitive" as const } } }
        const [rows, total] = await Promise.all([tx.businessTeamMember.findMany({ where, include: { user: { select: { id: true, name: true, status: true, role: true } } }, orderBy: [{ user: { name: "asc" } }, { userId: "asc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }), tx.businessTeamMember.count({ where })])
        return { items: rows.map(row => ({ ...row.user, isManager: row.isManager })), total, page: q.page, pageSize: q.pageSize, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) }
      })
    },
    changeTeamMember(id: string, input: unknown) {
      const data = memberSchema.parse(input)
      return run("teamMembers.assign", async (tx, actor) => {
        const team = await tx.businessTeam.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id } } })
        if (!team) throw new BusinessError(404, "Team not found.")
        if (!manageTeam(actor, id, "assign", "teamMembers")) throw new BusinessError(403, "Only a team manager can change this team's membership.")
        if (team.version !== data.version) throw new BusinessError(409, "This team changed. Refresh before saving.")
        if (team.archived) throw new BusinessError(409, "Restore this team before changing membership.")
        const previous = await tx.businessTeamMember.findUnique({ where: { tenantId_teamId_userId: { tenantId: actor.tenantId, teamId: id, userId: data.userId } } })
        if ((data.isManager !== undefined || (data.remove && previous?.isManager)) && actor.role !== "ADMIN") throw new BusinessError(403, "Only a tenant administrator can change team-manager authority.")
        if (data.isManager === true && !await tx.user.findFirst({ where: { tenantId: actor.tenantId, id: data.userId, role: { in: ["STAFF", "MANAGER", "ADMIN"] }, status: "ACTIVE" } })) throw new BusinessError(400, "Choose an active business user as team manager.")
        if (data.remove) {
          const where = { tenantId: actor.tenantId, salesTeamId: id, assignedUserId: data.userId }
          const [leads, deals] = await Promise.all([
            tx.crmEnquiry.count({ where: { ...where, status: { not: "CLOSED" }, opportunities: { none: {} } } }),
            tx.crmOpportunity.count({ where: { ...where, stage: { kind: "OPEN" } } }),
          ])
          if (leads || deals) throw new BusinessError(409, ["Reassign this member's open ", termText("crm.enquiry.plural", "enquiries"), " and ", termText("crm.opportunity.plural", "opportunities"), " before removing them."])
          await tx.businessTeamMember.deleteMany({ where: { tenantId: actor.tenantId, teamId: id, userId: data.userId } })
        } else {
          if (!await tx.user.findFirst({ where: { tenantId: actor.tenantId, id: data.userId, status: "ACTIVE", role: { in: ["ADMIN", "MANAGER", "STAFF"] } } })) throw new BusinessError(400, "Choose an active staff member in this business.")
          await tx.businessTeamMember.upsert({ where: { tenantId_teamId_userId: { tenantId: actor.tenantId, teamId: id, userId: data.userId } }, create: { tenantId: actor.tenantId, teamId: id, userId: data.userId, isManager: data.isManager ?? false }, update: data.isManager === undefined ? {} : { isManager: data.isManager } })
        }
        const result = await tx.businessTeam.update({ where: { tenantId_id: { tenantId: actor.tenantId, id }, version: data.version }, data: { version: { increment: 1 } } })
        await audit(tx, actor, data.remove ? "crm.team.member.removed" : data.isManager !== undefined ? "crm.team.manager.updated" : "crm.team.member.added", id, previous ? snapshot(previous) : undefined, { userId: data.userId, isManager: data.remove ? false : data.isManager ?? previous?.isManager ?? false })
        return { ...result, canManage: permits(actor, "teams.edit"), canAssign: permits(actor, "teamMembers.assign"), canManageTeamAccess: actor.role === "ADMIN" }
      })
    },
  }
}
