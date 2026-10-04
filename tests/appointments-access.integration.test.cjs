/* eslint-disable @typescript-eslint/no-require-imports */
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path')
const {AsyncLocalStorage}=require('node:async_hooks'),{Client}=require('pg')
const raw=process.env.CRM_TEST_DATABASE_URL,url=new URL(raw||'http://invalid')
if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!='/ls_salon_crm_test')throw Error('Disposable local database only.')
const root=new Client({connectionString:raw});url.username='crm_test_runtime';url.password=''
process.env.DATABASE_URL=url.toString();process.env.RLS_POOL_MAX='1'
const sessions=new AsyncLocalStorage(), authPath=path.resolve(__dirname,'../auth.ts')
require.cache[authPath]={id:authPath,filename:authPath,loaded:true,exports:{auth:async()=>{await Promise.resolve();return sessions.getStore()||null}}}
const {logger}=require('../lib/logger.ts');const errors=[];logger.info=()=>{};logger.error=(_e,c)=>errors.push(c.error?.message)
const {prisma,runWithTenantDbContext}=require('../lib/prisma.ts')
const routes=Object.fromEntries(['','/[id]','/availability','/resolve','/orders','/orders/[id]','/orders/[id]/invoice','/orders/[id]/invoice-email','/coupons','/coupons/[id]'].map(p=>[p,require(`../app/api/appointments${p}/route.ts`)]))
const auditReport=require('../app/api/reports/audit-logs/route.ts')
const report=require('../app/api/reports/coupon-usage/route.ts'),dashboard=require('../app/api/dashboard/summary/route.ts'),seeds=require('../app/api/seeds/route.ts')
const {canReadAppointmentDetails}=require('../modules/appointments/conflict-access.ts')
const {appointmentsNavigation}=require('../application/navigation.ts')
const {resolveOrderData}=require('../app/api/appointments/orders/_resolve.ts')
const suffix=require('node:crypto').randomUUID().replaceAll('-',''),a=`apt_a_${suffix}`,b=`apt_b_${suffix}`,rid=`role_${suffix}`
const session=(tenant=a,role='ADMIN')=>({user:{id:`${tenant}_${role.toLowerCase()}`,tenantId:tenant,role}})
const request=(method,body,tenant=a,endpoint='/appointments')=>new Request(`http://${tenant}.localhost/api${endpoint}`,{method,headers:{host:`${tenant}.localhost`,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})})
const call=(route,method,body,id,role='ADMIN',tenant=a)=>sessions.run(session(tenant,role),()=> (typeof route==='string'?routes[route]:route)[method](request(method,body,tenant),{params:Promise.resolve({id})}))
const perms=p=>root.query('UPDATE "TenantAccessRole" SET permissions=$1 WHERE id=$2',[p,rid])
const flag=(enabled,allowed=true,key='appointments')=>root.query('UPDATE "TenantModule" SET enabled=$1,allowed=$2 WHERE "tenantId"=$3 AND key=$4',[enabled,allowed,a,key])
async function ok(res,status=200){const body=await res.json();assert.equal(res.status,status,JSON.stringify({body,errors}));return body}
let coupon,order
const appt=`appointment_${suffix}`,service=`service_${suffix}`
const bookingPayload=()=>({customerId:a+'_customer',appointmentDate:'2030-10-08',appointmentStartTime:'10:00',appointmentStartAt:'2030-10-08T10:00:00Z',status:'DRAFT',coupons:[],productLines:[],lines:[{serviceId:service,staffId:a+'_staff',quantity:1,durationMinutes:60,unitPriceCents:12000,discountType:'NONE',discountValue:0,taxIds:[],taxMode:'EXCLUSIVE'}]})
before(async()=>{
 await root.connect()
 for(const tenant of [a,b]){
  await root.query('INSERT INTO "Tenant" (id,name,slug,"updatedAt") VALUES ($1,$1,$1,now())',[tenant])
  for(const role of ['ADMIN','MANAGER','STAFF','CUSTOMER'])await root.query('INSERT INTO "User" (id,name,email,role,"tenantId","updatedAt") VALUES ($1,$1,$2,$3,$4,now())',[`${tenant}_${role.toLowerCase()}`,`${tenant}_${role}@example.test`,role,tenant])
  for(const key of ['appointments','services'])await root.query('INSERT INTO "TenantModule" ("tenantId",key,allowed,enabled,"updatedAt") VALUES ($1,$2,true,true,now())',[tenant,key])
 }
 await root.query('INSERT INTO "TenantAccessRole" (id,"tenantId",name,"nameKey",permissions,"updatedAt") VALUES ($1,$2,\'Appointments test\',\'appointments test\',$3,now())',[rid,a,[]])
 await root.query('INSERT INTO "TenantRoleAssignment" ("tenantId","userId","roleId","updatedAt") VALUES ($1,$2,$3,now())',[a,a+'_manager',rid])
 await root.query('INSERT INTO "StaffProfile" (id,"userId","updatedAt") VALUES ($1,$2,now())',[`staff_${suffix}`,a+'_staff'])
 await root.query('INSERT INTO "ServiceCategory" (id,"tenantId",name,"updatedAt") VALUES ($1,$2,\'Test\',now())',[`cat_${suffix}`,a])
 await root.query('INSERT INTO "Service" (id,"tenantId","categoryId",name,"durationMinutes","priceCents","updatedAt") VALUES ($1,$2,$3,\'Consultation\',60,12000,now())',[service,a,`cat_${suffix}`])
 await root.query('INSERT INTO "Appointment" (id,"tenantId","staffProfileId","customerId","serviceId","startAt","endAt","updatedAt") VALUES ($1,$2,$3,$4,$5,\'2030-10-07T10:00:00Z\',\'2030-10-07T11:00:00Z\',now())',[appt,a,`staff_${suffix}`,a+'_customer',service])
})
after(async()=>{
 for(const tenant of [a,b]){
  for(const table of ['Appointment','AppointmentOrder','Service','ServiceCategory','RealEstateProjectStatus','RealEstatePropertyCategory','RealEstateBuyingTimeframe'])await root.query(`DELETE FROM "${table}" WHERE "tenantId"=$1`,[tenant])
 }
 await root.query('DELETE FROM "TenantRoleAssignment" WHERE "tenantId"=$1',[a]);await root.query('DELETE FROM "Tenant" WHERE id IN ($1,$2)',[a,b]);await root.end();await prisma.$disconnect();await global.prismaPool?.end()
})
const endpoints=[['','GET'],['','POST'],['/[id]','GET'],['/[id]','PATCH'],['/[id]','DELETE'],['/availability','POST'],['/resolve','POST'],['/orders','GET'],['/orders','POST'],['/orders/[id]','GET'],['/orders/[id]','PATCH'],['/orders/[id]/invoice','GET'],['/orders/[id]/invoice-email','POST'],['/coupons','GET'],['/coupons','POST'],['/coupons/[id]','PATCH'],['/coupons/[id]','DELETE']]
test('every booking route fails closed for disabled, revoked and absent module flags',async()=>{
 for(const state of ['disabled','revoked','missing']){
  if(state==='missing')await root.query('DELETE FROM "TenantModule" WHERE "tenantId"=$1 AND key=\'appointments\'',[a]);else await flag(false,state!=='revoked')
  for(const [route,method] of endpoints)assert.equal((await call(route,method,method==='GET'?undefined:{},'missing')).status,403,`${state}: ${method} ${route}`)
  assert.equal((await call(report,'GET')).status,403)
 }
 await root.query('INSERT INTO "TenantModule" ("tenantId",key,allowed,enabled,"updatedAt") VALUES ($1,\'appointments\',true,true,now())',[a])
})
test('read-only roles can view bookings but cannot mutate, export or open coupons',async()=>{
 await perms(['appointments.read']);await ok(await call('','GET',undefined,undefined,'MANAGER'));await ok(await call('/[id]','GET',undefined,appt,'MANAGER'))
 for(const [route,method] of endpoints.filter(([r,m])=>m!=='GET'||r.includes('invoice')||r.includes('coupons'))){
  // Availability is read-only but also requires Services/read.
  assert.equal((await call(route,method,method==='GET'?undefined:{},appt,'MANAGER')).status,403,`${method} ${route}`)
 }
 for(const role of ['STAFF','CUSTOMER'])assert.equal((await call('','GET',undefined,undefined,role)).status,403)
})
test('coupon CRUD, tenant isolation and separate archive permissions are enforced and audited',async()=>{
 coupon=(await ok(await call('/coupons','POST',{code:'WELCOME',discountType:'PERCENT',discountValue:10}),201)).coupon
 await perms(['appointmentCoupons.read','appointmentCoupons.edit'])
 await ok(await call('/coupons/[id]','PATCH',{name:'Updated'},coupon.id,'MANAGER'))
 assert.equal((await call('/coupons/[id]','PATCH',{isActive:false},coupon.id,'MANAGER')).status,403)
 assert.equal((await call('/coupons/[id]','DELETE',undefined,coupon.id,'MANAGER')).status,403)
 assert.equal((await call('/coupons/[id]','PATCH',{name:'Cross tenant'},coupon.id,'ADMIN',b)).status,404)
 assert.equal((await call('/coupons','POST',{code:'BAD',discountType:'PERCENT',discountValue:5,allowedServiceIds:['missing']})).status,400)
 await perms(['appointmentCoupons.read','appointmentCoupons.edit','appointmentCoupons.archive'])
 await ok(await call('/coupons/[id]','PATCH',{isActive:false},coupon.id,'MANAGER'))
 const audit=(await root.query('SELECT * FROM "AuditLog" WHERE "entityId"=$1 AND event=\'appointments.coupon.edit\' ORDER BY "createdAt"',[coupon.id])).rows
 assert.equal(audit.length,2);assert.equal(audit[1].before.isActive,true);assert.equal(audit[1].after.isActive,false);assert.equal(audit[1].actorUserId,a+'_manager');assert.ok(audit[1].requestId)
 await ok(await call('/coupons/[id]','PATCH',{isActive:true},coupon.id))
})
test('draft bookings create/edit with saved totals; invoice export is distinct from email permission',async()=>{
 await perms(['appointments.read','appointments.create','services.read'])
 order=(await ok(await call('/orders','POST',bookingPayload(),undefined,'MANAGER'),201)).order
 assert.equal(order.totalCents,12000)
 assert.equal((await call('/orders/[id]','PATCH',{customerNote:'Denied'},order.id,'MANAGER')).status,403)
 await perms(['appointments.read','appointments.edit','services.read'])
 await ok(await call('/orders/[id]','PATCH',{customerNote:'Allowed'},order.id,'MANAGER'))
 assert.equal((await call('/orders/[id]','PATCH',{status:'CANCELED'},order.id,'MANAGER')).status,403)
 assert.equal((await call('/orders/[id]/invoice','GET',undefined,order.id,'MANAGER')).status,403)
 await perms(['appointments.read','appointments.export'])
 const pdf=await call('/orders/[id]/invoice','GET',undefined,order.id,'MANAGER');assert.equal(pdf.status,200);assert.ok((await pdf.arrayBuffer()).byteLength>500)
 assert.equal((await call('/orders/[id]/invoice-email','POST',{},order.id,'MANAGER')).status,403)
 assert.equal((await call('/orders/[id]','GET',undefined,order.id,'ADMIN',b)).status,404)
 const audits=(await root.query('SELECT * FROM "AuditLog" WHERE "entityId"=$1 AND event LIKE \'appointments.order.%\' ORDER BY "createdAt"',[order.id])).rows
 assert.equal(audits.length,2);assert.equal(audits[1].after.customerNote,'Allowed');assert.equal(audits[1].actorUserId,a+'_manager')
})
test('disabled Services preserves history and cancellation but blocks service edits and bulk reassign',async()=>{
 await flag(false,true,'services');await ok(await call('/orders/[id]','GET',undefined,order.id));await ok(await call('/[id]','GET',undefined,appt))
 assert.equal((await call('/orders','POST',bookingPayload())).status,403)
 assert.equal((await call('/resolve','POST',{action:'reassign',appointmentIds:[appt],targetStaffId:a+'_staff'})).status,403)
 await perms(['appointments.read','appointments.archive'])
 await ok(await call('/resolve','POST',{action:'cancel',appointmentIds:[appt]},undefined,'MANAGER'))
 assert.equal((await root.query('SELECT status FROM "Appointment" WHERE id=$1',[appt])).rows[0].status,'CANCELED')
 assert.equal((await root.query('SELECT count(*)::int n FROM "AuditLog" WHERE "tenantId"=$1 AND event=\'appointment.bulk_canceled\'',[a])).rows[0].n,1)
 await flag(true,true,'services')
 await perms(['appointments.read','appointments.edit','services.read'])
 assert.equal((await call('/[id]','PATCH',{status:'SCHEDULED'},appt,'MANAGER')).status,403)
})
test('coupon use and coupon reports cannot bypass permissions; used coupon deletion preserves history',async()=>{
 await perms(['appointmentCoupons.read']);assert.equal((await call(report,'GET',undefined,undefined,'MANAGER')).status,403)
 await perms(['appointments.read']);assert.equal((await call(report,'GET',undefined,undefined,'MANAGER')).status,403)
 await perms(['appointmentCoupons.read','appointments.read']);await ok(await call(report,'GET',undefined,undefined,'MANAGER'))
 await runWithTenantDbContext(a,()=>assert.rejects(resolveOrderData({...bookingPayload(),coupons:['WELCOME']},{tenantId:a,actor:{tenantId:a,userId:a+'_manager',role:'MANAGER',permissions:['services.read','appointments.read','appointments.create']}}),e=>e.status===403))
 await root.query('INSERT INTO "AppointmentOrderCoupon" (id,"orderId",code) VALUES ($1,$2,\'WELCOME\')',[`snapshot_${suffix}`,order.id])
 await ok(await call('/coupons/[id]','DELETE',undefined,coupon.id))
 assert.equal((await root.query('SELECT "isActive" FROM "Coupon" WHERE id=$1',[coupon.id])).rows[0].isActive,false)
})
test('dashboard, maintenance and conflict details respect module and current role decisions',async()=>{
 const range = role => sessions.run(session(a,role),()=>dashboard.GET(request('GET',undefined,a,'/dashboard/summary?range=custom&startDate=2030-10-07&endDate=2030-10-08')))
 assert.equal((await ok(await range('ADMIN'))).kpis.appointments,1)
 await flag(false)
 const summary=await ok(await range('ADMIN'));assert.equal(summary.kpis.appointments,0)
 assert.deepEqual(summary.upcomingAppointments,[]);assert.deepEqual(summary.topServices,[])

 assert.equal(await canReadAppointmentDetails(a,a+'_admin'),false)
 for(const body of [{action:'seed',groups:['appointments']},{action:'seed',groups:['coupons']},{action:'clearModules',modules:['appointments']}])assert.equal((await call(seeds,'POST',body)).status,403)
 await flag(true);await perms(['dashboard.read','auditLogs.read']);assert.equal((await ok(await range('MANAGER'))).kpis.appointments,0);assert.equal(await canReadAppointmentDetails(a,a+'_manager'),false)
 await perms(['dashboard.read','auditLogs.read','appointments.read']);assert.equal(await canReadAppointmentDetails(a,a+'_manager'),true)
 await root.query('UPDATE "User" SET role=\'STAFF\' WHERE id=$1',[a+'_admin']);assert.equal((await call('','GET')).status,403);assert.equal(await canReadAppointmentDetails(a,a+'_admin'),false)
 await root.query('UPDATE "User" SET role=\'ADMIN\' WHERE id=$1',[a+'_admin'])
 const flags=[{key:'appointments',allowed:true,enabled:true}]
 assert.equal(appointmentsNavigation(flags,['appointmentCoupons.read'])[0].href,'/appointments/coupons');assert.deepEqual(appointmentsNavigation(flags,[]),[])
})

test('audit reports cannot expose booking or coupon snapshots through hidden views',async()=>{
 await perms(['dashboard.read','auditLogs.read'])
 let rows=await ok(await call(auditReport,'GET',undefined,undefined,'MANAGER'))
 assert.equal(rows.total,0)
 await perms(['auditLogs.read','appointmentCoupons.read'])
 rows=await ok(await call(auditReport,'GET',undefined,undefined,'MANAGER'))
 assert.ok(rows.total>0);assert.ok(rows.items.every(r=>r.event.startsWith('appointments.coupon.')))
 await perms(['dashboard.read','auditLogs.read','appointments.read'])
 rows=await ok(await call(auditReport,'GET',undefined,undefined,'MANAGER'))
 assert.ok(rows.items.some(r=>r.event==='appointments.order.edit'));assert.ok(rows.items.every(r=>!r.event.startsWith('appointments.coupon.')))
 await flag(false);rows=await ok(await call(auditReport,'GET'));assert.equal(rows.total,0);await flag(true)
})
