/* eslint-disable @typescript-eslint/no-require-imports */
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Pool}=require('pg'),{PrismaClient}=require('@prisma/client')
const {TenantPgAdapter}=require('../lib/tenant-pg-adapter.ts'),{runWithDatabaseActor}=require('../lib/database-actor.ts'),{runWithOfficeRequest}=require('../lib/database-office.ts')
const {createCompanyService}=require('../platform/companies/service.ts'),{createOfficeAccessService}=require('../platform/companies/office-access.ts')
const {createAccessRoleService}=require('../platform/access/service.ts'),{allPermissions}=require('../platform/access/catalog.ts'),{defaultRecordRules,supportedScopes}=require('../platform/access/rules.ts')
const {createApplicationCrmService}=require('../application/crm/service.ts'),{createRealEstateService}=require('../modules/real-estate/service.ts'),{createRecordSharingService}=require('../platform/access/sharing-service.ts')
const {applicationSalesOrders}=require('../application/sales-orders/service.ts'),{applicationReceivables}=require('../application/receivables/service.ts'),{emptyQuotationContent}=require('../modules/sales-documents/quotation-validation.ts')
const {officeExpectation}=require('../platform/companies/record-office.ts')
require('../lib/logger.ts').logger.info=()=>{}
const url=new URL(process.env.CRM_TEST_DATABASE_URL||'http://invalid')
if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!='/ls_salon_crm_test')throw Error('Disposable local database only.')
const tenant='record_offices_'+randomUUID(),foreign='record_offices_'+randomUUID(),clients=[],pools=[]
function client(tenantId,bypass=false){const u=new URL(url);if(!bypass){u.username='crm_test_runtime';u.password=''}const pool=new Pool({connectionString:u.toString(),max:4});pools.push(pool);const db=new PrismaClient({adapter:new TenantPgAdapter(pool,{tenantId,bypass})});clients.push(db);return db}
const root=client(undefined,true),db=client(tenant),other=client(foreign),identity=u=>({tenantId:u.tenantId,userId:u.id}),status=n=>e=>e.status===n
// Await lazy Prisma promises inside actor storage; returning one loses identity.
const direct=(user,fn)=>runWithDatabaseActor(user.id,async()=>await fn())
const crm=user=>createApplicationCrmService(db,identity(user)),projects=user=>createRealEstateService(db,identity(user))
let admin,staffA,staffB,manager,dual,noProfile,unassigned,foreignAdmin,access,companies,a,b,contact,pipeline,stage,leadA,leadB,dealA,dealB,projectA,projectB,orders,ledger,quotation,order
async function membership(user,officeIds,creationOfficeId){const p=await access.getMemberships(user.id);return access.saveMemberships(user.id,{version:p.version,officeIds,companies:[],creationOfficeId})}
async function select(office){const own=createOfficeAccessService(db,identity(admin)),p=await own.getOwnContext();return own.selectCreationOffice({version:p.version,officeId:office.id})}
const opportunity=(title,user,enquiryId)=>({title,contactId:contact.id,assignedUserId:user.id,pipelineId:pipeline.id,stageId:stage.id,amount:'100',currency:'INR',expectedCloseOn:'2030-01-01',...(enquiryId?{enquiryId}:{})})
before(async()=>{
 await root.tenant.createMany({data:[tenant,foreign].map(id=>({id,slug:id,name:id}))})
 const user=(tenantId,role)=>root.user.create({data:{tenantId,role,name:role,email:randomUUID()+'@example.test'}})
 admin=await user(tenant,'ADMIN');staffA=await user(tenant,'STAFF');staffB=await user(tenant,'STAFF');manager=await user(tenant,'MANAGER');dual=await user(tenant,'STAFF');noProfile=await user(tenant,'STAFF');unassigned=await user(tenant,'STAFF');foreignAdmin=await user(foreign,'ADMIN')
 await root.tenantModule.createMany({data:[tenant,foreign].flatMap(tenantId=>['crm','realEstate','salesDocuments','salesOrders','receivables','paymentPlans','catalog'].map(key=>({tenantId,key,allowed:true,enabled:true})))})
 access=createOfficeAccessService(db,identity(admin));companies=createCompanyService(db,identity(admin))
 const company=await companies.createCompany({name:'Office record checks',code:'CHECK'})
 a=await companies.createOffice({companyId:company.id,name:'East',code:'EAST'});b=await companies.createOffice({companyId:company.id,name:'West',code:'WEST'})
 for(const [user,offices,creation] of [[admin,[a.id,b.id],a.id],[staffA,[a.id],a.id],[staffB,[b.id],b.id],[manager,[a.id],a.id],[dual,[a.id,b.id],a.id],[noProfile,[a.id],a.id]])await membership(user,offices,creation)
 const roles=createAccessRoleService(db,identity(admin)),profile=await roles.save({name:'Office isolation checks',permissions:allPermissions}),rules=defaultRecordRules()
 for(const p of Object.keys(rules))if(supportedScopes(p.split('.')[0]).includes('ALL'))rules[p]='ALL'
 for(const user of [staffA,staffB,manager,dual,unassigned]){const assignment=await roles.assignment(user.id);await roles.assign(user.id,{roleIds:[profile.id],rules,version:assignment.accessPolicy.version})}
 contact=await crm(admin).createContact({name:'Shared customer',email:'office-customer@example.test'})
 pipeline=await crm(admin).createPipeline({name:'Offices',stages:[{name:'Open',kind:'OPEN',probability:10,color:'#123456'},{name:'Won',kind:'WON',probability:100,color:'#00aa00'},{name:'Lost',kind:'LOST',probability:0,color:'#aa0000'}]});stage=pipeline.stages[0]
 leadA=await crm(admin).createEnquiry({title:'East enquiry',contactId:contact.id,assignedUserId:staffA.id})
 projectA=await projects(admin).createProject({name:'East project',code:'EAST'})
 dealA=await crm(admin).createOpportunity(opportunity('East deal',staffA))
 await select(b)
 leadB=await crm(admin).createEnquiry({title:'West enquiry',contactId:contact.id,assignedUserId:staffB.id})
 projectB=await projects(admin).createProject({name:'West project',code:'WEST'})
 dealB=await crm(admin).createOpportunity(opportunity('West deal',staffB))
 await select(a)
 orders=applicationSalesOrders(db,identity(admin));ledger=applicationReceivables(db,identity(admin))
 quotation=await crm(admin).saveQuotation(dealA.id,{content:{...structuredClone(emptyQuotationContent),title:'East frozen quotation',supplierName:'Example',currency:'INR',lines:[{description:'Support',quantity:'1',unit:'hour',rate:'100'}]}})
 order=await orders.create({quotationId:quotation.id,revision:1});await orders.transition(order.id,{action:'confirm',version:1})
 await ledger.open(order.id,{dueDates:(await ledger.get(order.id)).plan.lines.map(()=>null)})
})
after(async()=>{await Promise.all(clients.map(c=>c.$disconnect()));await Promise.all(pools.map(p=>p.end()))})

