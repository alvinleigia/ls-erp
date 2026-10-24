import type { BusinessActor } from "../policy"
export const recordScopes = ["ACCOUNT_ROLE", "OWN", "MANAGED_TEAMS", "ALL"] as const
export type RecordScope = typeof recordScopes[number]
export type RecordDomain = "sales" | "projects"
export function recordAccess(actor: BusinessActor, domain: RecordDomain): "OWN" | "MANAGED_TEAMS" | "ALL" {
  if (actor.role === "ADMIN") return "ALL"
  // Scopes narrow account authority. Staff never gain manager authority.
  if (actor.role !== "MANAGER") return "OWN"
  const scope = domain === "sales" ? actor.salesRecordScope : actor.projectRecordScope
  if (!scope || scope === "ACCOUNT_ROLE") return "ALL"
  return scope
}
export const salesRecordAccess = (actor: BusinessActor) => recordAccess(actor, "sales")
export function canReadSalesRecord(actor: BusinessActor, record: { assignedUserId: string; salesTeamId?: string | null }) {
  const scope = salesRecordAccess(actor)
  return scope === "ALL" || record.assignedUserId === actor.userId || (scope === "MANAGED_TEAMS" && !!record.salesTeamId && !!actor.managedTeamIds?.includes(record.salesTeamId))
}
