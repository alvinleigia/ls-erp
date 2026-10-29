import { readParticipantConfiguration } from "@/platform/participants/configuration"
import { participantConfirmationProof } from "@/platform/participants/requirements"
import { realEstateParticipantPreset } from "@/modules/real-estate/participant-preset"
import { ownedRecordScope, quotationRecordScope, salesOrderRecordScope } from "@/platform/access/record-scope"
import type { Prisma, PrismaClient } from "@prisma/client"
import { BusinessError, type BusinessActor } from "@/platform/policy"
import { createSalesOrderService } from "@/modules/sales-orders/service"
import type { SalesOrderSource } from "@/modules/sales-orders/contracts"
import type { QuotationSnapshot } from "@/modules/sales-documents/quotation-service"
import { releaseOrderReservations } from "@/modules/catalog/reservation-events"
import { requireResolvedPayments } from "@/modules/receivables/cancellation"
async function reviewConfirmation(tx: Prisma.TransactionClient, actor: BusinessActor, snapshot: Prisma.JsonValue) {
  const configuration = await readParticipantConfiguration(tx, actor.tenantId, await realEstateParticipantPreset(tx, actor))
  return participantConfirmationProof((snapshot as unknown as QuotationSnapshot).participants, configuration)
}
const source: SalesOrderSource = {
  async reviewConfirmation(tx, actor, snapshot) {
    const { missing, proof } = await reviewConfirmation(tx, actor, snapshot)
    return { missing: missing.map(({ participant, label }) => ({ participant, label })), configurationVersion: proof.configurationVersion }
  },
  async onConfirm(tx, actor, snapshot) {
    const { missing, proof } = await reviewConfirmation(tx, actor, snapshot)
    if (missing.length) {
      const examples = missing.slice(0, 8).map(item => `${item.participant}: ${item.label}`).join("; ")
      throw new BusinessError(409, `Complete the required customer details in a new quotation revision before confirming: ${examples}${missing.length > 8 ? `; and ${missing.length - 8} more` : ""}. Saved orders retain their selected revision; cancel and replace this draft after correcting the source.`)
    }
    return proof
  },
  async onCancel(tx, actor, id, reason) {
    const [invoiced]=await tx.$queryRaw<{blocked:boolean|null}[]>`SELECT app.has_posted_invoice(${actor.tenantId},${id}) AS blocked`
    if(invoiced?.blocked)throw new BusinessError(409,"Fully credit posted commercial invoices before cancelling this order.")
    await requireResolvedPayments(tx, actor, id)
    await releaseOrderReservations(tx, actor, id, reason)
  },
  scope: actor => salesOrderRecordScope(actor),
  async read(tx, actor, quotationId, revision) {
    const row = await tx.crmQuotationRevision.findFirst({ where: { tenantId: actor.tenantId, quotationId, number: revision, quotation: { AND: [quotationRecordScope(actor, "read"), { opportunity: ownedRecordScope(actor, "salesOrders") }] } }, include: { quotation: { select: { opportunity: { select: { contact: { select: { archived: true } } } } } } } })
    if (!row) throw new BusinessError(404, "Quotation revision not found.")
    if (row.quotation.opportunity.contact.archived) throw new BusinessError(409, "Restore the customer before creating a sales order.")
    const snapshot = row.snapshot as unknown as QuotationSnapshot
    // Historical revisions freeze customer details, not a contact ID. Never
    // substitute the opportunity's current contact for that saved identity.
    return { quotationId, revision, title: snapshot.content.title, customerName: snapshot.customer.name, currency: snapshot.content.currency, consideration: snapshot.calculation.consideration, snapshot: row.snapshot as Prisma.InputJsonValue }
  },
}
export const applicationSalesOrders = (db: PrismaClient, actor: Pick<BusinessActor, "tenantId" | "userId" | "requestId">) => createSalesOrderService(db, actor, source)
