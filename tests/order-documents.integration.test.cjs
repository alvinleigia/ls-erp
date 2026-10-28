/* eslint-disable @typescript-eslint/no-require-imports */
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto'),fs=require('node:fs'),{Pool}=require('pg'),{PrismaClient}=require('@prisma/client')
const {fixtureUser,fixtureRole,fixtureProfile,resetFixtureRoles}=require('./helpers/access-fixtures.cjs'),{materializeRules}=require('./helpers/resource-policy-data.cjs')
const {TenantPgAdapter}=require('../lib/tenant-pg-adapter.ts'),{runWithDatabaseActor}=require('../lib/database-actor.ts')
const {createApplicationCrmService}=require('../application/crm/service.ts'),{applicationSalesOrders}=require('../application/sales-orders/service.ts')
const {applicationOrderDocuments,applicationDocumentTemplates}=require('../application/order-documents/service.ts')
const {applicationCatalog}=require('../application/catalog/service.ts'),{applicationReservations}=require('../application/catalog/reservations.ts'),{applicationReceivables}=require('../application/receivables/service.ts')
const {createRecordSharingService}=require('../platform/access/sharing-service.ts'),{emptyQuotationContent}=require('../modules/sales-documents/quotation-validation.ts'),{renderBusinessDocument}=require('../platform/documents/pdf.ts')
require('../lib/logger.ts').logger.info=()=>{}
const url=new URL(process.env.CRM_TEST_DATABASE_URL||'http://invalid')
if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!='/ls_salon_crm_test')throw Error('Disposable local database only.')
const tenant='documents_'+randomUUID(),foreignTenant='documents_'+randomUUID(),pools=[],clients=[]
function client(tenantId,root=false){const u=new URL(url);if(!root){u.username='crm_test_runtime';u.password=''}const pool=new Pool({connectionString:u.toString(),max:6});pools.push(pool);const db=new PrismaClient({adapter:new TenantPgAdapter(pool,{tenantId,bypass:root})});clients.push(db);return db}
const root=client(undefined,true),db=client(tenant),foreignDb=client(foreignTenant),identity=u=>({tenantId:u.tenantId,userId:u.id}),status=code=>e=>e.status===code
const ACK='order-acknowledgement',BI='real-estate.booking-intimation',UA='real-estate.unit-allotment',objects=new Map(),calls={uploads:0,removals:0,urls:0}
const storage={async upload(t,source,id,bytes){calls.uploads++;const path=`${t}/orders/${source}/${id}/${randomUUID()}.pdf`;objects.set(path,Buffer.from(bytes));return {path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}},async remove(path){calls.removals++;objects.delete(path)},async url(path){calls.urls++;assert(objects.has(path));return 'https://documents.example.test/'+path}}
const fakeRender=async()=>Buffer.from('%PDF-synthetic')
let admin,staff,outsider,foreign,crm,orders,catalog,reservations,finance,company,project,category,contact,additional,secondApplicant,pipeline,stage
const docs=(user=admin,options={},connection=db)=>applicationOrderDocuments(connection,identity(user),{storage,render:fakeRender,...options})
const templates=(user=admin,connection=db)=>applicationDocumentTemplates(connection,identity(user))
const content=(items=[])=>({...structuredClone(emptyQuotationContent),title:'QA accepted agreement',supplierName:'QA Shared Company',currency:'INR',lines:items.length?items.map(item=>({description:item.name,quantity:'1',unit:'each',rate:String(item.price),catalogItemId:item.id,catalogItemVersion:item.version})):[{description:'Shared service',quantity:'1',unit:'each',rate:'300'}]})
async function fixture(items=[],confirmed=true,details={}){const d=await crm.createOpportunity({title:'QA source',contactId:contact.id,assignedUserId:staff.id,pipelineId:pipeline.id,stageId:stage.id,amount:'300',currency:'INR',expectedCloseOn:'2027-01-01'});await crm.replaceOpportunityParticipants(d.id,{version:1,participants:[{role:'ADDITIONAL_CUSTOMER',party:{kind:'PERSON',id:additional.id}},{role:'ADDITIONAL_CUSTOMER',party:{kind:'PERSON',id:secondApplicant.id}}]});const q=await crm.saveQuotation(d.id,{content:{...content(items),...details}}),o=await orders.create({quotationId:q.id,revision:1,orderedOn:'2026-01-01'});if(confirmed)await orders.transition(o.id,{action:'confirm',version:1});return {deal:d,quote:q,order:await orders.get(o.id),items}}
async function publish(key=ACK,patch={}){const current=await templates().get(company.id,key);await templates().publish({companyId:company.id,providerKey:key,version:current.version,content:{...current.content,enabled:true,address:'QA operating office\nPune, India',contact:'qa@example.test',terms:'QA approved terms. Pending charges require separate confirmation.',...patch},reviewed:true});return templates().get(company.id,key)}
const input=(p,extra={})=>({providerKey:p.providerKey,supersedesId:p.supersedesId,reason:'',previewHash:p.fingerprint,requestKey:randomUUID(),...extra})
async function propertyFixture(count=2,pending=false){const items=[];for(let i=0;i<count;i++)items.push(await catalog.save({code:'QA-'+randomUUID(),name:'QA Property '+(i+1),kind:'UNIT',price:String(100*(i+1)),currency:'INR',unit:'each',extensionKey:'realEstate',extension:{projectId:project.id,categoryId:category.id,area:String(1200+i*100),areaUnit:'SQ_FT',bedrooms:2}}));return fixture(items,true,{charges:pending?[{label:'Statutory charges',group:'',kind:'TBD',value:'0',basis:'BASE',included:false,due:'On confirmation by issuer'}]:[],instalments:[{label:'Initial instalment',percent:'25',days:0,note:'Agreed schedule'},{label:'Final instalment',percent:'75',days:30,note:''}]})}
async function holdAll(f){return Promise.all(f.items.map(item=>reservations.create(f.order.id,{itemId:item.id,expiresAt:new Date(Date.now()+86400000).toISOString()})))}
async function allocateAll(f){const held=await holdAll(f);for(const row of held)await reservations.transition(f.order.id,row.id,{action:'allocate',version:row.version})}
function proxyTransaction(wrap){return new Proxy(db,{get(target,key){if(key==='$transaction')return (fn,options)=>target.$transaction(tx=>fn(wrap(tx)),options);return target[key]}})}
function auditFailure(){return proxyTransaction(tx=>new Proxy(tx,{get(t,k){if(k==='auditLog')return new Proxy(t.auditLog,{get(a,m){return m==='createMany'?async()=>{throw Error('Audit unavailable')}:a[m]}});return t[k]}}))}
before(async()=>{
 await root.tenant.createMany({data:[tenant,foreignTenant].map(id=>({id,slug:id,name:id}))})
 const user=(tenantId,role)=>fixtureUser(root,{data:{tenantId,role,name:'QA '+role,email:randomUUID()+'@example.test'}})
 admin=await user(tenant,'ADMIN');staff=await user(tenant,'STAFF');outsider=await user(tenant,'STAFF');foreign=await user(foreignTenant,'ADMIN')
 await root.tenantModule.createMany({data:['crm','salesDocuments','salesOrders','catalog','realEstate','receivables','paymentPlans'].map(key=>({tenantId:tenant,key,allowed:true,enabled:true}))})
 crm=createApplicationCrmService(db,identity(admin));orders=applicationSalesOrders(db,identity(admin));catalog=applicationCatalog(db,identity(admin));reservations=applicationReservations(db,identity(admin));finance=applicationReceivables(db,identity(admin))
 contact=await root.crmContact.create({data:{tenantId:tenant,name:'QA Primary applicant',ownerUserId:staff.id,email:'primary@example.test'}})
 additional=await root.crmContact.create({data:{tenantId:tenant,name:'QA Additional applicant',ownerUserId:staff.id,email:'additional@example.test'}})
 secondApplicant=await root.crmContact.create({data:{tenantId:tenant,name:'QA Second co-applicant',ownerUserId:staff.id}})
 pipeline=await root.crmPipeline.create({data:{tenantId:tenant,name:'QA sales'}});stage=await root.crmStage.create({data:{tenantId:tenant,pipelineId:pipeline.id,name:'Open',position:0,kind:'OPEN',probability:10,color:'#123456'}})
 company=await root.businessCompany.findFirstOrThrow({where:{tenantId:tenant}})
 await root.businessCompany.update({where:{tenantId_id:{tenantId:tenant,id:company.id}},data:{name:'QA Shared Industries'}})
 project=await root.realEstateProject.create({data:{tenantId:tenant,name:'QA Common Gardens',code:'QA-CG',location:'QA Pune'}})
 category=await root.realEstatePropertyCategory.findUniqueOrThrow({where:{tenantId_nameKey:{tenantId:tenant,nameKey:'apartment'}}})
 for(const key of [ACK,BI,UA])await publish(key)
})
after(async()=>{await Promise.all(clients.map(c=>c.$disconnect()));await Promise.all(pools.map(p=>p.end()))})

