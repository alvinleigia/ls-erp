import type { DocumentBlock,PrintableDocument } from "@/platform/documents/contracts"
import { resolveDocumentLayout } from "@/platform/documents/layout"
import { participantDocumentBlocks } from "@/platform/participants/document-blocks"
import { formatDateForDisplay } from "@/lib/date"
import { formatDecimalCurrency } from "@/lib/formatting"
import { BusinessError } from "@/platform/policy"
import type { QuotationSnapshot } from "./quotation-service"
import { quotationDocumentLabels } from "./quotation-labels"
import { quotationLayoutCatalog } from "./quotation-layout-catalog"

// All values come from the selected immutable revision and its own metadata.
// No company-directory, customer, catalogue or ledger reads occur while rendering.
export function quotationLayoutDocument(record:{id:string;revision:number;revisionCreatedAt:Date|string;snapshot:QuotationSnapshot}):PrintableDocument {
  const s=record.snapshot,c=s.content,calc=s.calculation,labels=s.labels??quotationDocumentLabels()
  if(!c.layout)throw new BusinessError(400,"Choose a saved custom quotation layout.")
  const money=(v:string)=>formatDecimalCurrency(v,c.currency,s),date=(v:string)=>v?formatDateForDisplay(v,s.dateFormat):"Not supplied"
  const reference=`${record.id}/V${record.revision}`,issuedOn=new Date(record.revisionCreatedAt).toISOString().slice(0,10)
  const blocks:DocumentBlock[]=[
    ...participantDocumentBlocks(s.participants).map(block=>({...block,key:"customer-details"})),
    {key:"reference-details",title:"Reference details",table:{headings:["Detail","Value"],widths:[1,2],rows:[[labels.opportunity,s.opportunity],...(c.bookingDate?[["Booking date",date(c.bookingDate)]]:[]),...(c.validUntil?[["Valid until",date(c.validUntil)]]:[]),...[...s.context,...c.details].map(row=>[row.label,row.value])]}},
    {key:"commercial-lines",title:"Price",table:{headings:["Description","Quantity / unit","Rate","Amount"],widths:[2,1,1,1.2],rows:calc.lines.map(line=>[line.description,`${line.quantity} ${line.unit}`,money(line.rate),money(line.amount)])}},
    {key:"totals",title:"Pricing summary",table:{headings:["Summary","Amount"],widths:[2,1],rows:[["Base price",money(calc.base)],["Included charges",money(calc.included)],["Discount",money(calc.discount)],["Total consideration",money(calc.consideration)],["Extra charges - known",money(calc.extras)],["Total known amount",money(calc.totalKnown)]]},paragraphs:calc.hasPending?["Pending charges are additional and are not included in the total known amount."]:[]},
    ...(calc.charges.length?[{key:"charges",title:"Charges and payment conditions",table:{headings:["Charge","Amount / calculation","Due / conditions"],widths:[1.5,1.5,2],rows:calc.charges.map(row=>[`${row.label}\n${row.included?"Included in consideration":"Extra charge"}`,`${row.amount===null?"To be confirmed":money(row.amount)}${row.kind==="PERCENT"?`\n${row.value}% of ${row.basis==="BASE"?"base price":"consideration"}`:""}`,row.due||"Not specified"])},paragraphs:calc.groups.map(row=>`${row.label} subtotal (${row.included?"included":"extra"}${row.hasPending?", known amounts":""}): ${money(row.amount)}`)}]:[]),
    ...(calc.instalments.length?[{key:"payment-schedule",title:labels.paymentSchedule,paragraphs:["Instalments cover total consideration. Extra charges follow their separate payment conditions.",`Total instalments: ${money(calc.consideration)} (100%)`],table:{headings:["Milestone","%","Amount","Due / conditions"],widths:[1.5,.5,1.2,2],rows:calc.instalments.map(row=>[row.label,row.percent,money(row.amount),[row.days?`${row.days} days from booking`:"On booking",row.dueDate?date(row.dueDate):"",row.note].filter(Boolean).join("\n")])}}]:[]),
    ...(Object.values(c.bank).some(Boolean)?[{key:"bank-details",title:"Bank details",table:{headings:["Detail","Value"],widths:[1,2],rows:Object.entries({accountName:"Account name",accountNumber:"Account number",accountType:"Account type",bankName:"Bank",branch:"Branch",routingCode:"IFSC / routing code"}).filter(([key])=>c.bank[key as keyof typeof c.bank]).map(([key,label])=>[label,c.bank[key as keyof typeof c.bank]])}}]:[]),
    ...(c.terms?[{key:"terms",title:"Terms and remarks",paragraphs:[c.terms]}]:[]),
    ...(c.registration||c.registrationUrl?[{key:"registration",title:"Registration",paragraphs:[c.registration,c.registrationUrl].filter(Boolean),...(c.registrationUrl?{qrCode:c.registrationUrl}:{})}]:[]),
  ]
  const values:Record<string,string>={"document.reference":reference,"document.date":date(issuedOn),"quote.version":String(record.revision),"quote.title":c.title,"customer.name":s.customer.name,"customer.email":s.customer.email??"Not supplied","customer.phone":s.customer.phone??"Not supplied","quote.opportunity":s.opportunity,"quote.booking-date":date(c.bookingDate),"quote.valid-until":date(c.validUntil),"quote.currency":c.currency,"quote.base":money(calc.base),"quote.discount":money(calc.discount),"quote.consideration":money(calc.consideration),"quote.extras":money(calc.extras),"quote.total":money(calc.totalKnown),"supplier.name":c.supplierName,"supplier.website":c.website,"bank.name":c.bank.bankName,"bank.account-name":c.bank.accountName,"bank.account-number":c.bank.accountNumber,"bank.routing-code":c.bank.routingCode}
  const document:PrintableDocument={format:1,title:c.title,reference,date:date(issuedOn),sourceReference:record.id,company:{name:c.supplierName},issuer:{address:"",contact:c.website,signatory:""},showSignatory:false,notice:labels.notice,opening:"",terms:"",branding:s.branding??null,logoDataUrl:c.logoDataUrl,blocks,body:resolveDocumentLayout(c.layout,quotationLayoutCatalog,values,blocks)}
  if(Buffer.byteLength(JSON.stringify(document))>512*1024)throw new BusinessError(413,"This document contains too much text. Shorten the layout or saved details.")
  return document
}
