import { randomUUID,createHash } from 'node:crypto'
import { PDFDocument } from 'pdf-lib'
import { Prisma,type PrismaClient,type TaxStatutoryDocument } from '@prisma/client'
import { authorizeBusinessOperation } from '@/platform/access/operation'
import { satisfies } from '@/platform/access/policy'
import { recordActionAccess } from '@/platform/access/record-actions'
import { lockTenantOperations } from '@/platform/transactions/tenant-lock'
import { serializationConflict } from '@/platform/database-errors'
import { BusinessError,type BusinessActor } from '@/platform/policy'
import type { DocumentIdentity,DocumentStorage,DocumentPayload } from '@/platform/documents/contracts'
import { documentHash } from '@/platform/documents/hash'
import { validateDocumentSize } from '@/platform/documents/service'
import { documentContentSchema } from '@/platform/documents/validation'
import { readDocumentBranding } from '@/platform/branding/read'
import type { ArchivedPdf } from '@/platform/storage/documents'
import { statutorySeriesSchema,statutorySeriesQuery,statutoryReviewSchema,statutoryPrepareSchema,statutoryReserveSchema,statutoryCompleteSchema,statutoryVoidSchema,statutoryFactsSchema,statutoryReadiness,gstFinancialYear,type StatutoryAccepted,type StatutorySource } from '@/platform/tax/localizations/india-statutory'
import { statutoryKeys,statutoryPayload,type StatutorySnapshot } from '@/platform/tax/localizations/india-statutory-pdf'
import { previewProfileSnapshotSchema } from '@/platform/tax/agreement-preview'
import { recordDomainAuditEvent } from '@/lib/domain-audit'
import { invoiceFind,invoiceScope,invoiceSnapshot,invoiceToday } from './service'
import { invoiceBilling } from './billing'

