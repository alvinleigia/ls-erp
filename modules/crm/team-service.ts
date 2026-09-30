import { requireWriteFields } from "@/platform/access/policy"
import type { PermissionRun } from "@/platform/access/server"
import type { Prisma } from "@prisma/client"
import { z } from "zod"
import { crmListSchema } from "./validation"
import { CrmError, canManageCrm, type CrmActor } from "./policy"

type Tx = Prisma.TransactionClient
type Context = {
  run: PermissionRun
  audit: (tx: Tx, actor: CrmActor, event: string, id: string, before?: Prisma.InputJsonValue, after?: Prisma.InputJsonValue) => Promise<void>
}
export const salesTeamSchema = z.object({
  name: z.string().trim().min(1).max(100).transform(value => value.replace(/\s+/g, " ")),
  workflow: z.enum(["ENQUIRY_FIRST", "DIRECT"]).default("ENQUIRY_FIRST"),
  archived: z.boolean().default(false), version: z.number().int().positive().optional(),
}).strict()
const memberSchema = z.object({ userId: z.string().min(1).max(100), version: z.number().int().positive(), remove: z.boolean().default(false) }).strict()
export const teamSelect = { id: true, name: true, workflow: true, archived: true } as const
const snapshot = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value))
export function teamScope(actor: CrmActor) {
  return { tenantId: actor.tenantId, ...(!canManageCrm(actor.role) ? { members: { some: { tenantId: actor.tenantId, userId: actor.userId } } } : {}) }
}

// Team membership restricts new assignment; it never grants access to another
// salesperson's records. Existing owner/manager scopes remain authoritative.
export async function resolveSalesTeam(tx: Tx, actor: CrmActor, requested: string | null | undefined, owner: string, before?: { salesTeamId: string | null; assignedUserId: string }) {
  const id = requested === undefined ? before?.salesTeamId ?? null : requested || null
  const unchanged = !!before && before.salesTeamId === id && before.assignedUserId === owner
  if (before && before.salesTeamId !== id && !canManageCrm(actor.role)) throw new CrmError(403, "Only a manager can change a record's sales team.")
  if (!id) return null
  const team = await tx.crmSalesTeam.findFirst({ where: { tenantId: actor.tenantId, id } })
  if (!team) throw new CrmError(404, "Sales team not found.")
  if (!unchanged) {
    if (team.archived) throw new CrmError(409, "Choose an active sales team.")
    const member = await tx.crmSalesTeamMember.findUnique({ where: { tenantId_teamId_userId: { tenantId: actor.tenantId, teamId: id, userId: owner } } })
    if (!member) throw new CrmError(400, "Choose a salesperson who belongs to this sales team.")
  }
  return team
}

