import type { Prisma } from "@prisma/client"
import { BusinessError, type BusinessActor } from "@/platform/policy"
import type { DocumentProvider, DocumentBlock } from "@/platform/documents/contracts"
import { documentHash } from "@/platform/documents/hash"
import type { OrderDocumentContext } from "@/modules/sales-orders/documents"
import { orderDocumentBlocks } from "@/modules/sales-orders/document-provider"
import type { ReceivableDocumentEvidence } from "@/modules/receivables/document-evidence"
import { propertyDocumentEvidenceSchema, readPropertyDocumentEvidenceSet } from "./document-evidence"
import { projectScope } from "./service"
import { reservationClock } from "@/modules/catalog/reservation-availability"
import { formatDecimalCurrency } from "@/lib/formatting"
import { salesOrderRecordScope } from "@/platform/access/record-scope"
import { recordLimits } from "@/platform/access/rules"
const roles={CUSTOMER:"Primary applicant",ADDITIONAL_CUSTOMER:"Co-applicant",REPRESENTATIVE:"Representative"}
type FinancialReader=(tx:Prisma.TransactionClient,actor:BusinessActor,id:string)=>Promise<ReceivableDocumentEvidence>
function savedUnits(context:OrderDocumentContext) {
  const refs=context.snapshot.items?.filter(row=>row.kind==="UNIT")??[]
  if(!refs.length)throw new BusinessError(404,"No saved property units are available for this document.")
  return refs.map(ref=>{
    const parsed=ref.documentEvidence?.key==="realEstate"?propertyDocumentEvidenceSchema.safeParse(ref.documentEvidence.value):null
    if(!parsed?.success||parsed.data.tenantId!==context.order.tenantId||parsed.data.itemId!==ref.itemId)throw new BusinessError(404,"This revision has no saved property document evidence. Refresh selected items in a new quotation and use a replacement order.")
    return {ref,property:parsed.data}
  })
}
async function authorizeProperties(tx:Prisma.TransactionClient,actor:BusinessActor,context:OrderDocumentContext) {
  if(recordLimits(actor,"catalogItems","read").includes("NONE")||!await tx.salesOrder.findFirst({where:{AND:[salesOrderRecordScope({...actor,operation:{resource:"unitReservations",action:"read"}},"unitReservations"),{id:context.order.id}]},select:{id:true}}))throw new BusinessError(404,"The property document source is not available.")
  const units=savedUnits(context),projectIds=[...new Set(units.flatMap(row=>[row.property.project.id,...(row.property.project.parent?[row.property.project.parent.id]:[])]))]
  const [projects,items]=await Promise.all([
    tx.realEstateProject.findMany({where:{AND:[projectScope(actor,"read"),{id:{in:projectIds}}]},select:{id:true,version:true,archived:true}}),
    tx.catalogItem.findMany({where:{tenantId:actor.tenantId,id:{in:units.map(row=>row.ref.itemId)},extensionKey:"realEstate",propertyUnit:{project:projectScope(actor,"read")}},select:{id:true,version:true,code:true,name:true,archived:true}}),
  ])
  if(projects.length!==projectIds.length||items.length!==units.length)throw new BusinessError(404,"The property document source is not available.")
  return {units,projects,items}
}
// Counters are intentionally omitted from this comparison: a description or
// catalogue price edit must not invalidate an unchanged accepted property.
function printedProperty(value:ReturnType<typeof propertyDocumentEvidenceSchema.parse>){const p=value.project;return {...value,project:{id:p.id,name:p.name,code:p.code,location:p.location,parent:p.parent?{id:p.parent.id,name:p.parent.name,code:p.parent.code,location:p.parent.location}:null}}}
async function propertyBlocks(tx:Prisma.TransactionClient,actor:BusinessActor,context:OrderDocumentContext,allotment:boolean) {
  const source=await authorizeProperties(tx,actor,context)
  if(source.projects.some(row=>row.archived)||source.items.some(row=>row.archived))throw new BusinessError(409,"Restore the selected property records before issuing a new letter.")
  const current=await readPropertyDocumentEvidenceSet(tx,actor,source.units.map(row=>row.ref.itemId))
  for(const unit of source.units){const now=current.find(row=>row.itemId===unit.ref.itemId),item=source.items.find(row=>row.id===unit.ref.itemId)!;if(!now||documentHash(printedProperty(now))!==documentHash(printedProperty(unit.property))||item.code!==unit.ref.code||item.name!==unit.ref.name)throw new BusinessError(409,"Property details changed. Refresh selected items in a new quotation and use a replacement order.")}
  const clock=await reservationClock(tx),allocations=await tx.unitReservation.findMany({where:{tenantId:actor.tenantId,orderId:context.order.id,itemId:{in:source.units.map(row=>row.ref.itemId)},...(allotment?{status:"ALLOCATED"}:{OR:[{status:"ALLOCATED"},{status:"HELD",expiresAt:{gt:clock}}]})},select:{id:true,itemId:true,status:true,version:true,expiresAt:true},orderBy:{itemId:"asc"}})
  if(allocations.length!==source.units.length)throw new BusinessError(409,allotment?"Allocate every saved property unit before issuing an allotment letter.":"Reserve or allocate every saved property unit before issuing a booking intimation letter. An expired hold cannot be used.")
  const blocks:DocumentBlock[]=[{title:allotment?"Allocated property units":"Booked property units",table:{headings:["Unit","Project / phase","Area","Location"],widths:[1.2,2,1.2,2],rows:source.units.map(({ref,property:p})=>[`${ref.code}\n${ref.name}`,[p.project.parent?.name,p.project.name].filter(Boolean).join(" / "),p.area?`${p.area} ${p.areaUnit==="SQ_M"?"sq m":"sq ft"}`:"Not supplied",p.project.location||p.project.parent?.location||"Not supplied"])}}]
  return {blocks,evidence:{items:source.items,projects:source.projects,allocations:allocations.map(row=>({...row,expiresAt:row.expiresAt.toISOString()}))}}
}
export function realEstateOrderDocuments(readFinancial:FinancialReader):DocumentProvider<OrderDocumentContext>[] {
  const base={address:"",contact:"",signatory:"Authorised signatory",terms:"",useTenantLogo:false,enabled:false}
  return [
    {key:"real-estate.booking-intimation",name:"Booking intimation letter",code:"BI",modules:["realEstate","catalog"],requirements:["projects.read","catalogItems.read","unitReservations.read"],defaults:{...base,title:"Booking intimation letter",opening:"We confirm that the following booking has been recorded. Unit allocation is recorded separately."},
      async authorizeDownload(tx,actor,context){await authorizeProperties(tx,actor,context)},
      async blocks(tx,actor,context){const property=await propertyBlocks(tx,actor,context,false);return {blocks:[...orderDocumentBlocks(context,roles),...property.blocks],evidence:property.evidence}},
    },
    {key:"real-estate.unit-allotment",name:"Unit allotment letter",code:"UA",modules:["realEstate","catalog","receivables"],requirements:["projects.read","catalogItems.read","unitReservations.read","receivables.read","orderPayments.read"],defaults:{...base,title:"Unit allotment letter",opening:"This letter records the confirmed unit allocation and the commercial terms below."},
      async authorizeDownload(tx,actor,context){await authorizeProperties(tx,actor,context);await readFinancial(tx,actor,context.order.id)},
      async blocks(tx,actor,context){
        const property=await propertyBlocks(tx,actor,context,true),financial=await readFinancial(tx,actor,context.order.id),money=(value:string)=>formatDecimalCurrency(value,context.order.currency,context.snapshot)
        const blocks:DocumentBlock[]=financial.state==="UNOPENED"?[{title:"Financial position",paragraphs:["Receivables have not been opened. Amounts received and outstanding are not verified by this letter."]}]:[{title:"Financial position",table:{headings:["Recorded total","Received","Outstanding"],widths:[1,1,1],rows:[[money(financial.total!),money(financial.paid!),money(financial.outstanding!)]]}},{title:"Receivable schedule",table:{headings:["Milestone","Due date","Amount","Received","Outstanding"],widths:[2,1.4,1.3,1.3,1.5],rows:financial.lines.map(row=>[row.label,row.dueOn??"Not set",money(row.amount),money(row.paid),money(row.outstanding)])}}]
        return {blocks:[...orderDocumentBlocks(context,roles),...property.blocks,...blocks],evidence:{...property.evidence,financial}}
      },
    },
  ]
}
