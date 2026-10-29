import { formatDecimalCurrency } from "@/lib/formatting"
import { formatDateForDisplay } from "@/lib/date"
import type { TemplateCatalog } from "@/platform/documents/layout"
import type { DocumentContent } from "@/platform/documents/validation"
import type { OrderDocumentContext } from "./documents"
import type { DocumentBlock } from "@/platform/documents/contracts"

export const orderTemplateCatalog: TemplateCatalog = {
  fields: [
    { key: "document.reference", label: "Document reference" }, { key: "document.date", label: "Issue date" },
    { key: "company.name", label: "Issuing company name" }, { key: "company.address", label: "Company address" }, { key: "company.contact", label: "Company contact details" },
    { key: "customer.name", label: "Customer name" }, { key: "order.reference", label: "Booking / order reference" }, { key: "order.date", label: "Booking / order date" },
    { key: "order.consideration", label: "Consideration" }, { key: "order.extras", label: "Known extra charges" }, { key: "order.total", label: "Total known amount" },
    { key: "template.opening", label: "Opening wording" }, { key: "template.terms", label: "Approved terms" },
    { key: "bank.name", label: "Bank name" }, { key: "bank.account-name", label: "Bank account name" }, { key: "bank.account-number", label: "Bank account number" }, { key: "bank.routing-code", label: "Bank routing code" },
  ],
  sections: [
    { key: "agreement", label: "Agreement summary", required: true }, { key: "participants", label: "Customers and correspondence", required: true },
    { key: "commercial-lines", label: "Commercial lines", required: true }, { key: "payment-schedule", label: "Payment schedule", required: true },
    { key: "additional-charges", label: "Additional charges", required: true }, { key: "pending-charges", label: "Pending-charge notice", required: true },
    { key: "bank-details", label: "Payment bank details", required: true },
  ],
}
export function orderTemplateValues(context: OrderDocumentContext, content: DocumentContent, reference: string): Record<string, string> {
  const money = (value: string) => formatDecimalCurrency(value, context.order.currency, context.snapshot)
  return {
    "document.reference": reference, "document.date": formatDateForDisplay(context.date, context.snapshot.dateFormat),
    "company.name": context.company.name, "company.address": content.address, "company.contact": content.contact,
    "customer.name": context.snapshot.customer.name, "order.reference": context.order.reference!, "order.date": formatDateForDisplay(context.order.orderedOn!.toISOString().slice(0, 10), context.snapshot.dateFormat),
    "order.consideration": money(context.snapshot.calculation.consideration), "order.extras": money(context.snapshot.calculation.extras), "order.total": money(context.snapshot.calculation.totalKnown),
    "template.opening": content.opening, "template.terms": content.terms,
    "bank.name":context.snapshot.content.bank.bankName,"bank.account-name":context.snapshot.content.bank.accountName,"bank.account-number":context.snapshot.content.bank.accountNumber,"bank.routing-code":context.snapshot.content.bank.routingCode,
  }
}
export function orderTemplateBlocks(context: OrderDocumentContext, blocks: DocumentBlock[]): DocumentBlock[] {
  const bank=context.snapshot.content.bank
  return [...blocks,...(Object.values(bank).some(Boolean)?[{key:"bank-details",title:"Payment bank details",table:{headings:["Detail","Value"],widths:[1,2],rows:[["Account name",bank.accountName],["Account number",bank.accountNumber],["Bank",bank.bankName],["Account type",bank.accountType],["Branch",bank.branch],["Routing code",bank.routingCode]].filter(row=>row[1])}}]:[])]
}
