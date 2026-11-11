/* eslint-disable @typescript-eslint/no-require-imports */
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto'),{Pool}=require('pg'),{PrismaClient}=require('@prisma/client')
const {TenantPgAdapter}=require('../lib/tenant-pg-adapter.ts'),{runWithDatabaseActor}=require('../lib/database-actor.ts'),{authorizeBusinessOperation}=require('../platform/access/operation.ts')
const {createApplicationCrmService}=require('../application/crm/service.ts'),{applicationSalesOrders}=require('../application/sales-orders/service.ts'),{applicationReservations}=require('../application/catalog/reservations.ts'),{applicationCatalog}=require('../application/catalog/service.ts'),{applicationReceivables}=require('../application/receivables/service.ts')
const {applicationOrderDocuments,applicationDocumentTemplates}=require('../application/order-documents/service.ts'),{emptyQuotationContent}=require('../modules/sales-documents/quotation-validation.ts')
const {applicationVerificationCases,applicationVerificationSubmissions,applicationVerificationSummary}=require('../application/verification/service.ts'),{createVerificationConfigurationService}=require('../platform/verification/configuration.ts'),{createVerificationCheckpointSettings}=require('../platform/verification/checkpoint-settings.ts'),{emptyVerificationPolicy}=require('../platform/verification/contracts.ts'),{emptyCheckpoints,checkpointDefinitionSchema}=require('../platform/verification/checkpoint-contracts.ts')
const {createOfficeAccessService}=require('../platform/companies/office-access.ts'),{createCompanyService}=require('../platform/companies/service.ts'),{createAccessRoleService}=require('../platform/access/service.ts'),{createRecordSharingService}=require('../platform/access/sharing-service.ts'),{defaultRecordRules}=require('../platform/access/rules.ts')
require('../lib/logger.ts').logger.info=()=>{}
const url=new URL(process.env.CRM_TEST_DATABASE_URL||'http://invalid');if(!['127.0.0.1','localhost'].includes(url.hostname)||url.pathname!='/ls_salon_crm_test')throw Error('Disposable local database only.')
const tenant='checkpoints_'+randomUUID(),foreign=tenant+'_foreign',pools=[],clients=[],objects=new Map(),counts={uploads:0,removes:0}
function client(tenantId,bypass=false){const u=new URL(url);if(!bypass){u.username='crm_test_runtime';u.password=''}const pool=new Pool({connectionString:u.toString(),max:5});pools.push(pool);const db=new PrismaClient({adapter:new TenantPgAdapter(pool,{tenantId,bypass})});clients.push(db);return db}
const root=client(undefined,true),db=client(tenant),other=client(foreign),identity=u=>({tenantId:u.tenantId,userId:u.id}),status=n=>e=>e.status===n
const storage={async upload(t,o,id,bytes){counts.uploads++;const path=`${t}/orders/${o}/${id}/${randomUUID()}.pdf`;objects.set(path,bytes);return{path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}},async remove(p){counts.removes++;objects.delete(p)},async url(p){assert.ok(objects.has(p));return'https://example.test/'+p}}
const docs=(u=admin,options={})=>applicationOrderDocuments(db,identity(u),{storage,render:async()=>Buffer.from('%PDF-test'),...options}),settings=(u=admin)=>createVerificationCheckpointSettings(db,identity(u)),submissions=u=>applicationVerificationSubmissions(db,identity(u)),summary=u=>applicationVerificationSummary(db,identity(u)),subject=p=>({kind:'PERSON',id:p.id})
let admin,reviewer,operator,outsider,foreignAdmin,roles,crm,orders,reservations,catalog,main,additional,third,company,office,pipeline,stage,warnOrder,offDocument,offDocumentOrder,confirmedProof
const definition={...emptyVerificationPolicy(),validityDays:30},operatorPermissions=['salesOrders.read','salesOrders.confirm','opportunities.read','verificationSummaries.read']
async function grant(user,permissions,rules={}){const p=await roles.save({name:randomUUID(),permissions:[...new Set(permissions)]}),a=await roles.assignment(user.id);await roles.assign(user.id,{version:a.accessPolicy.version,roleIds:[p.id],rules:{...defaultRecordRules(),'salesOrders.read':'ALL','salesOrders.confirm':'ALL','opportunities.read':'ALL','contacts.read':'ALL','accounts.read':'ALL',...rules}})}
async function publish(mode='OFF',roles=['CUSTOMER','ADDITIONAL_CUSTOMER']){const c=await settings().get(),data={version:c.version,definition:{...emptyCheckpoints(),roles,checkpoints:{ORDER_CONFIRMATION:mode,UNIT_ALLOCATION:mode,ORDER_DOCUMENT:mode}}},p=await settings().preview(data);return settings().publish({...data,previewHash:p.previewHash})}
async function approve(person,role='CUSTOMER'){
 const caseId=(await applicationVerificationCases(db,identity(admin)).start(subject(person))).case.id,view=await submissions(admin).view(subject(person))
 const s=await submissions(admin).submit({caseId,version:view.submission?.number??0,policyVersion:view.policy.version,role,facts:[],evidenceIds:[],...(view.submission?{reason:'Fresh role-specific approval'}:{})})
 const r=await submissions(reviewer).review({submissionId:s.id,version:s.number,reviewVersion:0,decision:'APPROVED',reviewed:true});return{s,r}
}
async function revoke(person){const v=await submissions(admin).view(subject(person));return submissions(reviewer).review({submissionId:v.submission.id,version:v.submission.number,reviewVersion:v.history[0].reviews[0].number,decision:'REVOKED',reason:'Synthetic correction',reviewed:false})}
async function fixture({co=false,unit=false,person=main}={}){
 const d=await crm.createOpportunity({title:'Generic verification sale',contactId:person.id,assignedUserId:operator.id,pipelineId:pipeline.id,stageId:stage.id,amount:'100',currency:'INR',expectedCloseOn:'2030-01-01'})
 if(co){const p=await crm.getOpportunityParticipants(d.id);await crm.replaceOpportunityParticipants(d.id,{version:p.version,participants:[{role:'ADDITIONAL_CUSTOMER',party:{kind:'PERSON',id:additional.id}}]})}
 const item=unit?await catalog.save({code:randomUUID(),name:'Generic equipment unit',kind:'UNIT',price:'100',currency:'INR',unit:'each'}):null
 const q=await crm.saveQuotation(d.id,{content:{...structuredClone(emptyQuotationContent),title:'Generic accepted terms',supplierName:'Shared Industries',currency:'INR',lines:[{description:'Equipment or service',quantity:'1',unit:'each',rate:'100',...(item?{catalogItemId:item.id,catalogItemVersion:item.version}:{})}]}})
 return{deal:d,item,order:await orders.create({quotationId:q.id,revision:1})}
}
const confirm=f=>orders.transition(f.order.id,{action:'confirm',version:1}),hold=f=>reservations.create(f.order.id,{itemId:f.item.id,expiresAt:new Date(Date.now()+86400000).toISOString()})
async function issue(f,service=docs()){const p=await service.prepare(f.order.id,{providerKey:'order-acknowledgement',supersedesId:null,reason:''});const input={providerKey:'order-acknowledgement',supersedesId:null,reason:'',previewHash:p.fingerprint,requestKey:randomUUID()};return {row:await service.issue(f.order.id,input),input}}
const direct=(u,fn)=>runWithDatabaseActor(u.id,()=>db.$transaction(async tx=>{await authorizeBusinessOperation(tx,identity(u),'salesOrders.read');return fn(tx)}))
before(async()=>{
 await root.tenant.createMany({data:[tenant,foreign].map(id=>({id,name:id,slug:id}))})
 for(const t of [tenant,foreign])await root.tenantModule.createMany({data:['crm','salesDocuments','salesOrders','catalog','receivables','paymentPlans','customerVerification'].map(key=>({tenantId:t,key,allowed:true,enabled:true}))})
 const user=(tenantId,role)=>root.user.create({data:{tenantId,role,name:role,email:randomUUID()+'@example.test'}})
 admin=await user(tenant,'ADMIN');reviewer=await user(tenant,'STAFF');operator=await user(tenant,'MANAGER');outsider=await user(tenant,'STAFF');foreignAdmin=await user(foreign,'ADMIN')
 const structure=createCompanyService(db,identity(admin));company=await structure.createCompany({code:'GEN',name:'Generic industries'});office=await structure.createOffice({companyId:company.id,code:'TEST',name:'Test office'})
 const access=createOfficeAccessService(db,identity(admin));for(const u of [admin,reviewer,operator,outsider]){const m=await access.getMemberships(u.id);await access.saveMemberships(u.id,{version:m.version,officeIds:[office.id],companies:[],creationOfficeId:office.id})}
 roles=createAccessRoleService(db,identity(admin));await grant(operator,operatorPermissions);await grant(reviewer,['contacts.read','accounts.read','customerVerification.read','verificationSubmissions.read','verificationEvidence.read','verificationReviews.read','verificationReviews.approve','verificationReviews.cancel']);await grant(outsider,operatorPermissions,{'salesOrders.read':'OWN','opportunities.read':'OWN'})
 crm=createApplicationCrmService(db,identity(admin));orders=applicationSalesOrders(db,identity(admin));catalog=applicationCatalog(db,identity(admin));reservations=applicationReservations(db,identity(admin))
 main=await crm.createContact({name:'Main verification customer'});additional=await crm.createContact({name:'Additional verification customer'});third=await crm.createContact({name:'Later unrelated applicant'})
 pipeline=await crm.createPipeline({name:'Generic pipeline',stages:[{name:'Open',kind:'OPEN',probability:10,color:'#123456'},{name:'Won',kind:'WON',probability:100,color:'#00aa00'},{name:'Lost',kind:'LOST',probability:0,color:'#aa0000'}]});stage=pipeline.stages[0]
 const templates=applicationDocumentTemplates(db,identity(admin)),t=await templates.get(company.id,'order-acknowledgement');await templates.publish({companyId:company.id,providerKey:'order-acknowledgement',version:t.version,content:{...t.content,enabled:true},reviewed:true})
})
after(async()=>{await Promise.all(clients.map(c=>c.$disconnect()));await Promise.all(pools.map(p=>p.end()))})

