import type { Prisma, PrismaClient } from "@prisma/client"
import { BusinessError, type BusinessActor } from "@/platform/policy"
import { enquiryScope } from "@/modules/crm/policy"
import { createSalesOrderService } from "@/modules/sales-orders/service"
import type { SalesOrderSource } from "@/modules/sales-orders/contracts"
import type { QuotationSnapshot } from "@/modules/sales-documents/quotation-service"
const source: SalesOrderSource = {
  scope: actor => ({ source: { quotation: { opportunity: enquiryScope(actor) } } }),
  async read(tx, actor, quotationId, revision) {
    const row = await tx.crmQuotationRevision.findFirst({ where: { tenantId: actor.tenantId, quotationId, number: revision, quotation: { opportunity: enquiryScope(actor) } }, include: { quotation: { select: { opportunity: { select: { contact: { select: { archived: true } } } } } } } })
    if (!row) throw new BusinessError(404, "Quotation revision not found.")
    if (row.quotation.opportunity.contact.archived) throw new BusinessError(409, "Restore the customer before creating a sales order.")
    const snapshot = row.snapshot as unknown as QuotationSnapshot
    // Historical revisions freeze customer details, not a contact ID. Never
    // substitute the opportunity's current contact for that saved identity.
    return { quotationId, revision, title: snapshot.content.title, customerName: snapshot.customer.name, currency: snapshot.content.currency, consideration: snapshot.calculation.consideration, snapshot: row.snapshot as Prisma.InputJsonValue }
  },
}
export const applicationSalesOrders = (db: PrismaClient, actor: Pick<BusinessActor, "tenantId" | "userId" | "requestId">) => createSalesOrderService(db, actor, source)
