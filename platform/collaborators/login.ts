import type { Prisma } from "@prisma/client"
import { BusinessError } from "@/platform/policy"
import { recordDomainAuditEvent } from "@/lib/domain-audit"
import { accessResources, type Permission } from "@/platform/access/catalog"

// An identity boundary, independent of which reusable profiles are assigned.
export function externalPermissionAllowed(permission: Permission) {
  const resource = permission.split(".")[0] as keyof typeof accessResources
  return !["leaves", "shifts"].includes(accessResources[resource].module) && resource !== "users" && (!(["teams", "teamMembers"].includes(resource)) || permission.endsWith(".read"))
}
export async function validateCollaboratorLogin(tx: Prisma.TransactionClient, tenantId: string, collaboratorId: string | null | undefined, role: string) {
  if (!collaboratorId) return
  if (role !== "STAFF") throw new BusinessError(400, "External logins use the business Staff account role with explicit access profiles.")
  if (!await tx.externalCollaborator.findFirst({ where: { tenantId, id: collaboratorId, archived: false }, select: { id: true } })) throw new BusinessError(400, "Choose an active collaborator in this workspace.")
}
export async function auditCollaboratorLogin(tx: Prisma.TransactionClient, identity: { tenantId: string; userId: string; requestId?: string }, user: { id: string; role: string; status: string }, collaboratorId: string | null | undefined) {
  if (!collaboratorId) return
  await recordDomainAuditEvent(tx, { tenantId: identity.tenantId, actorUserId: identity.userId, actorRole: "ADMIN", requestId: identity.requestId,
    event: "collaborator.login.created", entityType: "User", entityId: user.id, after: { userId: user.id, collaboratorId, role: user.role, status: user.status } })
}
