import { Prisma, type PrismaClient } from "@prisma/client"
import type { BusinessActor } from "@/platform/policy"
import { ownedRecordSql, ownedRecordScope } from "@/platform/access/record-scope"
import type { QuotationSnapshot } from "@/modules/sales-documents/quotation-service"
import { createReceivableService } from "@/modules/receivables/service"
import type { ReceivableSource } from "@/modules/receivables/contracts"
const source: ReceivableSource = {
  scope: actor => ({ source: { quotation: { opportunity: { AND: [ownedRecordScope(actor, actor.operation?.resource === "orderPayments" ? "orderPayments" : "receivables"), ownedRecordScope(actor, "receivables", "read"), ownedRecordScope(actor, "salesOrders", "read")] } } } }),
  visibleOrderIds(actor) {
    return Prisma.sql`SELECT o.id FROM "SalesOrder" o
      JOIN "CrmQuotation" q ON q."tenantId"=o."tenantId" AND q.id=o."quotationId"
      JOIN "CrmOpportunity" p ON p."tenantId"=q."tenantId" AND p.id=q."opportunityId"
      WHERE o."tenantId"=${actor.tenantId} AND ${ownedRecordSql(actor, actor.operation?.resource === "orderPayments" ? "orderPayments" : "receivables", "p")} AND ${ownedRecordSql(actor, "receivables", "p", "read")} AND ${ownedRecordSql(actor, "salesOrders", "p", "read")}`
  },
  plan(value) {
    const { calculation: c } = value as unknown as QuotationSnapshot
    const lines = c.instalments.length
      ? c.instalments.map(line => ({ label: line.label, amount: line.amount, dueOn: line.dueDate || null }))
      : [{ label: "Order consideration", amount: c.consideration, dueOn: null }]
    for (const charge of c.charges) if (!charge.included && charge.amount) lines.push({ label: charge.label, amount: charge.amount, dueOn: null })
    return { total: c.totalKnown, blocked: c.hasPending ? "Resolve pending charges in a replacement quotation and order before opening receivables." : null, lines: lines.filter(line => new Prisma.Decimal(line.amount).gt(0)) }
  },
}
export const applicationReceivables = (db: PrismaClient, identity: Pick<BusinessActor, "tenantId" | "userId" | "requestId">) => createReceivableService(db, identity, source)
