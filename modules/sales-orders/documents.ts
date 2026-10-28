import type { Prisma, PrismaClient, SalesOrder } from "@prisma/client"
import { salesOrderRecordScope } from "@/platform/access/record-scope"
import { recordActionAccess } from "@/platform/access/record-actions"
import { authorizeBusinessOperation } from "@/platform/access/operation"
import { satisfies } from "@/platform/access/policy"
import { moduleEnabled } from "@/platform/modules"
import { BusinessError } from "@/platform/policy"
import { businessDate } from "@/lib/business-time"
import { readDocumentBranding } from "@/platform/branding/read"
import { recordDomainAuditEvent } from "@/lib/domain-audit"
import type { QuotationSnapshot } from "@/modules/sales-documents/quotation-service"
import type { ArchivedPdf } from "@/platform/storage/documents"
import type { DocumentIdentity, DocumentProvider, DocumentStorage, StoredDocument } from "@/platform/documents/contracts"
import { createDocumentService, validateDocumentSize, type DocumentOwner } from "@/platform/documents/service"
import { documentHash } from "@/platform/documents/hash"
import { documentContentSchema } from "@/platform/documents/validation"
export type OrderDocumentContext={order:SalesOrder;snapshot:QuotationSnapshot;date:string;office:{id:string;version:number;archived:boolean};company:{id:string;name:string;version:number;archived:boolean}}
const json=(value:unknown)=>JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
export function createOrderDocumentService(db:PrismaClient,identity:DocumentIdentity,providers:readonly DocumentProvider<OrderDocumentContext>[],storage:DocumentStorage,render?:Parameters<typeof createDocumentService<OrderDocumentContext>>[4]) {
  const owner:DocumentOwner<OrderDocumentContext>={
    resource:"orderDocuments",requirements:["salesOrders.read"],modules:["salesOrders"],providers,
    async context(tx,actor,id){
      const order=await tx.salesOrder.findFirst({where:{AND:[salesOrderRecordScope(actor,"orderDocuments"),{id}]}})
      if(!order)throw new BusinessError(404,"Sales order not found.")
      const [source]=await tx.$queryRaw<Pick<OrderDocumentContext,"office"|"company">[]>`SELECT * FROM app.document_source_issuer(${actor.tenantId},${order.id})`
      if(!source)throw new BusinessError(404,"The saved issuing office is unavailable.")
      const setting=await tx.appSetting.findFirst({where:{tenantId:actor.tenantId},select:{timeZone:true}}),[{now}]=await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`
      return {order,snapshot:order.snapshot as unknown as QuotationSnapshot,date:businessDate(now,setting?.timeZone||"UTC"),...source}
    },
    async lock(tx,tenantId,id){await tx.$queryRaw`SELECT id FROM "SalesOrder" WHERE "tenantId"=${tenantId} AND id=${id} FOR UPDATE`},
    async prepare(tx,actor,context,provider,input){
      const {order,company,office}=context
      if(order.status!=="CONFIRMED"||!order.reference||!order.orderedOn)throw new BusinessError(409,"Use a confirmed order with a recorded reference and order date.")
      if(company.archived||office.archived)throw new BusinessError(409,"Restore the issuing company and office before issuing a new document.")
      await provider.authorizeDownload(tx,actor,context,undefined)
      const template=await tx.businessDocumentTemplate.findFirst({where:{tenantId:actor.tenantId,companyId:company.id,providerKey:provider.key},orderBy:{version:"desc"}})
      if(!template)throw new BusinessError(409,"Ask a tenant administrator to publish a template for this issuing company.")
      const content=documentContentSchema.parse(template.content)
      if(!content.enabled)throw new BusinessError(409,"This company's document template is disabled.")
      const previous=await tx.salesOrderDocument.findFirst({where:{tenantId:actor.tenantId,orderId:order.id,providerKey:provider.key},orderBy:{version:"desc"}})
      if((previous?.id??null)!==input.supersedesId)throw new BusinessError(409,"The issued version changed. Reload before preparing its replacement.")
      const version=(previous?.version??0)+1,reference=`${order.reference}/${provider.code}/${String(version).padStart(3,"0")}`
      const {blocks,evidence}=await provider.blocks(tx,actor,context)
      const payload={format:1 as const,title:content.title,reference,date:context.date,sourceReference:order.reference,company:{id:company.id,name:company.name},issuer:{address:content.address,contact:content.contact,signatory:content.signatory},opening:content.opening,terms:content.terms,branding:content.useTenantLogo?await readDocumentBranding(tx,actor.tenantId):null,blocks}
      validateDocumentSize(payload)
      const prepared={providerKey:provider.key,templateVersion:template.version,version,supersedesId:input.supersedesId,payload,evidence}
      return {...prepared,fingerprint:documentHash({prepared,orderVersion:order.version,companyVersion:company.version,officeVersion:office.version,reason:input.reason})}
    },
    async find(tx,actor,sourceId,selector){
      const row=await tx.salesOrderDocument.findFirst({where:{tenantId:actor.tenantId,orderId:sourceId,...selector}})
      return row?{...row,sourceId:row.orderId,archive:row.archive as unknown as ArchivedPdf}:null
    },
    async save(tx,actor,sourceId,data){
      const p=data.prepared
      const row=await tx.salesOrderDocument.create({data:{tenantId:actor.tenantId,id:data.id,orderId:sourceId,companyId:p.payload.company.id,providerKey:p.providerKey,templateVersion:p.templateVersion,version:p.version,reference:p.payload.reference,requestKey:data.requestKey,requestHash:data.requestHash,snapshot:json({payload:p.payload,evidence:p.evidence}),archive:json(data.archive),supersedesId:p.supersedesId,reason:data.reason,createdBy:actor.userId}})
      await recordDomainAuditEvent(tx,{tenantId:actor.tenantId,actorUserId:actor.userId,actorRole:actor.role,requestId:actor.requestId,entityType:"SalesOrder",entityId:sourceId,event:"salesOrder.document.issued",after:{orderId:sourceId,documentId:row.id,providerKey:row.providerKey,version:row.version,templateVersion:row.templateVersion,reference:row.reference,supersedesId:row.supersedesId,reason:row.reason,sha256:data.archive.sha256}})
      return {...row,sourceId,archive:data.archive}
    },
  }
  const service=createDocumentService(db,identity,owner,storage,render)
  return {...service,
    async list(id:string,page=1){
      return db.$transaction(async tx=>{
        const actor=await authorizeBusinessOperation(tx,identity,["orderDocuments.read","salesOrders.read"],["salesOrders"]),context=await owner.context(tx,actor,id)
        const flags=await tx.tenantModule.findMany({where:{tenantId:actor.tenantId}}),allowed:DocumentProvider<OrderDocumentContext>[]=[],potential:DocumentProvider<OrderDocumentContext>[]=[]
        for(const provider of providers){
          if(!provider.modules.every(key=>moduleEnabled(flags,key))||!satisfies(actor,provider.requirements))continue
          potential.push(provider)
          try{await provider.authorizeDownload(tx,actor,context,undefined);allowed.push(provider)}catch(error){if(!(error instanceof BusinessError)||![403,404].includes(error.status))throw error}
        }
        const where={tenantId:actor.tenantId,orderId:id,providerKey:{in:allowed.map(provider=>provider.key)}}
        const [items,total]=await Promise.all([tx.salesOrderDocument.findMany({where,select:{id:true,providerKey:true,version:true,reference:true,templateVersion:true,supersedesId:true,reason:true,createdAt:true},orderBy:[{createdAt:"desc"},{id:"asc"}],skip:(page-1)*10,take:10}),tx.salesOrderDocument.count({where})])
        const maxima=await tx.salesOrderDocument.groupBy({by:["providerKey"],where,_max:{version:true}})
        const latest=maxima.length?await tx.salesOrderDocument.findMany({where:{...where,OR:maxima.map(row=>({providerKey:row.providerKey,version:row._max.version!}))},select:{id:true,providerKey:true,version:true,reference:true}}):[]
        const recordAccess=await recordActionAccess(actor,"orderDocuments",id,tx,action=>tx.salesOrder.findFirst({where:{AND:[salesOrderRecordScope({...actor,operation:{resource:"orderDocuments",action}},"orderDocuments"),{id}]},select:{id:true}}))
        return {items:items.map(row=>({...row,isLatest:latest.some(current=>current.id===row.id)})),latest,total,page,pageSize:10,totalPages:Math.max(1,Math.ceil(total/10)),providers:potential.map(({key,name})=>({key,name})),recordAccess,canIssue:context.order.status==="CONFIRMED"&&!!context.order.reference&&!!context.order.orderedOn&&!!recordAccess.permissions["orderDocuments.create"]&&!!recordAccess.permissions["orderDocuments.export"]}
      },{isolationLevel:"Serializable",maxWait:20000,timeout:20000})
    },
  }
}
export const issuedDocumentSummary=(row:StoredDocument)=>({id:row.id,providerKey:row.providerKey,version:row.version,reference:row.reference,supersedesId:row.supersedesId})