type Tx=Prisma.TransactionClient
const json=(v:unknown)=>JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue
const iso=(d:Date)=>d.toISOString().slice(0,10),date=(d:string)=>new Date(d+'T00:00:00Z')
const summary=(d:TaxStatutoryDocument)=>({id:d.id,kind:d.kind,reference:d.reference,status:d.status,version:d.version,issueOn:iso(d.issueOn),signedOn:d.signedOn?iso(d.signedOn):null,createdAt:d.createdAt,voidReason:d.voidReason,hasPrint:!!d.printArchive,hasSigned:!!d.signedArchive})
export function createStatutoryInvoiceService(db:PrismaClient,identity:DocumentIdentity,storage:DocumentStorage,renderer?:(payload:DocumentPayload,preview:boolean)=>Promise<Uint8Array>){
 const render=renderer??(async(p,preview)=>(await import('@/platform/documents/pdf')).renderBusinessDocument({...p,showSignatory:false},preview))
 async function run<T>(id:string,mode:'read'|'write'|'export',fn:(tx:Tx,actor:BusinessActor)=>Promise<T>):Promise<T>{for(let attempt=0;;attempt++)try{return await db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${identity.tenantId} FOR SHARE`;await lockTenantOperations(tx,identity.tenantId)
  const requirements=['invoiceDocuments.read','customerInvoices.read','salesOrders.read','receivables.read'] as const
  const actor=await authorizeBusinessOperation(tx,identity,mode==='write'?[...requirements,'invoiceDocuments.create','invoiceDocuments.export','taxProfiles.read','taxProfiles.edit']:mode==='export'?[...requirements,'invoiceDocuments.export']:requirements,['invoicing'])
  if(mode==='write'&&actor.role!=='ADMIN')throw new BusinessError(403,'A tenant administrator must review statutory facts and record signing completion.')
  const before=await invoiceFind(tx,actor,id,'invoiceDocuments');await tx.$queryRaw`SELECT id FROM "SalesOrder" WHERE "tenantId"=${actor.tenantId} AND id=${before.orderId} FOR UPDATE`
  for(const action of (mode==='write'?['read','create','export']:mode==='export'?['read','export']:['read']) as ('read'|'create'|'export')[])await invoiceFind(tx,{...actor,operation:{resource:'invoiceDocuments',action}},id,'invoiceDocuments')
  await invoiceFind(tx,{...actor,operation:{resource:'customerInvoices',action:'read'}},id)
  return fn(tx,actor)
 },{isolationLevel:'ReadCommitted',maxWait:20000,timeout:20000})}catch(e){if(serializationConflict(e)&&attempt<3)continue;if((e as {code?:string}).code==='P2002')throw new BusinessError(409,'The source, request or numbering series already exists. Reload before continuing.');if((e as {code?:string}).code==='P2025')throw new BusinessError(409,'The saved version changed. Reload before continuing.');const f=e as {cause?:{originalMessage?:string};meta?:{driverAdapterError?:{cause?:{originalMessage?:string}}}},m=f.cause?.originalMessage||f.meta?.driverAdapterError?.cause?.originalMessage;if(m?.startsWith('Statutory:'))throw new BusinessError(409,m.slice(11).trim());throw e}}
 async function source(tx:Tx,a:BusinessActor,id:string){
  const invoice=await invoiceFind(tx,a,id,'invoiceDocuments'),snapshot=invoiceSnapshot(invoice),tax=invoiceBilling(invoice).tax
  if(snapshot.kind!=='TAX_AWARE'||!tax||!snapshot.taxAcceptance)throw new BusinessError(409,'This workflow requires a frozen tax-aware invoice allocation.')
  const original=await tx.taxStatutoryDocument.findFirst({where:{tenantId:a.tenantId,invoiceId:id,kind:{in:['TAX_INVOICE','BILL_OF_SUPPLY']},status:'ISSUED'}})
  const accepted=snapshot.taxAcceptance as unknown as StatutoryAccepted
  const facts:StatutorySource={status:invoice.status,version:invoice.version,currency:snapshot.currency,invoiceDate:iso(invoice.invoiceDate),tax,accepted,original:original?{id:original.id,status:original.status,reference:original.reference,kind:original.kind,issueOn:iso(original.issueOn)}:null}
  return {invoice,snapshot,tax,accepted,facts,original,today:await invoiceToday(tx,a.tenantId)}
 }
 async function audit(tx:Tx,a:BusinessActor,id:string,event:string,data:Record<string,unknown>){const invoice=await invoiceFind(tx,a,id,'invoiceDocuments');await recordDomainAuditEvent(tx,{tenantId:a.tenantId,actorUserId:a.userId,actorRole:a.role,requestId:a.requestId,entityType:'SalesOrder',entityId:invoice.orderId,event:'commercialInvoice.statutory.'+event,after:json({invoiceId:id,...data}) as Prisma.InputJsonObject})}
 async function event(tx:Tx,a:BusinessActor,d:TaxStatutoryDocument,reason:string){const [{snapshot}]=await tx.$queryRaw<{snapshot:Prisma.InputJsonObject}[]>`SELECT to_jsonb(d) snapshot FROM "TaxStatutoryDocument" d WHERE "tenantId"=${a.tenantId} AND id=${d.id}`;await tx.taxStatutoryDocumentEvent.create({data:{tenantId:a.tenantId,documentId:d.id,version:d.version,status:d.status,actorId:a.userId,reason,snapshot}});await audit(tx,a,d.invoiceId,d.status.toLowerCase(),{documentId:d.id,reference:d.reference,version:d.version,reason})}
 async function find(tx:Tx,a:BusinessActor,id:string,documentId:string){const d=await tx.taxStatutoryDocument.findFirst({where:{tenantId:a.tenantId,invoiceId:id,id:documentId}});if(!d)throw new BusinessError(404,'Statutory document not found.');return d}
 async function currentIssuer(tx:Tx,a:BusinessActor,id:string,s:StatutorySnapshot){
  const current=await invoiceFind(tx,a,id,'invoiceDocuments');if(current.status!==(s.facts.kind==='CREDIT_NOTE'?'CREDITED':'POSTED'))throw new BusinessError(409,'The source status changed. Void this unissued reservation before continuing.')
  const issuer=(s.invoice.taxAcceptance as StatutoryAccepted).issuer,registration=await tx.companyTaxRegistration.findFirst({where:{tenantId:a.tenantId,id:String(issuer.id),archived:false,company:{archived:false}}})
  if(!registration||registration.version!==issuer.version||registration.eInvoicePolicy!=='NOT_REQUIRED')throw new BusinessError(409,'The reviewed issuer/e-invoice assessment changed. Void the unissued reservation and correct its source first.')
  const [meta]=await tx.$queryRaw<{available:boolean}[]>`SELECT NOT (company->>'archived')::boolean AND NOT (office->>'archived')::boolean available FROM app.document_source_issuer(${a.tenantId},${current.orderId})`
  if(!meta?.available)throw new BusinessError(409,'Restore the saved issuing company and office before statutory preparation.')
 }
 async function prepare(tx:Tx,a:BusinessActor,id:string,reviewId:string){
  const c=await source(tx,a,id),review=await tx.taxStatutoryReview.findFirst({where:{tenantId:a.tenantId,invoiceId:id,id:reviewId}})
  if(!review||review.sourceVersion!==c.invoice.version)throw new BusinessError(409,'Review the current invoice facts first.')
  const latest=await tx.taxStatutoryReview.findFirst({where:{tenantId:a.tenantId,invoiceId:id,kind:review.kind},orderBy:{version:'desc'}})
  if(latest?.id!==review.id)throw new BusinessError(409,'This review was replaced. Reload the latest review.')
  const facts=statutoryFactsSchema.parse(review.body),errors=statutoryReadiness(c.facts,facts,c.today)
  if(errors.length)throw new BusinessError(409,errors.join(' '))
  const series=await tx.taxStatutorySeries.findFirst({where:{tenantId:a.tenantId,id:facts.seriesId,registrationId:String(c.accepted.issuer.id),kind:facts.kind,financialYear:gstFinancialYear(facts.issueOn),version:facts.seriesVersion,enabled:true}})
  if(!series)throw new BusinessError(409,'Select the current enabled registration/year series.')
  const template=await tx.businessDocumentTemplate.findFirst({where:{tenantId:a.tenantId,companyId:c.snapshot.company.id,providerKey:statutoryKeys[facts.kind]},orderBy:{version:'desc'}})
  if(!template)throw new BusinessError(409,'Publish the issuing company’s statutory document template first.')
  const content=documentContentSchema.parse(template.content);if(!content.enabled)throw new BusinessError(409,'The company’s statutory template is disabled.')
  const credit=facts.kind==='CREDIT_NOTE'?await tx.customerCreditNote.findUnique({where:{tenantId_invoiceId:{tenantId:a.tenantId,invoiceId:id}}}):null
  const snapshot:StatutorySnapshot={format:1,reference:'',facts,invoiceId:id,invoiceReference:c.invoice.reference!,invoiceVersion:c.invoice.version,creditReason:credit?.reason||'',invoice:c.snapshot,tax:c.tax,original:facts.kind==='CREDIT_NOTE'?c.facts.original!:null,branding:content.useTenantLogo?await readDocumentBranding(tx,a.tenantId):null,templateContent:content,templateVersion:template.version}
  await currentIssuer(tx,a,id,snapshot);validateDocumentSize(statutoryPayload(snapshot))
  return {snapshot,fingerprint:documentHash(snapshot)}
 }
 function archiveCheck(candidate:Pick<ArchivedPdf,'path'|'sha256'|'bytes'>,id:string,documentId:string,bytes:Uint8Array){const prefix=`${identity.tenantId}/invoices/${id}/${documentId}/`;if(!candidate.path.startsWith(prefix)||!/^[a-f0-9-]{36}\.pdf$/.test(candidate.path.slice(prefix.length))||candidate.bytes!==bytes.length||candidate.sha256!==createHash('sha256').update(bytes).digest('hex'))throw new Error('Storage returned invalid statutory PDF evidence.')}
 async function copies(s:StatutorySnapshot){
  const goods=s.tax.lines.some(l=>previewProfileSnapshotSchema.parse((s.invoice.taxAcceptance as StatutoryAccepted).lines.find(i=>i.lineIndex===Number(l.key))!.profileSnapshot).supplyKind==='GOODS')
  const labels=s.facts.kind!=='TAX_INVOICE'?['Original for recipient']:goods?['Original for recipient','Duplicate for transporter','Triplicate for supplier']:['Original for recipient','Duplicate for supplier']
  const merged=await PDFDocument.create()
  for(const label of labels){const p=await PDFDocument.load(await render(statutoryPayload(s,label),false));for(const page of await merged.copyPages(p,p.getPageIndices()))merged.addPage(page)}
  if(merged.getPageCount()>100)throw new BusinessError(413,'The combined print copies exceed 100 pages.')
  const bytes=await merged.save();if(bytes.length>10*1024*1024)throw new BusinessError(413,'The combined print PDF exceeds 10 MB.');return bytes
 }
 return {
  seriesChoices(id:string,input:unknown){const q=statutorySeriesQuery.parse(input);return run(id,'write',async(tx,a)=>{const c=await source(tx,a,id),population={tenantId:a.tenantId,registrationId:String(c.accepted.issuer.id),financialYear:gstFinancialYear(c.today),kind:q.kind},where={...population,...(q.q?{code:{contains:q.q.toUpperCase()}}:{})},[items,total,selected]=await Promise.all([tx.taxStatutorySeries.findMany({where,orderBy:[{code:'asc'},{id:'asc'}],skip:(q.page-1)*20,take:20}),tx.taxStatutorySeries.count({where}),q.selected?tx.taxStatutorySeries.findFirst({where:{...population,id:q.selected}}):Promise.resolve(null)]);return {items,total,page:q.page,pageSize:20,totalPages:Math.max(1,Math.ceil(total/20)),selected}})},
  get(id:string,page=1){return run(id,'read',async(tx,a)=>{
   const c=await source(tx,a,id),where={tenantId:a.tenantId,invoiceId:id},[docs,total]=await Promise.all([tx.taxStatutoryDocument.findMany({where,orderBy:[{createdAt:'desc'},{id:'asc'}],skip:(page-1)*10,take:10}),tx.taxStatutoryDocument.count({where})]),access=await recordActionAccess(a,'invoiceDocuments',id,tx,action=>tx.customerInvoice.findFirst({where:{AND:[invoiceScope({...a,operation:{resource:'invoiceDocuments',action}},'invoiceDocuments'),{id}]},select:{id:true}})),canWrite=a.role==='ADMIN'&&satisfies(a,['taxProfiles.read','taxProfiles.edit'])&&!!access.permissions['invoiceDocuments.create']&&!!access.permissions['invoiceDocuments.export']
   const kind=c.invoice.status==='CREDITED'?'CREDIT_NOTE':c.tax.lines.every(l=>['NIL_RATED','EXEMPT'].includes(previewProfileSnapshotSchema.parse(c.accepted.lines.find(x=>x.lineIndex===Number(l.key))!.profileSnapshot).treatment))?'BILL_OF_SUPPLY':'TAX_INVOICE',reviews=await tx.taxStatutoryReview.findMany({where,orderBy:[{createdAt:'desc'},{id:'asc'}],take:10})
   const activeDocuments=await tx.taxStatutoryDocument.findMany({where:{...where,status:{not:'VOID'}},take:3});return {activeDocuments:activeDocuments.map(summary),items:docs.map(summary),page,pageSize:10,total,totalPages:Math.max(1,Math.ceil(total/10)),reviews,canWrite,canExport:!!access.permissions['invoiceDocuments.export'],today:c.today,sourceVersion:c.invoice.version,sourceStatus:c.invoice.status,registrationId:c.accepted.issuer.id,financialYear:gstFinancialYear(c.today),kind,original:c.facts.original,issuer:c.accepted.issuer,recipient:c.accepted.recipient,lines:c.tax.lines.map(l=>{const p=c.accepted.lines.find(x=>x.lineIndex===Number(l.key))!;return {lineIndex:Number(l.key),description:c.snapshot.order.calculation.lines[Number(l.key)].description,profile:p.profileSnapshot,placeRegionCode:p.placeRegionCode}}),electronicSigningAvailable:false,notice:'Manual signing is supported. Electronic signing and required IRP/e-invoicing need verified provider integrations; they cannot be finalized here.'}
  })},
  series(id:string,input:unknown){const d=statutorySeriesSchema.parse(input);return run(id,'write',async(tx,a)=>{
   const c=await source(tx,a,id);if(d.registrationId!==c.accepted.issuer.id)throw new BusinessError(400,'Choose this invoice’s frozen issuer registration.')
   if(d.financialYear!==gstFinancialYear(c.today))throw new BusinessError(400,'Configure this tenant-calendar financial year first.')
   const existing=d.id?await tx.taxStatutorySeries.findFirst({where:{tenantId:a.tenantId,id:d.id,registrationId:d.registrationId}}):null
   if(d.id&&(!existing||existing.version!==d.version||existing.code!==d.code||existing.kind!==d.kind||existing.financialYear!==d.financialYear)||!d.id&&d.version!==0)throw new BusinessError(409,'Series identity cannot be edited. Reload its current enabled state.')
   const row=existing?await tx.taxStatutorySeries.update({where:{tenantId_id:{tenantId:a.tenantId,id:existing.id},version:d.version},data:{enabled:d.enabled,version:{increment:1}}}):await tx.taxStatutorySeries.create({data:{tenantId:a.tenantId,registrationId:d.registrationId,financialYear:d.financialYear,code:d.code,kind:d.kind,enabled:d.enabled}})
   await audit(tx,a,id,'seriesReviewed',{seriesId:row.id,version:row.version,code:row.code,kind:row.kind,financialYear:row.financialYear,enabled:row.enabled});return row
  })},
  review(id:string,input:unknown){const d=statutoryReviewSchema.parse(input);return run(id,'write',async(tx,a)=>{
   const c=await source(tx,a,id);if(c.invoice.version!==d.sourceVersion)throw new BusinessError(409,'The source changed. Reload before reviewing.')
   const errors=statutoryReadiness(c.facts,d.body,c.today);if(errors.length)throw new BusinessError(409,errors.join(' '))
   const old=await tx.taxStatutoryReview.findFirst({where:{tenantId:a.tenantId,invoiceId:id,kind:d.body.kind},orderBy:{version:'desc'}})
   if((old?.version||0)!==d.version)throw new BusinessError(409,'Another review was saved. Reload before continuing.')
   const row=await tx.taxStatutoryReview.create({data:{tenantId:a.tenantId,invoiceId:id,sourceVersion:d.sourceVersion,kind:d.body.kind,version:d.version+1,body:json(d.body),createdBy:a.userId}});await audit(tx,a,id,'reviewed',{reviewId:row.id,version:row.version,sourceVersion:d.sourceVersion});return row
  })},
  prepare(id:string,input:unknown){const d=statutoryPrepareSchema.parse(input);return run(id,'write',(tx,a)=>prepare(tx,a,id,d.reviewId))},
  async preview(id:string,input:unknown){const p=await this.prepare(id,input);return render(statutoryPayload(p.snapshot),true)},
  reserve(id:string,input:unknown){const d=statutoryReserveSchema.parse(input),hash=documentHash({id,...d});return run(id,'write',async(tx,a)=>{
   const old=await tx.taxStatutoryDocument.findUnique({where:{tenantId_requestKey:{tenantId:a.tenantId,requestKey:d.requestKey}}});if(old){if(old.invoiceId!==id||old.requestHash!==hash)throw new BusinessError(409,'This request belongs to a different reservation.');return summary(old)}
   const p=await prepare(tx,a,id,d.reviewId);if(p.fingerprint!==d.fingerprint)throw new BusinessError(409,'The source or template changed after preview. Prepare a fresh preview.')
   if(p.snapshot.facts.signatureMode!=='MANUAL')throw new BusinessError(409,'Connect a verified electronic signing provider before reserving an electronically signed document.')
   const row=await tx.taxStatutoryDocument.create({data:{tenantId:a.tenantId,id:randomUUID(),invoiceId:id,reviewId:d.reviewId,seriesId:p.snapshot.facts.seriesId,registrationId:String((p.snapshot.invoice.taxAcceptance as StatutoryAccepted).issuer.id),financialYear:gstFinancialYear(p.snapshot.facts.issueOn),kind:p.snapshot.facts.kind,issueOn:date(p.snapshot.facts.issueOn),requestKey:d.requestKey,requestHash:hash,snapshot:json(p.snapshot),originalDocumentId:p.snapshot.original?.id,createdBy:a.userId}});await event(tx,a,row,'Reviewed statutory number reservation; no signed issuance yet.');return summary(row)
  })},
  async print(id:string,documentId:string){
   const start=await run(id,'write',async(tx,a)=>{const d=await find(tx,a,id,documentId);if(d.status!=='RESERVED'){if(d.printArchive&&d.status!=='VOID')return d;throw new BusinessError(409,'This reservation cannot produce a print PDF.')}const s=d.snapshot as unknown as StatutorySnapshot;await currentIssuer(tx,a,id,s);if(iso(d.issueOn)!==await invoiceToday(tx,a.tenantId))throw new BusinessError(409,'An unprinted reservation from an earlier day must be voided and reviewed again.');return d})
   if(start.status!=='RESERVED')return summary(start)
   const bytes=await copies(start.snapshot as unknown as StatutorySnapshot),candidate=await storage.upload(identity.tenantId,id,documentId,bytes);archiveCheck(candidate,id,documentId,bytes)
   let knownRollback=false
   try{const done=await run(id,'write',async(tx,a)=>{knownRollback=false;try{const d=await find(tx,a,id,documentId);if(d.printArchive&&d.status!=='VOID')return d;if(d.status!=='RESERVED')throw new BusinessError(409,'This reservation was voided.');await currentIssuer(tx,a,id,d.snapshot as unknown as StatutorySnapshot);const row=await tx.taxStatutoryDocument.update({where:{tenantId_id:{tenantId:a.tenantId,id:documentId}},data:{status:'PRINT_READY',version:{increment:1},printArchive:json({...candidate,issuedAt:new Date().toISOString(),issuedBy:a.userId})}});await event(tx,a,row,'Immutable prepared PDF archived for manual signing.');return row}catch(e){knownRollback=true;throw e}});if((done.printArchive as unknown as ArchivedPdf).path!==candidate.path)await storage.remove(candidate.path).catch(()=>{});return summary(done)}catch(e){if(knownRollback||e instanceof BusinessError)await storage.remove(candidate.path).catch(()=>{});throw e}
  },
  async complete(id:string,documentId:string,input:unknown,bytes:Uint8Array){
   const d=statutoryCompleteSchema.parse(input);if(bytes.length<5||bytes.length>3*1024*1024)throw new BusinessError(413,'Upload a signed PDF up to 3 MB.');if(Buffer.from(bytes.subarray(0,5)).toString()!=='%PDF-')throw new BusinessError(400,'Upload the manually signed document as a PDF.')
   await run(id,'write',async(tx,a)=>{const row=await find(tx,a,id,documentId);if(!['PRINT_READY','ISSUED'].includes(row.status))throw new BusinessError(409,'Archive its prepared print PDF before signing completion.')})
   try{const pdf=await PDFDocument.load(bytes,{updateMetadata:false});if(pdf.isEncrypted||pdf.getPageCount()<1||pdf.getPageCount()>100)throw new Error('Unsupported signed PDF')}catch{throw new BusinessError(400,'The signed PDF must be readable, unencrypted and contain 1–100 pages.')}
   const sha=createHash('sha256').update(bytes).digest('hex')
   const replay=await run(id,'write',async(tx,a)=>{const row=await find(tx,a,id,documentId);if(row.status==='ISSUED'){if((row.signedArchive as unknown as ArchivedPdf).sha256===sha&&row.completionBasis===d.basis&&row.signedOn&&iso(row.signedOn)===d.signedOn)return summary(row);throw new BusinessError(409,'Issued signed evidence is immutable.')}if(row.version!==d.version||row.status!=='PRINT_READY'||iso(row.issueOn)!==d.signedOn||d.signedOn>await invoiceToday(tx,a.tenantId))throw new BusinessError(409,'Confirm the current print version and its actual document signing date.');if((row.printArchive as unknown as ArchivedPdf).sha256===sha)throw new BusinessError(409,'The prepared unsigned PDF cannot be recorded as the manually signed copy.');await currentIssuer(tx,a,id,row.snapshot as unknown as StatutorySnapshot);return null})
   if(replay)return replay
   const candidate=await storage.upload(identity.tenantId,id,documentId,bytes);archiveCheck(candidate,id,documentId,bytes);let knownRollback=false
   try{const done=await run(id,'write',async(tx,a)=>{knownRollback=false;try{const row=await find(tx,a,id,documentId);if(row.status==='ISSUED'){if((row.signedArchive as unknown as ArchivedPdf).sha256===sha&&row.completionBasis===d.basis&&row.signedOn&&iso(row.signedOn)===d.signedOn)return row;throw new BusinessError(409,'This document already has different signed evidence.')}if(row.version!==d.version||row.status!=='PRINT_READY')throw new BusinessError(409,'Signing state changed. Reload before continuing.');await currentIssuer(tx,a,id,row.snapshot as unknown as StatutorySnapshot);const next=await tx.taxStatutoryDocument.update({where:{tenantId_id:{tenantId:a.tenantId,id:documentId}},data:{status:'ISSUED',version:{increment:1},signedOn:date(d.signedOn),completionBasis:d.basis,signedArchive:json({...candidate,issuedAt:new Date().toISOString(),issuedBy:a.userId})}});await event(tx,a,next,'Manual signature completion attested: '+d.basis);return next}catch(e){knownRollback=true;throw e}});if((done.signedArchive as unknown as ArchivedPdf).path!==candidate.path)await storage.remove(candidate.path).catch(()=>{});return summary(done)}catch(e){if(knownRollback||e instanceof BusinessError)await storage.remove(candidate.path).catch(()=>{});throw e}
  },
  void(id:string,documentId:string,input:unknown){const d=statutoryVoidSchema.parse(input);return run(id,'write',async(tx,a)=>{const row=await find(tx,a,id,documentId);if(row.status==='VOID'&&row.voidReason===d.reason)return summary(row);if(row.version!==d.version||!['RESERVED','PRINT_READY'].includes(row.status))throw new BusinessError(409,'Only an unissued current reservation can be voided. Signed documents require a credit note.');const next=await tx.taxStatutoryDocument.update({where:{tenantId_id:{tenantId:a.tenantId,id:documentId}},data:{status:'VOID',version:{increment:1},voidReason:d.reason}});await event(tx,a,next,d.reason);return summary(next)})},
  download(id:string,documentId:string,copy:'print'|'signed',acknowledgeHistorical=false){return run(id,'export',async(tx,a)=>{const row=await find(tx,a,id,documentId),invoice=await invoiceFind(tx,a,id,'invoiceDocuments');if(row.status==='VOID')throw new BusinessError(409,'Voided reservations cannot be downloaded for use.');if(invoice.status==='CREDITED'&&row.kind!=='CREDIT_NOTE'&&!acknowledgeHistorical)throw new BusinessError(409,'Acknowledge that this is the historical original of a fully credited invoice.');const archive=(copy==='signed'?row.signedArchive:row.printArchive) as unknown as ArchivedPdf|null;if(!archive)throw new BusinessError(409,'This PDF is not available yet.');return storage.url(archive.path,`${row.reference.replaceAll('/','-')}-${copy==='signed'?'signed':'unsigned-print'}.pdf`)})},
 }
}
