import { Prisma } from "@prisma/client"
import type { BusinessActor } from "../policy"
import type { PermissionAction, Resource } from "./catalog"
import { recordLimits } from "./rules"

// Owned sales records share this shape; the permission belongs to the target
// resource, even when ownership is inherited through an opportunity.
export function ownedRecordScope(actor: BusinessActor, resource: Resource, action?: PermissionAction) {
  return { tenantId: actor.tenantId, AND: recordLimits(actor, resource, action).map(scope => scope === "NONE" ? { id: { in: [] as string[] } } : { OR: [
    { assignedUserId: actor.userId },
    ...(scope === "MANAGED_TEAMS" ? [{ salesTeamId: { in: actor.managedTeamIds ?? [] } }] : []),
  ] }) }
}
export function ownedRecordSql(actor: BusinessActor, resource: Resource, alias: string, action?: PermissionAction) {
  // Identifiers are supplied by application code, never request input.
  if (!/^[a-z][a-z0-9_]*$/i.test(alias)) throw new Error("Invalid ownership alias")
  const column = (name: string) => Prisma.raw(`${alias}."${name}"`)
  return Prisma.join([Prisma.sql`TRUE`, ...recordLimits(actor, resource, action).map(scope => scope === "NONE" ? Prisma.sql`FALSE` : Prisma.sql`(${column("assignedUserId")}=${actor.userId} ${scope === "MANAGED_TEAMS" && actor.managedTeamIds?.length ? Prisma.sql`OR ${column("salesTeamId")} IN (${Prisma.join(actor.managedTeamIds)})` : Prisma.empty})`)], " AND ")
}
export function canReadSalesRecord(actor: BusinessActor, record: { assignedUserId: string; salesTeamId?: string | null }, resource: Resource) {
  return recordLimits(actor, resource, "read").every(scope => scope !== "NONE" && (record.assignedUserId === actor.userId || (scope === "MANAGED_TEAMS" && !!record.salesTeamId && !!actor.managedTeamIds?.includes(record.salesTeamId))))
}
