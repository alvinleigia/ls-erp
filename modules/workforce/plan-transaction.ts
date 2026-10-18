import type { Prisma } from "@prisma/client"
import { recordDomainAuditEvent } from "@/lib/domain-audit"
import { findAccessUser, assignedPermissions } from "@/platform/access/server"
import { requirePermission } from "@/platform/access/policy"
import { requireBusinessModule } from "@/platform/module-server"
import { BusinessError, type BusinessActor } from "@/platform/policy"
import { scheduleTransaction } from "./schedule-transaction"

type Resource = "shiftPlans" | "shiftRoster" | "shiftSchedules" | "shiftTemplates"
type Action = "create" | "edit" | "archive"

export function planTransaction<T>(actor: BusinessActor, resource: Resource, action: Action,
  write: (tx: Prisma.TransactionClient, currentActor: BusinessActor) => Promise<T>) {
  return scheduleTransaction(actor.tenantId, async tx => {
    const user = await findAccessUser(tx, actor.tenantId, actor.userId)
    if (!user || !["ADMIN", "MANAGER"].includes(user.role) || user.tenant.status !== "ACTIVE") {
      throw new BusinessError(403, "Plan management access is no longer available.")
    }
    await requireBusinessModule(tx, actor.tenantId, "shifts")
    const current = { ...actor, role: user.role, permissions: assignedPermissions(user) }
    requirePermission(current, `${resource}.read`)
    requirePermission(current, `${resource}.${action}`)
    return write(tx, current)
  })
}

export async function auditPlan(tx: Prisma.TransactionClient, actor: BusinessActor, resource: Resource,
  action: Action, id: string, before: unknown, after: unknown) {
  await recordDomainAuditEvent(tx, {
    tenantId: actor.tenantId, actorUserId: actor.userId, actorRole: actor.role, requestId: actor.requestId,
    event: `workforce.${resource}.${action}`, entityType: resource, entityId: id,
    ...(before ? { before: JSON.parse(JSON.stringify(before)) } : {}),
    after: JSON.parse(JSON.stringify(after)),
  })
}
