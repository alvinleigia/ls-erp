/* eslint-disable @typescript-eslint/no-require-imports */
const {fixtureUser,fixtureRole,fixtureProfile,resetFixtureRoles}=require("./helpers/access-fixtures.cjs")
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Pool}=require('pg'),{PrismaClient}=require('@prisma/client')
const {TenantPgAdapter}=require('../lib/tenant-pg-adapter.ts'),{createApplicationCrmService}=require('../application/crm/service.ts'),{applicationSalesOrders}=require('../application/sales-orders/service.ts'),{emptyQuotationContent}=require('../modules/sales-documents/quotation-validation.ts')
const {updateBusinessModule}=require('../platform/module-service.ts')
require('../lib/logger.ts').logger.info=()=>{}
const url=new URL(process.env.CRM_TEST_DATABASE_URL||'http://invalid')
if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!='/ls_salon_crm_test')throw Error('Use the isolated local test database.')
const tenant='orders_'+randomUUID(),otherTenant='orders_'+randomUUID(),pools=[],clients=[]
function client(tenantId,root=false){const u=new URL(url);if(!root){u.username='crm_test_runtime';u.password=''}const pool=new Pool({connectionString:u.toString(),max:6});pools.push(pool);const db=new PrismaClient({adapter:new TenantPgAdapter(pool,{tenantId,bypass:root})});clients.push(db);return db}
const root=client(undefined,true),db=client(tenant),dbB=client(otherTenant),unscoped=client(undefined)
const identity=user=>({tenantId:user.tenantId,userId:user.id}),status=code=>e=>e.status===code
let admin,manager,staff,other,foreign,orders,staffOrders,otherOrders,foreignOrders,crm,deal,contact
const content=(extra={})=>({...structuredClone(emptyQuotationContent),title:'Annual maintenance',supplierName:'Shared Industries',currency:'INR',lines:[{description:'Support hours',quantity:'3',unit:'hour',rate:'100.125'}],...extra})
const quote=()=>crm.saveQuotation(deal.id,{content:content()})
before(async()=>{
 await root.tenant.createMany({data:[{id:tenant,slug:tenant,name:'Generic orders'},{id:otherTenant,slug:otherTenant,name:'Other'}]})
 const user=(tenantId,role)=>fixtureUser(root,{data:{tenantId,role,name:role,email:randomUUID()+'@example.test'}})
 admin=await user(tenant,'ADMIN');manager=await user(tenant,'MANAGER');staff=await user(tenant,'STAFF');other=await user(tenant,'STAFF');foreign=await user(otherTenant,'ADMIN')
 await root.tenantModule.createMany({data:[tenant,otherTenant].flatMap(tenantId=>['crm','salesDocuments','salesOrders'].map(key=>({tenantId,key,allowed:true,enabled:true})))})
 orders=applicationSalesOrders(db,identity(manager));staffOrders=applicationSalesOrders(db,identity(staff));otherOrders=applicationSalesOrders(db,identity(other));foreignOrders=applicationSalesOrders(dbB,identity(foreign));crm=createApplicationCrmService(db,identity(manager))
 contact=await root.crmContact.create({data:{tenantId:tenant,name:'Original customer',email:'original@example.test',ownerUserId:staff.id}})
 const pipeline=await root.crmPipeline.create({data:{tenantId:tenant,name:'Sales'}}),stage=await root.crmStage.create({data:{tenantId:tenant,pipelineId:pipeline.id,name:'Qualified',position:0,kind:'OPEN',probability:10,color:'#123456'}})
 deal=await crm.createOpportunity({title:'Service contract',contactId:contact.id,assignedUserId:staff.id,pipelineId:pipeline.id,stageId:stage.id,amount:'300.375',currency:'INR',expectedCloseOn:'2027-01-01'})
})
after(async()=>{await Promise.all(clients.map(c=>c.$disconnect()));await Promise.all(pools.map(p=>p.end()))})

