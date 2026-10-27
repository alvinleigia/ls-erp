import type { Prisma } from "@prisma/client"
import { BusinessError, type BusinessActor } from "../policy"
import { recordDomainAuditEvent } from "@/lib/domain-audit"
import { defaultRecordRules, type RecordRules } from "./rules"

type Identity = Pick<BusinessActor, "tenantId" | "userId" | "requestId">
// Lock first: concurrent demotions/suspensions cannot remove the last admin.
// This also rechecks authority when an old session still says ADMIN.
export async function guardUserWrite(tx: Prisma.TransactionClient, identity: Identity, targetId?: string, next?: { role?: string; status?: string }, administrative = true) {
  await tx.$queryRaw`SELECT "id" FROM "Tenant" WHERE "id"=${identity.tenantId} FOR UPDATE`
  const actor = await tx.user.findFirst({ where: { tenantId: identity.tenantId, id: identity.userId, status: "ACTIVE", tenant: { status: "ACTIVE" } }, select: { role: true } })
  if (!actor || (administrative && actor.role !== "ADMIN") || (!administrative && identity.userId !== targetId)) throw new BusinessError(403, "Your current account cannot make this change.")
  if (!targetId) return null
  const before = await tx.user.findFirst({ where: { tenantId: identity.tenantId, id: targetId }, select: { role: true, status: true, collaboratorId: true } })
  if (!before) throw new BusinessError(404, "User not found.")
  if (before.collaboratorId) {
    if (next?.role && next.role !== "STAFF") throw new BusinessError(400, "An external login cannot become an internal or customer account.")
    if (next?.status === "ACTIVE" && !await tx.externalCollaborator.findFirst({ where: { tenantId: identity.tenantId, id: before.collaboratorId, archived: false }, select: { id: true } })) throw new BusinessError(409, "Restore the collaborator before activating its login.")
  }
  if (before.role === "ADMIN" && before.status === "ACTIVE" && ((next?.role && next.role !== "ADMIN") || (next?.status && next.status !== "ACTIVE"))) {
    if (await tx.user.count({ where: { tenantId: identity.tenantId, role: "ADMIN", status: "ACTIVE" } }) <= 1) throw new BusinessError(409, "Keep at least one active tenant administrator.")
  }
  return before
}
export async function auditUserSecurity(tx: Prisma.TransactionClient, identity: Identity, userId: string, before: { role: string; status: string } | null, after: { role: string; status: string }) {
  if (before?.role === after.role && before?.status === after.status) return
  await recordDomainAuditEvent(tx, { ...identity, actorUserId: identity.userId, actorRole: "ADMIN", event: "access.user.updated", entityType: "User", entityId: userId, before: before ? { role: before.role, status: before.status } : undefined, after: { role: after.role, status: after.status } })
}
// Proposal validation grants no authority; callers must establish administration.
export async function validateInitialProfiles(tx: Prisma.TransactionClient, tenantId: string, role: string, roleIds: string[]) {
  if (!["STAFF", "MANAGER"].includes(role)) {
    if (roleIds.length) throw new BusinessError(400, "Access profiles apply only to Staff and Manager accounts.")
    return
  }
  const profiles = await tx.tenantAccessRole.findMany({ where: { tenantId, id: { in: roleIds }, archived: false }, select: { id: true } })
  if (new Set(roleIds).size !== roleIds.length || profiles.length !== roleIds.length) throw new BusinessError(400, "Choose active access profiles from this business.")
}
export async function assignInitialProfiles(tx: Prisma.TransactionClient, identity: Identity, user: { id: string; role: string }, roleIds: string[] = [], rules: RecordRules = defaultRecordRules()) {
  await validateInitialProfiles(tx, identity.tenantId, user.role, roleIds)
  if (!["STAFF", "MANAGER"].includes(user.role)) return
  await guardUserWrite(tx, identity)
  const policy = await tx.tenantUserAccess.create({ data: { tenantId: identity.tenantId, userId: user.id, rules } })
  if (roleIds.length) await tx.tenantRoleAssignment.createMany({ data: roleIds.map(roleId => ({ tenantId: identity.tenantId, userId: user.id, roleId })) })
  await recordDomainAuditEvent(tx, { ...identity, actorUserId: identity.userId, actorRole: "ADMIN", event: "access.assignment.updated", entityType: "User", entityId: user.id, after: { roleIds, policy } })
}
