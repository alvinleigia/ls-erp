/* eslint-disable @typescript-eslint/no-require-imports */
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Pool}=require('pg'),{PrismaClient}=require('@prisma/client')
const {TenantPgAdapter}=require('../lib/tenant-pg-adapter.ts'),{applicationCatalog}=require('../application/catalog/service.ts'),{applicationReservations}=require('../application/catalog/reservations.ts'),{applicationSalesOrders}=require('../application/sales-orders/service.ts'),{createApplicationCrmService}=require('../application/crm/service.ts'),{emptyQuotationContent}=require('../modules/sales-documents/quotation-validation.ts')
const {createAuditReportService}=require('../platform/audit/service.ts')
require('../lib/logger.ts').logger.info=()=>{}
const url=new URL(process.env.CRM_TEST_DATABASE_URL||'http://invalid')
if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!='/ls_salon_crm_test')throw Error('Use the isolated local test database.')
const tenant='reservations_'+randomUUID(),otherTenant='reservations_'+randomUUID(),pools=[],clients=[]
function client(tenantId,root=false){const u=new URL(url);if(!root){u.username='crm_test_runtime';u.password=''}const pool=new Pool({connectionString:u.toString(),max:6});pools.push(pool);const db=new PrismaClient({adapter:new TenantPgAdapter(pool,{tenantId,bypass:root})});clients.push(db);return db}
const root=client(undefined,true),db=client(tenant),dbB=client(otherTenant),unscoped=client(undefined),identity=user=>({tenantId:user.tenantId,userId:user.id}),status=code=>e=>e.status===code
let manager,staff,outsider,other,catalog,reservations,orders,crm,deal,contact
const future=(ms=86400000)=>new Date(Date.now()+ms).toISOString()
const itemInput=(extra={})=>({code:randomUUID(),name:'Equipment unit',kind:'UNIT',price:'100.125',currency:'INR',unit:'each',...extra})
const content=item=>({...structuredClone(emptyQuotationContent),title:'Equipment agreement',supplierName:'Shared Industries',currency:'INR',lines:[{description:item.name,quantity:'1',unit:item.unit,rate:String(item.price),catalogItemId:item.id,catalogItemVersion:item.version}]})
async function orderFor(item){const q=await crm.saveQuotation(deal.id,{content:content(item)});return orders.create({quotationId:q.id,revision:1})}
async function fixture(extra={}){const item=await catalog.save(itemInput(extra)),order=await orderFor(item);return {item,order}}
const hold=(f,expiresAt=future())=>reservations.create(f.order.id,{itemId:f.item.id,expiresAt})
before(async()=>{
 await root.tenant.createMany({data:[tenant,otherTenant].map(id=>({id,slug:id,name:id}))})
 const user=(tenantId,role)=>root.user.create({data:{tenantId,role,name:role,email:randomUUID()+'@example.test'}})
 manager=await user(tenant,'MANAGER');staff=await user(tenant,'STAFF');outsider=await user(tenant,'STAFF');other=await user(otherTenant,'ADMIN')
 await root.tenantModule.createMany({data:[tenant,otherTenant].flatMap(tenantId=>['crm','salesDocuments','salesOrders','catalog','realEstate'].map(key=>({tenantId,key,allowed:true,enabled:true})))})
 catalog=applicationCatalog(db,identity(manager));reservations=applicationReservations(db,identity(manager));orders=applicationSalesOrders(db,identity(manager));crm=createApplicationCrmService(db,identity(manager))
 contact=await root.crmContact.create({data:{tenantId:tenant,name:'Equipment buyer',ownerUserId:staff.id}})
 const pipeline=await root.crmPipeline.create({data:{tenantId:tenant,name:'Sales'}}),stage=await root.crmStage.create({data:{tenantId:tenant,pipelineId:pipeline.id,name:'Qualified',position:0,kind:'OPEN',probability:10,color:'#123456'}})
 deal=await crm.createOpportunity({title:'Equipment agreement',contactId:contact.id,assignedUserId:staff.id,pipelineId:pipeline.id,stageId:stage.id,amount:'100.125',currency:'INR',expectedCloseOn:'2027-01-01'})
})
after(async()=>{await Promise.all(clients.map(c=>c.$disconnect()));await Promise.all(pools.map(p=>p.end()))})