test('isolated suite has no single-office fixture triggers or implicit new-user memberships',async()=>{
 assert.equal((await root.$queryRaw`SELECT count(*)::int n FROM pg_trigger WHERE tgname IN ('test_user_office_fixture','aaa_test_record_office_fixture')`)[0].n,0)
 assert.equal((await access.getMemberships(unassigned.id)).version,0)
 await assert.rejects(crm(unassigned).createEnquiry({title:'No fallback',contactId:contact.id,assignedUserId:unassigned.id}),status(403))
 assert.equal((await crm(unassigned).listEnquiries({})).total,0)
})
test('office membership never grants a missing action profile',async()=>{await assert.rejects(crm(noProfile).getEnquiry(leadA.id),status(403))})
test('native root ownership is persisted and shared customer identity is reused across offices',async()=>{
 assert.equal(leadA.officeId,a.id);assert.equal(leadB.officeId,b.id);assert.equal(dealA.officeId,a.id);assert.equal(projectB.officeId,b.id)
 assert.equal((await crm(staffA).getContact(contact.id)).id,contact.id);assert.equal((await crm(staffB).getContact(contact.id)).id,contact.id)
 assert.equal(await root.crmContact.count({where:{tenantId:tenant,email:'office-customer@example.test'}}),1)
})
test('lists, details and exports intersect broad record permissions with exact office access',async()=>{
 for(const user of [staffA,manager]){
  assert.deepEqual((await crm(user).listEnquiries({})).items.map(r=>r.id),[leadA.id])
  assert.equal((await crm(user).listEnquiries({},true)).total,1)
  await assert.rejects(crm(user).getEnquiry(leadB.id),status(404))
  await assert.rejects(crm(user).getOpportunity(dealB.id),status(404))
  await assert.rejects(projects(user).getProject(projectB.id),status(404))
 }
 assert.equal((await crm(dual).listEnquiries({})).total,2)
 assert.equal((await crm(admin).listEnquiries({})).total,2)
})
test('raw runtime SQL enforces both positive and negative office reads, including actorless queries',async()=>{
 assert.equal(await direct(staffA,()=>db.crmEnquiry.count({where:{id:leadA.id}})),1)
 assert.equal(await direct(staffA,()=>db.crmEnquiry.count({where:{id:leadB.id}})),0)
 assert.equal((await direct(manager,()=>db.$queryRaw`SELECT count(*)::int n FROM "CrmOpportunity" WHERE id=${dealB.id}`))[0].n,0)
 assert.equal(await db.crmEnquiry.count({where:{id:leadA.id}}),0)
 assert.equal(await direct(foreignAdmin,()=>other.crmEnquiry.count({where:{id:leadA.id}})),0)
})
test('pooled transactions clear creation-office settings before another actor can reuse a connection',async()=>{
 await direct(staffA,()=>db.$transaction(async tx=>{await tx.$executeRaw`SELECT set_config('app.office_id',${a.id},true),set_config('app.office_version','123',true)`}))
 const [next]=await direct(staffB,()=>db.$queryRaw`SELECT current_setting('app.office_id',true) office,current_setting('app.office_version',true) version`)
 assert.deepEqual(next,{office:'',version:''})
})
test('an existing record cannot be edited or reassigned through an inaccessible office',async()=>{
 await assert.rejects(crm(staffA).updateEnquiry(leadB.id,{title:'Denied',assignedUserId:staffB.id,status:'NEW',version:1}),status(404))
 assert.equal((await root.crmEnquiry.findUnique({where:{id:leadB.id}})).title,'West enquiry')
})
test('user and team sharing cannot bypass an office boundary',async()=>{
 const sharing=createRecordSharingService(db,identity(admin)),current=await sharing.get('enquiries',leadB.id)
 const team=await root.businessTeam.create({data:{tenantId:tenant,name:'Across offices',nameKey:'across offices'}})
 await root.businessTeamMember.create({data:{tenantId:tenant,teamId:team.id,userId:staffA.id}})
 await sharing.save('enquiries',leadB.id,{version:current.version,restricted:false,grants:[{kind:'USER',id:staffA.id,level:'EDIT'},{kind:'TEAM',id:team.id,level:'EDIT'}]})
 await assert.rejects(crm(staffA).getEnquiry(leadB.id),status(404))
 assert.equal(await direct(staffA,()=>db.recordSharingPolicy.count({where:{recordId:leadB.id}})),0)
 assert.equal((await crm(staffB).getEnquiry(leadB.id)).id,leadB.id)
})
test('assignments require access to the fixed record office and failed writes leave no record',async()=>{
 const before=await root.crmEnquiry.count({where:{tenantId:tenant}})
 await assert.rejects(crm(admin).createEnquiry({title:'Wrong office assignee',contactId:contact.id,assignedUserId:staffB.id}),status(400))
 assert.equal(await root.crmEnquiry.count({where:{tenantId:tenant}}),before)
 await assert.rejects(crm(admin).updateEnquiry(leadA.id,{title:leadA.title,assignedUserId:staffB.id,status:'NEW',version:1}),status(400))
 assert.equal((await root.crmEnquiry.findUnique({where:{id:leadA.id}})).assignedUserId,staffA.id)
})
test('office identity is immutable even for a privileged maintenance connection',async()=>{
 await assert.rejects(root.crmEnquiry.update({where:{id:leadA.id},data:{officeId:b.id}}),/immutable/)
 await assert.rejects(root.realEstateProject.update({where:{id:projectA.id},data:{officeId:b.id}}),/immutable/)
})
test('HTTP root creation requires an explicit valid form context without consulting the current preference',async()=>{
 await assert.rejects(runWithOfficeRequest(null,()=>crm(admin).createEnquiry({title:'Missing header',contactId:contact.id,assignedUserId:staffA.id})),status(403))
 const own=createOfficeAccessService(db,identity(admin)),p=await own.getOwnContext()
 const saved=await runWithOfficeRequest({officeId:a.id,version:p.version},()=>crm(admin).createEnquiry({title:'Header bound',contactId:contact.id,assignedUserId:staffA.id}))
 assert.equal(saved.officeId,a.id)
 for(const headers of [{'x-office-id':a.id},{'x-office-id':a.id,'x-office-version':'0'},{'x-office-id':a.id,'x-office-version':'9007199254740992'}])assert.throws(()=>officeExpectation(new Request('http://localhost',{headers})),status(400))
})
test('stale form context rejects creation instead of silently rerouting the draft',async()=>{
 const p=await createOfficeAccessService(db,identity(admin)).getOwnContext();await select(b)
 try{await assert.rejects(runWithOfficeRequest({officeId:a.id,version:p.version},()=>crm(admin).createEnquiry({title:'Stale draft',contactId:contact.id,assignedUserId:dual.id})),status(409))}
 finally{await select(a)}
 assert.equal(await root.crmEnquiry.count({where:{tenantId:tenant,title:'Stale draft'}}),0)
})
test('conversion and activities inherit their source office even when the creation preference changes',async()=>{
 await select(b)
 try{
  const deal=await runWithOfficeRequest(null,()=>crm(admin).createOpportunity(opportunity('Converted East',staffA,leadA.id)))
  assert.equal(deal.officeId,a.id)
  const task=await runWithOfficeRequest(null,()=>crm(admin).createTask(leadA.id,{title:'East follow up',dueOn:'2030-01-01'}))
  assert.equal(task.officeId,a.id)
  assert.equal((await crm(staffA).getWork(task.id)).id,task.id)
  await assert.rejects(crm(staffB).getWork(task.id),status(404))
  assert.equal(await direct(staffB,()=>db.crmTaskEvent.count({where:{taskId:task.id}})),0)
 }finally{await select(a)}
})
test('subprojects inherit their parent office and cannot be moved across offices',async()=>{
 await select(b)
 let child
 try{child=await runWithOfficeRequest(null,()=>projects(admin).createProject({name:'East child',code:'EAST-CHILD',parentId:projectA.id}));assert.equal(child.officeId,a.id)}finally{await select(a)}
 await assert.rejects(root.realEstateProject.update({where:{id:child.id},data:{parentId:projectB.id}}),/cannot change the record office/)
 assert.equal((await projects(staffA).getProject(child.id)).id,child.id)
 await assert.rejects(projects(staffB).getProject(child.id),status(404))
})
test('project assignments cannot lend access to a staff member outside the office',async()=>{
 await assert.rejects(projects(admin).changeMember(projectA.id,{userId:staffB.id,version:1,remove:false}),status(400))
 assert.equal(await root.realEstateProjectMember.count({where:{projectId:projectA.id,userId:staffB.id}}),0)
})
test('project add-on references cannot join sales records from different offices',async()=>{
 await assert.rejects(root.realEstateEnquiryContext.create({data:{tenantId:tenant,enquiryId:leadA.id,projectId:projectB.id}}),/same office/)
 await root.realEstateEnquiryContext.create({data:{tenantId:tenant,enquiryId:leadA.id,projectId:projectA.id}})
 assert.equal(await direct(staffA,()=>db.realEstateEnquiryContext.count({where:{enquiryId:leadA.id}})),1)
 assert.equal(await direct(staffB,()=>db.realEstateEnquiryContext.count({where:{enquiryId:leadA.id}})),0)
})
test('typed values and their filters cannot expose another office through a shared field definition',async()=>{
 const {createCustomFieldService}=require('../platform/custom-fields/service.ts'),{enquiryFields}=require('../modules/crm/custom-fields.ts')
 const config=createCustomFieldService(db,identity(admin),[enquiryFields])
 const field=await config.save({name:'Office score',code:'office_score',scope:'SALES',type:'NUMBER',filterable:true})
 for(const record of [leadA,leadB])await root.crmEnquiryFieldValue.create({data:{tenantId:tenant,recordId:record.id,fieldId:field.id,scope:'SALES',type:'NUMBER',numberValue:'123',fieldName:field.name}})
 assert.equal(await direct(staffA,()=>db.crmEnquiryFieldValue.count({where:{recordId:leadA.id}})),1)
 assert.equal(await direct(staffA,()=>db.crmEnquiryFieldValue.count({where:{recordId:leadB.id}})),0)
 const filtered=await crm(staffA).listEnquiries({customFieldId:field.id,customFieldValue:'123'})
 assert.deepEqual(filtered.items.map(row=>row.id),[leadA.id])
})
test('quotation snapshots, orders and financial records follow their canonical opportunity office',async()=>{
 assert.equal((await crm(staffA).getQuotation(quotation.id,1,true)).id,quotation.id)
 assert.equal((await applicationSalesOrders(db,identity(staffA)).get(order.id)).id,order.id)
 assert.ok((await applicationReceivables(db,identity(staffA)).get(order.id)).account)
 for(const user of [staffB]){
  await assert.rejects(crm(user).getQuotation(quotation.id,1,true),status(404))
  await assert.rejects(applicationSalesOrders(db,identity(user)).get(order.id),status(404))
  await assert.rejects(applicationReceivables(db,identity(user)).get(order.id),status(404))
  for(const [model,where] of [['crmQuotationRevision',{quotationId:quotation.id}],['salesOrderEvent',{orderId:order.id}],['orderReceivable',{orderId:order.id}],['orderReceivableLine',{orderId:order.id}]])assert.equal(await direct(user,()=>db[model].count({where})),0,model)
 }
 await assert.rejects(root.crmQuotation.update({where:{tenantId_id:{tenantId:tenant,id:quotation.id}},data:{opportunityId:dealB.id}}),/immutable/)
})
test('record history and audit copies respect office isolation',async()=>{
 assert.ok(await direct(staffA,()=>db.auditLog.count({where:{entityId:leadA.id}})))
 assert.equal(await direct(staffB,()=>db.auditLog.count({where:{entityId:leadA.id}})),0)
 assert.equal(await direct(staffB,()=>db.auditLog.count({where:{entityId:order.id}})),0)
})
test('collection activities and scheduled plan steps inherit the source office',async()=>{
 await select(b)
 try{
  const task=await runWithOfficeRequest(null,()=>crm(admin).createWork({collectionOrderId:order.id,contactId:contact.id,opportunityId:dealA.id,title:'East collection',type:'CALL',callDirection:'OUTBOUND',assignedUserId:staffA.id,dueOn:'2030-01-02'}))
  assert.equal(task.officeId,a.id)
  const plan=await crm(admin).createActivityPlan({name:'Office sequence',steps:[{title:'Source call',type:'CALL',callDirection:'OUTBOUND',dayOffset:1}]})
  const launch=await runWithOfficeRequest(null,()=>crm(admin).applyActivityPlan(plan.id,{version:plan.version,requestKey:randomUUID(),startOn:'2030-01-01',contactId:contact.id,enquiryId:leadA.id,assignedUserId:staffA.id}))
  assert.equal((await root.crmPlanLaunch.findUnique({where:{id:launch.id}})).officeId,a.id)
  const steps=await root.crmTask.findMany({where:{planLaunchId:launch.id}});assert.equal(steps.length,1);assert.equal(steps[0].officeId,a.id)
  assert.equal(await direct(staffB,()=>db.crmPlanLaunch.count({where:{id:launch.id}})),0)
 }finally{await select(a)}
})
test('posted receipts and allocations retain the order office without a second office field',async()=>{
 const receipt=await ledger.record(order.id,{requestKey:randomUUID(),version:1,amount:'10',receivedOn:'2026-01-01',method:'CASH',reference:'',note:''})
 assert.equal(await direct(staffA,()=>db.orderReceipt.count({where:{id:receipt.id}})),1)
 assert.equal(await direct(staffB,()=>db.orderReceipt.count({where:{id:receipt.id}})),0)
 assert.equal(await direct(staffB,()=>db.orderReceiptAllocation.count({where:{orderId:order.id}})),0)
 assert.equal(await direct(staffB,()=>db.auditLog.count({where:{entityId:receipt.id}})),0)
})
test('project units stay private to their office; general catalog definitions remain shared',async()=>{
 const {applicationCatalog}=require('../application/catalog/service.ts'),catalog=applicationCatalog(db,identity(admin))
 const category=await root.realEstatePropertyCategory.findUniqueOrThrow({where:{tenantId_nameKey:{tenantId:tenant,nameKey:'apartment'}}})
 const unit=await catalog.save({code:'WEST-UNIT',name:'West unit',kind:'UNIT',price:'100',currency:'INR',extensionKey:'realEstate',extension:{projectId:projectB.id,categoryId:category.id}})
 const general=await catalog.save({code:'SHARED',name:'Shared product',kind:'PRODUCT',price:'10',currency:'INR'})
 assert.equal((await applicationCatalog(db,identity(staffB)).get(unit.id)).id,unit.id)
 await assert.rejects(applicationCatalog(db,identity(staffA)).get(unit.id),status(404))
 assert.equal(await direct(staffA,()=>db.catalogItem.count({where:{id:unit.id}})),0)
 assert.equal((await applicationCatalog(db,identity(staffA)).get(general.id)).id,general.id)
 await assert.rejects(root.realEstateUnit.update({where:{tenantId_itemId:{tenantId:tenant,itemId:unit.id}},data:{projectId:projectA.id}}),/immutable/)
 const content={...structuredClone(emptyQuotationContent),title:'Cross office unit',supplierName:'Example',currency:'INR',lines:[{description:unit.name,quantity:'1',unit:'each',rate:'100',catalogItemId:unit.id,catalogItemVersion:unit.version}]}
 await assert.rejects(crm(admin).saveQuotation(dealA.id,{content}),status(400))
 const own=await crm(admin).saveQuotation(dealB.id,{content});assert.equal((await crm(staffB).getQuotation(own.id,1,true)).id,own.id)
})
test('import batches keep their upload office when processing resumes under another preference',async()=>{
 const batch=await crm(admin).uploadEnquiryImport('offices.csv',Buffer.from('Contact name,Email\nImported East,imported-east@example.test\n'))
 const persisted=await root.crmEnquiryImport.findUnique({where:{id:batch.id}});assert.equal(persisted.officeId,a.id)
 await crm(admin).configureEnquiryImport(batch.id,{mapping:{name:0,email:1},defaults:{assignedUserId:staffA.id}})
 await select(b)
 try{
  await crm(admin).processEnquiryImport(batch.id,'validate')
  const result=await crm(admin).processEnquiryImport(batch.id,'import');assert.equal(result.status,'COMPLETE')
  const imported=await root.crmEnquiry.findFirst({where:{tenantId:tenant,importId:batch.id}})
  assert.ok(imported);assert.equal(imported.officeId,a.id)
  await assert.rejects(root.crmEnquiry.update({where:{id:imported.id},data:{importId:null}}),/immutable/)
  assert.equal(await direct(staffB,()=>db.crmEnquiryImportRow.count({where:{importId:batch.id}})),0)
 }finally{await select(a)}
})
test('membership revocation takes effect on the next read without altering record ownership or sharing',async()=>{
 const before=await root.crmEnquiry.findUnique({where:{id:leadB.id}})
 await membership(dual,[a.id],a.id)
 await assert.rejects(crm(dual).getEnquiry(leadB.id),status(404))
 assert.deepEqual(await root.crmEnquiry.findUnique({where:{id:leadB.id}}),before)
 await membership(dual,[a.id,b.id],a.id)
 assert.equal((await crm(dual).getEnquiry(leadB.id)).id,leadB.id)
})
test('closed offices remain readable to authorized staff but reject new independent work',async()=>{
 b=await companies.updateOffice(b.id,{version:b.version,archived:true})
 try{
  assert.equal((await crm(staffB).getEnquiry(leadB.id)).id,leadB.id)
  await assert.rejects(crm(staffB).createEnquiry({title:'Closed West',contactId:contact.id,assignedUserId:staffB.id}),status(403))
 }finally{b=await companies.updateOffice(b.id,{version:b.version,archived:false})}
})
