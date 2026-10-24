/* eslint-disable @typescript-eslint/no-require-imports */
const {fixtureUser,fixtureRole,fixtureProfile,resetFixtureRoles}=require("./helpers/access-fixtures.cjs")
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { Pool } = require('pg')
const { PrismaClient } = require('@prisma/client')
const { TenantPgAdapter } = require('../lib/tenant-pg-adapter.ts')
const { createApplicationCrmService: createCrmService } = require('../application/crm/service.ts')
const { updateBusinessModule } = require('../platform/module-service.ts')
const { emptyQuotationContent } = require('../modules/sales-documents/quotation-validation.ts')
require('../lib/logger.ts').logger.info = () => {}
const url = new URL(process.env.CRM_TEST_DATABASE_URL || 'http://invalid')
if (!['localhost','127.0.0.1'].includes(url.hostname) || url.pathname !== '/ls_salon_crm_test') throw Error('Use only the isolated local CRM test database.')
const tenant = `quotes_${randomUUID()}`, otherTenant = `quotes_${randomUUID()}`, pools = [], clients = [], queries = []
function client(tenantId, root = false) {
 const u = new URL(url); if (!root) {u.username='crm_test_runtime';u.password=''}
 const pool = new Pool({connectionString:u.toString(),max:4});pools.push(pool)
 const db = new PrismaClient({adapter:new TenantPgAdapter(pool,{tenantId,bypass:root}), log:[{emit:'event',level:'query'}]});clients.push(db);db.$on('query',event=>queries.push(event.query));return db
}
const root = client(undefined,true), db = client(tenant), dbB = client(otherTenant), unscoped = client(undefined)
let admin,manager,staff,other,adminB,crm,staffCrm,otherCrm,foreign,deal,contact,project
const status = code => error => error.status === code
const content = (extra={}) => ({...structuredClone(emptyQuotationContent),supplierName:'Example Developer',currency:'INR',lines:[{description:'Plot 29',quantity:'247',unit:'sq. m',rate:'15000'}],...extra})
before(async()=>{
 await root.tenant.createMany({data:[{id:tenant,slug:tenant,name:'Quotation test'},{id:otherTenant,slug:otherTenant,name:'Other'}]})
 const user=(tenantId,role)=>fixtureUser(root,{data:{tenantId,role,name:role,email:`${randomUUID()}@example.test`}})
 admin=await user(tenant,'ADMIN');manager=await user(tenant,'MANAGER');staff=await user(tenant,'STAFF');other=await user(tenant,'STAFF');adminB=await user(otherTenant,'ADMIN')
 await root.tenantModule.createMany({data:[tenant,otherTenant].flatMap(tenantId=>['crm','realEstate','salesDocuments','paymentPlans'].map(key=>({tenantId,key,allowed:true,enabled:true})))})
 const service=(client,user)=>createCrmService(client,{tenantId:user.tenantId,userId:user.id})
 crm=service(db,manager);staffCrm=service(db,staff);otherCrm=service(db,other);foreign=service(dbB,adminB)
 contact=await root.crmContact.create({data:{tenantId:tenant,name:'Buyer Original',ownerUserId:staff.id,email:'buyer@example.test'}})
 const pipeline=await root.crmPipeline.create({data:{tenantId:tenant,name:'Sales'}})
 const stage=await root.crmStage.create({data:{tenantId:tenant,pipelineId:pipeline.id,name:'Qualified',position:0,kind:'OPEN',probability:10,color:'#123456'}})
 deal=await crm.createOpportunity({title:'Example property',contactId:contact.id,assignedUserId:staff.id,pipelineId:pipeline.id,stageId:stage.id,amount:'3705000',currency:'INR',expectedCloseOn:'2026-12-31'})
 project=await root.realEstateProject.create({data:{tenantId:tenant,name:'BLISS AQUA',code:'AQUA'}})
 await root.realEstateOpportunityContext.create({data:{tenantId:tenant,opportunityId:deal.id,projectId:project.id}})
})
after(async()=>{await Promise.all(clients.map(c=>c.$disconnect()));await Promise.all(pools.map(p=>p.end()))})

