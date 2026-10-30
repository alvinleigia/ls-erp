import { taxPreparationError } from '@/platform/tax/source-errors'
import { Prisma,type PrismaClient } from '@prisma/client'
import { authorizeBusinessOperation } from '@/platform/access/operation'
import { quotationRecordScope } from '@/platform/access/record-scope'
import { permits } from '@/platform/access/policy'
import { lockTenantOperations } from '@/platform/transactions/tenant-lock'
import { serializationConflict } from '@/platform/database-errors'
import { BusinessError,type BusinessActor } from '@/platform/policy'
import { recordDomainAuditEvent } from '@/lib/domain-audit'
import { participantSnapshotSchema } from '@/platform/participants/validation'
import { previewProfileSnapshotSchema } from '@/platform/tax/agreement-preview'
import { taxInputQuery,taxInputSaveSchema,taxInputIllustration,withinTaxDates } from '@/platform/tax/source-inputs'
import { sourceTaxPricing,taxPricingApprovalSchema } from '@/platform/tax/source-pricing'
import type { QuotationSnapshot } from './quotation-service'

type Tx=Prisma.TransactionClient
type Identity=Pick<BusinessActor,'tenantId'|'userId'|'requestId'>
const json=(v:unknown)=>JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue
export function createQuotationTaxInputService(db:PrismaClient,identity:Identity){
 async function run<T>(write:boolean,fn:(tx:Tx,a:BusinessActor)=>Promise<T>,lockSecurity=write){for(let attempt=0;;attempt++)try{return await db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${identity.tenantId} FOR SHARE`;if(lockSecurity)await lockTenantOperations(tx,identity.tenantId)
  const a=await authorizeBusinessOperation(tx,identity,write?['quotations.read','quotations.edit','taxProfiles.read']:'quotations.read',['crm','salesDocuments'])
  if(write&&a.role!=='ADMIN')throw new BusinessError(403,'Tax administrators prepare source tax inputs.');return fn(tx,a)
 },{isolationLevel:lockSecurity?'ReadCommitted':'Serializable',maxWait:20000,timeout:20000})}catch(e){const native=taxPreparationError(e);if(native)throw native;if(serializationConflict(e)&&attempt<3)continue;if((e as {code?:string}).code==='P2002')throw new BusinessError(409,'Tax inputs already exist for this revision. Reload the saved preparation.');throw e}}
 async function source(tx:Tx,a:BusinessActor,id:string,revision:number,edit=false){
  const header=await tx.crmQuotation.findFirst({where:{...quotationRecordScope(a,edit?'edit':'read'),id},select:{id:true,version:true,opportunity:{select:{officeId:true}}}})
  const row=header?await tx.crmQuotationRevision.findUnique({where:{tenantId_quotationId_number:{tenantId:a.tenantId,quotationId:id,number:revision}}}):null
  if(!header||!row)throw new BusinessError(404,'Quotation revision not found.')
  return {header,row,snapshot:row.snapshot as unknown as QuotationSnapshot}
 }
 async function setup(tx:Tx,a:BusinessActor,s:Awaited<ReturnType<typeof source>>){
  const office=await tx.businessOffice.findFirst({where:{tenantId:a.tenantId,id:s.header.opportunity.officeId},include:{company:true,taxRegistration:{include:{registration:true}}}})
  const participants=participantSnapshotSchema.safeParse(s.snapshot.participants),party=participants.success?participants.data.participants.find(p=>p.role==='CUSTOMER')?.party:null
  const mapping=office?.taxRegistration,registration=mapping?.registration
  const ordered=!!await tx.salesOrder.count({where:{tenantId:a.tenantId,quotationId:s.header.id,revision:s.row.number}})
  let reason=''
  if(s.header.version!==s.row.number)reason='Save or open the latest quotation revision before preparing tax inputs.'
  else if(ordered)reason='This revision has already been ordered. Its accepted facts cannot be changed.'
  else if(!party)reason='Save a new quotation revision with an explicit main customer identity.'
  else if(!office||office.archived||office.company.archived||!registration||registration.archived)reason='Map an active company tax registration to this quotation’s issuing office first.'
  return {office,party,mapping,registration,reason}
 }
 return {
  pricing(id:string,input:unknown){const q=taxInputQuery.parse(input);return run(false,async(tx,a)=>{
   const s=await source(tx,a,id,q.revision),review=await tx.quotationTaxInputReview.findUnique({where:{tenantId_quotationId_revision:{tenantId:a.tenantId,quotationId:id,revision:q.revision}},include:{lines:{orderBy:{lineIndex:'asc'}},approval:true}})
   if(!review)return {reviewId:null,approval:null,canApprove:false,reason:'Prepare this saved revision before reviewing tax-aware pricing.',pricing:null}
   const pricing=sourceTaxPricing({currency:s.snapshot.content.currency,consideration:s.snapshot.calculation.consideration,discount:s.snapshot.calculation.discount,charges:s.snapshot.content.charges,lines:s.snapshot.calculation.lines},review.lines)
   const editable=a.role==='ADMIN'&&permits(a,'taxProfiles.read')&&permits(a,'quotations.edit')&&!!await tx.crmQuotation.findFirst({where:{...quotationRecordScope(a,'edit'),id},select:{id:true}})
   const reason=review.approval?'Pricing approval is immutable; orders retain its exact tax agreement.':pricing.reason||(!editable?'Tax administrators with quotation Edit access approve pricing.':(await setup(tx,a,s)).reason)
   return {reviewId:review.id,approval:review.approval,canApprove:!review.approval&&!reason,reason,pricing}
  })},
  approvePricing(id:string,input:unknown){const v=taxPricingApprovalSchema.parse(input);return run(true,async(tx,a)=>{
   await tx.$queryRaw`SELECT id FROM "CrmQuotation" WHERE "tenantId"=${a.tenantId} AND id=${id} FOR UPDATE`
   const s=await source(tx,a,id,v.revision,true),d=await setup(tx,a,s);if(d.reason)throw new BusinessError(409,d.reason)
   const review=await tx.quotationTaxInputReview.findUnique({where:{tenantId_quotationId_revision:{tenantId:a.tenantId,quotationId:id,revision:v.revision}},include:{lines:{orderBy:{lineIndex:'asc'}},approval:true}})
   if(!review||review.id!==v.reviewId)throw new BusinessError(409,'Tax preparation changed. Reload the saved review.')
   if(review.approval)throw new BusinessError(409,'Pricing is already approved. Open its saved evidence.')
   const pricing=sourceTaxPricing({currency:s.snapshot.content.currency,consideration:s.snapshot.calculation.consideration,discount:s.snapshot.calculation.discount,charges:s.snapshot.content.charges,lines:s.snapshot.calculation.lines},review.lines)
   if(pricing.reason||!pricing.agreement)throw new BusinessError(409,pricing.reason)
   if(v.expectedGross!==pricing.gross)throw new BusinessError(409,'The reviewed total changed. Reload before approving pricing.')
   const approval=await tx.quotationTaxPricingApproval.create({data:{tenantId:a.tenantId,reviewId:review.id,agreement:json(pricing.agreement),basisReference:v.basisReference,createdBy:a.userId}})
   await recordDomainAuditEvent(tx,{tenantId:a.tenantId,actorUserId:a.userId,actorRole:a.role,requestId:a.requestId,event:'crm.quotation.taxPricing.approved',entityType:'CrmQuotation',entityId:id,after:{approvalId:approval.id,reviewId:review.id,revision:v.revision,gross:pricing.gross}})
   return {id:approval.id,revision:v.revision}
  })},
  get(id:string,input:unknown){const q=taxInputQuery.parse(input);return run(false,async(tx,a)=>{
   const s=await source(tx,a,id,q.revision),review=await tx.quotationTaxInputReview.findUnique({where:{tenantId_quotationId_revision:{tenantId:a.tenantId,quotationId:id,revision:q.revision}},include:{lines:{orderBy:{lineIndex:'asc'}}}})
   const base={revision:q.revision,review,source:{title:s.snapshot.content.title,currency:s.snapshot.content.currency,consideration:s.snapshot.calculation.consideration,lines:s.snapshot.calculation.lines.map((l,i)=>({index:i,description:l.description,amount:l.amount}))}}
   if(review)return {...base,canPrepare:false,reason:'Prepared inputs are immutable. Order acceptance uses a separate saved pricing approval.',illustration:taxInputIllustration({currency:s.snapshot.content.currency,consideration:s.snapshot.calculation.consideration,discount:s.snapshot.calculation.discount,charges:s.snapshot.content.charges,lines:s.snapshot.calculation.lines},review.lines)}
   if(a.role!=='ADMIN'||!permits(a,'taxProfiles.read')||!permits(a,'quotations.edit')||!await tx.crmQuotation.findFirst({where:{...quotationRecordScope(a,'edit'),id},select:{id:true}}))return {...base,canPrepare:false,reason:'Tax administrators with quotation Edit access can prepare inputs.'}
   const d=await setup(tx,a,s);return {...base,canPrepare:!d.reason,reason:d.reason,party:d.party,issuer:d.registration?{id:d.registration.id,version:d.registration.version,label:d.registration.label,legalName:d.registration.legalName,registrationNumber:d.registration.registrationNumber,category:d.registration.category,mappingVersion:d.mapping!.version}:null}
  })},
  choices(id:string,input:unknown){const q=taxInputQuery.parse(input);return run(true,async(tx,a)=>{
   const s=await source(tx,a,id,q.revision,true),d=await setup(tx,a,s);if(d.reason)throw new BusinessError(409,d.reason)
   const paging={skip:(q.page-1)*q.pageSize,take:q.pageSize},companyId=d.office!.companyId
   if(q.kind==='profiles'){
    const where={tenantId:a.tenantId,companyId,enabled:true,...(q.q?{OR:[{name:{contains:q.q,mode:'insensitive' as const}},{code:{contains:q.q,mode:'insensitive' as const}}]}:{})},include={versions:{orderBy:{version:'desc' as const},take:1,select:{snapshot:true}}}
    const [rows,total,selected]=await Promise.all([tx.companyTaxProfile.findMany({where,include,orderBy:[{name:'asc'},{id:'asc'}],...paging}),tx.companyTaxProfile.count({where}),q.selectedId?tx.companyTaxProfile.findFirst({where:{...where,id:q.selectedId},include}):null])
    const dto=(r:typeof rows[number])=>({id:r.id,name:r.name+' · v'+r.version,version:r.version,variants:previewProfileSnapshotSchema.parse(r.versions[0].snapshot).variants.map(v=>v.key)})
    return {items:rows.map(dto),total,page:q.page,pageSize:q.pageSize,totalPages:Math.max(1,Math.ceil(total/q.pageSize)),selected:selected?dto(selected):null}
   }
   if(q.kind!=='recipients')throw new BusinessError(400,'Choose profiles or recipients.')
   const owner=d.party!.kind==='PERSON'?{contactId:d.party!.id,accountId:null}:{accountId:d.party!.id,contactId:null},where={tenantId:a.tenantId,...owner,archived:false,...(q.q?{OR:[{legalName:{contains:q.q,mode:'insensitive' as const}},{registrationNumber:{contains:q.q,mode:'insensitive' as const}}]}:{})}
   const [rows,total,selected]=await Promise.all([tx.partyTaxIdentity.findMany({where,orderBy:[{legalName:'asc'},{id:'asc'}],...paging}),tx.partyTaxIdentity.count({where}),q.selectedId?tx.partyTaxIdentity.findFirst({where:{...where,id:q.selectedId}}):null]);const dto=(r:typeof rows[number])=>({id:r.id,name:r.legalName+' · '+(r.registrationNumber||'Unregistered')+' · v'+r.version,version:r.version})
   return {items:rows.map(dto),total,page:q.page,pageSize:q.pageSize,totalPages:Math.max(1,Math.ceil(total/q.pageSize)),selected:selected?dto(selected):null}
  },false)},
  save(id:string,input:unknown){const v=taxInputSaveSchema.parse(input);return run(true,async(tx,a)=>{
   await tx.$queryRaw`SELECT id FROM "CrmQuotation" WHERE "tenantId"=${a.tenantId} AND id=${id} FOR UPDATE`
   const s=await source(tx,a,id,v.revision,true),d=await setup(tx,a,s);if(d.reason)throw new BusinessError(409,d.reason)
   if(await tx.quotationTaxInputReview.count({where:{tenantId:a.tenantId,quotationId:id,revision:v.revision}}))throw new BusinessError(409,'Tax inputs already exist for this revision. Reload the saved preparation.')
   if(d.mapping!.version!==v.mappingVersion||d.registration!.id!==v.issuerId||d.registration!.version!==v.issuerVersion)throw new BusinessError(409,'The issuing office mapping or registration changed. Reload before preparing inputs.')
   const owner=d.party!.kind==='PERSON'?{contactId:d.party!.id,accountId:null}:{accountId:d.party!.id,contactId:null}
   const recipient=await tx.partyTaxIdentity.findFirst({where:{tenantId:a.tenantId,...owner,id:v.recipientId,archived:false}})
   const activeParty=d.party!.kind==='PERSON'?await tx.crmContact.count({where:{tenantId:a.tenantId,id:d.party!.id,archived:false}}):await tx.crmAccount.count({where:{tenantId:a.tenantId,id:d.party!.id,archived:false}})
   if(!recipient||!activeParty)throw new BusinessError(400,'Choose an active tax identity belonging to this revision’s saved main customer.')
   if(recipient.version!==v.recipientVersion)throw new BusinessError(409,'The customer tax identity changed. Select it again.')
   if(!withinTaxDates(v.proposedSupplyOn,d.registration!)||!withinTaxDates(v.proposedSupplyOn,recipient))throw new BusinessError(400,'Registration and recipient validity must cover the proposed date.')
   if(v.lines.length!==s.snapshot.content.lines.length||v.lines.some(l=>l.lineIndex>=s.snapshot.content.lines.length))throw new BusinessError(400,'Review every saved source line exactly once.')
   const prepared=[]
   for(const l of [...v.lines].sort((a,b)=>a.lineIndex-b.lineIndex)){
    const p=await tx.companyTaxProfile.findFirst({where:{tenantId:a.tenantId,id:l.profileId,companyId:d.office!.companyId,enabled:true}})
    if(!p)throw new BusinessError(400,'Choose enabled profiles from the source company.');if(p.version!==l.profileVersion)throw new BusinessError(409,'A tax profile changed. Select its current reviewed version.')
    const history=await tx.companyTaxProfileVersion.findUniqueOrThrow({where:{tenantId_profileId_version:{tenantId:a.tenantId,profileId:p.id,version:p.version}},include:{rates:{include:{tax:true}}}})
    if(history.rates.some(r=>!r.tax.isActive||r.name!==r.tax.name||!r.percent.eq(r.tax.percent)||r.sourceUpdatedAt.getTime()!==r.tax.updatedAt.getTime()))throw new BusinessError(409,'Publish a fresh reviewed profile after directory rate changes.')
    const snap=previewProfileSnapshotSchema.parse(history.snapshot);if(snap.variants.length?!snap.variants.some(x=>x.key===l.variant):l.variant!=='NONE')throw new BusinessError(400,'Choose a configured jurisdiction variant for each line.')
    prepared.push({...l,profileSnapshot:history.snapshot})
   }
   const [issuer,party]=await Promise.all([tx.companyTaxRegistrationRevision.findUniqueOrThrow({where:{tenantId_registrationId_version:{tenantId:a.tenantId,registrationId:v.issuerId,version:v.issuerVersion}}}),tx.partyTaxIdentityRevision.findUniqueOrThrow({where:{tenantId_identityId_version:{tenantId:a.tenantId,identityId:v.recipientId,version:v.recipientVersion}}})])
   const review=await tx.quotationTaxInputReview.create({data:{tenantId:a.tenantId,quotationId:id,revision:v.revision,officeId:d.office!.id,companyId:d.office!.companyId,mappingVersion:v.mappingVersion,issuerId:v.issuerId,issuerVersion:v.issuerVersion,recipientId:v.recipientId,recipientVersion:v.recipientVersion,proposedSupplyOn:new Date(v.proposedSupplyOn+'T00:00:00Z'),issuerSnapshot:json(issuer.snapshot),recipientSnapshot:json(party.snapshot),createdBy:a.userId}})
   for(const l of prepared)await tx.quotationTaxInputLine.create({data:{...l,tenantId:a.tenantId,reviewId:review.id,profileSnapshot:json(l.profileSnapshot)}})
   await recordDomainAuditEvent(tx,{tenantId:a.tenantId,actorUserId:a.userId,actorRole:a.role,requestId:a.requestId,event:'crm.quotation.taxInputs.prepared',entityType:'CrmQuotation',entityId:id,after:{reviewId:review.id,revision:v.revision,issuerId:v.issuerId,issuerVersion:v.issuerVersion,recipientId:v.recipientId,recipientVersion:v.recipientVersion,profiles:prepared.map(l=>({lineIndex:l.lineIndex,profileId:l.profileId,version:l.profileVersion}))}})
   return {id:review.id,revision:v.revision}
  })},
 }
}