test('generic provider works with Real Estate disabled; preview is runtime-only and issuance retries reuse exact stored bytes',async()=>{
 await root.tenantModule.update({where:{tenantId_key:{tenantId:tenant,key:'realEstate'}},data:{enabled:false}})
 try{const f=await fixture(),s=docs(),p=await s.prepare(f.order.id,{providerKey:ACK});assert.equal(p.payload.blocks.filter(b=>b.title==='QA Additional applicant').length,1)
 const before=calls.uploads;await s.preview(f.order.id,{providerKey:ACK,previewHash:p.fingerprint});assert.equal(calls.uploads,before)
 const request=input(p),row=await s.issue(f.order.id,request),bytes=objects.get(row.archive.path);assert.equal(row.version,1);assert.equal((await s.issue(f.order.id,request)).id,row.id);assert.equal(calls.uploads,before+1)
 await root.crmContact.update({where:{id:additional.id},data:{name:'QA renamed source'}});await publish(ACK,{terms:'New reviewed wording'})
 await s.download(f.order.id,row.id,ACK);assert.deepEqual(objects.get(row.archive.path),bytes);assert.equal(row.snapshot.payload.terms.includes('New reviewed wording'),false)
 await assert.rejects(s.issue(f.order.id,{...request,reason:'Different payload'}),status(409))
 assert.equal((await s.list(f.order.id)).total,1);assert.equal(await root.auditLog.count({where:{entityId:f.order.id,event:'salesOrder.document.issued'}}),1)
 }finally{await root.tenantModule.update({where:{tenantId_key:{tenantId:tenant,key:'realEstate'}},data:{enabled:true}});await root.crmContact.update({where:{id:additional.id},data:{name:'QA Additional applicant'}})}
})

