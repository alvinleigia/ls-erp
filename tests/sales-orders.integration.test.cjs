/* eslint-disable @typescript-eslint/no-require-imports */
const {materializeRules}=require('./helpers/resource-policy-data.cjs')
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

test('creation review checks current authority and saved terms without consuming a reference',async()=>{
 const q=await quote(),input={quotationId:q.id,revision:1},before=await root.salesOrderSequence.findUnique({where:{tenantId:tenant}})
 const view=await orders.prepareCreate(input)
 assert.equal(view.quotationId,q.id);assert.equal(view.revision,1)
 assert.equal(view.title,'Annual maintenance');assert.equal(view.customerName,'Original customer');assert.equal(view.existing,null)
 assert.match(view.orderedOn,/^\d{4}-\d{2}-\d{2}$/);assert.equal('snapshot' in view,false)
 assert.deepEqual(await root.salesOrderSequence.findUnique({where:{tenantId:tenant}}),before)
 for(const denied of [otherOrders,foreignOrders])await assert.rejects(denied.prepareCreate(input),status(404))
 const row=await orders.create(input),again=await orders.prepareCreate(input)
 assert.equal(again.existing.id,row.id);assert.equal(again.existing.reference,row.reference)
 assert.equal((await staffOrders.get(row.id)).confirmationReview,undefined)
})

test('parallel creates and retries allocate unique references once; search respects record scope',async()=>{
 const a=await quote(),b=await quote(),before=(await root.salesOrderSequence.findUnique({where:{tenantId:tenant}}))?.value||0
 const rows=await Promise.all([orders.create({quotationId:a.id,revision:1}),orders.create({quotationId:b.id,revision:1}),orders.create({quotationId:a.id,revision:1})])
 assert.equal(rows[0].id,rows[2].id);assert.equal(new Set(rows.map(row=>row.reference)).size,2)
 for(const row of rows)assert.match(row.reference,/^SO-\d{6,}$/)
 assert.equal((await root.salesOrderSequence.findUnique({where:{tenantId:tenant}})).value,before+2)
 assert.equal((await orders.list({q:rows[0].reference})).items[0].id,rows[0].id)
 assert.equal((await otherOrders.list({q:rows[0].reference})).total,0);assert.equal((await foreignOrders.list({q:rows[0].reference})).total,0)
 await orders.transition(rows[0].id,{action:'cancel',version:1,reason:'Replace terms'})
 const replacement=await orders.create({quotationId:a.id,revision:1})
 assert.notEqual(replacement.reference,rows[0].reference);assert.equal((await orders.get(rows[0].id)).reference,rows[0].reference)
})

test('tenant calendar defaults, past dates and immutable saved references/dates',async()=>{
 await root.appSetting.upsert({where:{tenantId:tenant},create:{tenantId:tenant,timeZone:'Pacific/Kiritimati'},update:{timeZone:'Pacific/Kiritimati'}})
 try{
  const q=await quote(),view=await orders.prepareCreate({quotationId:q.id,revision:1}),[{date}]=await root.$queryRaw`SELECT (clock_timestamp() AT TIME ZONE 'Pacific/Kiritimati')::date AS date`
  assert.equal(view.orderedOn,date.toISOString().slice(0,10))
  const row=await orders.create({quotationId:q.id,revision:1,orderedOn:'2024-02-29'})
  assert.equal(row.orderedOn.toISOString().slice(0,10),'2024-02-29')
  assert.equal((await orders.create({quotationId:q.id,revision:1,orderedOn:'2024-02-29'})).id,row.id)
  await assert.rejects(orders.create({quotationId:q.id,revision:1,orderedOn:'2024-03-01'}),status(409))
  const where={tenantId_id:{tenantId:tenant,id:row.id}}
  await assert.rejects(root.salesOrder.update({where,data:{orderedOn:new Date('2024-03-01')}}),/immutable/)
  await assert.rejects(root.salesOrder.update({where,data:{reference:'SO-999999'}}),/immutable/)
  await orders.transition(row.id,{action:'confirm',version:1});await orders.transition(row.id,{action:'cancel',version:2,reason:'Date stays recorded'})
  assert.equal((await orders.get(row.id)).orderedOn.toISOString().slice(0,10),'2024-02-29')
  const fresh=await quote(),input={quotationId:fresh.id,revision:1}
  assert.throws(()=>orders.create({...input,orderedOn:'2025-02-29'}));assert.throws(()=>orders.create({...input,reference:'Injected'}));assert.throws(()=>orders.create({...input,revision:'1'}))
  await assert.rejects(orders.create({...input,orderedOn:'2999-01-01'}),status(400))
  assert.equal(await root.salesOrder.count({where:{tenantId:tenant,quotationId:fresh.id}}),0)
 }finally{await root.appSetting.update({where:{tenantId:tenant},data:{timeZone:'UTC'}})}
})