test('tenant logo references are captured once and later branding changes preserve saved quotations',async()=>{
 const logo={path:`${tenant}/11111111-1111-1111-1111-111111111111/document.png`,width:1200,height:400,bytes:1000}
 await root.appSetting.upsert({where:{tenantId:tenant},create:{tenantId:tenant,branding:{name:'Original brand',logo:{document:logo,sidebar:{...logo,path:logo.path.replace('document.png','sidebar.webp')}}}},update:{}})
 assert.equal((await crm.quotationDefaults(deal.id)).content.supplierName,'Original brand')
 const q=await crm.saveQuotation(deal.id,{content:content()})
 await root.appSetting.update({where:{tenantId:tenant},data:{branding:{name:'New brand'}}})
 await crm.saveQuotation(deal.id,{content:content(),version:1},q.id)
 for(const revision of [1,2]){const saved=await crm.getQuotation(q.id,revision);assert.equal(saved.snapshot.branding.logo.path,logo.path);assert.equal(saved.snapshot.branding.name,'Original brand')}
 await root.appSetting.update({where:{tenantId:tenant},data:{branding:{}}})
})

test('document contract supports non-property context without installing a CRM extension',async()=>{
 const { createCrmService: coreService } = require('../modules/crm/service.ts')
 const { createQuotationService } = require('../modules/sales-documents/quotation-service.ts')
 const { enquiryScope } = require('../modules/crm/policy.ts')
 let contextReads = 0
 const provider = async (tx, actor, opportunityId) => {
  contextReads++
  const row = await tx.crmOpportunity.findFirstOrThrow({where:{...enquiryScope(actor),id:opportunityId},select:{title:true}})
  return [{label:'Service agreement',value:row.title}]
 }
 const install = context => createQuotationService({...context,opportunityScope:enquiryScope,documentContext:provider})
 const service = coreService(db,{tenantId:tenant,userId:staff.id},undefined,[],install)
 const defaults = await service.quotationDefaults(deal.id)
 assert.deepEqual(defaults.context,[{label:'Service agreement',value:deal.title}])
 const saved = await service.saveQuotation(deal.id,{content:content()})
 assert.deepEqual((await service.getQuotation(saved.id)).snapshot.context,defaults.context)
 const before = contextReads
 const denied = coreService(db,{tenantId:tenant,userId:other.id},undefined,[],install)
 await assert.rejects(denied.quotationDefaults(deal.id),status(404))
 assert.equal(contextReads,before,'Context must not load before record access succeeds')
 const plain = coreService(db,{tenantId:tenant,userId:staff.id},undefined,[],context => createQuotationService({...context,opportunityScope:enquiryScope}))
 assert.deepEqual((await plain.quotationDefaults(deal.id)).context,[])
})
test('templates are managed, tenant-scoped, versioned and archived without modifying existing documents',async()=>{
 await assert.rejects(staffCrm.saveQuotationTemplate({name:'Denied',content:content()}),status(403))
 const t=await crm.saveQuotationTemplate({name:'Six instalments',content:content()})
 assert.equal((await staffCrm.getQuotationTemplate(t.id)).name,t.name)
 await assert.rejects(foreign.getQuotationTemplate(t.id),status(404))
 const q=await staffCrm.saveQuotation(deal.id,{content:content(),templateId:t.id})
 await crm.saveQuotationTemplate({name:'Archived',content:content({terms:'New terms'}),archived:true,version:t.version},t.id)
 assert.equal((await crm.getQuotation(q.id)).snapshot.template.name,'Six instalments')
 assert.equal((await staffCrm.listQuotationTemplates({})).total,0)
 await assert.rejects(staffCrm.getQuotationTemplate(t.id),status(404))
 await assert.rejects(crm.saveQuotationTemplate({name:'Stale',content:content(),version:1},t.id),status(409))
})
test('staff ownership, cross-tenant access and row security hold for documents and revisions',async()=>{
 const q=await staffCrm.saveQuotation(deal.id,{content:content()})
 for(const service of [otherCrm,foreign]){
  await assert.rejects(service.getQuotation(q.id),status(404))
  await assert.rejects(service.saveQuotation(deal.id,{content:content(),version:1},q.id),status(404))
  await assert.rejects(service.listQuotations(deal.id,{}),status(404))
 }
 assert.equal((await unscoped.crmQuotationRevision.findMany()).length,0)
 assert.equal((await dbB.crmQuotation.findMany({where:{tenantId:tenant}})).length,0)
 await assert.rejects(root.crmQuotationRevision.create({data:{tenantId:otherTenant,quotationId:q.id,number:99,snapshot:{}}}))
})
test('saved versions preserve original prices, customer/project details and terms',async()=>{
 const q=await crm.saveQuotation(deal.id,{content:content({terms:'Original terms'})})
 await root.crmContact.update({where:{id:contact.id},data:{name:'Buyer Changed'}})
 await root.realEstateProject.update({where:{id:project.id},data:{name:'Project Changed'}})
 await crm.saveQuotation(deal.id,{content:content({terms:'Updated terms',discount:'5000'}),version:1},q.id)
 const old=await crm.getQuotation(q.id,1),latest=await crm.getQuotation(q.id)
 assert.equal(old.snapshot.customer.name,'Buyer Original');assert.equal(old.snapshot.context[0].value,'BLISS AQUA');assert.equal(old.snapshot.content.terms,'Original terms');assert.equal(old.snapshot.calculation.consideration,'3705000.00')
 assert.equal(latest.revision,2);assert.equal(latest.snapshot.customer.name,'Buyer Changed');assert.equal(latest.snapshot.calculation.consideration,'3700000.00')
 await assert.rejects(root.crmQuotationRevision.updateMany({where:{tenantId:tenant,quotationId:q.id,number:1},data:{snapshot:{}}}),/immutable/)
 await assert.rejects(root.crmQuotationRevision.deleteMany({where:{tenantId:tenant,quotationId:q.id}}),/immutable/)
})
test('concurrent updates create one new version and stale writer gets a conflict',async()=>{
 const q=await crm.saveQuotation(deal.id,{content:content()})
 const results=await Promise.allSettled([crm.saveQuotation(deal.id,{content:content({discount:'100'}),version:1},q.id),crm.saveQuotation(deal.id,{content:content({discount:'200'}),version:1},q.id)])
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
 assert.equal(results.find(r=>r.status==='rejected').reason.status,409)
 assert.equal(await root.crmQuotationRevision.count({where:{tenantId:tenant,quotationId:q.id}}),2)
})
test('required audit failure rolls document header, snapshot and history back',async()=>{
 const broken={$transaction:(operation,options)=>db.$transaction(tx=>operation(new Proxy(tx,{get(target,key){if(key==='auditLog')return {create:async()=>{throw Error('audit unavailable')}};return target[key]}})),options)}
 const service=createCrmService(broken,{tenantId:tenant,userId:manager.id})
 const before=await root.crmQuotation.count({where:{tenantId:tenant}})
 await assert.rejects(service.saveQuotation(deal.id,{content:content()}),/audit unavailable/)
 assert.equal(await root.crmQuotation.count({where:{tenantId:tenant}}),before)
})
test('module-off hides new industry context while historical documents and core calculations remain intact',async()=>{
 const q=await crm.saveQuotation(deal.id,{content:content()})
 await root.tenantModule.update({where:{tenantId_key:{tenantId:tenant,key:'realEstate'}},data:{enabled:false}})
 assert.equal((await crm.quotationDefaults(deal.id)).context.length,0)
 assert.equal((await crm.getQuotation(q.id)).snapshot.context.length,1)
 const next=await crm.saveQuotation(deal.id,{content:content()});assert.equal((await crm.getQuotation(next.id)).snapshot.context.length,0)
 await root.tenantModule.update({where:{tenantId_key:{tenantId:tenant,key:'crm'}},data:{enabled:false}})
 await assert.rejects(crm.getQuotation(q.id),status(403))
 await root.tenantModule.update({where:{tenantId_key:{tenantId:tenant,key:'crm'}},data:{enabled:true}})
})
test('large document list remains paginated and never loads revision payloads',async()=>{
 await root.crmQuotation.createMany({data:Array.from({length:1000},(_,i)=>({id:`list-${i}-${tenant}`,tenantId:tenant,opportunityId:deal.id,title:'Large list',currency:'INR',consideration:'1'}))})
 queries.length=0
 const result=await crm.listQuotations(deal.id,{page:2,pageSize:5})
 assert.equal(result.items.length,5);assert.ok(result.total>=1000)
 assert.ok(!queries.some(q=>q.includes('CrmQuotationRevision')))
 assert.ok(queries.length<=12,`Unexpected query count: ${queries.length}`)
 console.log(`Quotation list: ${result.total} rows, 5 returned, ${queries.length} SQL statements, no revision payloads.`)
})


