import type { TemplateCatalog } from "@/platform/documents/layout"

const sections=[
  {key:"customer-details",label:"Customers and correspondence",required:true},
  {key:"reference-details",label:"Reference details",required:true},
  {key:"commercial-lines",label:"Commercial lines",required:true},
  {key:"totals",label:"Pricing totals and pending charges",required:true},
  {key:"charges",label:"Charges and conditions",required:true},
  {key:"payment-schedule",label:"Payment schedule",required:true},
  {key:"bank-details",label:"Bank details",required:true},
  {key:"terms",label:"Terms and remarks",required:true},
  {key:"registration",label:"Registration",required:true},
]
export const quotationLayoutCatalog: TemplateCatalog={
  fields:[{key:"customer.name",label:"Customer name"},{key:"customer.email",label:"Customer email"},{key:"customer.phone",label:"Customer phone"},
    {key:"document.reference",label:"Quotation reference"},{key:"document.date",label:"Version date"},{key:"quote.version",label:"Version number"},{key:"quote.title",label:"Document title"},
    {key:"quote.opportunity",label:"Opportunity"},{key:"quote.booking-date",label:"Booking date"},{key:"quote.valid-until",label:"Valid until"},{key:"quote.currency",label:"Currency"},
    {key:"quote.base",label:"Base price"},{key:"quote.discount",label:"Discount"},{key:"quote.consideration",label:"Consideration"},{key:"quote.extras",label:"Known extra charges"},{key:"quote.total",label:"Total known amount"},
    {key:"supplier.name",label:"Supplier name"},{key:"supplier.website",label:"Supplier website"},
    {key:"bank.name",label:"Bank name"},{key:"bank.account-name",label:"Bank account name"},{key:"bank.account-number",label:"Bank account number"},{key:"bank.routing-code",label:"Bank routing code"}],
  sections,
  starter:{type:"doc",content:sections.map(row=>({type:"documentSection",attrs:{key:row.key}}))},
}
