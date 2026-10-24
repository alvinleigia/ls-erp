import type { Prisma } from "@prisma/client"
import { ownedRecordScope } from "@/platform/access/record-scope"
import { recordLimits } from "@/platform/access/rules"
import type { PermissionAction, Resource } from "@/platform/access/catalog"
import { BusinessError as CrmError, type BusinessActor } from "@/platform/policy"
export { BusinessError as CrmError } from "@/platform/policy"
export type CrmActor = BusinessActor
export const canUseCrm = (role?: string | null) => role === "ADMIN" || role === "MANAGER" || role === "STAFF"
export function assertCrmActor(actor: CrmActor) {
  if (!actor.tenantId || !actor.userId || !canUseCrm(actor.role)) throw new CrmError(403, "CRM access is not permitted.")
}
export const enquiryScope = (actor: CrmActor, action?: PermissionAction) => { assertCrmActor(actor); return ownedRecordScope(actor, "enquiries", action) }
export const opportunityScope = (actor: CrmActor, action?: PermissionAction) => { assertCrmActor(actor); return ownedRecordScope(actor, "opportunities", action) }

export function contactScope(actor: CrmActor, action?: PermissionAction, resource: Resource = "contacts"): Prisma.CrmContactWhereInput {
  assertCrmActor(actor)
  return { tenantId: actor.tenantId, AND: recordLimits(actor, resource, action).map(scope => scope === "NONE" ? { id: { in: [] } } : { OR: [
    { ownerUserId: actor.userId },
    ...(scope === "OWN" ? [] : [
      { enquiries: { some: ownedRecordScope(actor, resource, action) } },
      { opportunities: { some: ownedRecordScope(actor, resource, action) } },
      { workItems: { some: { tenantId: actor.tenantId, assignedUserId: actor.userId, status: { in: ["OPEN", "IN_PROGRESS"] as ("OPEN" | "IN_PROGRESS")[] } } } },
    ]),
  ] }) }
}
export function accountScope(actor: CrmActor, action?: PermissionAction): Prisma.CrmAccountWhereInput {
  assertCrmActor(actor)
  return { tenantId: actor.tenantId, AND: recordLimits(actor, "accounts", action).map(scope => scope === "NONE" ? { id: { in: [] } } : { OR: [
    { ownerUserId: actor.userId },
    ...(scope === "OWN" ? [] : [
      { contacts: { some: { tenantId: actor.tenantId, contact: { AND: [contactScope(actor, "read"), contactScope(actor, action, "accounts")] } } } },
      { opportunities: { some: ownedRecordScope(actor, "accounts", action) } },
    ]),
  ] }) }
}
