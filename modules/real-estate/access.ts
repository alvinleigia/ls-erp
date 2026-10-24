import type { Prisma } from "@prisma/client"
import type { BusinessActor } from "@/platform/policy"
import { recordLimits } from "@/platform/access/rules"
import type { PermissionAction, Resource } from "@/platform/access/catalog"
import { sharedRecordWhere } from "@/platform/access/sharing-scope"

export function projectScope(actor: BusinessActor, action?: PermissionAction, resource: Resource = "projects"): Prisma.RealEstateProjectWhereInput {
  const active = recordLimits(actor, resource, action).includes("ASSIGNED") ? { archived: false } : {}
  const base: Prisma.RealEstateProjectWhereInput = { tenantId: actor.tenantId, AND: recordLimits(actor, resource, action).map(scope => {
    if (scope === "NONE") return { id: { in: [] } }
    const teamIds = scope === "ASSIGNED" ? actor.memberTeamIds ?? [] : scope === "MANAGED_TEAMS" ? actor.managedTeamIds ?? [] : []
    const assigned: Prisma.RealEstateProjectWhereInput = { OR: [{ members: { some: { tenantId: actor.tenantId, userId: actor.userId } } }, { teamId: { in: teamIds } }] }
    return assigned
  }) }
  const root = { AND: [sharedRecordWhere(actor, resource, base, { members: { some: { tenantId: actor.tenantId, userId: actor.userId } } }, action), active] }
  return { tenantId: actor.tenantId, ...active, OR: [{ parentId: null, ...root }, { parent: root }] }
}
