import { Prisma } from "@prisma/client"
import type { QuotationSnapshot } from "@/modules/sales-documents/quotation-service"
import type { ReceivablePlan } from "@/modules/receivables/contracts"

// Keys refer to positions in the immutable accepted calculation, never labels.
export function quotationReceivablePlan(value: Prisma.JsonValue): ReceivablePlan {
  const { calculation: c } = value as unknown as QuotationSnapshot
  const lines = c.instalments.length
    ? c.instalments.map(line => ({ label: line.label, amount: line.amount, dueOn: line.dueDate || null }))
    : [{ label: "Order consideration", amount: c.consideration, dueOn: null }]
  for (const charge of c.charges) if (!charge.included && charge.amount) lines.push({ label: charge.label, amount: charge.amount, dueOn: null })
  return { total: c.totalKnown, blocked: new Prisma.Decimal(c.totalKnown).gt(0) ? null : "There is no known positive amount to collect yet.", lines: lines.filter(line => new Prisma.Decimal(line.amount).gt(0)),
    pending: c.charges.flatMap((charge, index) => charge.amount === null ? [{ sourceKey: `charge:${index}`, label: charge.label, conditions: charge.due }] : []) }
}
