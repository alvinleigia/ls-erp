/* eslint-disable @typescript-eslint/no-require-imports */
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto'),fs=require('node:fs'),{Pool}=require('pg'),{PrismaClient}=require('@prisma/client')
const {TenantPgAdapter}=require('../lib/tenant-pg-adapter.ts'),{runWithDatabaseActor}=require('../lib/database-actor.ts')
const {fixtureUser,fixtureProfile,fixtureRole,resetFixtureRoles}=require('./helpers/access-fixtures.cjs')
const {createApplicationCrmService}=require('../application/crm/service.ts'),{applicationSalesOrders}=require('../application/sales-orders/service.ts'),{applicationReceivables}=require('../application/receivables/service.ts'),{applicationPaymentDocuments}=require('../application/payment-documents/service.ts'),{applicationDocumentTemplates}=require('../application/order-documents/service.ts')
const {emptyQuotationContent}=require('../modules/sales-documents/quotation-validation.ts'),{renderBusinessDocument}=require('../platform/documents/pdf.ts'),{starterDocumentLayout}=require('../platform/documents/layout.ts'),{receiptTemplateCatalog}=require('../modules/receivables/receipt-template.ts')
require('../lib/logger.ts').logger.info=()=>{}
const url=new URL(process.env.CRM_TEST_DATABASE_URL||'http://invalid');if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!='/ls_salon_crm_test')throw Error('Disposable localhost database only.')
const tenant='receipt_'+randomUUID(),foreignTenant='receipt_'+randomUUID(),pools=[],clients=[],objects=new Map(),calls={uploads:0,removed:0}
function client(tenantId,bypass=false){const u=new URL(url);if(!bypass){u.username='crm_test_runtime';u.password=''}const pool=new Pool({connectionString:u.toString(),max:5});pools.push(pool);const c=new PrismaClient({adapter:new TenantPgAdapter(pool,{tenantId,bypass})});clients.push(c);return c}
const root=client(undefined,true),db=client(tenant),foreignDb=client(foreignTenant),identity=u=>({tenantId:u.tenantId,userId:u.id}),status=n=>e=>e.status===n
const storage={async upload(t,p,id,bytes){calls.uploads++;const path=`${t}/receipts/${p}/${id}/${randomUUID()}.pdf`;objects.set(path,Buffer.from(bytes));return{path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}},async remove(path){calls.removed++;objects.delete(path)},async url(path){assert(objects.has(path));return 'https://receipts.example.test/'+path}}
let admin,staff,manager,outsider,foreign,crm,orders,finance,company,contact,pipeline,stage
const docs=(user=admin,options={},connection=db)=>applicationPaymentDocuments(connection,identity(user),{storage,render:async()=>Buffer.from('%PDF-synthetic'),...options})
const request=(p,extra={})=>({providerKey:'payment-receipt',supersedesId:p.supersedesId,reason:'',previewHash:p.fingerprint,requestKey:randomUUID(),...extra})
async function fixture(amount='30',officeId){
 const create=data=>officeId?root.crmOpportunity.create({data:{...data,tenantId:tenant,officeId,probability:10,expectedCloseOn:new Date(data.expectedCloseOn)}}):crm.createOpportunity(data)
 const d=await create({title:'QA generic sale',contactId:contact.id,assignedUserId:staff.id,pipelineId:pipeline.id,stageId:stage.id,amount:'100',currency:'INR',expectedCloseOn:'2027-01-01'})
 const q=await crm.saveQuotation(d.id,{content:{...structuredClone(emptyQuotationContent),title:'QA service quotation',supplierName:'QA Industries',currency:'INR',lines:[{description:'Shared service',quantity:'1',unit:'each',rate:'100'}],instalments:[{label:'Initial',percent:'20',days:0,note:''},{label:'Balance',percent:'80',days:30,note:''}]}}),o=await orders.create({quotationId:q.id,revision:1,orderedOn:'2026-01-01'})
 await orders.transition(o.id,{action:'confirm',version:1});await finance.open(o.id,{dueDates:[null,null]})
 const payment=await finance.record(o.id,{requestKey:randomUUID(),version:1,amount,receivedOn:'2026-01-01',method:'BANK_TRANSFER',reference:'QA-'+randomUUID(),note:'Internal note not for customer PDF'})
 return {deal:d,order:await orders.get(o.id),payment}
}
before(async()=>{
 await root.tenant.createMany({data:[tenant,foreignTenant].map(id=>({id,slug:id,name:'QA Receipts'}))})
 const user=(tenantId,role)=>fixtureUser(root,{data:{tenantId,role,name:'QA '+role,email:randomUUID()+'@example.test'}})
 admin=await user(tenant,'ADMIN');staff=await user(tenant,'STAFF');manager=await user(tenant,'MANAGER');outsider=await user(tenant,'STAFF');foreign=await user(foreignTenant,'ADMIN')
 await root.tenantModule.createMany({data:[tenant,foreignTenant].flatMap(tenantId=>['crm','salesDocuments','salesOrders','receivables','paymentPlans'].map(key=>({tenantId,key,allowed:true,enabled:true})))})
 crm=createApplicationCrmService(db,identity(admin));orders=applicationSalesOrders(db,identity(admin));finance=applicationReceivables(db,identity(admin))
 contact=await root.crmContact.create({data:{tenantId:tenant,name:'QA Accepted Customer',ownerUserId:staff.id}});pipeline=await root.crmPipeline.create({data:{tenantId:tenant,name:'QA Generic'}});stage=await root.crmStage.create({data:{tenantId:tenant,pipelineId:pipeline.id,name:'Open',kind:'OPEN',probability:10,color:'#123456',position:0}})
 company=await root.businessCompany.findFirstOrThrow({where:{tenantId:tenant}})
 const templates=applicationDocumentTemplates(db,identity(admin)),current=await templates.get(company.id,'payment-receipt')
 const layout=starterDocumentLayout(receiptTemplateCatalog);layout.content.unshift({type:'paragraph',content:[{type:'text',text:'Dear '},{type:'documentField',attrs:{key:'customer.name'}}]})
 await templates.publish({companyId:company.id,providerKey:'payment-receipt',version:0,reviewed:true,content:{...current.content,enabled:true,address:'QA office, Pune',layout}})
})
after(async()=>{await Promise.all(clients.map(c=>c.$disconnect()));await Promise.all(pools.map(p=>p.end()))})