test('templates require real administrator publication, immutable versions and explicit conflict review',async()=>{
 const current=await templates().get(company.id,ACK),proposal={companyId:company.id,providerKey:ACK,version:current.version,content:current.content,reviewed:true}
 await assert.rejects(templates(staff).publish(proposal),status(403))
 await templates().publish(proposal);await assert.rejects(templates().publish(proposal),status(409))
 await assert.rejects(root.businessDocumentTemplate.update({where:{tenantId_companyId_providerKey_version:{tenantId:tenant,companyId:company.id,providerKey:ACK,version:current.version}},data:{content:{...current.content,title:'Changed'}}}),/immutable/)
 await assert.rejects(root.businessDocumentTemplate.delete({where:{tenantId_companyId_providerKey_version:{tenantId:tenant,companyId:company.id,providerKey:ACK,version:current.version}}}),/immutable/)
 const hidden=await root.businessCompany.create({data:{tenantId:tenant,name:'QA unpublished company',code:'UNPUB'}})
 const profile=await fixtureProfile(root,{data:{tenantId:tenant,name:'Template reader',nameKey:randomUUID(),permissions:['documentTemplates.read','documentTemplates.edit']}});await fixtureRole(root,{data:{tenantId:tenant,userId:staff.id,roleId:profile.id}})
 try{const listing=await templates(staff).catalog({pageSize:1});assert.equal(listing.total,1);assert.equal(listing.canPublish,false);assert.equal(listing.items[0].id,company.id);assert.equal((await templates(staff).catalog({q:hidden.name})).total,0);await assert.rejects(templates(staff).get(hidden.id,ACK),status(404));await templates(staff).get(company.id,ACK);await assert.rejects(templates(staff).publish({...proposal,version:current.version+1}),status(403))}finally{await resetFixtureRoles(root,{where:{tenantId:tenant,userId:staff.id}})}
 const now=await templates().get(company.id,ACK);await assert.rejects(templates(admin,auditFailure()).publish({...proposal,version:now.version}),/Audit unavailable/);assert.equal((await templates().get(company.id,ACK)).version,now.version)
})

