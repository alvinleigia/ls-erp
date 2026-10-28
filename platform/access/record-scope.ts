import { Prisma } from "@prisma/client"
import type { BusinessActor } from "../policy"
import type { PermissionAction, Resource } from "./catalog"
import { recordLimits } from "./rules"
import { sharedRecordWhere, sharingGrant, sharingLevel } from "./sharing-scope"
import type { SharingResource } from "./sharing-registry"
import { policyAction } from "./rules"

// Owned sales records share this shape; the permission belongs to the target
// resource, even when ownership is inherited through an opportunity.
export function ownedRecordScope(actor: BusinessActor, resource: Resource, action?: PermissionAction) {
  return { tenantId: actor.tenantId, AND: recordLimits(actor, resource, action).map(scope => scope === "NONE" ? { id: { in: [] as string[] } } : { OR: [
    { assignedUserId: actor.userId },
    ...(scope === "MANAGED_TEAMS" ? [{ salesTeamId: { in: actor.managedTeamIds ?? [] } }] : []),
  ] }) }
}
// Related contact/activity context includes explicit shares of its sales source.
// The caller still enforces its own Read/action rules and source RLS.
export function relatedSalesScope(actor: BusinessActor, resource: Resource, action?: PermissionAction) {
  return { OR: [ownedRecordScope(actor, resource, action), sharingGrant(actor, policyAction(actor, resource, action))] }
}
export function ownedRecordSql(actor: BusinessActor, resource: Resource, alias: string, action?: PermissionAction) {
  // Identifiers are supplied by application code, never request input.
  if (!/^[a-z][a-z0-9_]*$/i.test(alias)) throw new Error("Invalid ownership alias")
  const column = (name: string) => Prisma.raw(`${alias}."${name}"`)
  const base = Prisma.join([Prisma.sql`TRUE`, ...recordLimits(actor, resource, action).map(scope => scope === "NONE" ? Prisma.sql`FALSE` : Prisma.sql`(${column("assignedUserId")}=${actor.userId} ${scope === "MANAGED_TEAMS" && actor.managedTeamIds?.length ? Prisma.sql`OR ${column("salesTeamId")} IN (${Prisma.join(actor.managedTeamIds)})` : Prisma.empty})`)], " AND ")
  if ((resource === "enquiries" || resource === "opportunities") && !recordLimits(actor, resource, action).includes("NONE")) return Prisma.sql`((${base}) OR ${sharingGrantSql(actor, resource, alias, policyAction(actor, resource, action))})`
  return base
}
export function quotationRecordScope(actor: BusinessActor, action?: PermissionAction): Prisma.CrmQuotationWhereInput {
  return sharedRecordWhere(actor, "quotations", { tenantId: actor.tenantId, opportunity: ownedRecordScope(actor, "quotations", action) }, { opportunity: { assignedUserId: actor.userId } }, action)
}
export function salesOrderRecordScope(actor: BusinessActor, resource: "salesOrders" | "receivables" | "orderPayments" | "unitReservations" | "orderDocuments" = "salesOrders"): Prisma.SalesOrderWhereInput {
  const rules: Resource[] = [resource, "salesOrders", ...(resource === "orderPayments" ? ["receivables" as const] : [])]
  const base: Prisma.SalesOrderWhereInput = { tenantId: actor.tenantId, source: { quotation: { opportunity: { AND: rules.map((key,index) => ownedRecordScope(actor, key, index ? "read" : undefined)) } } } }
  if (rules.some((key,index) => recordLimits(actor, key, index ? "read" : undefined).includes("NONE"))) return base
  return sharedRecordWhere(actor, resource, base, { source: { quotation: { opportunity: { assignedUserId: actor.userId } } } })
}

export function sharingGrantSql(actor: BusinessActor, resource: SharingResource, alias: string, action: PermissionAction, permissionResource: Resource = resource) {
  if (!/^[a-z][a-z0-9_]*$/i.test(alias)) throw new Error("Invalid sharing alias")
  if (recordLimits(actor, permissionResource, action).includes("NONE")) return Prisma.sql`FALSE`
  const level = sharingLevel(action)
  const id = Prisma.raw(`${alias}.id`)
  return Prisma.sql`EXISTS(SELECT 1 FROM "RecordSharingPolicy" sp JOIN "RecordSharingGrant" sg ON sg."tenantId"=sp."tenantId" AND sg."policyId"=sp.id WHERE sp."tenantId"=${actor.tenantId} AND sp.resource=${resource} AND sp."recordId"=${id} AND (${level}='READ' OR sg.level='EDIT') AND (sg."userId"=${actor.userId} ${actor.memberTeamIds?.length ? Prisma.sql`OR sg."teamId" IN (${Prisma.join(actor.memberTeamIds)})` : Prisma.empty}))`
}