test('defaults are Off and read-only; enabling rules requires published requirements and native contract parity',async()=>{
 assert.deepEqual((await settings().get()).definition,emptyCheckpoints());assert.equal(await root.verificationCheckpointVersion.count({where:{tenantId:tenant}}),0)
 await assert.rejects(publish('WARN'),status(409))
 for(const value of [emptyCheckpoints(),{...emptyCheckpoints(),roles:[]},{...emptyCheckpoints(),roles:['CUSTOMER','CUSTOMER']},{...emptyCheckpoints(),extra:true},{...emptyCheckpoints(),checkpoints:{ORDER_CONFIRMATION:'REQUIRED'}}]){const [r]=await root.$queryRaw`SELECT app.verification_checkpoint_valid(${JSON.stringify(value)}::jsonb) valid`;assert.equal(r.valid,checkpointDefinitionSchema.safeParse(value).success)}
 const s=createVerificationConfigurationService(db,identity(admin)),p=await s.preview({version:0,definition});await s.publish({version:0,definition,previewHash:p.previewHash})
})
test('Off preserves generic confirmation, allocation, document issuance and creates no fabricated verification proof',async()=>{
 const f=await fixture({co:true,unit:true});await confirm(f);const h=await hold(f);await reservations.transition(f.order.id,h.id,{action:'allocate',version:1});const issued=await issue(f);offDocument=issued;offDocumentOrder=f.order.id
 assert.equal(await root.orderVerificationAcceptance.count({where:{tenantId:tenant}}),0);assert.equal(await root.customerVerificationCase.count({where:{tenantId:tenant}}),0)
 assert.equal((await orders.get(f.order.id)).status,'CONFIRMED')
})
test('Warn allows actions and freezes all missing-participant warnings without exposing private facts',async()=>{
 await publish('WARN');const f=await fixture({co:true,unit:true});warnOrder=f;await confirm(f);const h=await hold(f);await reservations.transition(f.order.id,h.id,{action:'allocate',version:1});await issue(f)
 const proof=await root.orderVerificationAcceptance.findMany({where:{tenantId:tenant,orderId:f.order.id}});assert.equal(proof.length,3)
 for(const row of proof){assert.equal(row.proof.mode,'WARN');assert.equal(row.proof.eligible,false);assert.equal(row.proof.participants.length,2);assert.equal(/facts|filename|path|email|phone/.test(JSON.stringify(row.proof)),false)}
 const view=await summary(operator).get({kind:'ORDER',id:f.order.id});assert.equal(view.participants.length,2);assert.equal(view.acceptances.length,3)
 await assert.rejects(submissions(operator).view(subject(main)),status(403));assert.equal((await direct(operator,tx=>tx.verificationSubmission.findMany())).length,0)
 assert.equal(/caseId|submissionId|reviewedBy|facts|proof"/.test(JSON.stringify(view)),false)
})
test('Required blocks service and native confirmation atomically for unapproved main or additional customers',async()=>{
 await publish('REQUIRED');const f=await fixture({co:true});await assert.rejects(confirm(f),status(409));assert.equal((await orders.get(f.order.id)).status,'DRAFT');assert.equal(await root.salesOrderEvent.count({where:{tenantId:tenant,orderId:f.order.id}}),1)
 await assert.rejects(direct(operator,tx=>tx.salesOrder.update({where:{tenantId_id:{tenantId:tenant,id:f.order.id}},data:{status:'CONFIRMED',version:2,participantAcceptance:{}}})),/Customer verification checkpoint/)
 await approve(main);await assert.rejects(confirm(f),status(409));await approve(additional,'ADDITIONAL_CUSTOMER');await confirm(f)
 confirmedProof=await root.orderVerificationAcceptance.findFirstOrThrow({where:{tenantId:tenant,orderId:f.order.id}});assert.equal(confirmedProof.proof.eligible,true)
 for(const p of confirmedProof.proof.participants){assert.ok(p.reviewId);assert.ok(p.submissionId);assert.ok(p.reviewedByUserId);assert.ok(p.reviewedAt);assert.match(p.reviewedAt,/(Z|[+]00:00)$/);assert.match(p.validUntil,/(Z|[+]00:00)$/)}
})
test('checkpoint uses frozen quotation participants while opportunity summary follows its own current selections',async()=>{
 const f=await fixture({co:true}),v=await crm.getOpportunityParticipants(f.deal.id);await crm.replaceOpportunityParticipants(f.deal.id,{version:v.version,participants:[{role:'ADDITIONAL_CUSTOMER',party:{kind:'PERSON',id:third.id}}]})
 const old=await summary(operator).get({kind:'ORDER',id:f.order.id});for(const p of old.participants)assert.match(p.validUntil,/(Z|[+]00:00)$/);const live=await summary(operator).get({kind:'OPPORTUNITY',id:f.deal.id});assert.equal(old.participants.find(p=>p.role==='ADDITIONAL_CUSTOMER').id,additional.id);assert.equal(live.participants.find(p=>p.role==='ADDITIONAL_CUSTOMER').id,third.id)
 await confirm(f);assert.equal(live.participants.find(p=>p.id===third.id).status,'NOT_STARTED')
})
test('revocation blocks later allocation and new issuance, while historical PDF downloads and idempotent retries remain available',async()=>{
 const f=await fixture({unit:true});await confirm(f);const h=await hold(f);await revoke(main)
 await assert.rejects(reservations.transition(f.order.id,h.id,{action:'allocate',version:1}),status(409));assert.equal((await reservations.history(f.order.id)).items[0].status,'HELD')
 const p=await docs().prepare(f.order.id,{providerKey:'order-acknowledgement',supersedesId:null,reason:''}),before=counts.uploads
 await assert.rejects(docs().issue(f.order.id,{providerKey:'order-acknowledgement',supersedesId:null,reason:'',previewHash:p.fingerprint,requestKey:randomUUID()}),status(409));assert.equal(counts.uploads,before)
 assert.ok((await docs().download(offDocumentOrder,offDocument.row.id,'order-acknowledgement')).startsWith('https://example.test/'))
 assert.equal((await docs().issue(offDocumentOrder,offDocument.input)).id,offDocument.row.id)
 assert.deepEqual((await root.orderVerificationAcceptance.findUniqueOrThrow({where:{id:confirmedProof.id}})).proof,confirmedProof.proof)
})
test('recording money already received remains available despite Required and revoked verification',async()=>{
 const finance=applicationReceivables(db,identity(admin)),id=warnOrder.order.id;await finance.open(id,{dueDates:[null]});const v=await finance.get(id)
 const payment=await finance.record(id,{requestKey:randomUUID(),version:v.account.version,amount:'25',receivedOn:'2026-01-01',method:'CASH',reference:'',note:'Synthetic payment'})
 assert.ok(payment.id);assert.equal(String((await finance.get(id)).paid),'25')
})
test('module disablement cannot bypass a previously Required checkpoint',async()=>{
 const f=await fixture();await root.tenantModule.update({where:{tenantId_key:{tenantId:tenant,key:'customerVerification'}},data:{enabled:false}})
 try{await assert.rejects(confirm(f),status(409));await assert.rejects(summary(operator).get({kind:'ORDER',id:f.order.id}),status(403))}finally{await root.tenantModule.update({where:{tenantId_key:{tenantId:tenant,key:'customerVerification'}},data:{enabled:true}})}
})
test('approval changes during PDF generation invalidate the prepared state, clean unused upload and save no document/proof',async()=>{
 await approve(main);const f=await fixture();await confirm(f)
 const service=docs(admin,{render:async()=>{await revoke(main);return Buffer.from('%PDF-race')}}),p=await service.prepare(f.order.id,{providerKey:'order-acknowledgement',supersedesId:null,reason:''}),before=counts.removes
 await assert.rejects(service.issue(f.order.id,{providerKey:'order-acknowledgement',supersedesId:null,reason:'',previewHash:p.fingerprint,requestKey:randomUUID()}),status(409))
 assert.equal(counts.removes,before+1);assert.equal(await root.salesOrderDocument.count({where:{tenantId:tenant,orderId:f.order.id}}),0);assert.equal(await root.orderVerificationAcceptance.count({where:{tenantId:tenant,orderId:f.order.id,checkpoint:'ORDER_DOCUMENT'}}),0)
})
test('Required successful confirmation, allocation and document issuance each freeze their own accepted review proof',async()=>{
 await approve(main);const f=await fixture({co:true,unit:true});await confirm(f);const h=await hold(f);await reservations.transition(f.order.id,h.id,{action:'allocate',version:1});await issue(f)
 const rows=await root.orderVerificationAcceptance.findMany({where:{tenantId:tenant,orderId:f.order.id}});assert.equal(rows.length,3);assert.deepEqual(rows.map(r=>r.checkpoint).sort(),['ORDER_CONFIRMATION','ORDER_DOCUMENT','UNIT_ALLOCATION'])
 for(const row of rows){assert.equal(row.proof.mode,'REQUIRED');assert.equal(row.proof.eligible,true);assert.equal(row.proof.participants.length,2)}
})
test('each role uses its own latest submission; approval in another role cannot satisfy or revive a pending role',async()=>{
 const f=await fixture({co:true}),v=await crm.getOpportunityParticipants(f.deal.id);await crm.replaceOpportunityParticipants(f.deal.id,{version:v.version,participants:[{role:'ADDITIONAL_CUSTOMER',party:{kind:'PERSON',id:additional.id}},{role:'REPRESENTATIVE',party:{kind:'PERSON',id:additional.id}}]})
 const q=await crm.saveQuotation(f.deal.id,{content:{...structuredClone(emptyQuotationContent),supplierName:'Shared Industries',currency:'INR',lines:[{description:'Other roles',quantity:'1',unit:'each',rate:'100'}]}}),order=await orders.create({quotationId:q.id,revision:1})
 await publish('REQUIRED',['CUSTOMER','ADDITIONAL_CUSTOMER','REPRESENTATIVE']);await assert.rejects(orders.transition(order.id,{action:'confirm',version:1}),status(409));await approve(additional,'REPRESENTATIVE')
 const current=await summary(operator).get({kind:'ORDER',id:order.id});assert.equal(current.participants.filter(p=>p.id===additional.id&&p.status==='VERIFIED').length,2)
 await orders.transition(order.id,{action:'confirm',version:1})
 const detail=await submissions(admin).view(subject(additional)),addRevision=await submissions(admin).submit({caseId:detail.case.id,version:detail.submission.number,policyVersion:detail.policy.version,role:'ADDITIONAL_CUSTOMER',facts:[],evidenceIds:[],reason:'Fresh additional-customer review pending'})
 const pending=await summary(operator).get({kind:'ORDER',id:order.id});assert.equal(pending.participants.find(p=>p.role==='ADDITIONAL_CUSTOMER').status,'UNDER_REVIEW');assert.equal(pending.participants.find(p=>p.role==='REPRESENTATIVE').status,'VERIFIED')
 const representative=await submissions(admin).submit({caseId:detail.case.id,version:addRevision.number,policyVersion:detail.policy.version,role:'REPRESENTATIVE',facts:[],evidenceIds:[],reason:'Representative review pending independently'})
 await submissions(reviewer).review({submissionId:addRevision.id,version:representative.number,reviewVersion:0,decision:'APPROVED',reviewed:true})
 const independent=await summary(operator).get({kind:'ORDER',id:order.id});assert.equal(independent.participants.find(p=>p.role==='ADDITIONAL_CUSTOMER').status,'VERIFIED');assert.equal(independent.participants.find(p=>p.role==='REPRESENTATIVE').status,'UNDER_REVIEW')
})
test('business customers and their representatives require separate canonical verification without Real Estate',async()=>{
 const business=await crm.createAccount({name:'Generic business purchaser'}),person=await crm.createContact({name:'Purchasing representative'});
 const deal=await crm.createOpportunity({title:'Business purchase',contactId:person.id,accountId:business.id,assignedUserId:operator.id,pipelineId:pipeline.id,stageId:stage.id,amount:'100',currency:'INR',expectedCloseOn:'2030-01-01'});
 const quote=await crm.saveQuotation(deal.id,{content:{...structuredClone(emptyQuotationContent),supplierName:'Shared Industries',currency:'INR',lines:[{description:'Generic commercial service',quantity:'1',unit:'each',rate:'100'}]}}),order=await orders.create({quotationId:quote.id,revision:1});
 await publish('REQUIRED',['CUSTOMER','REPRESENTATIVE']);await approve(person,'REPRESENTATIVE');await assert.rejects(orders.transition(order.id,{action:'confirm',version:1}),status(409));
 const owner={kind:'BUSINESS',id:business.id},c=await applicationVerificationCases(db,identity(admin)).start(owner),v=await submissions(admin).view(owner),submitted=await submissions(admin).submit({caseId:c.case.id,version:0,policyVersion:v.policy.version,role:'CUSTOMER',facts:[],evidenceIds:[]});
 await submissions(reviewer).review({submissionId:submitted.id,version:1,reviewVersion:0,decision:'APPROVED',reviewed:true});
 const current=await summary(operator).get({kind:'ORDER',id:order.id});assert.equal(current.participants.find(p=>p.kind==='BUSINESS').status,'VERIFIED');assert.equal(current.participants.find(p=>p.role==='REPRESENTATIVE').status,'VERIFIED');await orders.transition(order.id,{action:'confirm',version:1});
});

test('an expired approval is rejected at the native checkpoint using the database clock',async()=>{
 const person=await crm.createContact({name:'Synthetic matured approval'}),approved=await approve(person)
 // Disposable fixture only: age this server-issued review coherently. The
 // transactional DDL restores the real immutable guard even on rollback.
 await root.$transaction(async tx=>{await tx.$executeRawUnsafe('ALTER TABLE "VerificationReview" DISABLE TRIGGER verification_review_write');await tx.$executeRaw`UPDATE "VerificationReview" SET "reviewedAt"="reviewedAt"-interval '31 days',"validUntil"="validUntil"-interval '31 days' WHERE id=${approved.r.id}`;await tx.$executeRawUnsafe('ALTER TABLE "VerificationReview" ENABLE TRIGGER verification_review_write')})
 const f=await fixture({person});assert.equal((await summary(operator).get({kind:'ORDER',id:f.order.id})).participants[0].status,'EXPIRED');await assert.rejects(confirm(f),status(409));assert.equal(await root.orderVerificationAcceptance.count({where:{tenantId:tenant,orderId:f.order.id}}),0)
})
test('summary capability cannot cross record scopes, Restricted sharing, offices, tenants, or the external-login boundary',async()=>{
 const f=await fixture();await assert.rejects(summary(outsider).get({kind:'ORDER',id:f.order.id}),status(404))
 const [native]=await direct(outsider,tx=>tx.$queryRaw`SELECT app.verification_source_summary(${tenant},'ORDER',${f.order.id}) data`);assert.equal(native.data,null)
 const sharing=createRecordSharingService(db,identity(admin)),v=await sharing.get('salesOrders',f.order.id);await sharing.save('salesOrders',f.order.id,{version:v.version,restricted:true,grants:[]});await grant(outsider,operatorPermissions);await assert.rejects(summary(outsider).get({kind:'ORDER',id:f.order.id}),status(404));assert.ok(await summary(operator).get({kind:'ORDER',id:f.order.id}))
 const officeAccess=createOfficeAccessService(db,identity(admin)),membership=await officeAccess.getMemberships(operator.id);await officeAccess.saveMemberships(operator.id,{version:membership.version,officeIds:[],companies:[],creationOfficeId:null});
 await assert.rejects(summary(operator).get({kind:'ORDER',id:f.order.id}),status(404));const [noOffice]=await direct(operator,tx=>tx.$queryRaw`SELECT app.verification_source_summary(${tenant},'ORDER',${f.order.id}) data`);assert.equal(noOffice.data,null);
 const restore=await officeAccess.getMemberships(operator.id);await officeAccess.saveMemberships(operator.id,{version:restore.version,officeIds:[office.id],companies:[],creationOfficeId:office.id});
 await assert.rejects(applicationVerificationSummary(other,identity(foreignAdmin)).get({kind:'ORDER',id:f.order.id}),status(404))
 const partner=await root.externalCollaborator.create({data:{tenantId:tenant,name:'Outside summary user',code:'SUMMARY',supervisorUserId:admin.id}}),u=await root.user.create({data:{tenantId:tenant,role:'STAFF',collaboratorId:partner.id,email:randomUUID()+'@example.test'}});await grant(u,operatorPermissions);await assert.rejects(summary(u).get({kind:'ORDER',id:f.order.id}),status(403))
 await assert.rejects(direct(operator,tx=>tx.$queryRaw`SELECT app.verification_evaluate(${tenant},'[]'::jsonb,'[]'::jsonb)`),/permission denied/)
})
test('acceptance proofs cannot be forged, changed or deleted, even through direct native writes',async()=>{
 const row=confirmedProof;await assert.rejects(root.orderVerificationAcceptance.update({where:{id:row.id},data:{proof:{eligible:false}}}),/immutable|retained/);await assert.rejects(root.orderVerificationAcceptance.delete({where:{id:row.id}}),/immutable|retained/)
 await assert.rejects(direct(operator,tx=>tx.orderVerificationAcceptance.create({data:{tenantId:tenant,orderId:row.orderId,checkpoint:'ORDER_CONFIRMATION',sourceId:'forged',sourceVersion:99,configurationVersion:row.configurationVersion,actorUserId:operator.id,proof:row.proof}})),/minted by|permission denied/)
})
test('concurrent unit holds and catalog edits retain exactly one winner and a safe conflict',async()=>{
 for(let i=0;i<4;i++){
  const f=await fixture({unit:true}),results=await Promise.allSettled([hold(f),catalog.save({code:f.item.code,name:f.item.name,kind:'UNIT',unit:f.item.unit,price:String(f.item.price),currency:f.item.currency,version:1,availability:'UNAVAILABLE'},f.item.id)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.status,409);
  const row=await catalog.get(f.item.id);assert(row.reservationState==='RESERVED'?row.availability==='AVAILABLE':row.availability==='UNAVAILABLE');
 }
});

test('an accepted transaction reference protects all case evidence independently of retention shortening',async()=>{
 const {applicationVerificationEvidence,applicationVerificationRetention}=require('../application/verification/service.ts'),sharp=require('sharp');const c=createVerificationConfigurationService(db,identity(admin)),saved=await c.get(),definition={...saved.definition,documents:[{code:'archive',label:'Archive evidence',subjects:['PERSON'],roles:['CUSTOMER']}]},p=await c.preview({version:saved.version,definition});await c.publish({version:saved.version,definition,previewHash:p.previewHash});
 const evidence=new Map(),storage={async signUpload(){return 'https://test.invalid/upload'},async read(path){return evidence.get(path)},async download(){return 'https://test.invalid/download'},async remove(){throw Error('Retention review must never remove files')}};
 const e=applicationVerificationEvidence(db,identity(admin),storage),caseId=(await applicationVerificationCases(db,identity(admin)).get(subject(main))).case.id,bytes=await sharp({create:{width:4,height:4,channels:3,background:'orange'}}).png().toBuffer(),upload=await e.reserve({caseId,documentCode:'archive',filename:'retained-original.png',contentType:'image/png',bytes:bytes.length}),row=await root.verificationEvidence.findUniqueOrThrow({where:{id:upload.id}});evidence.set(row.path,bytes);await e.finalize(row.id);
 const retention=applicationVerificationRetention(db,identity(admin)),cfg=await retention.settings(),preview=await retention.preview({version:cfg.version,retainDays:1});await retention.publish({version:cfg.version,retainDays:1,previewHash:preview.previewHash});
 const v=await retention.view(subject(main));assert.equal(v.decisions.find(d=>d.id===row.id).decision,'TRANSACTION_REFERENCE');assert.ok(evidence.has(row.path));const {applicationVerificationDisposal}=require('../application/verification/service.ts');await assert.rejects(applicationVerificationDisposal(db,identity(admin)).preview({evidenceId:row.id}),status(409));
});

test('irreversible disposal conflicts with new transaction acceptance until reconciliation completes',async()=>{
 const {applicationVerificationEvidence,applicationVerificationRetention,applicationVerificationDisposal}=require('../application/verification/service.ts'),sharp=require('sharp')
 const person=await crm.createContact({name:'Synthetic disposal checkpoint customer'}),caseId=(await applicationVerificationCases(db,identity(admin)).start(subject(person))).case.id
 await publish('WARN')
 const files=new Map(),bytes=await sharp({create:{width:4,height:4,channels:3,background:'orange'}}).png().toBuffer(),transport={async signUpload(){return'https://example.test/upload'},async read(path){return files.get(path)},async download(){return'https://example.test/download'},async remove(path){files.delete(path)}}
 const evidence=applicationVerificationEvidence(db,identity(admin),transport),upload=await evidence.reserve({caseId,documentCode:'archive',filename:'disposal-checkpoint.png',contentType:'image/png',bytes:bytes.length}),e=await root.verificationEvidence.findUniqueOrThrow({where:{id:upload.id}});files.set(e.path,bytes);await evidence.finalize(e.id)
 await root.$transaction(async tx=>{await tx.$executeRawUnsafe('ALTER TABLE "VerificationEvidence" DISABLE TRIGGER verification_evidence_write');await tx.$executeRaw`UPDATE "VerificationEvidence" SET "readyAt"="readyAt"-interval '100 days' WHERE id=${e.id}`;await tx.$executeRawUnsafe('ALTER TABLE "VerificationEvidence" ENABLE TRIGGER verification_evidence_write')})
 const retention=applicationVerificationRetention(db,identity(admin)),settings=await retention.settings(),r={version:settings.version,retainDays:1},rp=await retention.preview(r);await retention.publish({...r,previewHash:rp.previewHash})
 const storage={async inspect(path){return files.has(path)?{exists:true,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}:{exists:false}},async remove(path){files.delete(path);throw Error('Synthetic lost acknowledgement')}}
 const disposal=applicationVerificationDisposal(db,identity(admin),storage),preview=await disposal.preview({evidenceId:e.id}),pending=await disposal.request({evidenceId:e.id,requestKey:randomUUID(),previewHash:preview.previewHash,reason:'Synthetic checkpoint removal',reviewed:true})
 await assert.rejects(disposal.act({id:pending.id,version:1,action:'execute'}),status(503))
 const f=await fixture({person});await assert.rejects(confirm(f),e=>e.status===409&&/disposal/.test(e.message));assert.equal((await orders.get(f.order.id)).status,'DRAFT');assert.equal(await root.orderVerificationAcceptance.count({where:{tenantId:tenant,orderId:f.order.id}}),0)
 const d=await root.verificationDisposal.findUniqueOrThrow({where:{id:pending.id}})
 await root.$transaction(async tx=>{await tx.$executeRawUnsafe('ALTER TABLE "VerificationDisposal" DISABLE TRIGGER verification_disposal_write');await tx.$executeRawUnsafe('ALTER TABLE "VerificationDisposal" DISABLE TRIGGER verification_disposal_after');await tx.$executeRaw`UPDATE "VerificationDisposal" SET "retryAfter"=clock_timestamp()-interval '1 second' WHERE id=${d.id}`;await tx.$executeRawUnsafe('ALTER TABLE "VerificationDisposal" ENABLE TRIGGER verification_disposal_write');await tx.$executeRawUnsafe('ALTER TABLE "VerificationDisposal" ENABLE TRIGGER verification_disposal_after')})
 await disposal.act({id:d.id,version:d.version,action:'reconcile'});await confirm(f);assert.equal((await orders.get(f.order.id)).status,'CONFIRMED')
})

test('checkpoint publication is preview-bound, append-only, administrative and preserves existing profile grants',async()=>{
 const a=await roles.assignment(operator.id),current=await settings().get(),data={version:current.version,definition:emptyCheckpoints()},p=await settings().preview(data)
 await assert.rejects(settings().publish({...data,definition:{...data.definition,roles:['CUSTOMER']},previewHash:p.previewHash}),status(409));await settings().publish({...data,previewHash:p.previewHash});await assert.rejects(settings().publish({...data,previewHash:p.previewHash}),status(409))
 assert.deepEqual((await roles.assignment(operator.id)).accessPolicy,a.accessPolicy)
 await grant(operator,[...operatorPermissions,'verificationCheckpoints.read','verificationCheckpoints.edit']);assert.equal((await settings(operator).get()).canPublish,false);await assert.rejects(settings(operator).preview({version:current.version+1,definition:emptyCheckpoints()}),status(403))
 const row=await root.verificationCheckpointVersion.findFirstOrThrow({where:{tenantId:tenant}});await assert.rejects(root.verificationCheckpointVersion.update({where:{id:row.id},data:{definition:emptyCheckpoints()}}),/immutable/)
})
