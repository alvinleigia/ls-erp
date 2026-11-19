/* eslint-disable @typescript-eslint/no-require-imports */
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Pool}=require('pg'),{PrismaClient}=require('@prisma/client')
const {TenantPgAdapter}=require('../lib/tenant-pg-adapter.ts'),{fixtureUser}=require('./helpers/access-fixtures.cjs')
const {createRealEstateService}=require('../modules/real-estate/service.ts'),{applicationCatalog}=require('../application/catalog/service.ts'),{applicationReservations}=require('../application/catalog/reservations.ts'),{applicationSalesOrders}=require('../application/sales-orders/service.ts'),{createApplicationCrmService}=require('../application/crm/service.ts'),{emptyQuotationContent}=require('../modules/sales-documents/quotation-validation.ts')
const {authorizeBusinessOperation}=require('../platform/access/operation.ts')
require('../lib/logger.ts').logger.info=()=>{}
const url=new URL(process.env.CRM_TEST_DATABASE_URL||'http://invalid');assert.ok(['127.0.0.1','localhost'].includes(url.hostname));assert.equal(url.pathname,'/ls_salon_crm_test')
const tenant='launch_'+randomUUID().replaceAll('-',''),foreign=tenant+'_foreign',pools=[],clients=[]
function client(t,bypass=false){const u=new URL(url);if(!bypass){u.username='crm_test_runtime';u.password=''}const pool=new Pool({connectionString:u.toString(),max:3});pools.push(pool);const db=new PrismaClient({adapter:new TenantPgAdapter(pool,{tenantId:t,bypass})});clients.push(db);return db}
const root=client(undefined,true),db=client(tenant),otherDb=client(foreign),fail=code=>e=>e.status===code
let admin,staff,other,service,catalog,reservations,orders,crm,project,leaf,deal,category
const future=()=>new Date(Date.now()+86400000).toISOString()
const phase=(code,status='PLANNED',opensAt=null)=>service.saveLaunchPhase(project.id,{name:code,code,status,opensAt})
const update=(row,patch)=>service.saveLaunchPhase(project.id,{name:row.name,code:row.code,status:row.status,opensAt:row.opensAt?.toISOString()||null,version:row.version,...patch},row.id)
const unit=launchPhaseId=>catalog.save({code:randomUUID(),name:'Phase unit',kind:'UNIT',unit:'plot',price:'1000',currency:'INR',extensionKey:'realEstate',extension:{projectId:leaf.id,categoryId:category,launchPhaseId}})
async function orderFor(item){const q=await crm.saveQuotation(deal.id,{content:{...structuredClone(emptyQuotationContent),title:'Launch booking',supplierName:'Synthetic builder',currency:'INR',lines:[{description:item.name,quantity:'1',unit:item.unit,rate:'1000',catalogItemId:item.id,catalogItemVersion:item.version}]}});return orders.create({quotationId:q.id,revision:1})}
before(async()=>{
 await root.tenant.createMany({data:[tenant,foreign].map(id=>({id,slug:id,name:id}))})
 const user=(tenantId,role)=>fixtureUser(root,{data:{tenantId,role,name:role,email:randomUUID()+'@example.test'}})
 admin=await user(tenant,'ADMIN');staff=await user(tenant,'STAFF');other=await user(foreign,'ADMIN')
 await root.tenantModule.createMany({data:[tenant,foreign].flatMap(tenantId=>['crm','realEstate','catalog','salesDocuments','salesOrders','receivables'].map(key=>({tenantId,key,allowed:true,enabled:true})))})
 const identity={tenantId:tenant,userId:admin.id}
 service=createRealEstateService(db,identity);catalog=applicationCatalog(db,identity);crm=createApplicationCrmService(db,identity);reservations=applicationReservations(db,identity);orders=applicationSalesOrders(db,identity)
 project=await service.createProject({name:'Launch estate',code:'ESTATE'})
 let parent=project;for(let i=1;i<=5;i++)parent=await service.createProject({name:'Level '+i,code:'LEVEL'+i,parentId:parent.id});leaf=parent
 category=(await service.listChoices('property-categories',{})).items[0].id
 const contact=await crm.createContact({name:'Synthetic launch buyer'}),pipeline=await root.crmPipeline.create({data:{tenantId:tenant,name:'Launch sales'}}),stage=await root.crmStage.create({data:{tenantId:tenant,pipelineId:pipeline.id,name:'Open',position:0,kind:'OPEN',probability:10,color:'#123456'}})
 deal=await crm.createOpportunity({title:'Launch opportunity',contactId:contact.id,assignedUserId:admin.id,pipelineId:pipeline.id,stageId:stage.id,amount:'1000',currency:'INR',expectedCloseOn:'2027-01-01'})
})
after(async()=>{await Promise.all(clients.map(c=>c.$disconnect()));await Promise.all(pools.map(p=>p.end()))})

