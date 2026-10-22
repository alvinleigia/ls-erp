import { Prisma, type PrismaClient } from "@prisma/client"
import type { BusinessActor } from "@/platform/policy"
import { enquiryScope } from "@/modules/crm/policy"
import type { QuotationSnapshot } from "@/modules/sales-documents/quotation-service"
import { createReceivableService } from "@/modules/receivables/service"
import type { ReceivableSource } from "@/modules/receivables/contracts"
const source: ReceivableSource = {
  scope: actor => ({ source: { quotation: { opportunity: enquiryScope(actor) } } }),
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
