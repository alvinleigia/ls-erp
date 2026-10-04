import { salesRecordAccess } from "@/platform/access/record-scope"
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

// Restrictions stay inside AND so caller filters cannot replace the access rule.
export function enquiryScope(actor: CrmActor) {
  assertCrmActor(actor)
  const scope = salesRecordAccess(actor)
  return { tenantId: actor.tenantId, ...(scope === "ALL" ? {} : { AND: [{ OR: [
    { assignedUserId: actor.userId },
    ...(scope === "MANAGED_TEAMS" ? [{ salesTeamId: { in: actor.managedTeamIds ?? [] } }] : []),
  ] }] }) }
}
export function contactScope(actor: CrmActor) {
  assertCrmActor(actor)
  return { tenantId: actor.tenantId, ...(salesRecordAccess(actor) === "ALL" ? {} : { AND: [{ OR: [
    { ownerUserId: actor.userId },
    { enquiries: { some: enquiryScope(actor) } },
    { opportunities: { some: enquiryScope(actor) } },
    { workItems: { some: { tenantId: actor.tenantId, assignedUserId: actor.userId, status: { in: ["OPEN", "IN_PROGRESS"] as ("OPEN" | "IN_PROGRESS")[] } } } },
  ] }] }) }
}
export function accountScope(actor: CrmActor) {
  assertCrmActor(actor)
  return { tenantId: actor.tenantId, ...(salesRecordAccess(actor) === "ALL" ? {} : { AND: [{ OR: [
    { ownerUserId: actor.userId },
    { contacts: { some: { tenantId: actor.tenantId, contact: contactScope(actor) } } },
    { opportunities: { some: enquiryScope(actor) } },
  ] }] }) }
}
export function assigneeScope(actor: CrmActor) {
  const scope = salesRecordAccess(actor)
  return { tenantId: actor.tenantId, ...(scope === "ALL" ? {} : { OR: [
    { id: actor.userId },
    ...(scope === "MANAGED_TEAMS" ? [{ crmSalesTeamMemberships: { some: { tenantId: actor.tenantId, teamId: { in: actor.managedTeamIds ?? [] } } } }] : []),
  ] }) }
}
