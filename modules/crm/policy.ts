import type { Prisma } from "@prisma/client"
import { ownedRecordScope, relatedSalesScope } from "@/platform/access/record-scope"
import { recordLimits } from "@/platform/access/rules"
import { sharedRecordWhere } from "@/platform/access/sharing-scope"
import type { PermissionAction, Resource } from "@/platform/access/catalog"
import { BusinessError as CrmError, type BusinessActor } from "@/platform/policy"
export { BusinessError as CrmError } from "@/platform/policy"
export type CrmActor = BusinessActor
export const canUseCrm = (role?: string | null) => role === "ADMIN" || role === "MANAGER" || role === "STAFF"
export function assertCrmActor(actor: CrmActor) {
  if (!actor.tenantId || !actor.userId || !canUseCrm(actor.role)) throw new CrmError(403, "CRM access is not permitted.")
}
export const enquiryScope = (actor: CrmActor, action?: PermissionAction) => { assertCrmActor(actor); return sharedRecordWhere<Prisma.CrmEnquiryWhereInput>(actor, "enquiries", ownedRecordScope(actor, "enquiries", action), { assignedUserId: actor.userId }, action) }
export const opportunityScope = (actor: CrmActor, action?: PermissionAction) => { assertCrmActor(actor); return sharedRecordWhere<Prisma.CrmOpportunityWhereInput>(actor, "opportunities", ownedRecordScope(actor, "opportunities", action), { assignedUserId: actor.userId }, action) }

export function contactScope(actor: CrmActor, action?: PermissionAction, resource: Resource = "contacts"): Prisma.CrmContactWhereInput {
  assertCrmActor(actor)
  const base: Prisma.CrmContactWhereInput = { tenantId: actor.tenantId, AND: recordLimits(actor, resource, action).map(scope => scope === "NONE" ? { id: { in: [] } } : { OR: [
    { ownerUserId: actor.userId },
    ...(scope === "OWN" ? [] : [
      { enquiries: { some: relatedSalesScope(actor, resource, action) } },
      { opportunities: { some: relatedSalesScope(actor, resource, action) } },
      { workItems: { some: { tenantId: actor.tenantId, assignedUserId: actor.userId, status: { in: ["OPEN", "IN_PROGRESS"] as ("OPEN" | "IN_PROGRESS")[] } } } },
    ]),
  ] }) }
  return resource === "contacts" ? sharedRecordWhere(actor, resource, base, { ownerUserId: actor.userId }, action) : base
}
export function accountScope(actor: CrmActor, action?: PermissionAction): Prisma.CrmAccountWhereInput {
  assertCrmActor(actor)
  const base: Prisma.CrmAccountWhereInput = { tenantId: actor.tenantId, AND: recordLimits(actor, "accounts", action).map(scope => scope === "NONE" ? { id: { in: [] } } : { OR: [
    { ownerUserId: actor.userId },
    ...(scope === "OWN" ? [] : [
      { contacts: { some: { tenantId: actor.tenantId, contact: { AND: [contactScope(actor, "read"), contactScope(actor, action, "accounts")] } } } },
      { opportunities: { some: relatedSalesScope(actor, "accounts", action) } },
    ]),
  ] }) }
  return sharedRecordWhere(actor, "accounts", base, { ownerUserId: actor.userId }, action)
}
