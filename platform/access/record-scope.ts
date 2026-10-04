import type { BusinessActor } from "../policy"
export const crmRecordScopes = ["ACCOUNT_ROLE", "OWN", "MANAGED_TEAMS", "ALL"] as const
export type CrmRecordScope = typeof crmRecordScopes[number]
export function salesRecordAccess(actor: BusinessActor): "OWN" | "MANAGED_TEAMS" | "ALL" {
  if (actor.role === "ADMIN") return "ALL"
  // Scopes narrow account authority. Staff never gain manager authority.
  if (actor.role !== "MANAGER") return "OWN"
  if (!actor.crmRecordScope || actor.crmRecordScope === "ACCOUNT_ROLE") return "ALL"
  return actor.crmRecordScope
}
export function canReadSalesRecord(actor: BusinessActor, record: { assignedUserId: string; salesTeamId?: string | null }) {
  const scope = salesRecordAccess(actor)
  return scope === "ALL" || record.assignedUserId === actor.userId || (scope === "MANAGED_TEAMS" && !!record.salesTeamId && !!actor.managedTeamIds?.includes(record.salesTeamId))
}
