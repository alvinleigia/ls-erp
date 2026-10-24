import type { Prisma } from "@prisma/client"
import type { BusinessActor } from "@/platform/policy"
import { recordLimits } from "@/platform/access/rules"
import type { PermissionAction, Resource } from "@/platform/access/catalog"

export function projectScope(actor: BusinessActor, action?: PermissionAction, resource: Resource = "projects"): Prisma.RealEstateProjectWhereInput {
  return { tenantId: actor.tenantId, AND: recordLimits(actor, resource, action).map(scope => {
    if (scope === "NONE") return { id: { in: [] } }
    const teamIds = scope === "ASSIGNED" ? actor.memberTeamIds ?? [] : scope === "MANAGED_TEAMS" ? actor.managedTeamIds ?? [] : []
    const assigned: Prisma.RealEstateProjectWhereInput = { OR: [{ members: { some: { tenantId: actor.tenantId, userId: actor.userId } } }, { teamId: { in: teamIds } }] }
    const active = scope === "ASSIGNED" ? { archived: false } : {}
    return { ...active, OR: [{ parentId: null, ...assigned }, { parent: { ...active, ...assigned } }] }
  }) }
}