test('partial-payment source uses frozen customers, exact paid amount and allocations without changing ledger or consuming a number',async()=>{
 const f=await fixture(),s=docs(),before=await finance.get(f.order.id),count=await root.orderReceiptDocument.count({where:{tenantId:tenant}}),counter=await root.receiptDocumentSequence.findUnique({where:{tenantId:tenant}})
 const p=await s.prepare(f.payment.id,{providerKey:'payment-receipt'});assert.equal(p.evidence.amount,'30');assert.equal(p.evidence.currency,'INR');assert.deepEqual(p.evidence.allocations.map(r=>r.amount),['20','10']);assert.match(p.payload.body[0].runs.map(r=>r.text).join(''),/QA Accepted Customer/)
 assert(!JSON.stringify(p.payload).includes('Internal note'));assert(!JSON.stringify(p.payload).includes('outstanding'))
 await s.preview(f.payment.id,{providerKey:'payment-receipt',previewHash:p.fingerprint});assert.equal(await root.orderReceiptDocument.count({where:{tenantId:tenant}}),count);assert.deepEqual(await root.receiptDocumentSequence.findUnique({where:{tenantId:tenant}}),counter)
 const after=await finance.get(f.order.id);assert.equal(after.paid.toString(),before.paid.toString());assert.equal(after.account.version,before.account.version)
 await assert.rejects(s.prepare(f.payment.id,{providerKey:'real-estate.unit-allotment'}),status(400));await assert.rejects(s.prepare('missing',{providerKey:'payment-receipt'}),status(404))
})
test('issuance and concurrent retries archive one exact file; replacement retains its number and original bytes',async()=>{
 const f=await fixture(),s=docs(),p=await s.prepare(f.payment.id,{providerKey:'payment-receipt'}),input=request(p),[a,b]=await Promise.all([s.issue(f.payment.id,input),s.issue(f.payment.id,input)])
 assert.equal(a.id,b.id);const original=Buffer.from(objects.get(a.archive.path));assert.match(a.reference,/^RCT\/\d{6}\/V1$/)
 const args={providerKey:'payment-receipt',supersedesId:a.id,reason:'Correct company wording'},next=await s.prepare(f.payment.id,args),replacement=await s.issue(f.payment.id,request(next,args))
 assert.equal(replacement.sequence,a.sequence);assert.equal(replacement.version,2);assert.equal(replacement.supersedesId,a.id);assert.deepEqual(objects.get(a.archive.path),original)
 assert.equal((await s.list(f.payment.id)).total,2);await s.download(f.payment.id,a.id,'payment-receipt')
 await assert.rejects(s.prepare(f.payment.id,{providerKey:'payment-receipt'}),status(409));await assert.rejects(root.orderReceiptDocument.update({where:{tenantId_id:{tenantId:tenant,id:a.id}},data:{reason:'Rewrite'}}),/immutable/);await assert.rejects(root.orderReceiptDocument.delete({where:{tenantId_id:{tenantId:tenant,id:a.id}}}),/immutable/)
})
test('different payments get distinct sequential numbers and a stale prospective number requires review',async()=>{
 const a=await fixture(),b=await fixture(),s=docs(),pa=await s.prepare(a.payment.id,{providerKey:'payment-receipt'}),pb=await s.prepare(b.payment.id,{providerKey:'payment-receipt'})
 const first=await s.issue(a.payment.id,request(pa));await assert.rejects(s.issue(b.payment.id,request(pb)),status(409));const fresh=await s.prepare(b.payment.id,{providerKey:'payment-receipt'}),second=await s.issue(b.payment.id,request(fresh));assert.equal(second.sequence,first.sequence+1);assert.notEqual(first.reference,second.reference)
 await assert.rejects(db.receiptDocumentSequence.findMany())
})
test('reversal blocks new issuance and silent original downloads; explicit historical download preserves the file',async()=>{
 const f=await fixture(),s=docs(),p=await s.prepare(f.payment.id,{providerKey:'payment-receipt'}),input=request(p),a=await s.issue(f.payment.id,input),bytes=Buffer.from(objects.get(a.archive.path)),state=await finance.get(f.order.id)
 await finance.reverse(f.order.id,f.payment.id,{requestKey:randomUUID(),version:state.account.version,kind:'REFUND',reason:'QA refund',reference:'QA-REFUND',effectiveOn:'2026-01-01'})
 const listed=await s.list(f.payment.id);assert.equal(listed.canIssue,false);assert.equal(listed.historical,true);assert.match(listed.notice,/reversed/)
 await assert.rejects(s.prepare(f.payment.id,{providerKey:'payment-receipt',supersedesId:a.id,reason:'New wording'}),status(409));await assert.rejects(s.issue(f.payment.id,input),status(409));await assert.rejects(s.download(f.payment.id,a.id,'payment-receipt'),status(409));await s.download(f.payment.id,a.id,'payment-receipt',true);assert.deepEqual(objects.get(a.archive.path),bytes)
})
test('payment reversal during rendering invalidates the prepared facts and removes the unused object',async()=>{
 const f=await fixture(),base=docs(),p=await base.prepare(f.payment.id,{providerKey:'payment-receipt'}),before=calls.removed
 const s=docs(admin,{render:async()=>{const state=await finance.get(f.order.id);await finance.reverse(f.order.id,f.payment.id,{requestKey:randomUUID(),version:state.account.version,kind:'CORRECTION',reason:'QA correction',reference:'',effectiveOn:'2026-01-01'});return Buffer.from('%PDF-race')}})
 await assert.rejects(s.issue(f.payment.id,request(p)),status(409));assert.equal(await root.orderReceiptDocument.count({where:{tenantId:tenant,paymentId:f.payment.id}}),0);assert.equal(calls.removed,before+1)
})
test('tenant, owner, action, Read and export bounds plus current activation remain mandatory',async()=>{
 const f=await fixture(),s=docs();await docs(staff).prepare(f.payment.id,{providerKey:'payment-receipt'});await assert.rejects(docs(outsider).list(f.payment.id),status(404));await assert.rejects(docs(foreign,{},foreignDb).list(f.payment.id),status(404))
 assert.equal(await runWithDatabaseActor(foreign.id,()=>foreignDb.orderReceiptDocument.count({where:{paymentId:f.payment.id}})),0)
 const profile=await fixtureProfile(root,{data:{tenantId:tenant,name:'QA receipt viewer',nameKey:randomUUID(),permissions:['paymentDocuments.read','paymentDocuments.export','orderPayments.read','receivables.read','salesOrders.read']}});await fixtureRole(root,{data:{tenantId:tenant,userId:staff.id,roleId:profile.id}})
 try{await docs(staff).list(f.payment.id);await assert.rejects(docs(staff).prepare(f.payment.id,{providerKey:'payment-receipt'}),status(403))}finally{await resetFixtureRoles(root,{where:{tenantId:tenant,userId:staff.id}})}
 const policy=await root.tenantUserAccess.findUniqueOrThrow({where:{tenantId_userId:{tenantId:tenant,userId:staff.id}}})
 try{for(const permission of ['paymentDocuments.export','orderPayments.read','receivables.read','salesOrders.read']){await root.tenantUserAccess.update({where:{tenantId_userId:{tenantId:tenant,userId:staff.id}},data:{rules:{...policy.rules,[permission]:'NONE'}}});await assert.rejects(docs(staff).prepare(f.payment.id,{providerKey:'payment-receipt'}),e=>[403,404].includes(e.status))}}finally{await root.tenantUserAccess.update({where:{tenantId_userId:{tenantId:tenant,userId:staff.id}},data:{rules:policy.rules}})}
 await root.tenantModule.update({where:{tenantId_key:{tenantId:tenant,key:'receivables'}},data:{enabled:false}});try{await assert.rejects(s.list(f.payment.id),status(403))}finally{await root.tenantModule.update({where:{tenantId_key:{tenantId:tenant,key:'receivables'}},data:{enabled:true}})}
})
test('failed audit rolls back receipt number and history and removes the uncommitted object',async()=>{
 const f=await fixture(),p=await docs().prepare(f.payment.id,{providerKey:'payment-receipt'}),counter=await root.receiptDocumentSequence.findUnique({where:{tenantId:tenant}}),before=objects.size
 const broken=new Proxy(db,{get(target,key){if(key==='$transaction')return(fn,options)=>target.$transaction(tx=>fn(new Proxy(tx,{get(t,k){if(k==='auditLog')return new Proxy(t.auditLog,{get(a,m){return m==='createMany'?async()=>{throw Error('QA audit unavailable')}:a[m]}});return t[k]}})),options);return target[key]}})
 await assert.rejects(docs(admin,{},broken).issue(f.payment.id,request(p)),/QA audit unavailable/);assert.equal(objects.size,before);assert.equal(await root.orderReceiptDocument.count({where:{tenantId:tenant,paymentId:f.payment.id}}),0);assert.deepEqual(await root.receiptDocumentSequence.findUnique({where:{tenantId:tenant}}),counter)
})
test('restricted upstream sources and native offices bound receipt browsing, numbering and archived downloads',async()=>{
 const f=await fixture(),s=docs(),p=await s.prepare(f.payment.id,{providerKey:'payment-receipt'}),row=await s.issue(f.payment.id,request(p));await docs(manager).list(f.payment.id)
 const sharing=require('../platform/access/sharing-service.ts').createRecordSharingService(db,identity(admin)),current=await sharing.get('opportunities',f.deal.id)
 await sharing.save('opportunities',f.deal.id,{version:current.version,restricted:true,grants:[]});await assert.rejects(docs(manager).download(f.payment.id,row.id,'payment-receipt'),status(404));assert.equal(await runWithDatabaseActor(manager.id,()=>db.orderReceiptDocument.count({where:{paymentId:f.payment.id}})),0)
 assert.equal((await runWithDatabaseActor(manager.id,()=>db.$queryRaw`SELECT app.receipt_document_next(${tenant},${f.payment.id}) AS number`))[0].number,null)
 const office=await root.businessOffice.create({data:{tenantId:tenant,companyId:company.id,name:'QA restricted office',code:'QA-RECEIPT-HIDDEN'}}),hidden=await fixture('30',office.id),prepared=await s.prepare(hidden.payment.id,{providerKey:'payment-receipt'}),issued=await s.issue(hidden.payment.id,request(prepared))
 await assert.rejects(docs(staff).list(hidden.payment.id),status(404));await assert.rejects(docs(staff).download(hidden.payment.id,issued.id,'payment-receipt'),status(404));assert.equal(await runWithDatabaseActor(staff.id,()=>db.orderReceiptDocument.count({where:{paymentId:hidden.payment.id}})),0)
})
test('real receipt rendering uses the shared layout engine and source-owned payment facts',async()=>{
 const f=await fixture(),s=docs(admin,{render:renderBusinessDocument}),p=await s.prepare(f.payment.id,{providerKey:'payment-receipt'}),bytes=await s.preview(f.payment.id,{providerKey:'payment-receipt',previewHash:p.fingerprint});assert.equal(Buffer.from(bytes).subarray(0,5).toString(),'%PDF-')
 fs.mkdirSync('tmp/payment-receipts',{recursive:true});fs.writeFileSync('tmp/payment-receipts/receipt-preview.pdf',bytes)
 const issued=await s.issue(f.payment.id,request(p));assert.equal(objects.get(issued.archive.path).subarray(0,5).toString(),'%PDF-');assert.equal(issued.snapshot.evidence.amount,'30')
 const raw=await root.orderReceiptDocument.findUnique({where:{tenantId_id:{tenantId:tenant,id:issued.id}}}),id=randomUUID(),reference=raw.reference.replace('/V1','/V2'),snapshot=structuredClone(raw.snapshot);snapshot.payload.reference=reference;snapshot.evidence.amount='999'
 await assert.rejects(root.orderReceiptDocument.create({data:{...raw,id,version:2,reference,supersedesId:raw.id,reason:'QA invalid amount',requestKey:randomUUID(),snapshot,archive:{...raw.archive,path:`${tenant}/receipts/${f.payment.id}/${id}/${randomUUID()}.pdf`}}}),/exact posted payment evidence/)
})
