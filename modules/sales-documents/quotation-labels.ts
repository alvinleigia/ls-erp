import { defaultTermResolver, type TermResolver } from "@/platform/terminology/resolver"

// Persist resolved presentation text with each revision; rendering never reads
// current tenant settings. Revisions predating labels retain their original text.
export function quotationDocumentLabels(term: TermResolver = defaultTermResolver) {
  return {
    customer: term("crm.contact.singular", "Customer"),
    opportunity: term("crm.opportunity.singular", "Opportunity"),
    parties: `${term("crm.contact.singular", "Customer")} and ${term("crm.opportunity.singular", "opportunity")}`,
    paymentSchedule: term("paymentPlans.paymentPlan.singular", "Instalment schedule"),
    notice: term("salesDocuments.quotation.singular", "Quotation / payment instructions only. This document is not a payment receipt.", "{label} / payment instructions only. This document is not a payment receipt."),
  }
}
export type QuotationDocumentLabels = ReturnType<typeof quotationDocumentLabels>
