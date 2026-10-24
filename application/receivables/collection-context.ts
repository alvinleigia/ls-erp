import type { CrmExtensions } from "@/modules/crm/extensions"
import { salesOrderRecordScope } from "@/platform/access/record-scope"
import { permits, requirePermission } from "@/platform/access/policy"
import { moduleEnabled } from "@/platform/modules"
import { BusinessError } from "@/platform/policy"

// Called inside Activities' transaction with fresh identity/access. Assignment to
// an activity never grants permission to its order or financial ledger.
export const collectionContext: NonNullable<CrmExtensions["collectionContext"]> = async (tx, actor, orderId, creating) => {
  requirePermission(actor, ["receivables.read", "salesOrders.read"])
  if (!moduleEnabled(await tx.tenantModule.findMany({ where: { tenantId: actor.tenantId } }), "receivables")) throw new BusinessError(403, "Receivables is not enabled.")
  const account = await tx.orderReceivable.findFirst({ where: { tenantId: actor.tenantId, orderId, order: salesOrderRecordScope({ ...actor, operation: { resource: "receivables", action: "read" } }, "receivables") },
    include: { order: { select: { status: true, title: true, source: { select: { quotation: { select: { opportunity: { select: { id: true, contactId: true } } } } } } } } } })
  if (!account) throw new BusinessError(404, "Receivable not found.")
  const paid = await tx.orderReceipt.aggregate({ where: { tenantId: actor.tenantId, orderId, status: "POSTED" }, _sum: { amount: true } })
  const open = account.order.status === "CONFIRMED" && account.total.gt(paid._sum.amount ?? 0)
  if (creating && !open) throw new BusinessError(409, "Collection follow-ups require a confirmed order with an outstanding balance.")
  const opportunity = account.order.source.quotation.opportunity
  return { title: account.order.title, contactId: opportunity.contactId, opportunityId: opportunity.id, canCreate: open && permits(actor, "activities.create") }
}
