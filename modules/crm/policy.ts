import { BusinessError as CrmError, type BusinessActor } from "@/platform/policy"
export { BusinessError as CrmError } from "@/platform/policy"
export type CrmActor = BusinessActor

export function canUseCrm(role?: string | null) {
  return role === "ADMIN" || role === "MANAGER" || role === "STAFF"
}

export function canManageCrm(role?: string | null) {
  return role === "ADMIN" || role === "MANAGER"
}

export function assertCrmActor(actor: CrmActor) {
  if (!actor.tenantId || !actor.userId || !canUseCrm(actor.role)) {
    throw new CrmError(403, "CRM access is not permitted.")
  }
}

export function enquiryScope(actor: CrmActor) {
  assertCrmActor(actor)
  return {
    tenantId: actor.tenantId,
    ...(!canManageCrm(actor.role) ? { assignedUserId: actor.userId } : {}),
  }
}

export function contactScope(actor: CrmActor) {
  assertCrmActor(actor)
  return {
    tenantId: actor.tenantId,
    ...(!canManageCrm(actor.role) ? {
      OR: [
        { ownerUserId: actor.userId },
        { enquiries: { some: { tenantId: actor.tenantId, assignedUserId: actor.userId } } },
      ],
    } : {}),
  }
}

export function accountScope(actor: CrmActor) {
  assertCrmActor(actor)
  return {
    tenantId: actor.tenantId,
    ...(!canManageCrm(actor.role) ? {
      OR: [
        { ownerUserId: actor.userId },
        { contacts: { some: { tenantId: actor.tenantId, contact: contactScope(actor) } } },
      ],
    } : {}),
  }
}
