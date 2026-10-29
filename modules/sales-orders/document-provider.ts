import { formatDecimalCurrency } from "@/lib/formatting"
import { formatDateForDisplay } from "@/lib/date"
import type { DocumentProvider, DocumentBlock } from "@/platform/documents/contracts"
import { participantDocumentBlocks } from "@/platform/participants/document-blocks"
import type { OrderDocumentContext } from "./documents"
import type { ParticipantRole } from "@/platform/participants/validation"
import { orderTemplateCatalog } from "./document-template"
import { sampleDocument } from "./document-template-sample"
export function orderDocumentBlocks(context: OrderDocumentContext,roleLabels?:Record<ParticipantRole,string>): DocumentBlock[] {
  const snapshot=context.snapshot,calc=snapshot.calculation,currency=snapshot.content.currency
  const money=(value:string)=>formatDecimalCurrency(value,currency,snapshot)
  return [{key:"agreement",title:"Agreement",table:{headings:["Detail","Value"],widths:[1,2],rows:[["Order reference",context.order.reference!],["Order date",formatDateForDisplay(context.order.orderedOn!.toISOString().slice(0,10),snapshot.dateFormat)],["Consideration",money(calc.consideration)],["Extra charges - known",money(calc.extras)],["Total known amount",money(calc.totalKnown)]]}},
    ...participantDocumentBlocks(snapshot.participants,roleLabels).map(block=>({...block,key:"participants"})),
    {key:"commercial-lines",title:"Commercial lines",table:{headings:["Description","Quantity","Rate","Amount"],widths:[3,1,1.5,1.5],rows:calc.lines.map(row=>[row.description,`${row.quantity} ${row.unit}`,money(row.rate),money(row.amount)])}},
    ...(calc.instalments.length?[{key:"payment-schedule",title:"Payment schedule",table:{headings:["Milestone","Amount","Due / conditions"],widths:[2,1,2],rows:calc.instalments.map(row=>[row.label,money(row.amount),[row.dueDate?formatDateForDisplay(row.dueDate,snapshot.dateFormat):"",row.days?`${row.days} days from booking`:"On booking",row.note].filter(Boolean).join("\n")])}}]:[]),
    ...(calc.charges.length?[{key:"additional-charges",title:"Additional charges",table:{headings:["Charge","Amount","Due / conditions"],widths:[2,1,2],rows:calc.charges.map(row=>[`${row.label}${row.included?" (included)":" (extra)"}`,row.amount===null?"To be confirmed":money(row.amount),row.due||"Not supplied"])}}]:[]),
    ...(calc.hasPending?[{key:"pending-charges",title:"Pending charges",paragraphs:["Pending charges are additional. They are not included in the total known amount."]}]:[])]
}
export const orderAcknowledgement: DocumentProvider<OrderDocumentContext> = {
  key:"order-acknowledgement",name:"Order acknowledgement",code:"ACK",modules:[],requirements:[],
  templateCatalog:orderTemplateCatalog,
  sample:sampleDocument,
  defaults:{title:"Order acknowledgement",opening:"This document records the following confirmed commercial agreement.",terms:"",address:"",contact:"",signatory:"Authorised signatory",useTenantLogo:false,enabled:false},
  async blocks(_tx,_actor,context){return {blocks:orderDocumentBlocks(context),evidence:{orderVersion:context.order.version}}},
  async authorizeDownload(){},
}
