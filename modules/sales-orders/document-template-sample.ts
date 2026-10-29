import type { DocumentPayload } from "@/platform/documents/contracts"
import type { DocumentContent } from "@/platform/documents/validation"
import { resolveDocumentLayout, starterDocumentLayout, type TemplateCatalog } from "@/platform/documents/layout"

// Explicit sample data only: previews never browse customers, orders or payments.
export function sampleDocument(content: DocumentContent, catalog: TemplateCatalog, company: { id: string; name: string }): DocumentPayload {
  const money = "INR 100,000.00"
  const values: Record<string, string> = { "document.reference": "SAMPLE/001", "document.date": "01/01/2026", "company.name": company.name, "company.address": content.address, "company.contact": content.contact, "customer.name": "Sample Customer", "order.reference": "SAMPLE-ORDER-001", "order.date": "01/01/2026", "order.consideration": money, "order.extras": "INR 0.00", "order.total": money, "template.opening": content.opening, "template.terms": content.terms }
  Object.assign(values,{"bank.name":"Sample Bank","bank.account-name":"Sample Company","bank.account-number":"0000000000","bank.routing-code":"SAMPLE00000"})
  const blocks = catalog.sections.map(section => ({ key: section.key, title: section.label, ...(section.key === "payment-schedule" ? { table: { headings: ["Milestone", "Amount", "Due / conditions"], widths: [2, 1, 2], rows: [["Booking", "INR 10,000.00", "On booking"], ["Balance", "INR 90,000.00", "30 days from booking"]] } } : { paragraphs: [section.key === "participants" ? "Sample Customer\nSample Additional Customer" : `Sample ${section.label.toLowerCase()} - actual values come from the accepted source.`] }) }))
  return { format: 1, title: content.title, reference: "SAMPLE/001", date: "2026-01-01", sourceReference: "SAMPLE-ORDER-001", company, issuer: { address: content.address, contact: content.contact, signatory: content.signatory }, opening: content.opening, terms: content.terms, branding: null, blocks, body: resolveDocumentLayout(content.layout ?? starterDocumentLayout(catalog), catalog, values, blocks) }
}
