/* eslint-disable @typescript-eslint/no-require-imports */
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { AsyncLocalStorage } = require('node:async_hooks')
const { Client } = require('pg')
const raw = process.env.CRM_TEST_DATABASE_URL
const url = new URL(raw || 'http://invalid')
if (!['localhost','127.0.0.1'].includes(url.hostname) || url.pathname !== '/ls_salon_crm_test') throw Error('Disposable local database only.')
const root = new Client({ connectionString: raw })
url.username='crm_test_runtime'; url.password=''
process.env.DATABASE_URL=url.toString(); process.env.RLS_POOL_MAX='1'
const sessions = new AsyncLocalStorage()
const authPath = path.resolve(__dirname, '../auth.ts')
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: { auth: async () => { await Promise.resolve(); return sessions.getStore() || null } } }
const { logger } = require('../lib/logger.ts')
const errors=[]; logger.info=()=>{};logger.error=(_e,c)=>errors.push(c.error?.message)
const {prisma,runWithTenantDbContext}=require('../lib/prisma.ts')
const routes=Object.fromEntries(['services','service-categories'].map(name=>[name,{list:require(`../app/api/${name}/route.ts`),detail:require(`../app/api/${name}/[id]/route.ts`)}]))
const bookings=require('../app/api/appointments/route.ts'), booking=require('../app/api/appointments/[id]/route.ts'), availability=require('../app/api/appointments/availability/route.ts')
const orders=require('../app/api/appointments/orders/route.ts')
const orderDetail=require('../app/api/appointments/orders/[id]/route.ts'), invoice=require('../app/api/appointments/orders/[id]/invoice/route.ts')
const {resolveOrderData}=require('../app/api/appointments/orders/_resolve.ts')
const users=require('../app/api/users/route.ts'), userDetail=require('../app/api/users/[id]/route.ts')
const seeds=require('../app/api/seeds/route.ts'), dashboard=require('../app/api/dashboard/summary/route.ts')
const {servicesNavigation}=require('../application/navigation.ts')
const {workspaceRead}=require('../platform/access/catalog.ts'),{satisfies}=require('../platform/access/policy.ts')
const suffix=require('node:crypto').randomUUID().replaceAll('-',''), a=`svc_a_${suffix}`, b=`svc_b_${suffix}`, rid=`svc_role_${suffix}`
const session=(tenant=a,role='ADMIN')=>({user:{id:`${tenant}_${role.toLowerCase()}`,tenantId:tenant,role}})
const req=(method,body,tenant=a,endpoint='/services')=>new Request(`http://${tenant}.localhost/api${endpoint}`,{method,headers:{host:`${tenant}.localhost`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})})
const invoke=(name,method,body,id,tenant=a,role='ADMIN',query='')=>sessions.run(session(tenant,role),()=> (id?routes[name].detail:routes[name].list)[method](req(method,body,tenant,`/${name}${query}`),{params:Promise.resolve({id})}))
const call=(route,method,body,id,role='ADMIN')=>sessions.run(session(a,role),()=>route[method](req(method,body),{params:Promise.resolve({id})}))
const perms=p=>root.query('UPDATE "TenantAccessRole" SET permissions=$1 WHERE id=$2',[p,rid])
const flag=(enabled,allowed=true)=>root.query('UPDATE "TenantModule" SET enabled=$1,allowed=$2 WHERE "tenantId"=$3 AND key=\'services\'',[enabled,allowed,a])
async function ok(response,status=200){const data=await response.json();assert.equal(response.status,status,JSON.stringify({data,errors}));return data}
let category,service,foreign,appointmentId,orderId
before(async()=>{
 await root.connect()
 for(const tenant of [a,b]){
  await root.query('INSERT INTO "Tenant" (id,name,slug,"updatedAt") VALUES ($1,$1,$1,now())',[tenant])
  for(const role of ['ADMIN','MANAGER','STAFF','CUSTOMER'])await root.query('INSERT INTO "User" (id,name,email,role,"tenantId","updatedAt") VALUES ($1,$1,$2,$3,$4,now())',[`${tenant}_${role.toLowerCase()}`,`${tenant}_${role}@example.test`,role,tenant])
  await root.query('INSERT INTO "TenantModule" ("tenantId",key,allowed,enabled,"updatedAt") VALUES ($1,\'services\',true,true,now())',[tenant])
  await root.query('INSERT INTO "TenantModule" ("tenantId",key,allowed,enabled,"updatedAt") VALUES ($1,\'appointments\',true,true,now())',[tenant])
 }
 await root.query('INSERT INTO "TenantAccessRole" (id,"tenantId",name,"nameKey",permissions,"updatedAt") VALUES ($1,$2,\'Services test\',\'services test\',$3,now())',[rid,a,[]])
 await root.query('INSERT INTO "TenantRoleAssignment" ("tenantId","userId","roleId","updatedAt") VALUES ($1,$2,$3,now())',[a,`${a}_manager`,rid])
})
after(async()=>{
 for(const tenant of [a,b]){
  await root.query('DELETE FROM "Appointment" WHERE "tenantId"=$1',[tenant])
  await root.query('DELETE FROM "AppointmentOrder" WHERE "tenantId"=$1',[tenant])
  await root.query('DELETE FROM "StaffServiceEligibility" WHERE "userId" IN (SELECT id FROM "User" WHERE "tenantId"=$1)',[tenant])
  await root.query('DELETE FROM "ServicePackageItem" WHERE "packageId" IN (SELECT id FROM "Service" WHERE "tenantId"=$1)',[tenant])
  for(const table of ['Service','ServiceCategory','RealEstateProjectStatus','RealEstatePropertyCategory','RealEstateBuyingTimeframe'])await root.query(`DELETE FROM "${table}" WHERE "tenantId"=$1`,[tenant])
 }
 await root.query('DELETE FROM "TenantRoleAssignment" WHERE "tenantId"=$1',[a]); await root.query('DELETE FROM "Tenant" WHERE id IN ($1,$2)',[a,b]);await root.end();await prisma.$disconnect();await global.prismaPool?.end()
})
test('all catalog endpoints fail closed when disabled, revoked or missing',async()=>{
 for(const state of ['disabled','revoked','missing']){
  if(state==='missing')await root.query('DELETE FROM "TenantModule" WHERE "tenantId"=$1 AND key=\'services\'',[a]);else await flag(false,state!=='revoked')
  for(const name of Object.keys(routes))for(const method of ['GET','POST','PATCH','DELETE'])assert.equal((await invoke(name,method,method==='GET'?undefined:{},['PATCH','DELETE'].includes(method)?'missing':undefined)).status,403,`${state} ${name} ${method}`)
 }
 await root.query('INSERT INTO "TenantModule" ("tenantId",key,allowed,enabled,"updatedAt") VALUES ($1,\'services\',true,true,now())',[a])
})
test('catalog CRUD and paging work through actual tenant RLS, including packages and taxes',async()=>{
 category=(await ok(await invoke('service-categories','POST',{name:'Consultations'}))).item
 const payload={name:'Consultation',categoryId:category.id,durationMinutes:60,priceCents:10000,taxMode:'EXCLUSIVE'}
 service=(await ok(await invoke('services','POST',payload))).item
 const catB=(await ok(await invoke('service-categories','POST',{name:'Other tenant'},undefined,b))).item
 foreign=(await ok(await invoke('services','POST',{...payload,categoryId:catB.id},undefined,b))).item
 assert.equal((await invoke('services','POST',{...payload,categoryId:catB.id})).status,404)
 assert.equal((await invoke('services','POST',{...payload,type:'PACKAGE',packageItemIds:[foreign.id]})).status,400)
 const bundle=(await ok(await invoke('services','POST',{...payload,name:'Package',type:'PACKAGE',packageItemIds:[service.id]}))).item
 await root.query('INSERT INTO "Tax" (id,"tenantId",name,percent,"updatedAt") VALUES ($1,$2,\'Test tax\',18,now())',[`tax_${suffix}`,a])
 const changed=(await ok(await invoke('services','PATCH',{taxIds:[`tax_${suffix}`],priceCents:12000},service.id))).item
 assert.deepEqual(changed.taxIds,[`tax_${suffix}`]);assert.equal(changed.priceCents,12000)
 await ok(await invoke('services','PATCH',{taxIds:[]},service.id))
 const list=await ok(await invoke('services','GET',undefined,undefined,a,'ADMIN','?page=2&pageSize=1&sort=name&order=asc'))
 assert.equal(list.total,2);assert.equal(list.items.length,1);assert.equal(list.page,2)
 assert.equal((await ok(await invoke('services','GET',undefined,undefined,b))).total,1)
 await ok(await invoke('services','DELETE',undefined,bundle.id))
 assert.equal((await ok(await invoke('services','GET',undefined,undefined,a,'ADMIN','?status=INACTIVE'))).items[0].id,bundle.id)
})
test('read, create, edit and archive are separate and do not elevate STAFF',async()=>{
 await perms(['services.read']);await ok(await invoke('services','GET',undefined,undefined,a,'MANAGER'))
 for(const method of ['POST','PATCH','DELETE'])assert.equal((await invoke('services',method,{},method==='POST'?undefined:service.id,a,'MANAGER')).status,403)
 assert.equal((await invoke('service-categories','GET',undefined,undefined,a,'MANAGER')).status,403)
 await perms(['services.read','services.edit']);await ok(await invoke('services','PATCH',{name:'Edited',status:'ACTIVE',categoryId:category.id},service.id,a,'MANAGER'))
 assert.equal((await invoke('services','PATCH',{status:'INACTIVE'},service.id,a,'MANAGER')).status,403)
 await perms(['services.read','services.create']);assert.equal((await invoke('services','POST',{name:'Denied',categoryId:category.id,durationMinutes:30,priceCents:1000},undefined,a,'MANAGER')).status,403)
 await perms(['services.read','services.edit','services.archive']);await ok(await invoke('services','PATCH',{status:'INACTIVE'},service.id,a,'MANAGER'));await ok(await invoke('services','PATCH',{status:'ACTIVE'},service.id))
 assert.equal((await invoke('services','GET',undefined,undefined,a,'STAFF')).status,403)
 assert.equal((await invoke('services','PATCH',{name:'Cross tenant'},service.id,b)).status,404)
 const audit=(await root.query('SELECT * FROM "AuditLog" WHERE "entityId"=$1 AND "actorUserId"=$2 ORDER BY "createdAt"',[service.id,`${a}_manager`])).rows
 assert.equal(audit.length,2);assert.equal(audit[1].after.status,'INACTIVE');assert.ok(audit[1].requestId)
})
test('service booking resolution and legacy creation/availability require enabled catalog access',async()=>{
 await flag(false)
 for(const route of [bookings,availability])assert.equal((await call(route,'POST',{})).status,403)
 await runWithTenantDbContext(a,async()=>{
  await assert.rejects(resolveOrderData({lines:[{serviceId:service.id}]},{tenantId:a,actor:{tenantId:a,userId:`${a}_admin`,role:'ADMIN'}}),e=>e.status===403)
 })
 await flag(true);await perms([])
 for(const route of [bookings,availability])assert.equal((await call(route,'POST',{},undefined,'MANAGER')).status,403)
 await runWithTenantDbContext(a,()=>assert.rejects(resolveOrderData({lines:[{serviceId:service.id}]},{tenantId:a,actor:{tenantId:a,userId:`${a}_manager`,role:'MANAGER',permissions:[]}}),e=>e.status===403))
})
test('saved bookings survive disabled services; rescheduling and reactivation are blocked',async()=>{
 await root.query('INSERT INTO "StaffProfile" (id,"userId","updatedAt") VALUES ($1,$2,now())',[`staff_${suffix}`,`${a}_staff`])
 appointmentId=`appt_${suffix}`;orderId=`order_${suffix}`
 await root.query('INSERT INTO "Appointment" (id,"tenantId","staffProfileId","customerId","serviceId","startAt","endAt","updatedAt") VALUES ($1,$2,$3,$4,$5,\'2030-10-07T10:00:00Z\',\'2030-10-07T11:00:00Z\',now())',[appointmentId,a,`staff_${suffix}`,`${a}_customer`,service.id])
 await root.query('INSERT INTO "AppointmentOrder" (id,"tenantId","customerId","appointmentDate","appointmentStartAt","updatedAt") VALUES ($1,$2,$3,\'2030-10-07\',\'2030-10-07T10:00:00Z\',now())',[orderId,a,`${a}_customer`])
 await flag(false)
 await ok(await call(bookings,'GET'));await ok(await call(booking,'GET',undefined,appointmentId));await ok(await call(orderDetail,'GET',undefined,orderId))
 assert.equal((await call(booking,'PATCH',{startAt:'2030-10-07T12:00:00Z'},appointmentId)).status,403)
 await ok(await call(booking,'PATCH',{status:'CANCELED'},appointmentId))
 assert.equal((await root.query('SELECT count(*)::int n FROM "AuditLog" WHERE "entityId"=$1 AND event=\'appointment.updated\'',[appointmentId])).rows[0].n,1)
 assert.equal((await call(booking,'PATCH',{status:'SCHEDULED'},appointmentId)).status,403)
 const pdf=await call(invoice,'GET',undefined,orderId);assert.equal(pdf.status,200);assert.equal(pdf.headers.get('content-type'),'application/pdf');assert.ok((await pdf.arrayBuffer()).byteLength>500)
 await flag(true)
 await ok(await invoke('services','DELETE',undefined,service.id))
 assert.equal((await root.query('SELECT status FROM "Service" WHERE id=$1',[service.id])).rows[0].status,'INACTIVE')
 await ok(await invoke('services','PATCH',{status:'ACTIVE'},service.id))
})
test('authorized draft orders use service lines; disabled services blocks create and edit without altering saved totals',async()=>{
 const payload={customerId: a+'_customer',appointmentDate:'2030-10-08',appointmentStartTime:'10:00',appointmentStartAt:'2030-10-08T10:00:00Z',status:'DRAFT',coupons:[],productLines:[],lines:[{serviceId:service.id,staffId:a+'_staff',quantity:1,durationMinutes:60,unitPriceCents:12000,discountType:'NONE',discountValue:0,taxIds:[],taxMode:'EXCLUSIVE'}]}
 const created=await ok(await call(orders,'POST',payload),201);assert.equal(created.order.totalCents,12000)
 await flag(false)
 assert.equal((await call(orders,'POST',payload)).status,403)
 assert.equal((await call(orderDetail,'PATCH',{customerNote:'Should not persist'},created.order.id)).status,403)
 const saved=await ok(await call(orderDetail,'GET',undefined,created.order.id));assert.equal(saved.order.totalCents,12000);assert.notEqual(saved.order.customerNote,'Should not persist')
 await flag(true)
})
test('eligibility checks activation and tenant IDs, while unrelated profile edits remain possible',async()=>{
 const staff=`${a}_staff`
 await flag(false)
 assert.equal((await call(userDetail,'PATCH',{eligibleServiceIds:[service.id]},staff)).status,403)
 await ok(await call(userDetail,'PATCH',{name:'Staff profile updated'},staff))
 await flag(true)
 assert.equal((await call(userDetail,'PATCH',{eligibleServiceIds:[foreign.id]},staff)).status,400)
 await ok(await call(userDetail,'PATCH',{eligibleServiceIds:[service.id]},staff))
 assert.equal((await root.query('SELECT count(*)::int n FROM "AuditLog" WHERE "tenantId"=$1 AND event=\'services.eligibility.updated\'',[a])).rows[0].n,1)
 await flag(false)
 assert.equal((await call(users,'POST',{name:'New staff',email:`new_${suffix}@example.test`,password:'Test-password-123',role:'STAFF',eligibleServiceIds:[service.id]})).status,403)
 await flag(true)
})
test('maintenance and dashboard catalog counts respect activation and roles',async()=>{
 await flag(false)
 for(const body of [{action:'seed',groups:['serviceCatalog']},{action:'seed',groups:['appointments']},{action:'clearModules',modules:['services']}])assert.equal((await call(seeds,'POST',body)).status,403)
 assert.equal((await ok(await call(dashboard,'GET'))).kpis.activeServices,0)
 await flag(true);assert.equal((await ok(await call(dashboard,'GET'))).kpis.activeServices,1)
 await perms(['dashboard.read']);assert.equal((await ok(await call(dashboard,'GET',undefined,undefined,'MANAGER'))).kpis.activeServices,0)
})
test('stale sessions, category-only navigation and CRM separation',async()=>{
 await root.query('UPDATE "User" SET role=\'STAFF\' WHERE id=$1',[`${a}_admin`]);assert.equal((await invoke('services','GET')).status,403);assert.equal((await call(bookings,'POST',{})).status,403);await root.query('UPDATE "User" SET role=\'ADMIN\' WHERE id=$1',[`${a}_admin`])
 const flags=[{key:'services',allowed:true,enabled:true}]
 assert.equal(servicesNavigation(flags,['serviceCategories.read'])[0].href,'/services/categories')
 assert.deepEqual(servicesNavigation(flags,[]),[]);assert.deepEqual(servicesNavigation([{key:'services',allowed:false,enabled:true}]),[])
 assert.equal(satisfies({permissions:['services.read']},workspaceRead),false)
})
