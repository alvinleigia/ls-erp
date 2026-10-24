import type { Prisma } from "@prisma/client"
import type { BusinessActor } from "@/platform/policy"
import { recordAccess } from "@/platform/access/record-scope"

export function projectScope(actor: BusinessActor): Prisma.RealEstateProjectWhereInput {
  const scope = recordAccess(actor, "projects")
  if (scope === "ALL") return { tenantId: actor.tenantId }
  // Staff read explicitly assigned projects and projects assigned to their team.
  // A Manager's OWN scope is explicit assignment, rather than every team they join.
  const teamIds = actor.role === "STAFF" ? actor.memberTeamIds ?? [] : scope === "MANAGED_TEAMS" ? actor.managedTeamIds ?? [] : []
  const assigned: Prisma.RealEstateProjectWhereInput = { OR: [
    { members: { some: { tenantId: actor.tenantId, userId: actor.userId } } },
    { teamId: { in: teamIds } },
  ] }
  return { tenantId: actor.tenantId, ...(actor.role === "STAFF" ? { archived: false } : {}), OR: [
    { parentId: null, ...assigned },
    { parent: { ...(actor.role === "STAFF" ? { archived: false } : {}), ...assigned } },
  ] }
}
