export type Role = "ADMIN" | "MANAGER" | "STAFF" | "CUSTOMER"
export { canUseCrm, canManageCrm } from "@/modules/crm/policy"

export function canManageUsers(role?: Role | null) {
  return role === "ADMIN" || role === "MANAGER"
}

export function canInvite(role?: Role | null) {
  return role === "ADMIN"
}

export function canManageTenants(role?: Role | null) {
  return role === "ADMIN"
}
