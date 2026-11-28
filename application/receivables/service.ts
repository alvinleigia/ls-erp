import { responsibleUserSql, introductionSql } from "@/platform/collaborators/report-scope"
import { hasIntroductionFilter } from "@/platform/collaborators/report-validation"
import { requirePermission } from "@/platform/access/policy"
import { Prisma, type PrismaClient } from "@prisma/client"
import type { BusinessActor } from "@/platform/policy"
import { ownedRecordSql, sharingGrantSql, salesOrderRecordScope } from "@/platform/access/record-scope"
import { recordLimits } from "@/platform/access/rules"
import { quotationReceivablePlan } from "./plan"
import { createReceivableService } from "@/modules/receivables/service"
import type { ReceivableSource } from "@/modules/receivables/contracts"
const source: ReceivableSource = {
  pendingOrderIds(actor) {
    return Prisma.sql`SELECT o.id FROM "SalesOrder" o WHERE o."tenantId"=${actor.tenantId} AND o.snapshot->'calculation'->>'hasPending'='true'
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(o.snapshot->'calculation'->'charges') WITH ORDINALITY c(value,position)
        WHERE c.value->>'kind'='TBD' AND NOT EXISTS(SELECT 1 FROM "OrderReceivableCharge" x WHERE x."tenantId"=o."tenantId" AND x."orderId"=o.id AND x."sourceKey"='charge:'||(c.position-1)::text))`
  },
  scope: actor => salesOrderRecordScope(actor, actor.operation?.resource === "orderPayments" ? "orderPayments" : "receivables"),
  visibleOrderIds(actor, filters = {}) {
    if (hasIntroductionFilter(filters)) requirePermission(actor, "opportunities.read")
    const resource = actor.operation?.resource === "orderPayments" ? "orderPayments" : "receivables"
    if (recordLimits(actor, resource).includes("NONE") || recordLimits(actor, "receivables", "read").includes("NONE") || recordLimits(actor, "salesOrders", "read").includes("NONE")) return Prisma.sql`SELECT id FROM "SalesOrder" WHERE FALSE`
    return Prisma.sql`SELECT o.id FROM "SalesOrder" o
      JOIN "CrmQuotation" q ON q."tenantId"=o."tenantId" AND q.id=o."quotationId"
      JOIN "CrmOpportunity" p ON p."tenantId"=q."tenantId" AND p.id=q."opportunityId"
      WHERE o."tenantId"=${actor.tenantId}
      AND EXISTS(SELECT 1 FROM "User" u WHERE u."tenantId"=p."tenantId" AND u.id=p."assignedUserId" AND ${responsibleUserSql(filters,"u")})
      AND ${introductionSql(filters,"p")}
      ${hasIntroductionFilter(filters) ? Prisma.sql`AND ${ownedRecordSql(actor,"opportunities","p","read")}` : Prisma.empty}
      AND ((${ownedRecordSql(actor, resource, "p")} AND ${ownedRecordSql(actor, "receivables", "p", "read")} AND ${ownedRecordSql(actor, "salesOrders", "p", "read")}) OR ${sharingGrantSql(actor, "salesOrders", "o", actor.operation?.action ?? "read", resource)})`
  },
  attributionSources(actor, orderIds) {
    return Prisma.sql`SELECT p.id,p."createdAt",p."introducedByCollaboratorId" AS partner,p."partnerAttribution" AS evidence
      FROM "SalesOrder" o JOIN "CrmQuotation" q ON q."tenantId"=o."tenantId" AND q.id=o."quotationId"
      JOIN "CrmOpportunity" p ON p."tenantId"=q."tenantId" AND p.id=q."opportunityId"
      WHERE o."tenantId"=${actor.tenantId} AND o.id IN (${orderIds}) AND ${ownedRecordSql(actor,"opportunities","p","read")}`
  },
  plan: quotationReceivablePlan,
}
export const applicationReceivables = (db: PrismaClient, identity: Pick<BusinessActor, "tenantId" | "userId" | "requestId">) => createReceivableService(db, identity, source)
