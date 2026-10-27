import { z } from "zod"
import { accessResources, allPermissions, type Permission, type PermissionAction, type Requirement, type Resource } from "./catalog"
import type { BusinessActor } from "../policy"
import { resourceRecordPolicies } from "./resource-policy"

export const recordScopes = ["NONE", "OWN", "RELATED", "ASSIGNED", "MANAGED_TEAMS", "REPORTS", "ACTIVE", "BUSINESS", "ALL"] as const
export type RecordScope = typeof recordScopes[number]
export type RecordRules = Partial<Record<Permission, RecordScope>>
export const scopeNames: Record<RecordScope, string> = { NONE: "No access", OWN: "Own / directly assigned", RELATED: "Own and assigned context", ASSIGNED: "Assigned active records", MANAGED_TEAMS: "Own and managed teams", REPORTS: "Reporting staff", ACTIVE: "Active records", BUSINESS: "Business events", ALL: "All accessible records" }
export function supportedScopes(resource: Resource): readonly RecordScope[] {
  if (resource === "auditLogs") return ["NONE", "BUSINESS", "ALL"]
  if (resource === "quotationTemplates") return ["NONE", "ACTIVE", "ALL"]
  switch (resourceRecordPolicies[resource]) {
    case "sales": return ["contacts", "accounts", "activities"].includes(resource) ? ["NONE", "OWN", "RELATED", "MANAGED_TEAMS", "ALL"] : ["NONE", "OWN", "MANAGED_TEAMS", "ALL"]
    case "projects": return resource === "catalogItems" ? ["NONE", "ALL"] : ["NONE", "OWN", "ASSIGNED", "MANAGED_TEAMS", "ALL"]
    case "personal": return ["NONE", "OWN"]
    case "reportingManager": return ["NONE", "REPORTS", "ALL"]
    case "teams": return ["NONE", "OWN", "MANAGED_TEAMS", "ALL"]
    case "directory": return ["NONE", "OWN", "MANAGED_TEAMS", "ALL"]
    case "reporting": return ["NONE", "OWN", "ALL"]
    default: return ["NONE", "ALL"]
  }
}
export function defaultScope(resource: Resource, action: PermissionAction): RecordScope {
  if (resource === "auditLogs") return "BUSINESS"
  if (resource === "restrictedFields") return "NONE"
  const family = resourceRecordPolicies[resource]
  if (family === "personal" || family === "directory" || family === "reporting") return "OWN"
  if (family === "reportingManager") return "REPORTS"
  if (family === "teams") return action === "read" ? "OWN" : action === "create" ? "ALL" : "MANAGED_TEAMS"
  if (family === "projects" && resource !== "catalogItems") return action === "read" || action === "export" ? "ASSIGNED" : action === "assign" ? "MANAGED_TEAMS" : "OWN"
  if (family === "sales") return action === "read" && ["contacts", "accounts", "activities"].includes(resource) ? "RELATED" : "OWN"
  return "ALL"
}
export function defaultRecordRules(): RecordRules {
  return Object.fromEntries(allPermissions.map(permission => { const [resource, action] = permission.split(".") as [Resource, PermissionAction]; return [permission, defaultScope(resource, action)] })) as RecordRules
}
export const recordRulesSchema = z.partialRecord(z.enum(allPermissions as [Permission, ...Permission[]]), z.enum(recordScopes)).superRefine((rules, ctx) => {
  for (const [permission, scope] of Object.entries(rules)) if (!supportedScopes(permission.split(".")[0] as Resource).includes(scope)) ctx.addIssue({ code: "custom", path: [permission], message: "This resource does not support that record scope." })
})
export function operationPermission(requirement: Requirement): Permission {
  const flatten = (value: Requirement): Permission[] => typeof value === "string" ? [value] : "any" in value ? [...value.any] : value.flatMap(flatten)
  const permissions = flatten(requirement)
  return permissions.find(permission => !permission.endsWith(".read")) ?? permissions[0]
}
export function policyAction(actor: BusinessActor, resource: Resource, action?: PermissionAction): PermissionAction {
  if (action) return action
  if (actor.operation?.resource === resource) return actor.operation.action
  if (actor.operation?.action === "export" && (accessResources[resource].actions as readonly string[]).includes("export")) return "export"
  return "read"
}
export function recordScope(actor: BusinessActor, resource: Resource, action?: PermissionAction): RecordScope {
  if (actor.role === "ADMIN") return "ALL"
  if (actor.role !== "STAFF" && actor.role !== "MANAGER") return "NONE"
  const scope = actor.recordRules?.[`${resource}.${policyAction(actor, resource, action)}`]
  return scope && supportedScopes(resource).includes(scope) ? scope : "NONE"
}
export function recordLimits(actor: BusinessActor, resource: Resource, action?: PermissionAction): RecordScope[] {
  const actual = policyAction(actor, resource, action)
  const limits = [...new Set([recordScope(actor, resource, actual), ...(actual === "read" ? [] : [recordScope(actor, resource, "read")])])]
  return limits.includes("NONE") ? ["NONE"] : limits.filter(scope => scope !== "ALL")
}
export function scopeAllowsOthers(actor: BusinessActor, resource: Resource, action?: PermissionAction) {
  const limits = recordLimits(actor, resource, action)
  return !limits.includes("NONE") && !limits.includes("OWN")
}