test('generic units: concurrent repeated holds are idempotent; competing orders cannot double reserve',async()=>{
 const f=await fixture(),second=await orderFor(f.item),input={itemId:f.item.id,expiresAt:future()}
 const repeated=await Promise.all([reservations.create(f.order.id,input),reservations.create(f.order.id,input)])
 assert.equal(repeated[0].id,repeated[1].id);assert.equal((await reservations.history(f.order.id)).total,1)
 await assert.rejects(reservations.create(second.id,input),status(409))
 const g=await fixture(),third=await orderFor(g.item)
 const result=await Promise.allSettled([hold(g),reservations.create(third.id,{itemId:g.item.id,expiresAt:future()})])
 assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal(result.find(r=>r.status==='rejected').reason.status,409)
 assert.equal((await catalog.get(f.item.id)).reservationState,'RESERVED');assert.equal((await catalog.list({q:f.item.code,availability:'AVAILABLE'})).total,0)
 assert.equal((await catalog.list({q:f.item.code,availability:'RESERVED'})).total,1)
 await assert.rejects(orderFor(f.item),status(409))
 const saved=await orders.get(f.order.id);assert.equal(saved.status,'DRAFT');assert.equal(String(saved.consideration),'100.13')
})
test('expiry immediately frees availability, prevents allocation and permits another audited hold',async()=>{
 const f=await fixture(),second=await orderFor(f.item),held=await hold(f,future(1200))
 await orders.transition(f.order.id,{action:'confirm',version:1})
 await new Promise(resolve=>setTimeout(resolve,1300))
 assert.equal((await reservations.history(f.order.id)).items[0].status,'EXPIRED');assert.equal((await catalog.get(f.item.id)).reservationState,null)
 assert.equal((await catalog.list({q:f.item.code,availability:'AVAILABLE'})).total,1)
 await assert.rejects(reservations.transition(f.order.id,held.id,{action:'allocate',version:1}),status(409))
 await reservations.create(second.id,{itemId:f.item.id,expiresAt:future()})
 const expired=(await reservations.history(f.order.id)).items[0];assert.equal(expired.events.at(-1).status,'EXPIRED')
 assert.equal(await root.auditLog.count({where:{tenantId:tenant,entityId:held.id,event:'catalog.reservation.expired'}}),1)
})
test('explicit allocation requires confirmation; concurrent versioned release wins once and requires reason',async()=>{
 const f=await fixture(),held=await hold(f)
 await assert.rejects(reservations.transition(f.order.id,held.id,{action:'allocate',version:1}),status(409))
 await orders.transition(f.order.id,{action:'confirm',version:1})
 const allocated=await reservations.transition(f.order.id,held.id,{action:'allocate',version:1});assert.equal(allocated.status,'ALLOCATED')
 assert.equal((await catalog.get(f.item.id)).reservationState,'ALLOCATED');assert.equal((await catalog.list({q:f.item.code,availability:'ALLOCATED'})).total,1)
 assert.throws(()=>reservations.transition(f.order.id,held.id,{action:'release',version:2,reason:' '}))
 const results=await Promise.allSettled(['Changed request','Duplicate'].map(reason=>reservations.transition(f.order.id,held.id,{action:'release',version:2,reason})))
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.status,409)
 const row=(await reservations.history(f.order.id)).items[0];assert.equal(row.events.length,3);assert.equal(row.status,'RELEASED');assert.equal((await catalog.get(f.item.id)).reservationState,null)
 await assert.rejects(reservations.transition(f.order.id,held.id,{action:'allocate',version:3}),status(409))
})
test('invalid selection, expired/overlong expiry, non-unit, unavailable and archived units are rejected',async()=>{
 const f=await fixture(),other=await catalog.save(itemInput()),product=await fixture({kind:'PRODUCT'})
 await assert.rejects(reservations.create(f.order.id,{itemId:other.id,expiresAt:future()}),status(400))
 await assert.rejects(hold(product),status(400))
 for(const expiresAt of [future(-1000),future(31*86400000)])await assert.rejects(hold(f,expiresAt),status(400))
 assert.throws(()=>hold(f,'not a date'))
 for(const change of [{availability:'UNAVAILABLE'},{archived:true}]){
  const g=await fixture();await root.catalogItem.update({where:{tenantId_id:{tenantId:tenant,id:g.item.id}},data:change});await assert.rejects(hold(g),status(409))
 }
 await orders.transition(f.order.id,{action:'cancel',version:1,reason:'Not needed'});await assert.rejects(hold(f),status(409))
})
test('allocated units remain unavailable beyond their original hold expiry',async()=>{
 const f=await fixture(),held=await hold(f,future(1500))
 await orders.transition(f.order.id,{action:'confirm',version:1})
 await reservations.transition(f.order.id,held.id,{action:'allocate',version:1})
 await new Promise(resolve=>setTimeout(resolve,1600))
 assert.equal((await reservations.history(f.order.id)).items[0].status,'ALLOCATED')
 assert.equal((await catalog.get(f.item.id)).reservationState,'ALLOCATED')
 assert.equal((await catalog.list({q:f.item.code,availability:'AVAILABLE'})).total,0)
 await reservations.transition(f.order.id,held.id,{action:'release',version:2,reason:'Release allocation after original expiry'})
 assert.equal((await catalog.get(f.item.id)).reservationState,null)
})
test('order cancellation and catalog changes serialize safely against new holds',async()=>{
 const f=await fixture()
 const cancelled=await Promise.allSettled([hold(f),orders.transition(f.order.id,{action:'cancel',version:1,reason:'Concurrent cancellation'})])
 assert.equal(cancelled[1].status,'fulfilled')
 assert.equal((await orders.get(f.order.id)).status,'CANCELLED')
 assert.equal(await root.unitReservation.count({where:{tenantId:tenant,orderId:f.order.id,status:{in:['HELD','ALLOCATED']}}}),0)
 const g=await fixture()
 const changed=await Promise.allSettled([hold(g),catalog.save(itemInput({code:g.item.code,version:1,availability:'UNAVAILABLE'}),g.item.id)])
 assert.equal(changed.filter(r=>r.status==='fulfilled').length,1)
 assert.equal(changed.find(r=>r.status==='rejected').reason.status,409)
 const row=await catalog.get(g.item.id)
 assert(row.reservationState==='RESERVED' ? row.availability==='AVAILABLE' : row.availability==='UNAVAILABLE')
})
test('tenant RLS, composite FKs, immutable snapshots/history and catalog write guards',async()=>{
 const f=await fixture(),held=await hold(f),where={tenantId_id:{tenantId:tenant,id:held.id}}
 assert.equal((await unscoped.unitReservation.findMany()).length,0);assert.equal((await unscoped.unitReservationEvent.findMany()).length,0)
 assert.equal((await dbB.unitReservation.findMany({where:{tenantId:tenant}})).length,0)
 const foreign=applicationReservations(dbB,identity(other));await assert.rejects(foreign.list(f.order.id),status(404));await assert.rejects(foreign.create(f.order.id,{itemId:f.item.id,expiresAt:future()}),status(404))
 await assert.rejects(root.unitReservation.create({data:{tenantId:otherTenant,orderId:f.order.id,itemId:f.item.id,itemCode:'Forged',itemName:'Forged',expiresAt:new Date(future())}}))
 await assert.rejects(root.unitReservation.update({where,data:{expiresAt:new Date(future(10*86400000))}}));await assert.rejects(root.unitReservation.delete({where}))
 await assert.rejects(root.unitReservationEvent.updateMany({where:{tenantId:tenant,reservationId:held.id},data:{actorName:'Forged'}}))
 await assert.rejects(root.unitReservation.update({where,data:{status:'ALLOCATED',version:2}}))
 await assert.rejects(root.catalogItem.update({where:{tenantId_id:{tenantId:tenant,id:f.item.id}},data:{availability:'SOLD'}}))
 await assert.rejects(catalog.save(itemInput({code:f.item.code,version:1}),f.item.id),status(409))
 await assert.rejects(root.salesOrder.update({where:{tenantId_id:{tenantId:tenant,id:f.order.id}},data:{status:'CANCELLED',version:2}}))
})
test('cancelling order releases allocations even with catalog disabled; audit failure rolls everything back',async()=>{
 const f=await fixture(),held=await hold(f)
 await orders.transition(f.order.id,{action:'confirm',version:1});await reservations.transition(f.order.id,held.id,{action:'allocate',version:1})
 const broken=new Proxy(db,{get(target,key){if(key==='$transaction')return (fn,options)=>target.$transaction(tx=>fn(new Proxy(tx,{get(t,k){if(k==='auditLog')return {create:async()=>{throw Error('Audit unavailable')}};return t[k]}})),options);return target[key]}})
 await assert.rejects(applicationSalesOrders(broken,identity(manager)).transition(f.order.id,{action:'cancel',version:2,reason:'Cancel with audit failure'}),/Audit unavailable/)
 assert.equal((await orders.get(f.order.id)).status,'CONFIRMED');assert.equal((await reservations.history(f.order.id)).items[0].status,'ALLOCATED')
 await root.tenantModule.update({where:{tenantId_key:{tenantId:tenant,key:'catalog'}},data:{enabled:false}})
 try{await orders.transition(f.order.id,{action:'cancel',version:2,reason:'Customer cancelled agreement'});await assert.rejects(reservations.list(f.order.id),status(403))}
 finally{await root.tenantModule.update({where:{tenantId_key:{tenantId:tenant,key:'catalog'}},data:{enabled:true}})}
 const released=(await reservations.history(f.order.id)).items[0];assert.equal(released.status,'RELEASED');assert.equal(released.events.at(-1).reason,'Customer cancelled agreement')
 assert.equal((await catalog.get(f.item.id)).reservationState,null)
 const g=await fixture();await assert.rejects(applicationReservations(broken,identity(manager)).create(g.order.id,{itemId:g.item.id,expiresAt:future()}),/Audit unavailable/);assert.equal((await reservations.history(g.order.id)).total,0)
})
test('current custom permissions, staff/order scope, user status and module gates apply on every request',async()=>{
 const f=await fixture(),held=await hold(f),staffService=applicationReservations(db,identity(staff)),outside=applicationReservations(db,identity(outsider))
 assert.equal((await staffService.history(f.order.id)).total,1);await assert.rejects(staffService.create(f.order.id,{itemId:f.item.id,expiresAt:future()}),status(403));await assert.rejects(outside.history(f.order.id),status(404))
 const permissions=['salesOrders.read','catalogItems.read','unitReservations.read']
 const role=await root.tenantAccessRole.create({data:{tenantId:tenant,name:'Unit reviewer',nameKey:'unit reviewer',permissions}})
 await root.tenantRoleAssignment.create({data:{tenantId:tenant,userId:manager.id,roleId:role.id}})
 try{
  assert.equal((await reservations.list(f.order.id)).canRelease,false)
  await assert.rejects(hold(f),status(403));await assert.rejects(reservations.transition(f.order.id,held.id,{action:'release',version:1,reason:'Denied'}),status(403))
  await root.tenantAccessRole.update({where:{tenantId_id:{tenantId:tenant,id:role.id}},data:{permissions:[...permissions,'unitReservations.cancel']}})
  await reservations.transition(f.order.id,held.id,{action:'release',version:1,reason:'Granted separately'})
  await root.tenantAccessRole.update({where:{tenantId_id:{tenantId:tenant,id:role.id}},data:{crmRecordScope:'OWN'}});await assert.rejects(reservations.list(f.order.id),status(404))
 }finally{await root.tenantRoleAssignment.deleteMany({where:{tenantId:tenant,userId:manager.id}})}
 for(const key of ['salesOrders','catalog','crm','salesDocuments']){
  await root.tenantModule.update({where:{tenantId_key:{tenantId:tenant,key}},data:{enabled:false}})
  try{await assert.rejects(reservations.list(f.order.id),status(403));await assert.rejects(hold(f),status(403))}finally{await root.tenantModule.update({where:{tenantId_key:{tenantId:tenant,key}},data:{enabled:true}})}
 }
 await root.user.update({where:{tenantId_id:{tenantId:tenant,id:manager.id}},data:{status:'SUSPENDED'}})
 try{await assert.rejects(reservations.list(f.order.id),status(403))}finally{await root.user.update({where:{tenantId_id:{tenantId:tenant,id:manager.id}},data:{status:'ACTIVE'}})}
 const audit=await createAuditReportService(db,identity(manager)).list({q:held.id});assert.equal(audit.items.some(row=>row.event.startsWith('catalog.reservation.')),false)
})
test('real estate addon follows project membership and activation; generic reservations remain independent',async()=>{
 const project=await root.realEstateProject.create({data:{tenantId:tenant,name:'Property',code:'RES-PROP'}}),category=await root.realEstatePropertyCategory.findUniqueOrThrow({where:{tenantId_nameKey:{tenantId:tenant,nameKey:'apartment'}}})
 const f=await fixture({extensionKey:'realEstate',extension:{projectId:project.id,categoryId:category.id}}),held=await hold(f),service=applicationReservations(db,identity(staff))
 assert.equal((await service.history(f.order.id)).total,0);assert.equal((await service.list(f.order.id)).units.length,0)
 await root.realEstateProjectMember.create({data:{tenantId:tenant,projectId:project.id,userId:staff.id}})
 assert.equal((await service.history(f.order.id)).items[0].id,held.id)
 await root.tenantModule.update({where:{tenantId_key:{tenantId:tenant,key:'realEstate'}},data:{enabled:false}})
 try{assert.equal((await service.history(f.order.id)).total,0);await assert.rejects(reservations.transition(f.order.id,held.id,{action:'release',version:1,reason:'No project access'}),status(404));const generic=await fixture();await hold(generic)}
 finally{await root.tenantModule.update({where:{tenantId_key:{tenantId:tenant,key:'realEstate'}},data:{enabled:true}})}
})
