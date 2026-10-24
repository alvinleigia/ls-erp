export type Role = "ADMIN" | "MANAGER" | "STAFF" | "CUSTOMER"
export { canUseCrm } from "@/modules/crm/policy"

export function canInvite(role?: Role | null) {
  return role === "ADMIN"
}

export function canManageTenants(role?: Role | null) {
  return role === "ADMIN"
}
