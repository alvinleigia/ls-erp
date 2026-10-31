import { Prisma } from "@prisma/client"
import { recordLimits, policyAction } from "@/platform/access/rules"
import { sharedRecordWhere } from "@/platform/access/sharing-scope"
import { relatedSalesScope, ownedRecordSql, sharingGrantSql } from "@/platform/access/record-scope"
import type { PermissionAction } from "@/platform/access/catalog"
import type { CrmActor } from "./policy"

export function workScope(actor: CrmActor, action?: PermissionAction): Prisma.CrmTaskWhereInput {
  const base: Prisma.CrmTaskWhereInput = { tenantId: actor.tenantId, AND: recordLimits(actor, "activities", action).map(scope => scope === "NONE" ? { id: { in: [] } } : { OR: [
    { assignedUserId: actor.userId }, ...(scope === "OWN" ? [] : [
      { enquiry: relatedSalesScope(actor, "activities", action) }, { opportunity: relatedSalesScope(actor, "activities", action) },
      { enquiryId: null, opportunityId: null, contact: { ownerUserId: actor.userId } },
    ]),
  ] }) }
  return sharedRecordWhere(actor, "activities", base, { assignedUserId: actor.userId }, action)
}

// SQL projection of the same Read policy for source-backed report choices.
// Parent and task tables retain native sharing, source and office RLS.
export function workScopeSql(actor: CrmActor, alias: string) {
  if (!/^[a-z][a-z0-9_]*$/i.test(alias)) throw Error("Invalid work alias")
  const t = Prisma.raw(alias)
  const action = policyAction(actor, "activities")
  const related = (resource: "enquiries" | "opportunities", source: string) => Prisma.sql`(${ownedRecordSql(actor, "activities", source, action)} OR ${sharingGrantSql(actor, resource, source, action, "activities")})`
  const base = Prisma.join([Prisma.sql`TRUE`, ...recordLimits(actor, "activities", action).map(scope => scope === "NONE" ? Prisma.sql`FALSE` : Prisma.sql`(${t}."assignedUserId"=${actor.userId} ${scope === "OWN" ? Prisma.empty : Prisma.sql`OR EXISTS(SELECT 1 FROM "CrmEnquiry" e WHERE e."tenantId"=${t}."tenantId" AND e.id=${t}."enquiryId" AND ${related("enquiries", "e")})
    OR EXISTS(SELECT 1 FROM "CrmOpportunity" p WHERE p."tenantId"=${t}."tenantId" AND p.id=${t}."opportunityId" AND ${related("opportunities", "p")})
    OR (${t}."enquiryId" IS NULL AND ${t}."opportunityId" IS NULL AND EXISTS(SELECT 1 FROM "CrmContact" c WHERE c."tenantId"=${t}."tenantId" AND c.id=${t}."contactId" AND c."ownerUserId"=${actor.userId}))`})`)], " AND ")
  return Prisma.sql`(${t}."tenantId"=${actor.tenantId} AND ((${base}) OR ${sharingGrantSql(actor, "activities", alias, action)}))`
}