test('phase configuration is paged, versioned, scoped and audited without changing company or project state',async()=>{
 const first=await phase('FIRST'),second=await phase('SECOND')
 assert.equal(first.projectId,project.id);assert.equal(first.status,'PLANNED')
 const list=await service.listLaunchPhases(leaf.id,{pageSize:1});assert.equal(list.total,2);assert.equal(list.items.length,1)
 const opened=await update(first,{status:'OPEN'});assert.equal(opened.version,2)
 await assert.rejects(update(first,{status:'PAUSED'}),fail(409))
 assert.equal(await root.auditLog.count({where:{tenantId:tenant,event:'realEstate.launchPhase.updated',entityId:project.id}}),1)
 assert.equal((await service.getProject(project.id)).version,project.version)
 const reader=createRealEstateService(db,{tenantId:tenant,userId:staff.id})
 await assert.rejects(reader.listLaunchPhases(project.id,{}),fail(404))
 await service.changeMember(project.id,{version:project.version,userId:staff.id})
 assert.equal((await reader.listLaunchPhases(leaf.id,{})).canManage,false)
 await assert.rejects(reader.saveLaunchPhase(project.id,{name:'Forbidden',code:'NO',status:'OPEN'}),fail(403))
 await assert.rejects(createRealEstateService(otherDb,{tenantId:foreign,userId:other.id}).listLaunchPhases(project.id,{}),fail(404))
 await assert.rejects(root.realEstateLaunchPhase.delete({where:{tenantId_id:{tenantId:tenant,id:second.id}}}),/retained/)
 await assert.rejects(root.realEstateLaunchPhase.update({where:{tenantId_id:{tenantId:tenant,id:second.id}},data:{status:'OPEN'}}),/version/)
})
test('units at any depth may select only a phase of their own root, with native cross-project guards',async()=>{
 const p=await phase('NESTED'),item=await unit(p.id),detail=await catalog.get(item.id)
 assert.equal(detail.extension.launchPhaseId,p.id);assert.equal(detail.extension.projectId,leaf.id)
 const another=await service.createProject({name:'Other estate',code:'OTHER'}),wrong=await service.saveLaunchPhase(another.id,{name:'Wrong',code:'WRONG',status:'OPEN'})
 await assert.rejects(unit(wrong.id),fail(400))
 await assert.rejects(root.realEstateUnit.update({where:{tenantId_itemId:{tenantId:tenant,itemId:item.id}},data:{launchPhaseId:wrong.id}}),/must belong/)
 await assert.rejects(root.realEstateLaunchPhase.update({where:{tenantId_id:{tenantId:tenant,id:p.id}},data:{projectId:another.id,version:2}}),/identity/)
})
test('planned, paused, closed and future opening block new holds; open past/current permits holds',async()=>{
 for(const state of ['PLANNED','PAUSED','CLOSED','FUTURE']){
  const p=await phase('GATE_'+state,state==='FUTURE'?'OPEN':state,state==='FUTURE'?future():null),item=await unit(p.id),order=await orderFor(item)
  assert.equal((await reservations.list(order.id)).units[0].available,false)
  assert.match((await catalog.get(item.id)).reservationBlockedReason,/not open/)
  await assert.rejects(reservations.create(order.id,{itemId:item.id,expiresAt:future()}),fail(409))
  await assert.rejects(root.unitReservation.create({data:{tenantId:tenant,orderId:order.id,itemId:item.id,itemCode:item.code,itemName:item.name,expiresAt:new Date(future())}}),/not open/)
  await update(p,{status:'OPEN',opensAt:new Date(Date.now()-60000).toISOString()})
  assert.equal((await reservations.list(order.id)).units[0].available,true)
  const held=await reservations.create(order.id,{itemId:item.id,expiresAt:future()});assert.equal(held.status,'HELD')
 }
})
test('pausing retains existing hold retries, allocation, release and payments; units without phases retain prior behaviour',async()=>{
 let p=await phase('COMMITMENTS','OPEN');const item=await unit(p.id),order=await orderFor(item),held=await reservations.create(order.id,{itemId:item.id,expiresAt:future()})
 p=await update(p,{status:'PAUSED'})
 assert.equal((await reservations.create(order.id,{itemId:item.id,expiresAt:future()})).id,held.id)
 await orders.transition(order.id,{action:'confirm',version:order.version})
 const allocated=await reservations.transition(order.id,held.id,{action:'allocate',version:held.version});assert.equal(allocated.status,'ALLOCATED')
 await assert.rejects(root.realEstateUnit.update({where:{tenantId_itemId:{tenantId:tenant,itemId:item.id}},data:{launchPhaseId:null}}),/Release/)
 const {applicationReceivables}=require('../application/receivables/service.ts'),finance=applicationReceivables(db,{tenantId:tenant,userId:admin.id})
 await finance.open(order.id,{dueDates:[null]})
 await finance.record(order.id,{requestKey:randomUUID(),version:1,amount:'100',receivedOn:'2026-11-19',method:'CASH',reference:'',note:''})
 assert.equal(String((await finance.get(order.id)).paid),'100')
 await reservations.transition(order.id,held.id,{action:'release',version:allocated.version,reason:'Synthetic release'})
 await assert.rejects(reservations.create(order.id,{itemId:item.id,expiresAt:future()}),fail(409))
 const ordinary=await unit(null),ordinaryOrder=await orderFor(ordinary)
 assert.equal((await reservations.list(ordinaryOrder.id)).units[0].available,true)
 assert.equal((await reservations.create(ordinaryOrder.id,{itemId:ordinary.id,expiresAt:future()})).status,'HELD')
})
test('native phase metadata respects restricted project sharing without removing assigned staff access',async()=>{
 const {createRecordSharingService}=require('../platform/access/sharing-service.ts')
  const outsider=await fixtureUser(root,{data:{tenantId:tenant,role:'MANAGER',name:'Unassigned manager',email:randomUUID()+'@example.test'}})
 const sharing=createRecordSharingService(db,{tenantId:tenant,userId:admin.id})
 await sharing.save('projects',project.id,{version:0,restricted:true,grants:[]})
 await db.$transaction(async tx=>{
  await authorizeBusinessOperation(tx,{tenantId:tenant,userId:outsider.id},'projects.read',['crm','realEstate'])
  assert.equal(await tx.realEstateLaunchPhase.count({where:{tenantId:tenant,projectId:project.id}}),0)
 })
  assert.ok((await createRealEstateService(db,{tenantId:tenant,userId:staff.id}).listLaunchPhases(project.id,{})).total>0)
 await sharing.save('projects',project.id,{version:1,restricted:false,grants:[]})
})
test('phase changes roll back if audit fails and concurrent edits accept one version only',async()=>{
 const p=await phase('ATOMIC','OPEN')
 await root.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION app.launch_test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."tenantId"='${tenant}' AND NEW.event='realEstate.launchPhase.updated' THEN RAISE EXCEPTION 'Synthetic phase audit failure'; END IF; RETURN NEW; END $$`)
 await root.$executeRawUnsafe('CREATE TRIGGER launch_test_audit_failure BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION app.launch_test_audit_failure()')
 try{await assert.rejects(update(p,{status:'PAUSED'}),/Synthetic phase audit failure/)}finally{await root.$executeRawUnsafe('DROP TRIGGER launch_test_audit_failure ON "AuditLog"');await root.$executeRawUnsafe('DROP FUNCTION app.launch_test_audit_failure()')}
 assert.equal((await root.realEstateLaunchPhase.findUnique({where:{tenantId_id:{tenantId:tenant,id:p.id}}})).status,'OPEN')
 const results=await Promise.allSettled([update(p,{status:'PAUSED'}),update(p,{status:'CLOSED'})])
 assert.equal(results.filter(row=>row.status==='fulfilled').length,1);assert.equal(results.find(row=>row.status==='rejected').reason.status,409)
})
