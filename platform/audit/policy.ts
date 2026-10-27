import { Prisma } from "@prisma/client"
import type { BusinessActor } from "../policy"
import { moduleEnabled } from "../modules"
import { satisfies } from "../access/policy"
import { recordLimits, recordScope } from "../access/rules"
import { auditFamilies } from "./registry"

export const securityEvents: Prisma.AuditLogWhereInput = { OR: auditFamilies.filter(family => family.boundary === "security").map(family => ({ event: { startsWith: family.prefix } })) }
const prefixSql = (prefix: string) => Prisma.sql`starts_with(a.event, ${prefix})`
export const securityEventSql = Prisma.sql`(${Prisma.join(auditFamilies.filter(family => family.boundary === "security").map(family => prefixSql(family.prefix)), " OR ")})`

export async function auditScope(tx: Prisma.TransactionClient, actor: BusinessActor): Promise<Prisma.Sql> {
  const flags = await tx.tenantModule.findMany({ where: { tenantId: actor.tenantId }, select: { key: true, allowed: true, enabled: true } })
  const families = auditFamilies.filter(family => (!family.adminOnly || actor.role === "ADMIN") &&
    (!family.fullAudit || recordScope(actor, "auditLogs", "read") === "ALL") &&
    (!family.read || satisfies(actor, family.read)) &&
    (!family.modules || family.modules.every(key => moduleEnabled(flags, key))) &&
    (!family.unscoped || family.unscoped.every(resource => recordLimits(actor, resource, "read").length === 0)))
  const predicates = families.map(family => {
    const children = auditFamilies.filter(child => child.prefix !== family.prefix && child.prefix.startsWith(family.prefix))
    return Prisma.sql`(${prefixSql(family.prefix)}${children.length ? Prisma.sql` AND NOT (${Prisma.join(children.map(child => prefixSql(child.prefix)), " OR ")})` : Prisma.empty})`
  })
  // Historical catalog snapshots can contain add-on fields. Disabling the add-on
  // hides that evidence, including before-only snapshots, without rewriting it.
  const addOn = moduleEnabled(flags, "realEstate") && satisfies(actor, "projects.read") ? Prisma.empty : Prisma.sql` AND NOT (starts_with(a.event, 'catalog.') AND (COALESCE(a.before->>'extensionKey', '')='realEstate' OR COALESCE(a.after->>'extensionKey', '')='realEstate'))`
  return Prisma.sql`(${predicates.length ? Prisma.join(predicates, " OR ") : Prisma.sql`false`})${addOn}`
}