test('frozen quotation terms and decimal totals survive source changes; list omits snapshots',async()=>{
 const q=await quote(),source=await crm.getQuotation(q.id),order=await staffOrders.create({quotationId:q.id,revision:1})
 assert.equal(order.status,'DRAFT');assert.equal(String(order.consideration),source.snapshot.calculation.consideration)
 await crm.saveQuotation(deal.id,{content:content({title:'Replacement',lines:[{description:'Changed',quantity:'1',unit:'hour',rate:'999'}]}),version:1},q.id)
 await root.crmContact.update({where:{tenantId_id:{tenantId:tenant,id:contact.id}},data:{name:'Changed customer'}})
 const saved=await orders.get(order.id);assert.deepEqual(saved.snapshot,source.snapshot);assert.equal(saved.customerName,'Original customer');assert.equal(saved.history.length,1)
 assert.equal(saved.history[0].actorId,staff.id);assert.equal(saved.canConfirm,true);assert.equal((await staffOrders.get(order.id)).canConfirm,false)
 const list=await orders.list({pageSize:1,q:order.id});assert.equal(list.total,1);assert.equal('snapshot' in list.items[0],false)
 assert.equal((await orders.list({q:order.id,page:2,pageSize:1})).items.length,0)
 await assert.rejects(orders.create({quotationId:q.id,revision:2}),status(409))
 await root.crmContact.update({where:{tenantId_id:{tenantId:tenant,id:contact.id}},data:{name:'Original customer'}})
})
test('parallel create requests return one active order and one audit event',async()=>{
 const q=await quote(),input={quotationId:q.id,revision:1}
 const rows=await Promise.all([orders.create(input),orders.create(input),orders.create(input)])
 assert.equal(new Set(rows.map(r=>r.id)).size,1)
 assert.equal(await root.salesOrderEvent.count({where:{tenantId:tenant,orderId:rows[0].id}}),1)
 assert.equal(await root.auditLog.count({where:{tenantId:tenant,entityId:rows[0].id,event:'salesOrder.draft'}}),1)
})
test('creation uses the selected revision customer even after opportunity reassignment',async()=>{
 const q=await quote(),original=(await crm.getQuotation(q.id)).snapshot
 const replacement=await root.crmContact.create({data:{tenantId:tenant,name:'Replacement contact',ownerUserId:staff.id}})
 try{
  await root.crmOpportunity.update({where:{tenantId_id:{tenantId:tenant,id:deal.id}},data:{contactId:replacement.id}})
  const order=await orders.create({quotationId:q.id,revision:1}),saved=await orders.get(order.id)
  assert.deepEqual(saved.snapshot.customer,original.customer);assert.equal(saved.customerName,original.customer.name)
 }finally{await root.crmOpportunity.update({where:{tenantId_id:{tenantId:tenant,id:deal.id}},data:{contactId:contact.id}})}
})
test('staff record scope, cross-tenant FKs and forced RLS prevent data disclosure',async()=>{
 const q=await quote(),order=await staffOrders.create({quotationId:q.id,revision:1})
 for(const denied of [otherOrders,foreignOrders]){await assert.rejects(denied.get(order.id),status(404));await assert.rejects(denied.create({quotationId:q.id,revision:1}),status(404));assert.equal((await denied.list({q:order.id})).total,0)}
 assert.equal((await unscoped.salesOrder.findMany()).length,0);assert.equal((await unscoped.salesOrderEvent.findMany()).length,0)
 assert.equal((await dbB.salesOrder.findMany({where:{tenantId:tenant}})).length,0)
 await assert.rejects(root.salesOrder.create({data:{tenantId:otherTenant,quotationId:q.id,revision:1,title:'Invalid',customerName:'Invalid',currency:'INR',consideration:'1',snapshot:{},createdBy:foreign.id}}))
 await assert.rejects(root.salesOrderEvent.create({data:{tenantId:otherTenant,orderId:order.id,version:1,status:'DRAFT',actorId:foreign.id,actorName:'Invalid'}}))
 await assert.rejects(staffOrders.transition(order.id,{action:'confirm',version:1}),status(403))
})
test('confirmation is versioned and atomic; cancellation is terminal and permits replacement',async()=>{
 const q=await quote(),order=await orders.create({quotationId:q.id,revision:1})
 const results=await Promise.allSettled([orders.transition(order.id,{action:'confirm',version:1}),orders.transition(order.id,{action:'cancel',version:1,reason:'Concurrent cancellation'})])
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.status,409)
 let current=await orders.get(order.id)
 if(current.status==='CONFIRMED') current=await orders.transition(order.id,{action:'cancel',version:2,reason:'Customer changed requirements'})
 await assert.rejects(orders.transition(order.id,{action:'confirm',version:current.version}),status(409))
 const replacement=await orders.create({quotationId:q.id,revision:1});assert.notEqual(replacement.id,order.id)
 const history=(await orders.get(order.id)).history;assert.equal(history.at(-1).status,'CANCELLED');assert(history.at(-1).reason)
 assert.equal((await root.crmOpportunity.findUnique({where:{tenantId_id:{tenantId:tenant,id:deal.id}}})).stageId,deal.stageId)
})
test('database rejects snapshot edits, deletion, invalid starts, duplicate active orders and history rewrites',async()=>{
 const q=await quote(),order=await orders.create({quotationId:q.id,revision:1}),where={tenantId_id:{tenantId:tenant,id:order.id}}
 await assert.rejects(root.salesOrder.update({where,data:{title:'Tampered'}}));await assert.rejects(root.salesOrder.delete({where}))
 await assert.rejects(root.salesOrderEvent.update({where:{tenantId_orderId_version:{tenantId:tenant,orderId:order.id,version:1}},data:{actorName:'Tampered'}}))
 const data={tenantId:tenant,quotationId:q.id,revision:1,title:'Duplicate',customerName:'X',currency:'INR',consideration:'1',snapshot:{},createdBy:admin.id}
 await assert.rejects(root.salesOrder.create({data}));await assert.rejects(root.salesOrder.create({data:{...data,status:'CONFIRMED'}}))
 assert.throws(()=>orders.transition(order.id,{action:'cancel',version:1,reason:' '}))
 assert.throws(()=>orders.create({quotationId:q.id,revision:1,snapshot:{consideration:'0'}}))
})
test('failed mandatory audit rolls back draft and transitions',async()=>{
 const broken=new Proxy(db,{get(target,key){if(key==='$transaction')return (fn,options)=>target.$transaction(tx=>fn(new Proxy(tx,{get(t,k){if(k==='auditLog')return new Proxy(t.auditLog,{get(a,method){return method==='create'?async()=>{throw Error('Audit unavailable')}:a[method]}});return t[k]}})),options);return target[key]}})
 const service=applicationSalesOrders(broken,identity(manager)),q=await quote()
 await assert.rejects(service.create({quotationId:q.id,revision:1}),/Audit unavailable/);assert.equal(await root.salesOrder.count({where:{tenantId:tenant,quotationId:q.id}}),0)
 const order=await orders.create({quotationId:q.id,revision:1});await assert.rejects(service.transition(order.id,{action:'confirm',version:1}),/Audit unavailable/)
 const saved=await orders.get(order.id);assert.equal(saved.status,'DRAFT');assert.equal(saved.history.length,1)
})
test('fresh module allowance, dependency, tenant and user status checks apply to existing services',async()=>{
 const q=await quote(),order=await orders.create({quotationId:q.id,revision:1})
 await assert.rejects(updateBusinessModule(db,identity(admin),{key:'salesDocuments',enabled:false}),status(409))
 for(const key of ['salesOrders','salesDocuments','crm']){
  await root.tenantModule.update({where:{tenantId_key:{tenantId:tenant,key}},data:{enabled:false}})
  await assert.rejects(orders.get(order.id),status(403));await assert.rejects(orders.create({quotationId:q.id,revision:1}),status(403));await assert.rejects(orders.transition(order.id,{action:'confirm',version:1}),status(403))
  await root.tenantModule.update({where:{tenantId_key:{tenantId:tenant,key}},data:{enabled:true}})
 }
 await root.tenantModule.update({where:{tenantId_key:{tenantId:tenant,key:'salesOrders'}},data:{allowed:false,enabled:false}});await assert.rejects(orders.list({}),status(403));await root.tenantModule.update({where:{tenantId_key:{tenantId:tenant,key:'salesOrders'}},data:{allowed:true,enabled:true}})
 await root.tenant.update({where:{id:tenant},data:{status:'SUSPENDED'}});await assert.rejects(orders.get(order.id),status(403));await root.tenant.update({where:{id:tenant},data:{status:'ACTIVE'}})
 await root.user.update({where:{tenantId_id:{tenantId:tenant,id:manager.id}},data:{status:'SUSPENDED'}});await assert.rejects(orders.get(order.id),status(403));await root.user.update({where:{tenantId_id:{tenantId:tenant,id:manager.id}},data:{status:'ACTIVE'}})
})
test('custom role permissions are independent, refreshed, and do not grant managers wider record scope',async()=>{
 const q=await quote(),order=await orders.create({quotationId:q.id,revision:1})
 const role=await fixtureProfile(root,{data:{tenantId:tenant,name:'Order reader',nameKey:'order reader',permissions:['salesOrders.read']}})
 await fixtureRole(root,{data:{tenantId:tenant,userId:manager.id,roleId:role.id}})
 try{
  assert.equal((await orders.get(order.id)).canConfirm,false)
  await assert.rejects(orders.create({quotationId:q.id,revision:1}),status(403));await assert.rejects(orders.transition(order.id,{action:'confirm',version:1}),status(403))
  await root.tenantAccessRole.update({where:{tenantId_id:{tenantId:tenant,id:role.id}},data:{permissions:['salesOrders.read','salesOrders.confirm']}})
  await orders.transition(order.id,{action:'confirm',version:1})
  await assert.rejects(orders.transition(order.id,{action:'cancel',version:2,reason:'Denied'}),status(403))
  await root.tenantUserAccess.update({where:{tenantId_userId:{tenantId:tenant,userId:manager.id}},data:{salesRecordScope:'OWN'}});await assert.rejects(orders.get(order.id),status(404))
 }finally{await resetFixtureRoles(root,{where:{tenantId:tenant,userId:manager.id}})}
})
test('team manager scope is rechecked and ordinary membership does not widen staff access',async()=>{
 const q=await quote(),order=await orders.create({quotationId:q.id,revision:1})
 const team=await root.businessTeam.create({data:{tenantId:tenant,name:'Support',nameKey:'support'}})
 const role=await fixtureProfile(root,{data:{tenantId:tenant,name:'Team orders',nameKey:'team orders',permissions:['salesOrders.read','salesOrders.confirm'],salesRecordScope:'MANAGED_TEAMS'}})
 await fixtureRole(root,{data:{tenantId:tenant,userId:manager.id,roleId:role.id}})
 await root.businessTeamMember.createMany({data:[{tenantId:tenant,teamId:team.id,userId:manager.id,isManager:true},{tenantId:tenant,teamId:team.id,userId:other.id,isManager:false}]})
 try{
  await assert.rejects(orders.get(order.id),status(404))
  await root.crmOpportunity.update({where:{tenantId_id:{tenantId:tenant,id:deal.id}},data:{salesTeamId:team.id}})
  assert.equal((await orders.get(order.id)).canConfirm,true);await assert.rejects(otherOrders.get(order.id),status(404))
  await root.businessTeamMember.update({where:{tenantId_teamId_userId:{tenantId:tenant,teamId:team.id,userId:manager.id}},data:{isManager:false}})
  await assert.rejects(orders.transition(order.id,{action:'confirm',version:1}),status(404))
 }finally{await resetFixtureRoles(root,{where:{tenantId:tenant,userId:manager.id}});await root.crmOpportunity.update({where:{tenantId_id:{tenantId:tenant,id:deal.id}},data:{salesTeamId:null}})}
})
