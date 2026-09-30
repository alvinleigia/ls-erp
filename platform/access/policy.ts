import { BusinessError, type BusinessActor } from "../policy"
import { accessResources, type Permission, type Requirement, type Resource } from "./catalog"

export function permits(actor: Pick<BusinessActor, "permissions">, permission: Permission) {
  // No assignment retains legacy authorization, whose existing checks still run.
  return actor.permissions === undefined || (actor.permissions.includes(permission) && actor.permissions.includes(`${permission.split(".")[0]}.read` as Permission))
}
export function satisfies(actor: Pick<BusinessActor, "permissions">, requirement: Requirement): boolean {
  if (typeof requirement === "string") return permits(actor, requirement)
  if ("any" in requirement) return requirement.any.some(permission => permits(actor, permission))
  return requirement.every(item => satisfies(actor, item))
}
export function requirePermission(actor: BusinessActor, requirement: Requirement) {
  if (!satisfies(actor, requirement)) throw new BusinessError(403, "Your access role does not permit this action.")
}
export function requireWriteFields(actor: BusinessActor, resource: Resource, before: Record<string, unknown> | undefined, data: Record<string, unknown>) {
  if (data.archived !== undefined && data.archived !== (before?.archived ?? false)) requirePermission(actor, `${resource}.archive`)
  for (const key of ["assignedUserId", "ownerUserId", "salesTeamId"]) {
    if (data[key] !== undefined && (data[key] || null) !== (before?.[key] ?? (key === "salesTeamId" ? null : actor.userId)) && accessResources[resource].actions.some(action => action === "assign")) requirePermission(actor, `${resource}.assign`)
  }
}
