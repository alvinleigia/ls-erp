import { serializationConflict } from "@/modules/crm/database-errors"
import type { Prisma, PrismaClient } from "@prisma/client"
import { recordDomainAuditEvent } from "@/lib/domain-audit"
import { BusinessError, type BusinessActor } from "../policy"
import { accessListSchema, accessRoleSchema, roleAssignmentSchema } from "./validation"

type Identity = Pick<BusinessActor, "tenantId" | "userId" | "requestId">
const snapshot = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value))
export async function requireAccessAdministrator(tx: Prisma.TransactionClient, identity: Identity) {
  const user = await tx.user.findFirst({ where: { id: identity.userId, tenantId: identity.tenantId, role: "ADMIN", status: "ACTIVE" }, select: { tenant: { select: { slug: true, status: true } } } })
  if (!user || user.tenant?.status !== "ACTIVE" || user.tenant.slug === (process.env.PLATFORM_ADMIN_TENANT_SLUG?.trim().toLowerCase() || "platform")) throw new BusinessError(403, "Only an active tenant administrator can manage access roles.")
}
export function createAccessRoleService(db: PrismaClient, identity: Identity) {
  async function run<T>(write: boolean, operation: (tx: Prisma.TransactionClient) => Promise<T>) {
    for (let attempt = 0; ; attempt++) {
      try { return await db.$transaction(async tx => {
        await requireAccessAdministrator(tx, identity)
        if (write) await tx.$queryRaw`SELECT "id" FROM "Tenant" WHERE "id"=${identity.tenantId} FOR UPDATE`
        return operation(tx)
      }, { isolationLevel: "Serializable", maxWait: 20000, timeout: 20000 }) }
      catch (error) {
        const code = (error as { code?: string }).code
        if (serializationConflict(error) && attempt < 2) continue
        if (serializationConflict(error)) throw new BusinessError(409, "Access settings changed. Refresh before saving.")
        if (code === "P2002") throw new BusinessError(409, "A role with this name already exists.")
        throw error
      }
    }
  }
  const audit = (tx: Prisma.TransactionClient, event: string, entityType: string, entityId: string, before: unknown, after: unknown) => recordDomainAuditEvent(tx, { ...identity, actorUserId: identity.userId, actorRole: "ADMIN", event, entityType, entityId, before: snapshot(before), after: snapshot(after) })
  async function find(tx: Prisma.TransactionClient, id: string) {
    const role = await tx.tenantAccessRole.findFirst({ where: { tenantId: identity.tenantId, id } })
    if (!role) throw new BusinessError(404, "Access role not found.")
    return role
  }
  return {
    list(input: unknown) {
      const q = accessListSchema.parse(input)
      return run(false, async tx => {
        const where = { tenantId: identity.tenantId, archived: q.archived === "true", ...(q.q ? { name: { contains: q.q, mode: "insensitive" as const } } : {}) }
        const [items, total] = await Promise.all([tx.tenantAccessRole.findMany({ where, select: { id: true, name: true, archived: true, version: true, _count: { select: { assignments: true } } }, orderBy: [{ name: "asc" }, { id: "asc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }), tx.tenantAccessRole.count({ where })])
        return { items, total, page: q.page, pageSize: q.pageSize, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) }
      })
    },
    get: (id: string) => run(false, tx => find(tx, id)),
    save(input: unknown, id?: string) {
      const data = accessRoleSchema.parse(input)
      return run(true, async tx => {
        const before = id ? await find(tx, id) : null
        if (before && before.version !== data.version) throw new BusinessError(409, "This access role changed. Refresh before saving.")
        if (id && data.archived && !before?.archived && await tx.tenantRoleAssignment.count({ where: { tenantId: identity.tenantId, roleId: id } })) throw new BusinessError(409, "Reassign users before archiving this role.")
        const fields = { name: data.name, nameKey: data.name.normalize("NFKC").toLocaleLowerCase("en-US"), permissions: data.permissions, crmRecordScope: data.crmRecordScope ?? before?.crmRecordScope ?? "ACCOUNT_ROLE", archived: data.archived }
        const role = id ? await tx.tenantAccessRole.update({ where: { tenantId_id: { tenantId: identity.tenantId, id } }, data: { ...fields, version: { increment: 1 } } }) : await tx.tenantAccessRole.create({ data: { tenantId: identity.tenantId, ...fields } })
        await audit(tx, id ? "access.role.updated" : "access.role.created", "TenantAccessRole", role.id, before, role)
        return role
      })
    },
    assignment(userId: string) {
      return run(false, async tx => {
        const user = await tx.user.findFirst({ where: { tenantId: identity.tenantId, id: userId }, select: { id: true, name: true, role: true, accessAssignment: { select: { roleId: true, role: { select: { name: true } } } } } })
        if (!user) throw new BusinessError(404, "User not found.")
        return user
      })
    },
    assign(userId: string, input: unknown) {
      const data = roleAssignmentSchema.parse(input)
      return run(true, async tx => {
        const user = await tx.user.findFirst({ where: { tenantId: identity.tenantId, id: userId }, select: { id: true, role: true, accessAssignment: { select: { roleId: true } } } })
        if (!user) throw new BusinessError(404, "User not found.")
        if (user.role !== "STAFF" && user.role !== "MANAGER") throw new BusinessError(409, "Access roles apply to staff and managers. Tenant administrators retain full administrative access.")
        const previousRoleId = user.accessAssignment?.roleId ?? null
        if (previousRoleId !== data.previousRoleId) throw new BusinessError(409, "This user's role changed. Refresh before saving.")
        if (data.roleId && (await find(tx, data.roleId)).archived) throw new BusinessError(409, "Choose an active access role.")
        if (previousRoleId === data.roleId) return { roleId: data.roleId }
        if (data.roleId) await tx.tenantRoleAssignment.upsert({ where: { tenantId_userId: { tenantId: identity.tenantId, userId } }, create: { tenantId: identity.tenantId, userId, roleId: data.roleId }, update: { roleId: data.roleId } })
        else await tx.tenantRoleAssignment.deleteMany({ where: { tenantId: identity.tenantId, userId } })
        await audit(tx, "access.assignment.updated", "User", userId, { roleId: previousRoleId }, { roleId: data.roleId })
        return { roleId: data.roleId }
      })
    },
  }
}
