import type { Prisma } from "@prisma/client"
import type { BusinessActor } from "../policy"
import type { PermissionAction, Resource } from "./catalog"
import { policyAction, recordLimits } from "./rules"
import { sharingResource } from "./sharing-registry"

export const sharingLevel = (action: PermissionAction) => action === "read" || action === "export" ? "READ" : "EDIT"
export function sharingGrant(actor: BusinessActor, action: PermissionAction) {
  return { sharingPolicy: { is: { grants: { some: {
    ...(sharingLevel(action) === "EDIT" ? { level: "EDIT" } : {}),
    OR: [{ userId: actor.userId }, { teamId: { in: actor.memberTeamIds ?? [] } }],
  } } } } }
}
// Explicit sharing extends normal ownership, never a missing profile permission
// or a None rule. Restricted visibility also caps tenant-wide ordinary users.
export function sharedRecordWhere<T>(actor: BusinessActor, resource: Resource, base: T, owner: object, action?: PermissionAction): T {
  if (actor.role === "ADMIN" || !sharingResource(resource) || recordLimits(actor, resource, action).includes("NONE")) return base
  const grant = sharingGrant(actor, policyAction(actor, resource, action))
  return { tenantId: actor.tenantId, AND: [
    { OR: [base, grant] },
    { OR: [{ sharingPolicyId: null }, { sharingPolicy: { is: { restricted: false } } }, owner, grant] },
  ] } as T
}
export async function sharingAllows(tx: Prisma.TransactionClient, actor: BusinessActor, resource: Resource, id: string, action: PermissionAction) {
  const canonical = sharingResource(resource)
  if (!canonical || actor.role === "ADMIN") return true
  const [row] = await tx.$queryRaw<{ allowed: boolean }[]>`SELECT app.record_sharing_allowed(${actor.tenantId}, ${canonical}, ${id}, ${actor.userId}, ${sharingLevel(action)}) AS allowed`
  return row?.allowed === true
}