test('module migration preserves existing access without enabling new or opted-out businesses', async()=>{
 const fs=require('node:fs'), connection=await pools[0].connect(), schema=`optional_${randomUUID().replaceAll('-','')}`
 try {
  await connection.query('BEGIN')
  await connection.query(`CREATE SCHEMA ${schema}; SET LOCAL search_path TO ${schema};
   CREATE TABLE "TenantModule" ("tenantId" text, "key" text, "enabled" boolean, "updatedAt" timestamp, PRIMARY KEY ("tenantId","key"));
   CREATE TABLE "CrmQuotation" ("id" text, "tenantId" text, "createdAt" timestamp);
   INSERT INTO "TenantModule" VALUES ('legacy','crm',true,now()),('disabled','crm',false,now()),('optout','crm',true,now()),('optout','salesDocuments',false,now())`)
  await connection.query(fs.readFileSync('prisma/migrations/20260929200000_optional_sales_documents/migration.sql','utf8').replace(/^BEGIN;/,'').replace(/COMMIT;\s*$/,''))
  const rows=(await connection.query('SELECT * FROM "TenantModule"')).rows
  for(const key of ['salesDocuments','paymentPlans']) assert.equal(rows.find(row=>row.tenantId==='legacy'&&row.key===key).enabled,true)
  assert.equal(rows.filter(row=>['disabled','new'].includes(row.tenantId)&&row.key!=='crm').length,0)
  assert.equal(rows.find(row=>row.tenantId==='optout'&&row.key==='salesDocuments').enabled,false)
 } finally { await connection.query('ROLLBACK'); connection.release() }
})

