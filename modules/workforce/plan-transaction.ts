import { authorizeBusinessOperation } from "@/platform/access/operation"
import type { Prisma } from "@prisma/client"
import { recordDomainAuditEvent } from "@/lib/domain-audit"



import { type BusinessActor } from "@/platform/policy"
import { scheduleTransaction } from "./schedule-transaction"

type Resource = "shiftPlans" | "shiftRoster" | "shiftSchedules" | "shiftTemplates"
type Action = "create" | "edit" | "archive"

export function planTransaction<T>(actor: BusinessActor, resource: Resource, action: Action,
  write: (tx: Prisma.TransactionClient, currentActor: BusinessActor) => Promise<T>) {
  return scheduleTransaction(actor.tenantId, async tx => {
    const current = await authorizeBusinessOperation(tx, actor, `${resource}.${action}`, ["shifts"])
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