test('replacement chains retain originals, require latest predecessor/reason and reject native mutations',async()=>{
 const f=await fixture(),s=docs(),p=await s.prepare(f.order.id,{providerKey:ACK}),a=await s.issue(f.order.id,input(p))
 await assert.rejects(s.prepare(f.order.id,{providerKey:ACK,supersedesId:a.id,reason:''}))
 const r={providerKey:ACK,supersedesId:a.id,reason:'Correct reviewed contact wording'},next=await s.prepare(f.order.id,r),b=await s.issue(f.order.id,input(next,r))
 assert.equal(b.version,2);assert.equal(b.supersedesId,a.id);assert.equal((await s.list(f.order.id)).latest[0].id,b.id);await s.download(f.order.id,a.id,ACK)
 await assert.rejects(s.prepare(f.order.id,r),status(409));await assert.rejects(s.prepare(f.order.id,{providerKey:ACK}),status(409))
 await assert.rejects(root.salesOrderDocument.update({where:{tenantId_id:{tenantId:tenant,id:a.id}},data:{reason:'Rewrite'}}),/immutable/);await assert.rejects(root.salesOrderDocument.delete({where:{tenantId_id:{tenantId:tenant,id:a.id}}}),/immutable/)
 const raw=await root.salesOrderDocument.findUnique({where:{tenantId_id:{tenantId:tenant,id:b.id}}});delete raw.id;delete raw.createdAt
 for(const patch of [{orderId:'missing'},{companyId:'missing'},{version:9},{requestHash:'bad'},{archive:{path:'foreign/file.pdf'}},{snapshot:{}},{supersedesId:a.id,version:3}]){
  const id=randomUUID(),reference=`${f.order.reference}/ACK/003`,snapshot=structuredClone(raw.snapshot);snapshot.payload.reference=reference
  await assert.rejects(root.salesOrderDocument.create({data:{...raw,id,version:3,supersedesId:b.id,requestKey:randomUUID(),reference,snapshot,archive:{...raw.archive,path:`${tenant}/orders/${f.order.id}/${id}/${randomUUID()}.pdf`},...patch}}))
 }
 assert.equal(await runWithDatabaseActor(foreign.id,()=>foreignDb.salesOrderDocument.count({where:{orderId:f.order.id}})),0)
 assert.deepEqual(await runWithDatabaseActor(foreign.id,()=>foreignDb.$queryRaw`SELECT * FROM app.document_source_issuer(${tenant},${f.order.id})`),[])
 await orders.transition(f.order.id,{action:'cancel',version:2,reason:'Keep issued history'});await s.download(f.order.id,a.id,ACK)
})

