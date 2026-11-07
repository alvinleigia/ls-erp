import type { DocumentBlock, DocumentPayload } from "@/platform/documents/contracts"
import type { DocumentContent } from "@/platform/documents/validation"
import { resolveDocumentLayout, starterDocumentLayout, type TemplateCatalog } from "@/platform/documents/layout"

// Explicit sample data only: previews never browse customers, orders or payments.
export function sampleDocument(content: DocumentContent, catalog: TemplateCatalog, company: { id: string; name: string }, examples: DocumentBlock[] = [], sampleValues: Record<string, string> = {}): DocumentPayload {
  const money = "INR 100,000.00"
  const values: Record<string, string> = { "document.title": content.title, "document.reference": "SAMPLE/001", "document.date": "01/01/2026", "company.name": company.name, "company.address": content.address, "company.contact": content.contact, "customer.name": "Sample Customer", "order.reference": "SAMPLE-ORDER-001", "order.date": "01/01/2026", "order.consideration": money, "order.extras": "INR 0.00", "order.total": money, "template.opening": content.opening, "template.terms": content.terms }
  Object.assign(values,{"bank.name":"Sample Bank","bank.account-name":"Sample Company","bank.account-number":"0000000000","bank.routing-code":"SAMPLE00000"})
  values["order.booking-date"] = "25/12/2025"
  Object.assign(values, sampleValues)
  const blocks:DocumentBlock[] = catalog.sections.flatMap(section => {
    const supplied=examples.filter(block=>block.key===section.key)
    if(supplied.length)return structuredClone(supplied)
    if(section.key==='participants')return [{key:section.key,title:'Sample Customer',paragraphs:['Main customer','Example address line 1\nExample City, Goa, 403001\nIndia','customer@example.test | +91 0000000001']},{key:section.key,title:'Sample Additional Customer',paragraphs:['Additional customer','Example address line 2\nExample City, Goa, 403001\nIndia','additional@example.test | +91 0000000002']}]
    return [{key:section.key,title:section.label,...(section.key==='payment-schedule'?{table:{headings:['Milestone','Amount','Due / conditions'],widths:[2,1,2],rows:[['Booking','INR 10,000.00','On booking'],['Balance','INR 90,000.00','30 days from booking']]}}:{paragraphs:[`Sample ${section.label.toLowerCase()} - actual values come from the accepted source.`]})}]
  })
  return { format: 1, title: content.title, reference: "SAMPLE/001", date: "2026-01-01", sourceReference: "SAMPLE-ORDER-001", company, issuer: { address: content.address, contact: content.contact, signatory: content.signatory }, opening: content.opening, terms: content.terms, ...(content.appearance ? { appearance: content.appearance } : {}), branding: null, blocks, body: resolveDocumentLayout(content.layout ?? starterDocumentLayout(catalog), catalog, values, blocks) }
}