export function createTeamService({ run, audit }: Context) {
  const manage = (actor: CrmActor) => { if (!canManageCrm(actor.role)) throw new CrmError(403, "Only managers can configure sales teams.") }
  return {
    listSalesTeams(input: unknown) {
      const q = crmListSchema.parse(input)
      return run("salesTeams.read", async (tx, actor) => {
        const where = { ...teamScope(actor), ...(q.includeArchived === "true" ? {} : { archived: q.archived === "true" }), name: { contains: q.q, mode: "insensitive" as const } }
        const [items, total] = await Promise.all([
          tx.crmSalesTeam.findMany({ where, orderBy: [{ name: "asc" }, { id: "asc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { _count: { select: { members: true } } } }), tx.crmSalesTeam.count({ where }),
        ])
        return { items, total, page: q.page, pageSize: q.pageSize, totalPages: Math.max(1, Math.ceil(total / q.pageSize)), canManage: canManageCrm(actor.role) }
      })
    },
    getSalesTeam(id: string) {
      return run("salesTeams.read", async (tx, actor) => {
        const team = await tx.crmSalesTeam.findFirst({ where: { ...teamScope(actor), id } })
        if (!team) throw new CrmError(404, "Sales team not found.")
        return { ...team, canManage: canManageCrm(actor.role) }
      })
    },
    saveSalesTeam(input: unknown, id?: string) {
      const { version, ...data } = salesTeamSchema.parse(input)
      return run(id ? "salesTeams.edit" : "salesTeams.create", async (tx, actor) => {
        manage(actor)
        const before = id ? await tx.crmSalesTeam.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id } } }) : null
        requireWriteFields(actor, "salesTeams", before ?? undefined, data)
        if (id && !before) throw new CrmError(404, "Sales team not found.")
        if (before && before.version !== version) throw new CrmError(409, "This team changed. Refresh before saving.")
        const record = before
          ? await tx.crmSalesTeam.update({ where: { tenantId_id: { tenantId: actor.tenantId, id: before.id }, version }, data: { ...data, nameKey: data.name.toLowerCase(), version: { increment: 1 } } })
          : await tx.crmSalesTeam.create({ data: { ...data, tenantId: actor.tenantId, nameKey: data.name.toLowerCase() } })
        await audit(tx, actor, `crm.team.${before ? "updated" : "created"}`, record.id, before ? snapshot(before) : undefined, snapshot(record))
        return record
      })
    },
    listSalesTeamMembers(id: string, input: unknown) {
      const q = crmListSchema.parse(input)
      return run("salesTeams.read", async (tx, actor) => {
        manage(actor)
        if (!await tx.crmSalesTeam.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id } } })) throw new CrmError(404, "Sales team not found.")
        const where = { tenantId: actor.tenantId, teamId: id, user: { name: { contains: q.q, mode: "insensitive" as const } } }
        const [rows, total] = await Promise.all([tx.crmSalesTeamMember.findMany({ where, include: { user: { select: { id: true, name: true, status: true, role: true } } }, orderBy: [{ user: { name: "asc" } }, { userId: "asc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }), tx.crmSalesTeamMember.count({ where })])
        return { items: rows.map(row => row.user), total, page: q.page, pageSize: q.pageSize, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) }
      })
    },
    changeSalesTeamMember(id: string, input: unknown) {
      const data = memberSchema.parse(input)
      return run("salesTeams.assign", async (tx, actor) => {
        manage(actor)
        const team = await tx.crmSalesTeam.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id } } })
        if (!team) throw new CrmError(404, "Sales team not found.")
        if (team.version !== data.version) throw new CrmError(409, "This team changed. Refresh before saving.")
        if (team.archived) throw new CrmError(409, "Restore this team before changing membership.")
        if (data.remove) {
          const where = { tenantId: actor.tenantId, salesTeamId: id, assignedUserId: data.userId }
          const [leads, deals] = await Promise.all([
            tx.crmEnquiry.count({ where: { ...where, status: { not: "CLOSED" }, opportunities: { none: {} } } }),
            tx.crmOpportunity.count({ where: { ...where, stage: { kind: "OPEN" } } }),
          ])
          if (leads || deals) throw new CrmError(409, "Reassign this member's open enquiries and opportunities before removing them.")
          await tx.crmSalesTeamMember.deleteMany({ where: { tenantId: actor.tenantId, teamId: id, userId: data.userId } })
        } else {
          if (!await tx.user.findFirst({ where: { tenantId: actor.tenantId, id: data.userId, status: "ACTIVE", role: { in: ["ADMIN", "MANAGER", "STAFF"] } } })) throw new CrmError(400, "Choose an active salesperson in this business.")
          await tx.crmSalesTeamMember.createMany({ data: [{ tenantId: actor.tenantId, teamId: id, userId: data.userId }], skipDuplicates: true })
        }
        const result = await tx.crmSalesTeam.update({ where: { tenantId_id: { tenantId: actor.tenantId, id }, version: data.version }, data: { version: { increment: 1 } } })
        await audit(tx, actor, data.remove ? "crm.team.member.removed" : "crm.team.member.added", id, undefined, { userId: data.userId })
        return result
      })
    },
  }
}
