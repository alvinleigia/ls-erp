import { accessResources, allPermissions, type Permission, type Resource } from "./catalog"
import { businessModules, type BusinessModuleKey } from "../modules"

export const profileModules = ["all", "core", ...Object.keys(businessModules).filter(key => Object.values(accessResources).some(resource => resource.module === key))] as [string, ...string[]]
export const profileModuleName = (key: string) => key === "all" ? "Several modules" : key === "core" ? "Core workspace" : businessModules[key as BusinessModuleKey]?.name ?? key
export function profileResources(moduleKey: string): Resource[] {
  return (Object.keys(accessResources) as Resource[]).filter(resource => moduleKey === "all" || accessResources[resource].module === moduleKey || resource === "dashboard")
}
export function validProfilePermissions(moduleKey: string, permissions: readonly string[]) {
  const resources = new Set(profileResources(moduleKey))
  return permissions.every(permission => allPermissions.includes(permission as Permission) && resources.has(permission.split(".")[0] as Resource))
}
export const moduleProfileTemplates = profileModules.filter(key => key !== "all" && Object.values(accessResources).some(resource => resource.module === key)).flatMap(moduleKey => ["viewer", "manager"].map(level => ({
  key: `${moduleKey}:${level}`, moduleKey, name: `${profileModuleName(moduleKey)} ${level === "viewer" ? "Viewer" : "Manager"}`,
  permissions: allPermissions.filter(permission => (accessResources[permission.split(".")[0] as Resource].module === moduleKey && (level === "manager" || permission.endsWith(".read"))) || permission === "dashboard.read"),
})))
export type ProfileGrant = { roleId: string; role: { name?: string; moduleKey?: string; archived: boolean; permissions: string[] } }
// Permissions compose additively. Record visibility belongs to the user policy,
// so adding an unrelated profile cannot change record scope or approval authority.
export function composeProfilePermissions(role: string, assignments: readonly ProfileGrant[]): Permission[] | undefined {
  if (role === "ADMIN" || role === "CUSTOMER") return undefined
  const granted = new Set(assignments.filter(item => !item.role.archived).flatMap(item => item.role.permissions))
  return allPermissions.filter(permission => granted.has(permission))
}
