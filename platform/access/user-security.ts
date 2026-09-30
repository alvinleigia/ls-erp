import type { Prisma } from "@prisma/client"
import { BusinessError, type BusinessActor } from "../policy"
import { recordDomainAuditEvent } from "@/lib/domain-audit"

type Identity = Pick<BusinessActor, "tenantId" | "userId" | "requestId">
// Lock first: concurrent demotions/suspensions cannot remove the last admin.
// This also rechecks authority when an old session still says ADMIN.
export async function guardUserWrite(tx: Prisma.TransactionClient, identity: Identity, targetId?: string, next?: { role?: string; status?: string }, administrative = true) {
  await tx.$queryRaw`SELECT "id" FROM "Tenant" WHERE "id"=${identity.tenantId} FOR UPDATE`
  const actor = await tx.user.findFirst({ where: { tenantId: identity.tenantId, id: identity.userId, status: "ACTIVE", tenant: { status: "ACTIVE" } }, select: { role: true } })
  if (!actor || (administrative && actor.role !== "ADMIN") || (!administrative && identity.userId !== targetId)) throw new BusinessError(403, "Your current account cannot make this change.")
  if (!targetId) return null
  const before = await tx.user.findFirst({ where: { tenantId: identity.tenantId, id: targetId }, select: { role: true, status: true } })
  if (!before) throw new BusinessError(404, "User not found.")
  if (before.role === "ADMIN" && before.status === "ACTIVE" && ((next?.role && next.role !== "ADMIN") || (next?.status && next.status !== "ACTIVE"))) {
    if (await tx.user.count({ where: { tenantId: identity.tenantId, role: "ADMIN", status: "ACTIVE" } }) <= 1) throw new BusinessError(409, "Keep at least one active tenant administrator.")
  }
  return before
}
export async function auditUserSecurity(tx: Prisma.TransactionClient, identity: Identity, userId: string, before: { role: string; status: string } | null, after: { role: string; status: string }) {
  if (before?.role === after.role && before?.status === after.status) return
  await recordDomainAuditEvent(tx, { ...identity, actorUserId: identity.userId, actorRole: "ADMIN", event: "access.user.updated", entityType: "User", entityId: userId, before: before ?? undefined, after: { role: after.role, status: after.status } })
}
export async function assignInitialRole(tx: Prisma.TransactionClient, identity: Identity, user: { id: string; role: string }, roleId?: string) {
  if (!roleId) return
  if (!["STAFF", "MANAGER"].includes(user.role)) throw new BusinessError(400, "Custom access roles apply only to Staff and Manager accounts.")
  const role = await tx.tenantAccessRole.findFirst({ where: { tenantId: identity.tenantId, id: roleId, archived: false } })
  if (!role) throw new BusinessError(400, "Choose an active access role from this business.")
  await tx.tenantRoleAssignment.create({ data: { tenantId: identity.tenantId, userId: user.id, roleId } })
  await recordDomainAuditEvent(tx, { ...identity, actorUserId: identity.userId, actorRole: "ADMIN", event: "access.assignment.updated", entityType: "User", entityId: user.id, after: { roleId } })
}