test('concurrent retries and competing previews issue once, cleaning losing candidate objects',async()=>{
 const f=await fixture(),s=docs(),p=await s.prepare(f.order.id,{providerKey:ACK}),request=input(p),before=objects.size
 const same=await Promise.all([s.issue(f.order.id,request),s.issue(f.order.id,request)]);assert.equal(same[0].id,same[1].id);assert.equal(objects.size,before+1)
 const g=await fixture(),q=await s.prepare(g.order.id,{providerKey:ACK}),race=await Promise.allSettled([s.issue(g.order.id,input(q)),s.issue(g.order.id,input(q))]);assert.equal(race.filter(r=>r.status==='fulfilled').length,1);assert.equal(race.find(r=>r.status==='rejected').reason.status,409)
 assert.equal(await root.salesOrderDocument.count({where:{orderId:g.order.id}}),1);assert.equal(objects.size,before+2)
})

test('failed audit removes the rolled-back upload; lost commit acknowledgement keeps the committed file and retry resolves it',async()=>{
 const f=await fixture(),p=await docs().prepare(f.order.id,{providerKey:ACK}),request=input(p),before=objects.size
 await assert.rejects(docs(admin,{},auditFailure()).issue(f.order.id,request),/Audit unavailable/);assert.equal(objects.size,before);assert.equal(await root.salesOrderDocument.count({where:{orderId:f.order.id}}),0)
 let lost=false;const ambiguous=new Proxy(db,{get(target,key){if(key==='$transaction')return async(fn,options)=>{const value=await target.$transaction(fn,options);if(value?.archive&&!lost){lost=true;throw Error('Lost commit acknowledgement')}return value};return target[key]}})
 await assert.rejects(docs(admin,{},ambiguous).issue(f.order.id,request),/Lost commit/);assert.equal(objects.size,before+1)
 const uploads=calls.uploads,retry=await docs().issue(f.order.id,request);assert(objects.has(retry.archive.path));assert.equal(calls.uploads,uploads)
})

test('rechecks after rendering reject changed templates, disabled modules and revoked action/profile without issuance',async()=>{
 for(const change of ['template','module','profile']){
  const f=await fixture(),user=change==='profile'?staff:admin,s=docs(user),p=await s.prepare(f.order.id,{providerKey:ACK}),before=objects.size
  const mutate=async()=>{if(change==='template')await publish(ACK,{terms:'New wording '+randomUUID()});if(change==='module')await root.tenantModule.update({where:{tenantId_key:{tenantId:tenant,key:'salesOrders'}},data:{enabled:false}});if(change==='profile'){const role=await fixtureProfile(root,{data:{tenantId:tenant,name:'Read only',nameKey:randomUUID(),permissions:['salesOrders.read','orderDocuments.read']}});await fixtureRole(root,{data:{tenantId:tenant,userId:staff.id,roleId:role.id}})}return fakeRender()}
  try{await assert.rejects(docs(user,{render:mutate}).issue(f.order.id,input(p)),status(change==='template'?409:403));assert.equal(await root.salesOrderDocument.count({where:{orderId:f.order.id}}),0);assert.equal(objects.size,before)}finally{await root.tenantModule.update({where:{tenantId_key:{tenantId:tenant,key:'salesOrders'}},data:{enabled:true}});await resetFixtureRoles(root,{where:{tenantId:tenant,userId:staff.id}})}
 }
})