test('optional payment plans preserve saved schedules and allow quotation-only business',async()=>{
 const identity={tenantId:tenant,userId:admin.id}
 const planned=content({instalments:[{label:'On booking',percent:'100',days:0,note:''}]})
 const quote=await staffCrm.saveQuotation(deal.id,{content:planned})
 const template=await crm.saveQuotationTemplate({name:'Saved schedule',content:planned})
 await assert.rejects(updateBusinessModule(db,{tenantId:tenant,userId:manager.id},{key:'paymentPlans',enabled:false}),status(403))
 await updateBusinessModule(db,identity,{key:'paymentPlans',enabled:false})
 const saved=await staffCrm.getQuotation(quote.id)
 assert.equal(saved.paymentPlansEnabled,false);assert.equal(saved.snapshot.content.instalments.length,1)
 assert.equal((await crm.getQuotationTemplate(template.id)).content.instalments.length,1)
 await assert.rejects(staffCrm.saveQuotation(deal.id,{content:planned}),status(403))
 await assert.rejects(staffCrm.saveQuotation(deal.id,{content:content(),version:1},quote.id),status(403))
 await assert.rejects(crm.saveQuotationTemplate({name:'Cleared schedule',content:content(),version:1},template.id),status(403))
 await assert.rejects(crm.saveQuotationTemplate({name:'New scheduled template',content:planned}),status(403))
 const simple=await staffCrm.saveQuotation(deal.id,{content:content()})
 assert.deepEqual((await staffCrm.getQuotation(simple.id)).snapshot.calculation.instalments,[])
 assert.ok((await staffCrm.listQuotations(undefined,{q:'Quotation'})).items.some(row=>row.id===simple.id))
 assert.equal((await otherCrm.listQuotations(undefined,{})).total,0)
 await updateBusinessModule(db,identity,{key:'paymentPlans',enabled:true})
 assert.equal((await staffCrm.saveQuotation(deal.id,{content:planned,version:1},quote.id)).version,2)
})

test('module switches guard every document operation, dependencies, audit and concurrent changes',async()=>{
 const identity={tenantId:tenant,userId:admin.id}, quote=await crm.saveQuotation(deal.id,{content:content()})
 await assert.rejects(updateBusinessModule(db,identity,{key:'salesDocuments',enabled:false}),status(409))
 await updateBusinessModule(db,identity,{key:'paymentPlans',enabled:false})
 await updateBusinessModule(db,identity,{key:'salesDocuments',enabled:false})
 for(const operation of [()=>crm.listQuotations(undefined,{}),()=>crm.getQuotation(quote.id),()=>crm.quotationDefaults(deal.id),()=>crm.listQuotationTemplates({}),()=>crm.getQuotationTemplate('none'),()=>crm.saveQuotationTemplate({name:'Off',content:content()}),()=>crm.saveQuotation(deal.id,{content:content()})]) await assert.rejects(operation(),status(403))
 await assert.rejects(updateBusinessModule(db,identity,{key:'paymentPlans',enabled:true}),status(409))
 await updateBusinessModule(db,identity,{key:'salesDocuments',enabled:true})
 await Promise.allSettled([updateBusinessModule(db,identity,{key:'salesDocuments',enabled:false}),updateBusinessModule(db,identity,{key:'paymentPlans',enabled:true})])
 const flags=await root.tenantModule.findMany({where:{tenantId:tenant}}), on=key=>!!flags.find(f=>f.key===key)?.enabled
 assert.ok(!on('paymentPlans')||on('salesDocuments'))
 await updateBusinessModule(db,identity,{key:'salesDocuments',enabled:true})
 await updateBusinessModule(db,identity,{key:'paymentPlans',enabled:true})
 assert.equal((await crm.getQuotation(quote.id)).version,1)
 const broken={$transaction:(fn,options)=>db.$transaction(tx=>fn(new Proxy(tx,{get(target,key){if(key==='auditLog')return {create:async()=>{throw Error('audit unavailable')}};return target[key]}})),options)}
 await assert.rejects(updateBusinessModule(broken,identity,{key:'paymentPlans',enabled:false}),/audit unavailable/)
 assert.equal((await root.tenantModule.findUnique({where:{tenantId_key:{tenantId:tenant,key:'paymentPlans'}}})).enabled,true)
})