test('numbering stays per tenant, private to the trigger and protected from caller overrides',async()=>{
 const foreignCrm=createApplicationCrmService(dbB,identity(foreign)),person=await foreignCrm.createContact({name:'Foreign customer'})
 const pipeline=await root.crmPipeline.create({data:{tenantId:otherTenant,name:'Foreign sales'}}),stage=await root.crmStage.create({data:{tenantId:otherTenant,pipelineId:pipeline.id,name:'Open',position:0,kind:'OPEN',probability:10,color:'#123456'}})
 const d=await foreignCrm.createOpportunity({title:'Other agreement',contactId:person.id,assignedUserId:foreign.id,pipelineId:pipeline.id,stageId:stage.id,amount:'300.375',currency:'INR',expectedCloseOn:'2027-01-01'})
 const q=await foreignCrm.saveQuotation(d.id,{content:content()}),row=await foreignOrders.create({quotationId:q.id,revision:1})
 assert.equal(row.reference,'SO-000001')
 for(const connection of [db,dbB,unscoped])await assert.rejects(connection.salesOrderSequence.findMany())
 await assert.rejects(db.salesOrderSequence.update({where:{tenantId:tenant},data:{value:999}}))
 const own=await quote(),saved=await crm.getQuotation(own.id),before=await root.salesOrderSequence.findUnique({where:{tenantId:tenant}})
 await assert.rejects(root.salesOrder.create({data:{tenantId:tenant,quotationId:own.id,revision:1,title:'Injected',customerName:'Injected',currency:'INR',consideration:'1',snapshot:saved.snapshot,reference:'SO-999999',createdBy:admin.id}}),/generated by the system/)
 assert.deepEqual(await root.salesOrderSequence.findUnique({where:{tenantId:tenant}}),before)
})

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
test('new quotation participant evidence preserves authoritative IDs into the order',async()=>{
 const q=await quote(),saved=await crm.getQuotation(q.id)
 assert.equal(saved.snapshot.participants.format,1)
 assert.deepEqual(saved.snapshot.participants.participants,[{role:'CUSTOMER',party:{kind:'PERSON',id:contact.id,name:'Original customer',email:'original@example.test',phone:null,sourceVersion:1}}])
 const order=await orders.create({quotationId:q.id,revision:1})
 assert.deepEqual((await orders.get(order.id)).snapshot.participants,saved.snapshot.participants)
 assert.throws(()=>crm.saveQuotation(deal.id,{content:content(),participants:{format:1,participants:[]}}))
})

test('business customer and its representative keep separate identities without Real Estate',async()=>{
 const business=await root.crmAccount.create({data:{tenantId:tenant,name:'Company buyer',email:'private@example.test',phone:'private-directory-phone',ownerUserId:staff.id}})
 try{
  await root.crmOpportunity.update({where:{tenantId_id:{tenantId:tenant,id:deal.id}},data:{accountId:business.id}})
  const q=await quote(),saved=await crm.getQuotation(q.id),parties=saved.snapshot.participants.participants
  assert.deepEqual(parties.map(p=>[p.role,p.party.kind,p.party.id]),[['CUSTOMER','BUSINESS',business.id],['REPRESENTATIVE','PERSON',contact.id]])
  assert.equal(parties[0].party.email,null);assert.equal(parties[0].party.phone,null)
  const order=await orders.create({quotationId:q.id,revision:1})
  assert.deepEqual((await orders.get(order.id)).snapshot.participants,saved.snapshot.participants)
 }finally{await root.crmOpportunity.update({where:{tenantId_id:{tenantId:tenant,id:deal.id}},data:{accountId:null}})}
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
  assert.deepEqual(saved.snapshot.participants,original.participants)
  assert.equal(saved.snapshot.participants.participants[0].party.id,contact.id)
 }finally{await root.crmOpportunity.update({where:{tenantId_id:{tenantId:tenant,id:deal.id}},data:{contactId:contact.id}})}
})
test('historical snapshots without participant IDs remain exact and are never inferred from current contacts',async()=>{
 const q=await quote(),current=await crm.getQuotation(q.id),historical=structuredClone(current.snapshot)
 delete historical.participants
 const header=await root.crmQuotation.create({data:{tenantId:tenant,opportunityId:deal.id,title:historical.content.title,currency:historical.content.currency,consideration:historical.calculation.consideration}})
 await root.crmQuotationRevision.create({data:{tenantId:tenant,quotationId:header.id,number:1,snapshot:historical}})
 const replacement=await root.crmContact.create({data:{tenantId:tenant,name:'Different present-day customer',ownerUserId:staff.id}})
 try{
  await root.crmOpportunity.update({where:{tenantId_id:{tenantId:tenant,id:deal.id}},data:{contactId:replacement.id}})
  const order=await orders.create({quotationId:header.id,revision:1}),saved=await orders.get(order.id)
  assert.deepEqual(saved.snapshot,historical);assert.equal('participants' in saved.snapshot,false)
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
 const broken=new Proxy(db,{get(target,key){if(key==='$transaction')return (fn,options)=>target.$transaction(tx=>fn(new Proxy(tx,{get(t,k){if(k==='auditLog')return new Proxy(t.auditLog,{get(a,method){return method==='createMany'?async()=>{throw Error('Audit unavailable')}:a[method]}});return t[k]}})),options);return target[key]}})
 const service=applicationSalesOrders(broken,identity(manager)),q=await quote()
 const numberingBefore=await root.salesOrderSequence.findUnique({where:{tenantId:tenant}})
 await assert.rejects(service.create({quotationId:q.id,revision:1}),/Audit unavailable/);assert.equal(await root.salesOrder.count({where:{tenantId:tenant,quotationId:q.id}}),0)
 assert.deepEqual(await root.salesOrderSequence.findUnique({where:{tenantId:tenant}}),numberingBefore)
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
  await root.tenantUserAccess.update({where:{tenantId_userId:{tenantId:tenant,userId:manager.id}},data:{rules:materializeRules('MANAGER','OWN')}});await assert.rejects(orders.get(order.id),status(404))
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