test('source privacy, separate parent Read, record None and native office boundaries are preserved',async()=>{
 const f=await fixture(),s=docs(),p=await s.prepare(f.order.id,{providerKey:ACK}),row=await s.issue(f.order.id,input(p)),sharing=createRecordSharingService(db,identity(admin)),v=await sharing.get('opportunities',f.deal.id)
 await sharing.save('opportunities',f.deal.id,{version:v.version,restricted:true,grants:[]});await assert.rejects(docs(outsider).list(f.order.id),status(404));assert.equal(await runWithDatabaseActor(outsider.id,()=>db.salesOrderDocument.count({where:{orderId:f.order.id}})),0)
 assert.deepEqual(await runWithDatabaseActor(outsider.id,()=>db.$queryRaw`SELECT * FROM app.document_source_issuer(${tenant},${f.order.id})`),[])
 assert.equal(await runWithDatabaseActor(staff.id,()=>db.businessCompany.count({where:{tenantId:tenant}})),0)
 const profile=await fixtureProfile(root,{data:{tenantId:tenant,name:'Only child',nameKey:randomUUID(),permissions:['orderDocuments.read','orderDocuments.create','orderDocuments.export']}});await fixtureRole(root,{data:{tenantId:tenant,userId:staff.id,roleId:profile.id}})
 try{await assert.rejects(docs(staff).download(f.order.id,row.id,ACK),status(403));await root.tenantAccessRole.update({where:{id:profile.id},data:{permissions:['salesOrders.read','orderDocuments.read','orderDocuments.create','orderDocuments.export']}});await root.tenantUserAccess.update({where:{tenantId_userId:{tenantId:tenant,userId:staff.id}},data:{rules:{...materializeRules('STAFF'),'orderDocuments.read':'NONE'}}});await assert.rejects(docs(staff).list(f.order.id),status(403))}finally{await resetFixtureRoles(root,{where:{tenantId:tenant,userId:staff.id}})}
 const office=await root.businessOffice.create({data:{tenantId:tenant,companyId:company.id,name:'No staff membership',code:'DOC-HIDDEN'}})
 const d=await root.crmOpportunity.create({data:{tenantId:tenant,officeId:office.id,title:'Hidden office order',contactId:contact.id,assignedUserId:staff.id,pipelineId:pipeline.id,stageId:stage.id,amount:300,currency:'INR',probability:10,expectedCloseOn:new Date('2027-01-01')}})
 const q=await crm.saveQuotation(d.id,{content:content()}),o=await orders.create({quotationId:q.id,revision:1});await orders.transition(o.id,{action:'confirm',version:1});const pp=await s.prepare(o.id,{providerKey:ACK}),rr=await s.issue(o.id,input(pp));await assert.rejects(docs(staff).download(o.id,rr.id,ACK),status(404));assert.equal(await runWithDatabaseActor(staff.id,()=>db.salesOrderDocument.count({where:{orderId:o.id}})),0)
})