test('quotation terminology is captured once per new revision, without changing history or other tenants',async()=>{
 await root.tenantModule.update({where:{tenantId_key:{tenantId:tenant,key:'realEstate'}},data:{enabled:true}})
 const labels={'crm.contact.singular':'Buyer','crm.opportunity.singular':'Deal','salesDocuments.quotation.singular':'Offer','realEstate.project.singular':'Development','paymentPlans.paymentPlan.singular':'Payment schedule'}
 await root.tenantTerminology.createMany({data:Object.entries(labels).map(([key,label])=>({tenantId:tenant,key,label}))})
 queries.length=0
 const defaults=await crm.quotationDefaults(deal.id)
 assert.equal(defaults.content.title,'Offer');assert.equal(defaults.context[0].label,'Development')
 assert.equal(queries.filter(q=>q.includes('"TenantTerminology"')).length,1)
 const originalContent=content({title:'Negotiated offer - keep this title',details:[{label:'Project',value:'User supplied detail'}],instalments:[{label:'Booking',percent:'100',days:0,note:'Original condition'}]})
 const saved=await crm.saveQuotation(deal.id,{content:originalContent})
 const first=await crm.getQuotation(saved.id), snapshot=JSON.stringify(first.snapshot)
 assert.equal(first.snapshot.labels.opportunity,'Deal');assert.equal(first.snapshot.labels.customer,'Buyer')
 assert.equal(first.snapshot.labels.paymentSchedule,'Payment schedule')
 assert.equal(first.snapshot.context[0].label,'Development')
 assert.equal(first.snapshot.content.details[0].label,'Project')
 await root.tenantTerminology.deleteMany({where:{tenantId:tenant}})
 queries.length=0
 assert.equal(JSON.stringify((await crm.getQuotation(saved.id,1)).snapshot),snapshot)
 assert.equal(queries.filter(q=>q.includes('"TenantTerminology"')).length,0)
 const second=await crm.saveQuotation(deal.id,{content:originalContent,version:1},saved.id)
 assert.equal(second.version,2)
 const latest=await crm.getQuotation(saved.id)
 assert.equal(latest.snapshot.labels.opportunity,'Opportunity');assert.equal(latest.snapshot.labels.paymentSchedule,'Instalment schedule')
 assert.deepEqual(latest.snapshot.content,first.snapshot.content);assert.deepEqual(latest.snapshot.calculation,first.snapshot.calculation)
 assert.equal(JSON.stringify((await crm.getQuotation(saved.id,1)).snapshot),snapshot)
 await assert.rejects(foreign.getQuotation(saved.id),status(404))
 assert.throws(()=>crm.saveQuotation(deal.id,{content:originalContent,labels:{opportunity:'Forged'}}))
 await root.tenantTerminology.create({data:{tenantId:tenant,key:'paymentPlans.paymentPlan.singular',label:'Hidden schedule'}})
 await root.tenantModule.update({where:{tenantId_key:{tenantId:tenant,key:'paymentPlans'}},data:{enabled:false}})
 const simple=await crm.saveQuotation(deal.id,{content:content()})
 assert.equal((await crm.getQuotation(simple.id)).snapshot.labels.paymentSchedule,'Instalment schedule')
 assert.equal((await crm.getQuotation(saved.id,1)).snapshot.labels.paymentSchedule,'Payment schedule')
})

