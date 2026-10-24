import { BusinessError, type BusinessActor } from "../policy"
import { accessResources, type Permission, type Requirement, type Resource } from "./catalog"
import { operationPermission } from "./rules"
import type { PermissionAction } from "./catalog"

export function permits(actor: Pick<BusinessActor, "permissions">, permission: Permission) {
  // Admin/customer entrypoints may use account authority. Staff and Managers
  // resolve explicit profile arrays, including [] when no profile grants access.
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
export function authorizeOperation(actor: BusinessActor, requirement: Requirement): BusinessActor {
  requirePermission(actor, requirement)
  const [resource, action] = operationPermission(requirement).split(".") as [Resource, PermissionAction]
  return { ...actor, operation: { resource, action } }
}
export async function requireScopedWriteFields(actor: BusinessActor, resource: Resource, before: Record<string, unknown> | undefined, data: Record<string, unknown>, assertRecord: (action: PermissionAction) => Promise<unknown>) {
  requireWriteFields(actor, resource, before, data)
  if (!before) return
  if (data.archived !== undefined && data.archived !== (before.archived ?? false)) await assertRecord("archive")
  if (["assignedUserId", "ownerUserId", "salesTeamId", "teamId"].some(key => data[key] !== undefined && (data[key] || null) !== (before[key] ?? null)) && (accessResources[resource].actions as readonly string[]).includes("assign")) await assertRecord("assign")
}
export function requireWriteFields(actor: BusinessActor, resource: Resource, before: Record<string, unknown> | undefined, data: Record<string, unknown>) {
  if (data.archived !== undefined && data.archived !== (before?.archived ?? false)) requirePermission(actor, `${resource}.archive`)
  for (const key of ["assignedUserId", "ownerUserId", "salesTeamId"]) {
    // Choosing a team for a newly created record is part of Create. Assignment
    // controls changing an existing team or choosing another record owner.
    if (!before && key === "salesTeamId") continue
    if (data[key] !== undefined && (data[key] || null) !== (before?.[key] ?? (key === "salesTeamId" ? null : actor.userId)) && accessResources[resource].actions.some(action => action === "assign")) requirePermission(actor, `${resource}.assign`)
  }
}