test('property letters require saved property evidence and owned live reservations; allocation and money remain separate',async()=>{
 const f=await propertyFixture(),s=docs();await assert.rejects(s.prepare(f.order.id,{providerKey:BI}),status(409));await assert.rejects(s.prepare(f.order.id,{providerKey:UA}),status(409))
 await holdAll(f);const p=await s.prepare(f.order.id,{providerKey:BI});assert.equal(p.evidence.allocations.length,2);assert.equal(p.payload.blocks.find(b=>b.title==='Booked property units').table.rows.length,2)
 fs.mkdirSync('tmp/pdfs',{recursive:true});fs.writeFileSync('tmp/pdfs/p5-booking-intimation.pdf',await renderBusinessDocument(p.payload))
 const issued=await s.issue(f.order.id,input(p));assert.equal(issued.providerKey,BI)
 await allocateAll(f);const unopened=await s.prepare(f.order.id,{providerKey:UA});assert.equal(unopened.evidence.financial.total,null);assert.match(unopened.payload.blocks.find(b=>b.title==='Financial position').paragraphs[0],/not verified/)
 await finance.open(f.order.id,{dueDates:[null,null]});await finance.record(f.order.id,{requestKey:randomUUID(),version:1,amount:'100',receivedOn:'2026-01-01',method:'CASH',reference:'QA',note:''})
 const allotted=await s.prepare(f.order.id,{providerKey:UA});assert.equal(allotted.evidence.financial.lines.length,2);assert(allotted.payload.blocks.some(b=>b.title==='QA Second co-applicant'));assert.equal(allotted.evidence.financial.total,'300');assert.equal(allotted.evidence.financial.paid,'100');assert.equal(allotted.evidence.financial.outstanding,'200');fs.writeFileSync('tmp/pdfs/p5-unit-allotment.pdf',await renderBusinessDocument(allotted.payload));const ua=await s.issue(f.order.id,input(allotted))
 assert.equal(String((await orders.get(f.order.id)).consideration),'300');assert.equal(await root.orderReceipt.count({where:{orderId:f.order.id}}),1)
 const profile=await fixtureProfile(root,{data:{tenantId:tenant,name:'No financial access',nameKey:randomUUID(),permissions:['salesOrders.read','orderDocuments.read','orderDocuments.create','orderDocuments.export','projects.read','catalogItems.read','unitReservations.read']}});await fixtureRole(root,{data:{tenantId:tenant,userId:staff.id,roleId:profile.id}})
 try{await assert.rejects(docs(staff).prepare(f.order.id,{providerKey:UA,supersedesId:ua.id,reason:'Replacement'}),status(403));await assert.rejects(docs(staff).download(f.order.id,ua.id,UA),status(403));assert.equal((await docs(staff).list(f.order.id)).items.some(r=>r.providerKey===UA),false)}finally{await resetFixtureRoles(root,{where:{tenantId:tenant,userId:staff.id}})}
 await root.tenantModule.update({where:{tenantId_key:{tenantId:tenant,key:'realEstate'}},data:{enabled:false}});try{await assert.rejects(s.download(f.order.id,issued.id,BI),status(403));assert.equal((await s.list(f.order.id)).total,0)}finally{await root.tenantModule.update({where:{tenantId_key:{tenantId:tenant,key:'realEstate'}},data:{enabled:true}})}
})

test('Create and Export bounds intersect, and property reservations retain their independent Read scope',async()=>{
 const f=await fixture(),g=await propertyFixture(1);await holdAll(g)
 const profile=await fixtureProfile(root,{data:{tenantId:tenant,name:'Scoped issuer',nameKey:randomUUID(),permissions:['salesOrders.read','orderDocuments.read','orderDocuments.create','orderDocuments.export','projects.read','catalogItems.read','unitReservations.read']}})
 await fixtureRole(root,{data:{tenantId:tenant,userId:outsider.id,roleId:profile.id}})
 const base={...materializeRules('STAFF'),'salesOrders.read':'ALL','orderDocuments.read':'ALL','orderDocuments.create':'ALL','orderDocuments.export':'OWN','unitReservations.read':'ALL','projects.read':'ALL'}
 try{
  await root.tenantUserAccess.update({where:{tenantId_userId:{tenantId:tenant,userId:outsider.id}},data:{rules:base}})
  assert.equal((await docs(outsider).list(f.order.id)).canIssue,false);await assert.rejects(docs(outsider).prepare(f.order.id,{providerKey:ACK}),status(404))
  await root.tenantUserAccess.update({where:{tenantId_userId:{tenantId:tenant,userId:outsider.id}},data:{rules:{...base,'orderDocuments.export':'ALL','unitReservations.read':'OWN'}}})
  const p=await docs(outsider).prepare(f.order.id,{providerKey:ACK}),row=await docs(outsider).issue(f.order.id,input(p));await docs(outsider).download(f.order.id,row.id,ACK)
  await assert.rejects(docs(outsider).prepare(g.order.id,{providerKey:BI}),status(404))
 }finally{await resetFixtureRoles(root,{where:{tenantId:tenant,userId:outsider.id}})}
})