test('issued PDFs are committed once per revision under concurrency and preserve previous versions',async()=>{
 const storage=require('../platform/storage/documents.ts'),renderer=require('../modules/sales-documents/quotation-pdf.ts')
 const original={upload:storage.uploadQuotationPdf,remove:storage.removeUnusedPdf,render:renderer.buildQuotationPdf}
 const files=new Map(),removed=[]
 let renders=0
 storage.uploadQuotationPdf=async(tenantId,id,revision,bytes)=>{const path=`${tenantId}/quotations/${id}/${revision}/${randomUUID()}.pdf`;files.set(path,bytes);return {path,bytes:bytes.length,sha256:require('node:crypto').createHash('sha256').update(bytes).digest('hex')}}
 storage.removeUnusedPdf=async path=>{removed.push(path);files.delete(path)}
 renderer.buildQuotationPdf=async()=>{renders++;return Buffer.from('%PDF-original-'+renders)}
 try{
 const q=await crm.saveQuotation(deal.id,{content:content()}),before=(await crm.getQuotation(q.id)).snapshot
 assert.equal((await crm.getQuotation(q.id)).archivedPdf,null)
 const [a,b]=await Promise.all([crm.issueQuotation(q.id,1),crm.issueQuotation(q.id,1)])
 assert.deepEqual(a,b);assert.equal(files.size,1);assert.equal(renders,2);assert.equal(removed.length,1)
 assert.equal(a.issuedBy,manager.id);assert.ok(a.issuedAt)
 assert.deepEqual((await crm.getQuotation(q.id,1)).snapshot,before)
 renderer.buildQuotationPdf=async()=>{throw Error('renderer changed')}
 assert.deepEqual(await crm.issueQuotation(q.id,1),a)
 await crm.saveQuotation(deal.id,{content:content({title:'Revised draft'}),version:1},q.id)
 assert.equal((await crm.getQuotation(q.id,2)).archivedPdf,null)
 assert.deepEqual((await crm.getQuotation(q.id,1)).archivedPdf,a)
 const audits=await root.auditLog.findMany({where:{tenantId:tenant,event:'crm.quotation.issued',entityId:q.id}})
 assert.equal(audits.length,1)
 const key={tenantId_quotationId_number:{tenantId:tenant,quotationId:q.id,number:1}}
 await assert.rejects(root.crmQuotationRevision.update({where:key,data:{archivedPdf:{...a,path:'replacement'}}}),/immutable/)
 await assert.rejects(root.crmQuotationRevision.update({where:key,data:{snapshot:{changed:true}}}),/immutable/)
 await assert.rejects(root.crmQuotationRevision.delete({where:key}),/immutable/)
 await assert.rejects(foreign.issueQuotation(q.id,1),status(404))
 await assert.rejects(otherCrm.issueQuotation(q.id,1),status(404))
 await assert.rejects(crm.issueQuotation(q.id,999),status(404))
 }finally{storage.uploadQuotationPdf=original.upload;storage.removeUnusedPdf=original.remove;renderer.buildQuotationPdf=original.render}
})

test('upload failure leaves a draft unissued and module or permission denial prevents storage work',async()=>{
 const storage=require('../platform/storage/documents.ts'),original=storage.uploadQuotationPdf
 let uploads=0
 storage.uploadQuotationPdf=async()=>{uploads++;throw new (require('../platform/policy.ts').BusinessError)(503,'storage unavailable')}
 try{
 const q=await crm.saveQuotation(deal.id,{content:content()})
 await assert.rejects(crm.issueQuotation(q.id,1),status(503));assert.equal((await crm.getQuotation(q.id)).archivedPdf,null);assert.equal(uploads,1)
 await root.tenantModule.update({where:{tenantId_key:{tenantId:tenant,key:'salesDocuments'}},data:{enabled:false}})
 await assert.rejects(crm.issueQuotation(q.id,1),status(403));assert.equal(uploads,1)
 await root.tenantModule.update({where:{tenantId_key:{tenantId:tenant,key:'salesDocuments'}},data:{enabled:true}})
 const role=await fixtureProfile(root,{data:{tenantId:tenant,name:'Archive reader',nameKey:'archive reader',permissions:['quotations.read','quotations.export']}})
 await fixtureRole(root,{data:{tenantId:tenant,userId:manager.id,roleId:role.id}})
 await assert.rejects(crm.issueQuotation(q.id,1),status(403));assert.equal(uploads,1)
 await resetFixtureRoles(root,{where:{tenantId:tenant,userId:manager.id}})
 }finally{storage.uploadQuotationPdf=original;await root.tenantModule.update({where:{tenantId_key:{tenantId:tenant,key:'salesDocuments'}},data:{enabled:true}})}
})
