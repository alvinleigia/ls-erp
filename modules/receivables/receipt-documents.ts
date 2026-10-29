import type { OrderReceipt,Prisma,PrismaClient } from '@prisma/client'
import { createDocumentService,validateDocumentSize,type DocumentOwner } from '@/platform/documents/service'
import type { DocumentIdentity,DocumentStorage,DocumentPayload } from '@/platform/documents/contracts'
import type { ArchivedPdf } from '@/platform/storage/documents'
import { salesOrderRecordScope } from '@/platform/access/record-scope'
import { authorizeBusinessOperation } from '@/platform/access/operation'
import { recordActionAccess } from '@/platform/access/record-actions'
import { BusinessError } from '@/platform/policy'
import { readDocumentBranding } from '@/platform/branding/read'
import { documentContentSchema } from '@/platform/documents/validation'
import { resolveDocumentLayout,starterDocumentLayout } from '@/platform/documents/layout'
import { documentHash } from '@/platform/documents/hash'
import { recordDomainAuditEvent } from '@/lib/domain-audit'
import { businessDate } from '@/lib/business-time'
import type { OrderDocumentContext } from '@/modules/sales-orders/documents'
import { paymentReceiptProvider,receiptTemplateValues } from './receipt-template'

export type ReceiptDocumentContext=OrderDocumentContext & {payment:OrderReceipt;allocations:{label:string;amount:string}[]}
const json=(value:unknown)=>JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
const KEY='payment-receipt'
export function createReceiptDocumentService(db:PrismaClient,identity:DocumentIdentity,storage:DocumentStorage,render?:Parameters<typeof createDocumentService<ReceiptDocumentContext>>[4]){
 const owner:DocumentOwner<ReceiptDocumentContext>={
  resource:'paymentDocuments',requirements:['salesOrders.read','receivables.read','orderPayments.read'],modules:['salesOrders','receivables'],providers:[paymentReceiptProvider],
  async context(tx,actor,id){
   const payment=await tx.orderReceipt.findFirst({where:{tenantId:actor.tenantId,id,account:{order:salesOrderRecordScope(actor,'paymentDocuments')}}})
   if(!payment)throw new BusinessError(404,'Payment not found.')
   const order=await tx.salesOrder.findFirstOrThrow({where:{AND:[salesOrderRecordScope(actor,'paymentDocuments'),{id:payment.orderId}]}})
   const [issuer]=await tx.$queryRaw<Pick<OrderDocumentContext,'office'|'company'>[]>`SELECT * FROM app.document_source_issuer(${actor.tenantId},${order.id})`
   if(!issuer)throw new BusinessError(404,'The saved issuing office is unavailable.')
   const setting=await tx.appSetting.findFirst({where:{tenantId:actor.tenantId},select:{timeZone:true}}),[{now}]=await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`
   const rows=await tx.orderReceiptAllocation.findMany({where:{tenantId:actor.tenantId,orderId:order.id,paymentId:id},include:{line:{select:{label:true,position:true}}},orderBy:{line:{position:'asc'}}})
   return {payment,order,snapshot:order.snapshot as unknown as OrderDocumentContext['snapshot'],...issuer,date:businessDate(now,setting?.timeZone||'UTC'),allocations:rows.map(row=>({label:row.line.label,amount:row.amount.toString()}))}
  },
  async lock(tx,tenantId,id){const p=await tx.orderReceipt.findFirstOrThrow({where:{tenantId,id},select:{orderId:true}});await tx.$queryRaw`SELECT id FROM "SalesOrder" WHERE "tenantId"=${tenantId} AND id=${p.orderId} FOR UPDATE`},
  async prepare(tx,actor,c,provider,input){
   if(c.payment.status!=='POSTED'||c.order.status!=='CONFIRMED'||!c.order.reference)throw new BusinessError(409,'New receipts require a posted payment against a confirmed order.')
   if(c.office.archived||c.company.archived)throw new BusinessError(409,'Restore the issuing company and office before issuing a new receipt.')
   const template=await tx.businessDocumentTemplate.findFirst({where:{tenantId:actor.tenantId,companyId:c.company.id,providerKey:KEY},orderBy:{version:'desc'}})
   if(!template)throw new BusinessError(409,'Ask a tenant administrator to publish a payment receipt template for this company.')
   const content=documentContentSchema.parse(template.content);if(!content.enabled)throw new BusinessError(409,'This company\'s payment receipt template is disabled.')
   const previous=await tx.orderReceiptDocument.findFirst({where:{tenantId:actor.tenantId,paymentId:c.payment.id},orderBy:{version:'desc'}})
   if((previous?.id??null)!==input.supersedesId)throw new BusinessError(409,'The issued receipt changed. Reload before preparing its replacement.')
   const [{number}]=previous?[{number:previous.sequence}]:await tx.$queryRaw<{number:number}[]>`SELECT app.receipt_document_next(${actor.tenantId},${c.payment.id}) AS number`
   if(!number)throw new BusinessError(404,'Receipt numbering is unavailable for this source.')
   const version=(previous?.version??0)+1,reference=`RCT/${String(number).padStart(6,'0')}/V${version}`,{blocks,evidence}=await provider.blocks(tx,actor,c)
   const payload:DocumentPayload={format:1,title:content.title,reference,date:c.date,sourceReference:c.order.reference,company:{id:c.company.id,name:c.company.name},issuer:{address:content.address,contact:content.contact,signatory:content.signatory},opening:content.opening,terms:content.terms,branding:content.useTenantLogo?await readDocumentBranding(tx,actor.tenantId):null,blocks,body:resolveDocumentLayout(content.layout??starterDocumentLayout(provider.templateCatalog),provider.templateCatalog,receiptTemplateValues(c,content,reference),blocks)}
   validateDocumentSize(payload)
   const prepared={providerKey:KEY,templateVersion:template.version,version,supersedesId:input.supersedesId,payload,evidence:{...evidence as object,sequence:number} as Prisma.InputJsonValue}
   return {...prepared,fingerprint:documentHash({prepared,orderVersion:c.order.version,paymentStatus:c.payment.status,companyVersion:c.company.version,officeVersion:c.office.version,reason:input.reason})}
  },
  async find(tx,actor,sourceId,selector){const row=await tx.orderReceiptDocument.findFirst({where:{tenantId:actor.tenantId,paymentId:sourceId,...selector}});return row?{...row,sourceId:row.paymentId,archive:row.archive as unknown as ArchivedPdf}:null},
  async save(tx,actor,sourceId,data){
   const p=data.prepared,c=await owner.context(tx,actor,sourceId),sequence=(p.evidence as {sequence:number}).sequence
   const row=await tx.orderReceiptDocument.create({data:{tenantId:actor.tenantId,id:data.id,orderId:c.order.id,paymentId:sourceId,companyId:p.payload.company.id,providerKey:KEY,templateVersion:p.templateVersion,sequence,version:p.version,reference:p.payload.reference,requestKey:data.requestKey,requestHash:data.requestHash,snapshot:json({payload:p.payload,evidence:p.evidence}),archive:json(data.archive),supersedesId:p.supersedesId,reason:data.reason,createdBy:actor.userId}})
   await recordDomainAuditEvent(tx,{tenantId:actor.tenantId,actorUserId:actor.userId,actorRole:actor.role,requestId:actor.requestId,entityType:'SalesOrder',entityId:c.order.id,event:'payment.document.issued',after:{orderId:c.order.id,paymentId:sourceId,documentId:row.id,reference:row.reference,version:row.version,templateVersion:row.templateVersion,supersedesId:row.supersedesId,reason:row.reason,sha256:data.archive.sha256}})
   return {...row,sourceId,archive:data.archive}
  },
 }
 const service=createDocumentService(db,identity,owner,storage,render)
 return {...service,
  download(id:string,documentId:string,providerKey:string,acknowledgeReversal=false){
   const guarded={...paymentReceiptProvider,async authorizeDownload(_tx:Prisma.TransactionClient,_actor:Parameters<DocumentOwner<ReceiptDocumentContext>['context']>[1],c:ReceiptDocumentContext){if(c.payment.status==='REVERSED'&&!acknowledgeReversal)throw new BusinessError(409,'This payment was reversed. Explicitly acknowledge that you are downloading an original historical receipt.')}}
   return createDocumentService(db,identity,{...owner,providers:[guarded]},storage,render).download(id,documentId,providerKey)
  },
  async list(id:string,page=1){return db.$transaction(async tx=>{
   const actor=await authorizeBusinessOperation(tx,identity,['paymentDocuments.read','orderPayments.read','receivables.read','salesOrders.read'],['salesOrders','receivables']),c=await owner.context(tx,actor,id),where={tenantId:actor.tenantId,paymentId:id}
   const [items,total]=await Promise.all([tx.orderReceiptDocument.findMany({where,select:{id:true,providerKey:true,version:true,reference:true,templateVersion:true,supersedesId:true,reason:true,createdAt:true},orderBy:[{createdAt:'desc'},{id:'asc'}],skip:(page-1)*10,take:10}),tx.orderReceiptDocument.count({where})]),latest=await tx.orderReceiptDocument.findFirst({where,orderBy:{version:'desc'},select:{id:true,providerKey:true,version:true,reference:true}})
   const recordAccess=await recordActionAccess(actor,'paymentDocuments',id,tx,action=>tx.salesOrder.findFirst({where:{AND:[salesOrderRecordScope({...actor,operation:{resource:'paymentDocuments',action}},'paymentDocuments'),{id:c.order.id}]},select:{id:true}}))
   return {items:items.map(row=>({...row,isLatest:row.id===latest?.id})),latest:latest?[latest]:[],total,page,pageSize:10,totalPages:Math.max(1,Math.ceil(total/10)),providers:[{key:KEY,name:'Payment receipt'}],recordAccess,canIssue:c.payment.status==='POSTED'&&c.order.status==='CONFIRMED'&&!!recordAccess.permissions['paymentDocuments.create']&&!!recordAccess.permissions['paymentDocuments.export'],historical:c.payment.status==='REVERSED',notice:c.payment.status==='REVERSED'?'This payment was reversed. Original receipts remain historical evidence and do not confirm a current payment.':''}
  },{maxWait:20000,timeout:20000})},
 }
}