test('property and financial changes during rendering invalidate review; expired holds do not authorize a booking letter',async()=>{
 const f=await propertyFixture(1),held=await holdAll(f),p=await docs().prepare(f.order.id,{providerKey:BI}),before=objects.size
 await assert.rejects(docs(admin,{render:async()=>{await reservations.transition(f.order.id,held[0].id,{action:'release',version:1,reason:'QA source changed'});return fakeRender()}}).issue(f.order.id,input(p)),status(409));assert.equal(objects.size,before)
 await reservations.create(f.order.id,{itemId:f.items[0].id,expiresAt:new Date(Date.now()+1100).toISOString()});await new Promise(r=>setTimeout(r,1200));await assert.rejects(docs().prepare(f.order.id,{providerKey:BI}),status(409))
 await allocateAll(f);await finance.open(f.order.id,{dueDates:[null,null]});const q=await docs().prepare(f.order.id,{providerKey:UA})
 await assert.rejects(docs(admin,{render:async()=>{await finance.record(f.order.id,{requestKey:randomUUID(),version:1,amount:'1',receivedOn:'2026-01-01',method:'CASH',reference:'',note:''});return fakeRender()}}).issue(f.order.id,input(q)),status(409));assert.equal(objects.size,before)
 await root.realEstateUnit.update({where:{tenantId_itemId:{tenantId:tenant,itemId:f.items[0].id}},data:{area:'999'}});await assert.rejects(docs().prepare(f.order.id,{providerKey:UA}),status(409))
})

test('pending charges remain explicit in letters and do not become a fabricated receivable balance',async()=>{
 const f=await propertyFixture(1,true);await allocateAll(f)
 const p=await docs().prepare(f.order.id,{providerKey:UA})
 assert.equal(p.evidence.financial.state,'UNOPENED');assert.equal(p.evidence.financial.total,null)
 assert(p.payload.blocks.some(b=>b.title==='Pending charges'));assert(p.payload.blocks.find(b=>b.title==='Additional charges').table.rows.some(row=>row[1]==='To be confirmed'))
 await assert.rejects(finance.open(f.order.id,{dueDates:[null,null]}),status(409))
 await docs().issue(f.order.id,input(p))
})

test('historical missing property evidence has no live fallback; explicit saved-item refresh is versioned and request-only',async()=>{
 const f=await propertyFixture(1),snapshot=structuredClone(f.order.snapshot);delete snapshot.items[0].documentEvidence
 // Simulate a pre-P5 saved quotation via the native immutable revision fixture.
 const d=await crm.createOpportunity({title:'QA historical source',contactId:contact.id,assignedUserId:staff.id,pipelineId:pipeline.id,stageId:stage.id,amount:'100',currency:'INR',expectedCloseOn:'2027-01-01'})
 const q=await root.crmQuotation.create({data:{tenantId:tenant,opportunityId:d.id,title:snapshot.content.title,currency:'INR',consideration:'100'}});await root.crmQuotationRevision.create({data:{tenantId:tenant,quotationId:q.id,number:1,snapshot}})
 const o=await orders.create({quotationId:q.id,revision:1});await orders.transition(o.id,{action:'confirm',version:1});await reservations.create(o.id,{itemId:f.items[0].id,expiresAt:new Date(Date.now()+86400000).toISOString()});await assert.rejects(docs().prepare(o.id,{providerKey:BI}),status(404))
 const saved=await crm.saveQuotation(d.id,{version:1,content:{...content(f.items),lines:content(f.items).lines.map(row=>({...row,refreshCatalogItem:true}))}},q.id),current=await crm.getQuotation(saved.id)
 assert.equal(current.snapshot.items[0].documentEvidence.key,'realEstate');assert.equal(JSON.stringify(current.snapshot).includes('refreshCatalogItem'),false);assert.equal((await orders.get(o.id)).snapshot.items[0].documentEvidence,undefined)
})
