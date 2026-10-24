import type { Prisma } from "@prisma/client"
import type { BusinessActor } from "../policy"
import type { PermissionAction, Resource } from "./catalog"
import { recordLimits } from "./rules"

export function peopleScope(actor: BusinessActor, resource: Resource = "assignmentTargets", action?: PermissionAction): Prisma.UserWhereInput {
  return { tenantId: actor.tenantId, AND: recordLimits(actor, resource, action).map(scope => scope === "NONE" ? { id: { in: [] } } : { OR: [
    { id: actor.userId },
    ...(scope === "MANAGED_TEAMS" ? [{ businessTeamMemberships: { some: { tenantId: actor.tenantId, teamId: { in: actor.managedTeamIds ?? [] } } } }] : []),
  ] }) }
}
