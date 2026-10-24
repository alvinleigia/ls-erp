/* eslint-disable @typescript-eslint/no-require-imports */
const {grantPgFixtureUsers}=require("./helpers/access-fixtures.cjs")
process.env.TZ='UTC'
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path')
const {AsyncLocalStorage}=require('node:async_hooks'),{Client}=require('pg')
const raw=process.env.CRM_TEST_DATABASE_URL,url=new URL(raw||'http://invalid')
if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!='/ls_salon_crm_test')throw Error('Disposable local database only.')
const root=new Client({connectionString:raw});url.username='crm_test_runtime';url.password=''
process.env.DATABASE_URL=url.toString();process.env.RLS_POOL_MAX='2'
const sessions=new AsyncLocalStorage(), authPath=path.resolve(__dirname,'../auth.ts')
require.cache[authPath]={id:authPath,filename:authPath,loaded:true,exports:{auth:async()=>{await Promise.resolve();return sessions.getStore()||null}}}
const {logger}=require('../lib/logger.ts');const errors=[];logger.info=()=>{};logger.error=(_e,c)=>errors.push(c.error?.message)
const {prisma,runWithTenantDbContext}=require('../lib/prisma.ts')
// Never deliver real email from the disposable-database suite.
const mailPath=path.resolve(__dirname,'../lib/mailer.ts'),sentMail=[]
let emailConfigured=false,emailFailure=false
require.cache[mailPath]={id:mailPath,filename:mailPath,loaded:true,exports:{...require(mailPath),mailFrom:'billing@example.test',
 canSendConfiguredEmail:async()=>emailConfigured,mailer:{sendMail:async message=>{if(emailFailure)throw Error('Simulated transport failure');sentMail.push(message)}}}}
const pdfPath=path.resolve(__dirname,'../modules/appointments/invoice-pdf.ts'),pdfModule=require(pdfPath),renderedInvoices=[]
require.cache[pdfPath].exports={...pdfModule,buildAppointmentOrderInvoicePdf:async input=>{renderedInvoices.push(input);return pdfModule.buildAppointmentOrderInvoicePdf(input)}}
const routes=Object.fromEntries(['','/[id]','/availability','/resolve','/orders','/orders/preview','/orders/[id]','/orders/[id]/invoice','/orders/[id]/invoice-email','/coupons','/coupons/[id]'].map(p=>[p,require(`../app/api/appointments${p}/route.ts`)]))
const auditReport=require('../app/api/reports/audit-logs/route.ts')
const report=require('../app/api/reports/coupon-usage/route.ts'),dashboard=require('../app/api/dashboard/summary/route.ts'),seeds=require('../app/api/seeds/route.ts')
const {canReadAppointmentDetails}=require('../modules/appointments/conflict-access.ts')
const {appointmentsNavigation}=require('../application/navigation.ts')
const {resolveOrderData}=require('../modules/appointments/order-resolution.ts')
const suffix=require('node:crypto').randomUUID().replaceAll('-',''),a=`apt_a_${suffix}`,b=`apt_b_${suffix}`,rid=`role_${suffix}`
const session=(tenant=a,role='ADMIN')=>({user:{id:`${tenant}_${role.toLowerCase()}`,tenantId:tenant,role}})
const request=(method,body,tenant=a,endpoint='/appointments')=>new Request(`http://${tenant}.localhost/api${endpoint}`,{method,headers:{host:`${tenant}.localhost`,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})})
const call=(route,method,body,id,role='ADMIN',tenant=a,query='')=>sessions.run(session(tenant,role),()=> (typeof route==='string'?routes[route]:route)[method](request(method,body,tenant,`/appointments${query}`),{params:Promise.resolve({id})}))
const perms=p=>root.query('UPDATE "TenantAccessRole" SET permissions=$1 WHERE id=$2',[p,rid])
const flag=(enabled,allowed=true,key='appointments')=>root.query('UPDATE "TenantModule" SET enabled=$1,allowed=$2 WHERE "tenantId"=$3 AND key=$4',[enabled,allowed,a,key])
async function ok(res,status=200){const body=await res.json();assert.equal(res.status,status,JSON.stringify({body,errors:errors.slice(-3)}));return body}
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

 await grantPgFixtureUsers(root,[a,b])
})
after(async()=>{
 for(const tenant of [a,b]){
  await root.query('DELETE FROM "InventoryProductTax" WHERE "productId" IN (SELECT id FROM "InventoryProduct" WHERE "tenantId"=$1)',[tenant])
  for(const table of ['Appointment','AppointmentOrder','InventoryStockMovement','InventoryProduct','InventoryCategory','Service','ServiceCategory','RealEstateProjectStatus','RealEstatePropertyCategory','RealEstateBuyingTimeframe'])await root.query(`DELETE FROM "${table}" WHERE "tenantId"=$1`,[tenant])
 }
 await root.query('DELETE FROM "TenantRoleAssignment" WHERE "tenantId"=$1',[a]);await root.query('DELETE FROM "Tenant" WHERE id IN ($1,$2)',[a,b]);await root.end();await prisma.$disconnect();await global.prismaPool?.end()
})
const endpoints=[['','GET'],['','POST'],['/[id]','GET'],['/[id]','PATCH'],['/[id]','DELETE'],['/availability','POST'],['/resolve','POST'],['/orders','GET'],['/orders','POST'],['/orders/preview','POST'],['/orders/[id]','GET'],['/orders/[id]','PATCH'],['/orders/[id]/invoice','GET'],['/orders/[id]/invoice-email','POST'],['/coupons','GET'],['/coupons','POST'],['/coupons/[id]','PATCH'],['/coupons/[id]','DELETE']]
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
 for(const [route,method] of endpoints.filter(([r,m])=>r!=='/orders/preview'&&(m!=='GET'||r.includes('invoice')||r.includes('coupons')))){
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
 const savedBranding=(await root.query('SELECT "invoiceBranding" FROM "AppointmentOrder" WHERE id=$1',[order.id])).rows[0].invoiceBranding
 assert.equal(savedBranding.name,a);assert.equal(savedBranding.logo,null)
 await root.query('UPDATE "Tenant" SET name=\'Changed invoice identity\' WHERE id=$1',[a])
 assert.equal(order.totalCents,12000)
 assert.equal((await call('/orders/[id]','PATCH',{customerNote:'Denied'},order.id,'MANAGER')).status,403)
 await perms(['appointments.read','appointments.edit','services.read'])
 await ok(await call('/orders/[id]','PATCH',{customerNote:'Allowed'},order.id,'MANAGER'))
 assert.equal((await call('/orders/[id]','PATCH',{status:'CANCELED'},order.id,'MANAGER')).status,403)
 assert.equal((await call('/orders/[id]/invoice','GET',undefined,order.id,'MANAGER')).status,403)
 await perms(['appointments.read','appointments.export'])
 const pdf=await call('/orders/[id]/invoice','GET',undefined,order.id,'MANAGER');assert.equal(pdf.status,200);assert.ok((await pdf.arrayBuffer()).byteLength>500)
 assert.equal(renderedInvoices.at(-1).businessName,savedBranding.name)
 await root.query('UPDATE "Tenant" SET name=id WHERE id=$1',[a])
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

const singlePayload=(day='2039-01-04',time='10:00',extra={})=>({customerId:a+'_customer',serviceId:service,staffId:a+'_staff',startAt:`${day}T${time}:00Z`,...extra})
const preview=body=>call('/availability','POST',body)
const list=query=>call('','GET',undefined,undefined,'ADMIN',a,query)

test('appointment list uses real business dates, stable paging and scoped filters',async()=>{
 await root.query('INSERT INTO "AppSetting" (id,"tenantId","timeZone","updatedAt") VALUES ($1,$2,\'UTC\',now())',[a+'_settings',a])
 await root.query('UPDATE "StaffProfile" SET "schedulingMode"=\'FLEXIBLE\' WHERE id=$1',[`staff_${suffix}`])
 for(const [id,role] of [[a+'_staff2','STAFF'],[a+'_customer2','CUSTOMER']])await root.query('INSERT INTO "User" (id,"tenantId",name,email,role,"updatedAt") VALUES ($1,$2,$1,$3,$4,now())',[id,a,id+'@example.test',role])
 await root.query('INSERT INTO "StaffProfile" (id,"userId","schedulingMode","updatedAt") VALUES ($1,$2,\'FLEXIBLE\',now()),($3,$4,\'FLEXIBLE\',now())',[a+'_profile2',a+'_staff2',b+'_profile',b+'_staff'])
 for(const profile of [`staff_${suffix}`,a+'_profile2'])for(const date of ['2039-01-04','2039-01-05','2039-01-06','2039-01-07','2039-01-08','2039-01-09'])
  await root.query('INSERT INTO "StaffFlexibleAvailability" (id,"staffProfileId",date,"startTime","endTime","sortOrder","updatedAt") VALUES ($1,$2,$3,\'09:00\',\'17:00\',0,now())',[`${profile}_${date}`,profile,date])
 const ids=[]
 try {
  // Local day ranges include their start but exclude next midnight, in either UTC direction.
  for(const [zone,day,instants,expected] of [
   ['Asia/Kolkata','2039-02-01',['2039-01-31T18:29:59Z','2039-01-31T18:30:00Z','2039-02-01T18:29:59Z','2039-02-01T18:30:00Z'],[1,2]],
   ['America/Los_Angeles','2039-02-02',['2039-02-02T07:59:59Z','2039-02-02T08:00:00Z','2039-02-03T07:59:59Z','2039-02-03T08:00:00Z'],[1,2]],
   ['America/New_York','2039-03-13',['2039-03-13T04:59:59Z','2039-03-13T05:00:00Z','2039-03-14T03:59:59Z','2039-03-14T04:00:00Z'],[1,2]],
  ]) {
   await root.query('UPDATE "AppSetting" SET "timeZone"=$1 WHERE "tenantId"=$2',[zone,a])
   const current=[]
   for(const [index,instant] of instants.entries()) {
    const id=`${a}_${day}_${index}`;current.push(id);ids.push(id)
    await root.query('INSERT INTO "Appointment" (id,"tenantId","staffProfileId","customerId","serviceId","startAt","endAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6::timestamp,$6::timestamp+interval \'1 hour\',now())',[id,a,`staff_${suffix}`,a+'_customer',service,instant])
   }
   const result=await ok(await list(`?startDate=${day}&endDate=${day}`))
   assert.deepEqual(result.items.map(r=>r.id),expected.map(i=>current[i]))
   assert.equal(result.total,2)
   const first=await ok(await list(`?startDate=${day}&endDate=${day}&pageSize=1&sort=status`))
   const second=await ok(await list(`?startDate=${day}&endDate=${day}&pageSize=1&sort=status&page=2`))
   assert.equal(first.totalPages,2);assert.notEqual(first.items[0].id,second.items[0].id)
  }
  for(const query of ['?startDate=2039-02-30','?startDate=2039-02-02&endDate=2039-02-01','?pageSize=101','?page=1.5'])await ok(await list(query),400)
  for(const query of [`?staffId=${b}_staff`,`?customerId=${b}_customer`,'?q=absent-search-term'])assert.equal((await ok(await list(query))).total,0)
  const result=await ok(await list('?q=consultation'))
  assert.ok(result.total>0);assert.ok(result.items.every(row=>row.customer.id.startsWith(a)))
 } finally {
  await root.query('DELETE FROM "Appointment" WHERE id=ANY($1::text[])',[ids])
  await root.query('UPDATE "AppSetting" SET "timeZone"=\'UTC\' WHERE "tenantId"=$1',[a])
 }
})

test('availability is advisory, validates excluded IDs and never accepts foreign or inactive participants',async()=>{
 assert.equal((await ok(await preview(singlePayload()))).available,true)
 assert.equal((await ok(await preview(singlePayload('2039-01-04','08:00')))).available,false)
 assert.equal((await ok(await preview(singlePayload('2020-01-04')))).available,false)
 await ok(await call('','POST',singlePayload('2020-01-04')),400)
 for(const extra of [{staffId:b+'_staff'},{customerId:b+'_customer'},{serviceId:'foreign-service'}]) {
  assert.equal((await ok(await preview(singlePayload(undefined,undefined,extra)))).available,false)
  await ok(await call('','POST',singlePayload(undefined,undefined,extra)),404)
 }
 await ok(await preview(singlePayload(undefined,undefined,{appointmentId:'missing'})),404)
 await ok(await call('/availability','POST',singlePayload(undefined,undefined,{appointmentId:appt}),undefined,'ADMIN',b),404)
 for(const [table,id,field] of [['User',a+'_staff','staff'],['User',a+'_customer','customer'],['Service',service,'service']]) {
  await root.query(`UPDATE "${table}" SET status=$2 WHERE id=$1`,[id,table==='User'?'SUSPENDED':'INACTIVE'])
  try {
   const result=await ok(await preview(singlePayload()));assert.equal(result.available,false);assert.match(result.reason,new RegExp(field,'i'))
   await ok(await call('','POST',singlePayload()),400)
  } finally {await root.query(`UPDATE "${table}" SET status='ACTIVE' WHERE id=$1`,[id])}
 }
 await ok(await preview({...singlePayload(),startAt:'invalid'}),400)
 const malformed=await sessions.run(session(),()=>routes['/availability'].POST(new Request(`http://${a}.localhost/api/appointments/availability`,{method:'POST',headers:{host:`${a}.localhost`,'content-type':'application/json'},body:'{'})))
 await ok(malformed,400)
})

test('standalone create preserves its response, audit and independent cancellation permission',async()=>{
 await perms(['appointments.read','appointments.create','services.read'])
 await ok(await call('','POST',singlePayload(undefined,undefined,{status:'CANCELED'}),undefined,'MANAGER'),403)
 const response=await call('','POST',singlePayload(),undefined,'MANAGER')
 assert.ok(response.headers.get('x-request-id'));assert.equal(response.headers.get('cache-control'),'no-store')
 const saved=(await ok(response,201)).appointment
 assert.equal(saved.startAt,'2039-01-04T10:00:00.000Z');assert.equal(saved.endAt,'2039-01-04T11:00:00.000Z')
 assert.equal(saved.customer.id,a+'_customer');assert.equal(saved.service.durationMinutes,60);assert.equal(saved.staffProfile.user.id,a+'_staff');assert.equal(saved.orderLine,null)
 const audit=(await root.query('SELECT * FROM "AuditLog" WHERE "entityId"=$1',[saved.id])).rows
 assert.equal(audit.length,1);assert.equal(audit[0].event,'appointment.created');assert.equal(audit[0].actorUserId,a+'_manager');assert.ok(audit[0].requestId)
 assert.equal(audit[0].after.startAt,saved.startAt)
 const detail=(await ok(await call('/[id]','GET',undefined,saved.id))).appointment
 assert.equal(detail.service.priceCents,12000);assert.equal(detail.startAt,saved.startAt)
 assert.equal((await ok(await preview({...singlePayload(),appointmentId:saved.id}))).available,true)
 assert.equal((await ok(await preview(singlePayload()))).available,false)
 await ok(await call('','POST',singlePayload()),409)
 await ok(await call('','POST',singlePayload(undefined,undefined,{staffId:a+'_staff2'})),409)
 // Touching endpoints do not overlap.
 await ok(await call('','POST',singlePayload('2039-01-04','11:00')),201)
 await ok(await call('','POST',singlePayload('2039-01-04','17:00')),409)
 await root.query('UPDATE "Appointment" SET status=\'CANCELED\' WHERE id=$1',[saved.id])
 assert.equal((await ok(await preview(singlePayload()))).available,true)
})

test('concurrent standalone creates serialize staff and customer overlap checks',async()=>{
 for(const [day,extra] of [['2039-01-05',{customerId:a+'_customer2'}],['2039-01-06',{staffId:a+'_staff2'}]]) {
  const results=await Promise.all([call('','POST',singlePayload(day)),call('','POST',singlePayload(day,'10:00',extra))])
  assert.deepEqual(results.map(r=>r.status).sort(),[201,409])
  for(const response of results)await response.arrayBuffer()
  assert.equal((await root.query('SELECT count(*)::int n FROM "Appointment" WHERE "tenantId"=$1 AND "startAt"=$2',[a,`${day}T10:00:00Z`])).rows[0].n,1)
 }
})

test('create rechecks changed working hours after waiting on a schedule transaction',async()=>{
 await root.query('BEGIN')
 let pending
 try {
  await root.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`workforce-schedules:${a}`])
  pending=call('','POST',singlePayload('2039-01-07'))
  const deadline=Date.now()+3000
  let waiting=false
  while(Date.now()<deadline) {
   waiting=(await root.query(`SELECT EXISTS (SELECT 1 FROM pg_locks held JOIN pg_locks waiter ON held.classid=waiter.classid AND held.objid=waiter.objid AND held.objsubid=waiter.objsubid WHERE held.pid=pg_backend_pid() AND held.locktype='advisory' AND NOT waiter.granted) AS waiting`)).rows[0].waiting
   if(waiting)break
   await new Promise(resolve=>setTimeout(resolve,20))
  }
  assert.equal(waiting,true,'booking must wait on the shared scheduling lock')
  await root.query('UPDATE "StaffFlexibleAvailability" SET "startTime"=\'13:00\' WHERE "staffProfileId"=$1 AND date=\'2039-01-07\'',[`staff_${suffix}`])
  await root.query('COMMIT')
  const body=await ok(await pending,409);assert.match(body.error,/working hours|break/i)
  assert.equal((await root.query('SELECT count(*)::int n FROM "Appointment" WHERE "tenantId"=$1 AND "startAt"=\'2039-01-07T10:00:00Z\'',[a])).rows[0].n,0)
  await ok(await call('','POST',singlePayload('2039-01-07','13:00')),201)
 } finally {await root.query('ROLLBACK');if(pending)await pending}
})

let mutationSequence=0
async function mutationRow(day,time='10:00',extra={}) {
 const id=`${a}_mutation_${++mutationSequence}`
 const start=new Date(`${day}T${time}:00Z`),end=new Date(start.getTime()+(extra.minutes??60)*60000)
 await root.query('INSERT INTO "Appointment" (id,"tenantId","staffProfileId","customerId","serviceId","startAt","endAt",status,"updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())',[id,a,extra.profile??`staff_${suffix}`,extra.customer??a+'_customer',service,start,end,extra.status??'SCHEDULED'])
 return id
}
const savedRow=async id=>(await root.query('SELECT * FROM "Appointment" WHERE id=$1',[id])).rows[0]
const resolve=body=>call('/resolve','POST',body)

test('appointment edits preserve saved durations and validate relationships before writing',async()=>{
 await root.query('INSERT INTO "User" (id,"tenantId",name,email,role,"updatedAt") VALUES ($1,$2,$1,$3,\'STAFF\',now())',[a+'_staff3',a,a+'_staff3@example.test'])
 await root.query('INSERT INTO "StaffProfile" (id,"userId","schedulingMode","updatedAt") VALUES ($1,$2,\'FLEXIBLE\',now())',[a+'_profile3',a+'_staff3'])
 for(const profile of [`staff_${suffix}`,a+'_profile2',a+'_profile3'])for(let day=1;day<=12;day++) {
  const date=`2039-04-${String(day).padStart(2,'0')}`
  await root.query('INSERT INTO "StaffFlexibleAvailability" (id,"staffProfileId",date,"startTime","endTime","sortOrder","updatedAt") VALUES ($1,$2,$3,\'09:00\',\'17:00\',0,now())',[`${profile}_${date}`,profile,date])
 }
 const id=await mutationRow('2039-04-01','10:00',{minutes:90})
 const edited=(await ok(await call('/[id]','PATCH',{startAt:'2039-04-01T13:00:00Z'},id))).appointment
 assert.equal(edited.endAt,'2039-04-01T14:30:00.000Z');assert.equal(edited.service.priceCents,12000)
 for(const body of [{staffId:b+'_staff'},{customerId:b+'_customer'},{serviceId:'missing'}])await ok(await call('/[id]','PATCH',body,id),404)
 await ok(await call('/[id]','PATCH',{customerId:a+'_admin'},id),400)
 await ok(await call('/[id]','PATCH',{startAt:'2020-01-01T10:00:00Z'},id),400)
 await ok(await call('/[id]','PATCH',{},id),400)
 await ok(await call('/[id]','PATCH',{status:'CONFIRMED'},id,'ADMIN',b),404)
 const audit=(await root.query('SELECT * FROM "AuditLog" WHERE "entityId"=$1 AND event=\'appointment.updated\'',[id])).rows
 assert.equal(audit.length,1);assert.equal(audit[0].before.startAt,'2039-04-01T10:00:00.000Z');assert.equal(audit[0].after.endAt,edited.endAt)
 assert.ok(audit[0].requestId)
 await ok(await call('/[id]','PATCH',{customerId:a+'_customer2'},id))
 assert.equal((await savedRow(id)).endAt.toISOString(),edited.endAt)
})

test('status-only reactivation enforces archive permission, active participants and availability',async()=>{
 const canceled=await mutationRow('2039-04-02','10:00',{status:'CANCELED'}),other=await mutationRow('2039-04-02')
 await perms(['appointments.read','appointments.edit','services.read'])
 await ok(await call('/[id]','PATCH',{status:'SCHEDULED'},canceled,'MANAGER'),403)
 await perms(['appointments.read','appointments.edit','appointments.archive','services.read'])
 await ok(await call('/[id]','PATCH',{status:'SCHEDULED'},canceled,'MANAGER'),409)
 assert.equal((await savedRow(canceled)).status,'CANCELED')
 await ok(await call('/[id]','DELETE',undefined,other))
 await root.query('UPDATE "User" SET status=\'SUSPENDED\' WHERE id=$1',[a+'_staff'])
 try {await ok(await call('/[id]','PATCH',{status:'SCHEDULED'},canceled,'MANAGER'),400)}
 finally {await root.query('UPDATE "User" SET status=\'ACTIVE\' WHERE id=$1',[a+'_staff'])}
 await ok(await call('/[id]','PATCH',{status:'SCHEDULED'},canceled,'MANAGER'))
 assert.equal((await savedRow(canceled)).status,'SCHEDULED')
 const past=await mutationRow('2020-04-02','10:00',{status:'CANCELED'})
 await ok(await call('/[id]','PATCH',{status:'SCHEDULED'},past),400)
})

test('bulk reassignment checks working hours, outside bookings and conflicts within the selection',async()=>{
 const one=await mutationRow('2039-04-03'),two=await mutationRow('2039-04-03','10:00',{profile:a+'_profile2',customer:a+'_customer2'})
 const body={action:'reassign',appointmentIds:[one,two],targetStaffId:a+'_staff3'}
 const blocked=await ok(await resolve(body),409);assert.match(blocked.error,/Selected appointments overlap/)
 assert.equal((await savedRow(one)).staffProfileId,`staff_${suffix}`)
 await ok(await resolve({...body,appointmentIds:[one],targetStaffId:a+'_staff2'}),409)
 await root.query('UPDATE "StaffFlexibleAvailability" SET "startTime"=\'13:00\' WHERE "staffProfileId"=$1 AND date=\'2039-04-03\'',[a+'_profile3'])
 await ok(await resolve({...body,appointmentIds:[one]}),409)
 await root.query('UPDATE "StaffFlexibleAvailability" SET "startTime"=\'09:00\' WHERE "staffProfileId"=$1 AND date=\'2039-04-03\'',[a+'_profile3'])
 assert.equal((await ok(await resolve({...body,appointmentIds:[one]}))).updatedCount,1)
 assert.equal((await savedRow(one)).staffProfileId,a+'_profile3')
 assert.equal((await ok(await resolve({...body,appointmentIds:[one]}))).updatedCount,0)
 const audit=(await root.query('SELECT * FROM "AuditLog" WHERE "tenantId"=$1 AND event=\'appointment.bulk_reassigned\'',[a])).rows
 assert.equal(audit.length,1);assert.deepEqual(audit[0].metadata.appointmentIds,[one]);assert.equal(audit[0].after[0].staffProfileId,a+'_profile3')
})

test('bulk reschedule preserves duration and offsets, rejects customer conflicts and invalid local times',async()=>{
 const one=await mutationRow('2039-04-04','10:00',{minutes:90}),two=await mutationRow('2039-04-04','12:00')
 const outside=await mutationRow('2039-04-05','10:00',{profile:a+'_profile2'})
 const body={action:'reschedule',appointmentIds:[two,one],rescheduleDate:'2039-04-05',rescheduleTime:'10:00'}
 const conflict=await ok(await resolve(body),409);assert.match(conflict.error,/Customer/)
 assert.equal((await savedRow(one)).startAt.toISOString(),'2039-04-04T10:00:00.000Z')
 await ok(await call('/[id]','DELETE',undefined,outside))
 assert.equal((await ok(await resolve(body))).updatedCount,2)
 assert.equal((await savedRow(one)).endAt.toISOString(),'2039-04-05T11:30:00.000Z')
 assert.equal((await savedRow(two)).startAt.toISOString(),'2039-04-05T12:00:00.000Z')
 assert.equal((await ok(await resolve(body))).updatedCount,0)
 const internalOne=await mutationRow('2039-04-04','14:00'),internalTwo=await mutationRow('2039-04-04','14:00',{profile:a+'_profile2'})
 const internal=await ok(await resolve({...body,appointmentIds:[internalOne,internalTwo],rescheduleTime:'14:00'}),409);assert.match(internal.error,/same customer/)
 for(const extra of [{rescheduleDate:'2039-02-30'},{rescheduleTime:'25:00'},{rescheduleDate:'2020-01-01'},{appointmentIds:Array(101).fill(one)}])await ok(await resolve({...body,...extra}),400)
 await root.query('UPDATE "AppSetting" SET "timeZone"=\'America/New_York\' WHERE "tenantId"=$1',[a])
 try {
  await ok(await resolve({...body,rescheduleDate:'2039-03-13',rescheduleTime:'02:30'}),400)
  await ok(await resolve({...body,rescheduleDate:'2039-11-06',rescheduleTime:'01:30'}),400)
 } finally {await root.query('UPDATE "AppSetting" SET "timeZone"=\'UTC\' WHERE "tenantId"=$1',[a])}
})

test('bulk selection fails closed, cancellation is idempotent and disabled Services keeps cancellation available',async()=>{
 const one=await mutationRow('2039-04-06'),two=await mutationRow('2039-04-06','12:00')
 for(const action of ['cancel','reassign','reschedule'])await ok(await resolve({action,appointmentIds:[one,'missing'],targetStaffId:a+'_staff2',rescheduleDate:'2039-04-07',rescheduleTime:'10:00'}),404)
 assert.equal((await savedRow(one)).status,'SCHEDULED')
 await ok(await call('/[id]','DELETE',undefined,one,'ADMIN',b),404)
 await perms(['appointments.read'])
 for(const action of ['cancel','reassign','reschedule'])await ok(await call('/resolve','POST',{action,appointmentIds:[one],targetStaffId:a+'_staff2',rescheduleDate:'2039-04-07',rescheduleTime:'10:00'},undefined,'MANAGER'),403)
 await flag(false,true,'services')
 try {
  await ok(await resolve({action:'reassign',appointmentIds:[one],targetStaffId:a+'_staff2'}),403)
  assert.equal((await ok(await resolve({action:'cancel',appointmentIds:[one,two,one]}))).updatedCount,2)
  assert.equal((await ok(await resolve({action:'cancel',appointmentIds:[one,two]}))).updatedCount,0)
 } finally {await flag(true,true,'services')}
 const audit=(await root.query('SELECT * FROM "AuditLog" WHERE "tenantId"=$1 AND event=\'appointment.bulk_canceled\' AND metadata->\'appointmentIds\' ? $2',[a,one])).rows
 assert.equal(audit.length,1);assert.equal(audit[0].metadata.updatedCount,2);assert.equal(audit[0].before.length,2)
})

test('failed audit insertion rolls back single edits, cancellation and every bulk write',async()=>{
 const one=await mutationRow('2039-04-07'),two=await mutationRow('2039-04-07','12:00')
 const fn=`apt_audit_fail_${suffix}`,trigger=`apt_audit_trigger_${suffix}`
 await root.query(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."tenantId"='${a}' AND NEW.event IN ('appointment.updated','appointment.canceled','appointment.bulk_canceled','appointment.bulk_reassigned','appointment.bulk_rescheduled') THEN RAISE EXCEPTION 'Simulated appointment audit failure'; END IF; RETURN NEW; END $$;
 CREATE TRIGGER ${trigger} BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION ${fn}();`)
 try {
  await ok(await call('/[id]','PATCH',{startAt:'2039-04-07T14:00:00Z'},one),500)
  await ok(await call('/[id]','DELETE',undefined,one),500)
  for(const action of ['cancel','reassign','reschedule']) {
   await ok(await resolve({action,appointmentIds:[one,two],targetStaffId:a+'_staff3',rescheduleDate:'2039-04-08',rescheduleTime:'10:00'}),500)
   for(const id of [one,two]) {const row=await savedRow(id);assert.equal(row.status,'SCHEDULED');assert.equal(row.staffProfileId,`staff_${suffix}`);assert.equal(row.startAt.toISOString().slice(0,10),'2039-04-07')}
  }
 } finally {await root.query(`DROP TRIGGER ${trigger} ON "AuditLog"; DROP FUNCTION ${fn}();`)}
 assert.equal((await root.query('SELECT count(*)::int n FROM "AuditLog" WHERE "entityId"=ANY($1::text[])',[ [one,two] ])).rows[0].n,0)
 await ok(await call('/[id]','DELETE',undefined,one))
})

test('concurrent edits and bulk moves coordinate with creates, and repeated cancellation audits once',async()=>{
 const one=await mutationRow('2039-04-09','10:00'),two=await mutationRow('2039-04-09','12:00')
 const edits=await Promise.all([one,two].map(id=>call('/[id]','PATCH',{startAt:'2039-04-09T14:00:00Z'},id)))
 assert.deepEqual(edits.map(r=>r.status).sort(),[200,409]);for(const response of edits)await response.arrayBuffer()
 const moving=await mutationRow('2039-04-10','14:00')
 const raced=await Promise.all([resolve({action:'reschedule',appointmentIds:[moving],rescheduleDate:'2039-04-10',rescheduleTime:'10:00'}),call('','POST',singlePayload('2039-04-10'))])
 assert.ok((raced[0].status===200&&raced[1].status===409)||(raced[0].status===409&&raced[1].status===201));for(const response of raced)await response.arrayBuffer()
 const repeated=await Promise.all([call('/[id]','DELETE',undefined,moving),call('/[id]','DELETE',undefined,moving)])
 for(const response of repeated)await ok(response)
 assert.equal((await root.query('SELECT count(*)::int n FROM "AuditLog" WHERE "entityId"=$1 AND event=\'appointment.canceled\'',[moving])).rows[0].n,1)
})

const newOrderPayload=(day='2039-05-01',extra={})=>({...bookingPayload(),appointmentDate:day,appointmentStartAt:`${day}T10:00:00Z`,status:'CONFIRMED',...extra})
const stockProduct=a+'_stock_product'
const productLine=(quantity=1)=>({productId:stockProduct,quantity,unitPriceCents:2000,discountType:'NONE',discountValue:0,taxIds:[],taxMode:'EXCLUSIVE'})
const stockQty=async()=>Number((await root.query('SELECT "onHandQty" FROM "InventoryProduct" WHERE id=$1',[stockProduct])).rows[0].onHandQty)
const orderCounts=async()=> (await root.query(`SELECT
 (SELECT count(*)::int FROM "AppointmentOrder" WHERE "tenantId"=$1) orders,
 (SELECT count(*)::int FROM "Appointment" WHERE "tenantId"=$1) appointments,
 (SELECT count(*)::int FROM "InventoryStockMovement" WHERE "tenantId"=$1) movements,
 (SELECT count(*)::int FROM "AuditLog" WHERE "tenantId"=$1 AND event='appointments.order.create') audits`,[a])).rows[0]

test('confirmed order creation commits linked slots, totals, stock and exactly one audit together',async()=>{
 await root.query(`INSERT INTO "TenantModule" ("tenantId",key,allowed,enabled,"updatedAt") VALUES ($1,'inventory',true,true,now())`,[a])
 await root.query(`INSERT INTO "InventoryCategory" (id,"tenantId",name,"updatedAt") VALUES ($1,$2,'Order stock',now())`,[a+'_stock_category',a])
 await root.query(`INSERT INTO "InventoryProduct" (id,"tenantId","categoryId",sku,name,"mrpCents","onHandQty","updatedAt") VALUES ($1,$2,$3,'ORDER-STOCK','Order stock',2000,10,now())`,[stockProduct,a,a+'_stock_category'])
 for(const profile of [`staff_${suffix}`,a+'_profile2'])for(let day=1;day<=9;day++) {
  const date=`2039-05-0${day}`
  await root.query(`INSERT INTO "StaffFlexibleAvailability" (id,"staffProfileId",date,"startTime","endTime","sortOrder","updatedAt") VALUES ($1,$2,$3,'09:00','17:00',0,now())`,[`${profile}_${date}`,profile,date])
 }
 const payload=newOrderPayload(undefined,{productLines:[productLine(2)],lines:[...bookingPayload().lines,...bookingPayload().lines]})
 const saved=(await ok(await call('/orders','POST',payload),201)).order
 assert.equal(saved.totalCents,28000);assert.equal(await stockQty(),8)
 assert.equal(saved.lines.length,2);assert.equal(saved.lines[1].startAt,'2039-05-01T11:00:00.000Z')
 const slots=(await root.query('SELECT * FROM "Appointment" WHERE "orderLineId"=ANY($1::text[]) ORDER BY "startAt"',[saved.lines.map(l=>l.id)])).rows
 assert.equal(slots.length,2);assert.ok(slots.every(row=>row.status==='SCHEDULED'&&row.customerId===a+'_customer'))
 const audit=(await root.query(`SELECT * FROM "AuditLog" WHERE "entityId"=$1 AND event='appointments.order.create'`,[saved.id])).rows
 assert.equal(audit.length,1);assert.equal(audit[0].after.totalCents,28000);assert.equal(audit[0].actorUserId,a+'_admin');assert.ok(audit[0].requestId)
})

test('order list keeps paging stable, tenant/customer/status filters and input validation',async()=>{
 const ids=[]
 for(let i=0;i<3;i++)ids.push((await ok(await call('/orders','POST',newOrderPayload('2039-05-02',{status:'DRAFT',customerId:a+'_customer2'})),201)).order.id)
 await root.query(`UPDATE "AppointmentOrder" SET "updatedAt"='2040-01-01' WHERE id=ANY($1::text[])`,[ids])
 const list=query=>call('/orders','GET',undefined,undefined,'ADMIN',a,query)
 const pages=[]
 for(let page=1;page<=3;page++)pages.push(await ok(await list(`?page=${page}&pageSize=1&status=DRAFT&customerId=${a}_customer2`)))
 assert.deepEqual(pages.map(p=>p.items[0].id),ids.sort());assert.equal(pages[0].total,3)
 assert.equal((await ok(await call('/orders','GET',undefined,undefined,'ADMIN',b))).total,0)
 for(const query of ['?page=0','?pageSize=101','?status=INVALID'])await ok(await list(query),400)
 for(const extra of [{customerId:b+'_customer'},{customerId:a+'_admin'},{lines:[{...bookingPayload().lines[0],staffId:b+'_staff'}]}])await ok(await call('/orders','POST',newOrderPayload('2039-05-02',extra)),400)
})

test('concurrent order creates and standalone creates cannot reserve the same slot',async()=>{
 const responses=await Promise.all([call('/orders','POST',newOrderPayload('2039-05-02')),call('/orders','POST',newOrderPayload('2039-05-02'))])
 assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]);for(const response of responses)await response.arrayBuffer()
 const mixed=await Promise.all([call('/orders','POST',newOrderPayload('2039-05-03')),call('','POST',singlePayload('2039-05-03'))])
 assert.deepEqual(mixed.map(r=>r.status).sort(),[201,409]);for(const response of mixed)await response.arrayBuffer()
 for(const date of ['2039-05-02','2039-05-03'])assert.equal((await root.query('SELECT count(*)::int n FROM "Appointment" WHERE "tenantId"=$1 AND "startAt"=$2',[a,date+'T10:00:00Z'])).rows[0].n,1)
 const suggestion=await ok(await call('/orders','POST',newOrderPayload('2039-05-02')),409)
 assert.equal(suggestion.canApplySuggestion,true);assert.equal(suggestion.suggestedStartAt,'2039-05-02T11:00:00.000Z')
})

test('coupon usage is reread under the create lock, so simultaneous drafts respect customer limits',async()=>{
 await ok(await call('/coupons','POST',{code:'ONCE',discountType:'PERCENT',discountValue:10,maxUsesPerCustomer:1}),201)
 const payload=newOrderPayload('2039-05-04',{status:'DRAFT',coupons:['ONCE']})
 const responses=await Promise.all([call('/orders','POST',payload),call('/orders','POST',payload)])
 assert.deepEqual(responses.map(r=>r.status).sort(),[201,400]);for(const response of responses)await response.arrayBuffer()
 assert.equal((await root.query(`SELECT count(*)::int n FROM "AppointmentOrderCoupon" c JOIN "AppointmentOrder" o ON o.id=c."orderId" WHERE o."tenantId"=$1 AND c.code='ONCE'`,[a])).rows[0].n,1)
})

test('order stock rejection and audit failure roll back order, linked appointments and all movements',async()=>{
 const before=await orderCounts(),qty=await stockQty()
 await ok(await call('/orders','POST',newOrderPayload('2039-05-05',{productLines:[productLine(100)]})),409)
 assert.deepEqual(await orderCounts(),before);assert.equal(await stockQty(),qty)
 const fn=`order_audit_fail_${suffix}`,trigger=`order_audit_trigger_${suffix}`
 await root.query(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."tenantId"='${a}' AND NEW.event='appointments.order.create' THEN RAISE EXCEPTION 'Internal database test detail'; END IF; RETURN NEW; END $$;
 CREATE TRIGGER ${trigger} BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION ${fn}();`)
 try {
  const response=await ok(await call('/orders','POST',newOrderPayload('2039-05-05',{productLines:[productLine()]})),500)
  assert.doesNotMatch(response.error,/Internal database|prisma|AuditLog/)
  assert.deepEqual(await orderCounts(),before);assert.equal(await stockQty(),qty)
 } finally {await root.query(`DROP TRIGGER ${trigger} ON "AuditLog"; DROP FUNCTION ${fn}();`)}
 await ok(await call('/orders','POST',newOrderPayload('2039-05-05',{productLines:[productLine()]})),201)
})

test('stock deductions from independent transactions cannot oversell after both read the same balance',async()=>{
 const {applyInventoryStockDelta}=require('../modules/inventory/stock-service.ts')
 await root.query('UPDATE "InventoryProduct" SET "onHandQty"=1 WHERE id=$1',[stockProduct])
 let reads=0,release;const bothRead=new Promise(resolve=>{release=resolve})
 const actor={tenantId:a,userId:a+'_admin',role:'ADMIN'}
 const consume=()=>runWithTenantDbContext(a,()=>prisma.$transaction(async tx=>{
  const db=new Proxy(tx,{get(target,key){if(key!=='inventoryProduct')return target[key];return new Proxy(target.inventoryProduct,{get(model,operation){
   if(operation!=='findMany')return model[operation]
   return async args=>{const result=await model.findMany(args);if(++reads===2)release();await bothRead;return result}
  }})}})
  await applyInventoryStockDelta({actor,tenantId:a,tx:db,deltaByProduct:new Map([[stockProduct,-1]]),movement:()=>({type:'BOOKING_PRODUCT_SALE',note:'Concurrent stock test'})})
 }))
 const before=(await orderCounts()).movements
 const results=await Promise.allSettled([consume(),consume()])
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
 assert.equal(results.find(r=>r.status==='rejected').reason.name,'StockConflictError')
 assert.equal(await stockQty(),0);assert.equal((await orderCounts()).movements,before+1)
})


test('order final validation sees roster/duration changes and preserves an explicitly quoted zero price',async()=>{
 for(const change of ['roster','duration','price']) {
  const day=change==='roster'?'2039-05-06':change==='duration'?'2039-05-07':'2039-05-08'
  const payload=newOrderPayload(day,{lines:[{...bookingPayload().lines[0],unitPriceCents:0}]})
  const before=await orderCounts()
  await root.query('BEGIN');let pending
  try {
   await root.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`workforce-schedules:${a}`])
   pending=call('/orders','POST',payload)
   let waiting=false;const deadline=Date.now()+3000
   while(Date.now()<deadline) {
    waiting=(await root.query(`SELECT EXISTS (SELECT 1 FROM pg_locks held JOIN pg_locks waiter ON held.classid=waiter.classid AND held.objid=waiter.objid AND held.objsubid=waiter.objsubid WHERE held.pid=pg_backend_pid() AND held.locktype='advisory' AND NOT waiter.granted) AS waiting`)).rows[0].waiting
    if(waiting)break
    await new Promise(resolve=>setTimeout(resolve,20))
   }
   assert.equal(waiting,true,'order must finish preflight then wait for the scheduling lock')
   if(change==='roster')await root.query(`UPDATE "StaffFlexibleAvailability" SET "startTime"='13:00' WHERE "staffProfileId"=$1 AND date=$2`,[`staff_${suffix}`,day])
   else if(change==='duration')await root.query('UPDATE "Service" SET "durationMinutes"=90 WHERE id=$1',[service])
   else await root.query('UPDATE "Service" SET "priceCents"=23000 WHERE id=$1',[service])
   await root.query('COMMIT')
   const result=await ok(await pending,change==='price'?201:409)
   if(change==='price')assert.equal(result.order.totalCents,0)
   else assert.deepEqual(await orderCounts(),before)
  } finally {
   await root.query('ROLLBACK');if(pending)await pending
   await root.query('UPDATE "Service" SET "durationMinutes"=60,"priceCents"=12000 WHERE id=$1',[service])
  }
 }
})


const patchOrder=(id,body,role='ADMIN',tenant=a)=>call('/orders/[id]','PATCH',body,id,role,tenant)
const orderAppointments=async id=>(await root.query('SELECT a.* FROM "Appointment" a JOIN "AppointmentOrderLine" l ON l.id=a."orderLineId" WHERE l."orderId"=$1 ORDER BY l."sortOrder"',[id])).rows
const editLine=line=>({id:line.id,serviceId:line.serviceId,staffId:line.staffProfile.user.id,quantity:line.quantity,durationMinutes:line.durationMinutes,
 unitPriceCents:line.unitPriceCents,discountType:line.discountType,discountValue:line.discountValue,taxMode:line.taxMode,taxIds:line.taxIds,note:line.note||''})
let editingOrder

test('order confirmation and metadata edits preserve line identities, appointment links and saved prices',async()=>{
 for(const profile of [`staff_${suffix}`,a+'_profile2'])for(let day=1;day<=12;day++){
  const date=`2039-06-${String(day).padStart(2,'0')}`
  await root.query(`INSERT INTO "StaffFlexibleAvailability" (id,"staffProfileId",date,"startTime","endTime","sortOrder","updatedAt") VALUES ($1,$2,$3,'09:00','17:00',0,now())`,[`${profile}_${date}`,profile,date])
 }
 await root.query('UPDATE "InventoryProduct" SET "onHandQty"=10 WHERE id=$1',[stockProduct])
 const draft=(await ok(await call('/orders','POST',newOrderPayload('2039-06-01',{status:'DRAFT',productLines:[productLine(2)]})),201)).order
 editingOrder=(await ok(await patchOrder(draft.id,{status:'CONFIRMED'}))).order
 assert.equal(editingOrder.lines[0].id,draft.lines[0].id);assert.equal(editingOrder.productLines[0].id,draft.productLines[0].id)
 assert.equal(await stockQty(),8)
 const linked=await orderAppointments(draft.id);assert.equal(linked.length,1)
 await root.query('UPDATE "Service" SET "durationMinutes"=120,"priceCents"=99000 WHERE id=$1',[service])
 await flag(false,true,'services')
 try {
  const saved=(await ok(await patchOrder(draft.id,{internalNote:'Preserve snapshots'}))).order
  assert.equal(saved.totalCents,draft.totalCents);assert.equal(saved.lines[0].durationMinutes,60)
  assert.equal(saved.lines[0].id,draft.lines[0].id);assert.equal(saved.productLines[0].id,draft.productLines[0].id)
  assert.deepEqual(await orderAppointments(draft.id),linked)
 } finally {await flag(true,true,'services');await root.query('UPDATE "Service" SET "durationMinutes"=60,"priceCents"=12000 WHERE id=$1',[service])}
 const audits=(await root.query(`SELECT * FROM "AuditLog" WHERE "entityId"=$1 AND event='appointments.order.edit' ORDER BY "createdAt"`,[draft.id])).rows
 assert.equal(audits.length,2);assert.equal(audits[0].metadata.appointmentsAfter[0].id,linked[0].id);assert.equal(audits[1].after.internalNote,'Preserve snapshots')
})

test('order status commands preserve terminal history and concurrent cancellation restores stock once',async()=>{
 const id=editingOrder.id,linked=await orderAppointments(id),before=await orderCounts()
 const results=await Promise.all([patchOrder(id,{status:'CANCELED'}),patchOrder(id,{status:'CANCELED'})])
 for(const result of results)await ok(result)
 assert.equal(await stockQty(),10);assert.equal((await orderCounts()).movements,before.movements+1)
 const canceled=await orderAppointments(id);assert.equal(canceled[0].id,linked[0].id);assert.equal(canceled[0].status,'CANCELED');assert.equal(canceled[0].orderLineId,linked[0].orderLineId)
 await ok(await patchOrder(id,{status:'CONFIRMED'}));assert.equal(await stockQty(),8)
 assert.equal((await orderAppointments(id))[0].id,linked[0].id)
 await ok(await patchOrder(id,{status:'COMPLETED'}));assert.equal((await orderAppointments(id))[0].status,'COMPLETED')
 await ok(await patchOrder(id,{status:'CANCELED'}));assert.equal((await orderAppointments(id))[0].status,'COMPLETED');assert.equal(await stockQty(),10)
 await ok(await patchOrder(id,{status:'DRAFT'}),400)
 await perms(['appointments.read','appointments.edit','services.read'])
 await ok(await patchOrder(id,{status:'CONFIRMED'},'MANAGER'),403)
})

test('line IDs are tenant/order scoped, history cannot be removed, and new draft lines get server IDs',async()=>{
 const other=(await ok(await call('/orders','POST',newOrderPayload('2039-06-02',{status:'DRAFT'})),201)).order
 await ok(await patchOrder(other.id,{lines:[{...editLine(other.lines[0]),id:editingOrder.lines[0].id}]}),400)
 await ok(await patchOrder(other.id,{lines:[editLine(other.lines[0]),editLine(other.lines[0])]}),400)
 await ok(await patchOrder(other.id,{internalNote:'Foreign'},'ADMIN',b),404)
 await ok(await patchOrder(editingOrder.id,{lines:bookingPayload().lines}),409)
 const edited=(await ok(await patchOrder(other.id,{lines:[editLine(other.lines[0]),bookingPayload().lines[0]]}))).order
 assert.equal(edited.lines[0].id,other.lines[0].id);assert.notEqual(edited.lines[1].id,other.lines[0].id)
 const reduced=(await ok(await patchOrder(other.id,{lines:[editLine(edited.lines[1])]}))).order
 assert.equal(reduced.lines[0].id,edited.lines[1].id)
})

test('rescheduling updates linked appointments in place and does not replace started or completed work',async()=>{
 const order=(await ok(await call('/orders','POST',newOrderPayload('2039-06-03')),201)).order
 const original=(await orderAppointments(order.id))[0]
 await root.query('UPDATE "Service" SET "durationMinutes"=90 WHERE id=$1',[service])
 try {
  const moved=(await ok(await patchOrder(order.id,{appointmentStartAt:'2039-06-03T12:00:00Z'}))).order
  assert.equal(moved.lines[0].id,order.lines[0].id);assert.equal(moved.lines[0].durationMinutes,60)
  const appointment=(await orderAppointments(order.id))[0]
  assert.equal(appointment.id,original.id);assert.equal(appointment.endAt.toISOString(),'2039-06-03T13:00:00.000Z')
  await ok(await call('/[id]','PATCH',{status:'IN_PROGRESS'},original.id))
  await ok(await patchOrder(order.id,{appointmentStartAt:'2039-06-03T14:00:00Z'}),409)
  await ok(await patchOrder(order.id,{internalNote:'Keep progress'}));assert.equal((await orderAppointments(order.id))[0].status,'IN_PROGRESS')
  await ok(await patchOrder(order.id,{status:'COMPLETED'}));assert.equal((await orderAppointments(order.id))[0].status,'COMPLETED')
  await ok(await patchOrder(order.id,{appointmentStartAt:'2039-06-03T14:00:00Z',status:'CONFIRMED'}),409)
 } finally {await root.query('UPDATE "Service" SET "durationMinutes"=60 WHERE id=$1',[service])}
})

test('order edits keep canceled individual appointments canceled and retain unrelated appointments',async()=>{
 const order=(await ok(await call('/orders','POST',newOrderPayload('2039-06-04')),201)).order
 const linked=(await orderAppointments(order.id))[0],unrelated=await mutationRow('2039-06-04','15:00')
 await ok(await call('/[id]','DELETE',undefined,linked.id))
 await ok(await patchOrder(order.id,{internalNote:'Do not recreate canceled work'}))
 assert.equal((await orderAppointments(order.id))[0].status,'CANCELED')
 await ok(await patchOrder(order.id,{status:'COMPLETED'}))
 assert.equal((await orderAppointments(order.id))[0].status,'CANCELED')
 assert.equal((await savedRow(unrelated)).status,'SCHEDULED')
})

test('stock and audit failures roll back order edits with existing IDs and linked history intact',async()=>{
 const order=(await ok(await call('/orders','POST',newOrderPayload('2039-06-05',{productLines:[productLine()]})),201)).order
 const before=await orderCounts(),qty=await stockQty(),appointments=await orderAppointments(order.id)
 await ok(await patchOrder(order.id,{productLines:[{...productLine(100),id:order.productLines[0].id}]}),409)
 assert.equal(await stockQty(),qty);assert.deepEqual(await orderAppointments(order.id),appointments)
 assert.deepEqual((await ok(await call('/orders/[id]','GET',undefined,order.id))).order,order)
 const fn=`order_edit_audit_fail_${suffix}`,trigger=`order_edit_audit_trigger_${suffix}`
 await root.query(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."tenantId"='${a}' AND NEW.event='appointments.order.edit' THEN RAISE EXCEPTION 'Simulated edit audit failure'; END IF; RETURN NEW; END $$;
 CREATE TRIGGER ${trigger} BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION ${fn}();`)
 try {
  await ok(await patchOrder(order.id,{status:'CANCELED'}),500)
  assert.equal(await stockQty(),qty);assert.deepEqual(await orderAppointments(order.id),appointments)
  assert.deepEqual((await ok(await call('/orders/[id]','GET',undefined,order.id))).order,order)
  assert.deepEqual(await orderCounts(),before)
 } finally {await root.query(`DROP TRIGGER ${trigger} ON "AuditLog"; DROP FUNCTION ${fn}();`)}
})

test('order schedule edits coordinate with creates and coupon-bearing edits share create limits',async()=>{
 const order=(await ok(await call('/orders','POST',newOrderPayload('2039-06-06')),201)).order
 const responses=await Promise.all([patchOrder(order.id,{appointmentStartAt:'2039-06-06T12:00:00Z'}),call('','POST',singlePayload('2039-06-06','12:00'))])
 assert.ok((responses[0].status===200&&responses[1].status===409)||(responses[0].status===409&&responses[1].status===201))
 for(const response of responses)await response.arrayBuffer()
 await ok(await call('/coupons','POST',{code:'EDITONCE',discountType:'PERCENT',discountValue:10,maxUsesPerCustomer:1}),201)
 const draft=(await ok(await call('/orders','POST',newOrderPayload('2039-06-07',{status:'DRAFT'})),201)).order
 const couponRace=await Promise.all([patchOrder(draft.id,{coupons:['EDITONCE']}),call('/orders','POST',newOrderPayload('2039-06-07',{status:'DRAFT',coupons:['EDITONCE']}))])
 assert.ok((couponRace[0].status===200&&couponRace[1].status===400)||(couponRace[0].status===400&&couponRace[1].status===201))
 for(const response of couponRace)await response.arrayBuffer()
})


test('order edits reject stale preflight, past reactivation and empty legacy lines without touching other appointments',async()=>{
 const order=(await ok(await call('/orders','POST',newOrderPayload('2039-06-08')),201)).order
 await root.query('BEGIN');let pending
 try {
  await root.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`workforce-schedules:${a}`])
  pending=patchOrder(order.id,{appointmentStartAt:'2039-06-08T12:00:00Z'})
  let waiting=false;const deadline=Date.now()+3000
  while(Date.now()<deadline){
   waiting=(await root.query(`SELECT EXISTS (SELECT 1 FROM pg_locks held JOIN pg_locks waiter ON held.classid=waiter.classid AND held.objid=waiter.objid AND held.objsubid=waiter.objsubid WHERE held.pid=pg_backend_pid() AND held.locktype='advisory' AND NOT waiter.granted) AS waiting`)).rows[0].waiting
   if(waiting)break
   await new Promise(resolve=>setTimeout(resolve,20))
  }
  assert.equal(waiting,true)
  await root.query(`UPDATE "AppointmentOrder" SET "internalNote"='Intervening write',"updatedAt"=now() WHERE id=$1`,[order.id])
  await root.query('COMMIT')
  await ok(await pending,409)
  assert.equal((await ok(await call('/orders/[id]','GET',undefined,order.id))).order.internalNote,'Intervening write')
  assert.equal((await orderAppointments(order.id))[0].startAt.toISOString(),'2039-06-08T10:00:00.000Z')
 } finally {await root.query('ROLLBACK');if(pending)await pending}
 await ok(await patchOrder(order.id,{status:'CANCELED'}))
 await root.query(`UPDATE "Appointment" SET "startAt"='2020-06-08T10:00:00Z',"endAt"='2020-06-08T11:00:00Z' WHERE "orderLineId"=$1`,[order.lines[0].id])
 await ok(await patchOrder(order.id,{status:'CONFIRMED'}),400)
 assert.equal((await orderAppointments(order.id))[0].status,'CANCELED')
 const empty=(await ok(await call('/orders','POST',newOrderPayload('2039-06-09',{status:'DRAFT'})),201)).order
 await root.query('DELETE FROM "AppointmentOrderLine" WHERE "orderId"=$1',[empty.id])
 const unrelated=await mutationRow('2039-06-09','14:00')
 await ok(await patchOrder(empty.id,{status:'CANCELED'}),400)
 assert.equal((await savedRow(unrelated)).status,'SCHEDULED')
})


test('coupon partial edits preserve restrictions, inactive status, dates and limits; explicit clearing works',async()=>{
 const initial={code:'PARTIAL',name:'Before',discountType:'AMOUNT',discountValue:250,isActive:false,appliesTo:'SERVICE_LINES',
  allowedServiceIds:[service],allowedCategoryIds:[`cat_${suffix}`],minSubtotalCents:5000,stackingMode:'EXCLUSIVE',validFrom:'2039-01-01',validTo:'2039-12-31',maxUses:10,maxUsesPerCustomer:2}
 const saved=(await ok(await call('/coupons','POST',initial),201)).coupon
 await perms(['appointmentCoupons.read','appointmentCoupons.edit'])
 const updated=(await ok(await call('/coupons/[id]','PATCH',{name:'After'},saved.id,'MANAGER'))).coupon
 for(const [key,value] of Object.entries(initial))assert.deepEqual(updated[key],key==='name'?'After':value,key)
 assert.equal((await call('/coupons/[id]','PATCH',{},saved.id)).status,400)
 assert.equal((await call('/coupons/[id]','PATCH',{validFrom:'2040-01-01'},saved.id)).status,400)
 assert.equal((await call('/coupons/[id]','PATCH',{validTo:'2038-12-31'},saved.id)).status,400)
 assert.equal((await call('/coupons/[id]','PATCH',{discountType:'PERCENT'},saved.id)).status,400)
 const cleared=(await ok(await call('/coupons/[id]','PATCH',{validFrom:'',validTo:'',maxUses:null,maxUsesPerCustomer:null},saved.id))).coupon
 assert.equal(cleared.validFrom,null);assert.equal(cleared.validTo,null);assert.equal(cleared.maxUses,null);assert.equal(cleared.maxUsesPerCustomer,null)
})

test('coupon validation rejects impossible dates, percentages, malformed filters and duplicate codes',async()=>{
 for(const extra of [{validFrom:'2039-02-29'},{validTo:'2039-04-31'},{validFrom:'2039-06-02',validTo:'2039-06-01'},{discountValue:101}]){
  assert.equal((await call('/coupons','POST',{code:'BADRANGE',discountType:'PERCENT',discountValue:5,...extra})).status,400)
 }
 await ok(await call('/coupons','POST',{code:'UniqueCase',discountType:'PERCENT',discountValue:5}),201)
 assert.equal((await call('/coupons','POST',{code:'uniquecase',discountType:'PERCENT',discountValue:5})).status,409)
 assert.equal((await call('/coupons','GET',undefined,undefined,'ADMIN',a,'?active=garbage')).status,400)
 const list=await ok(await call('/coupons','GET',undefined,undefined,'ADMIN',a,'?q=UNIQUECASE&active=true&pageSize=1'))
 assert.equal(list.total,1);assert.equal(list.items[0].code,'UNIQUECASE');assert.equal(list.totalPages,1)
 assert.equal((await ok(await call('/coupons','GET',undefined,undefined,'ADMIN',b,'?q=UNIQUECASE'))).total,0)
})

test('changed coupon eligibility requires current module access and tenant-owned references',async()=>{
 const saved=(await ok(await call('/coupons','POST',{code:'ELIGIBLE',discountType:'PERCENT',discountValue:10,allowedServiceIds:[service]}),201)).coupon
 await flag(false,true,'services')
 await ok(await call('/coupons/[id]','PATCH',{name:'Historical setting'},saved.id))
 assert.equal((await call('/coupons/[id]','PATCH',{allowedServiceIds:[]},saved.id)).status,403)
 await flag(true,true,'services')
 await perms(['appointmentCoupons.read','appointmentCoupons.edit'])
 assert.equal((await call('/coupons/[id]','PATCH',{allowedServiceIds:[]},saved.id,'MANAGER')).status,403)
 assert.equal((await call('/coupons/[id]','PATCH',{allowedProductIds:['foreign-product']},saved.id)).status,400)
 assert.equal((await call('/coupons/[id]','PATCH',{allowedCategoryIds:['foreign-category']},saved.id)).status,400)
 await ok(await call('/coupons/[id]','PATCH',{allowedServiceIds:[]},saved.id))
})

test('coupon create/edit/delete roll back if their audit cannot be saved',async()=>{
 const saved=(await ok(await call('/coupons','POST',{code:'AUDITCOUPON',discountType:'PERCENT',discountValue:5}),201)).coupon
 const trigger=`coupon_audit_${suffix}`
 await root.query(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."tenantId"='${a}' AND NEW.event LIKE 'appointments.coupon.%' THEN RAISE EXCEPTION 'coupon audit test'; END IF; RETURN NEW; END $$`)
 await root.query(`CREATE TRIGGER ${trigger} BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION ${trigger}()`)
 try{
  assert.equal((await call('/coupons','POST',{code:'ROLLBACK',discountType:'PERCENT',discountValue:5})).status,500)
  assert.equal((await call('/coupons/[id]','PATCH',{name:'Must roll back'},saved.id)).status,500)
  assert.equal((await call('/coupons/[id]','DELETE',undefined,saved.id)).status,500)
  assert.equal((await root.query(`SELECT name FROM "Coupon" WHERE id=$1`,[saved.id])).rows[0].name,null)
  assert.equal((await root.query(`SELECT count(*)::int n FROM "Coupon" WHERE "tenantId"=$1 AND code='ROLLBACK'`,[a])).rows[0].n,0)
 }finally{await root.query(`DROP TRIGGER ${trigger} ON "AuditLog"`);await root.query(`DROP FUNCTION ${trigger}()`)}
 await ok(await call('/coupons/[id]','DELETE',undefined,saved.id))
 assert.equal((await root.query(`SELECT count(*)::int n FROM "Coupon" WHERE id=$1`,[saved.id])).rows[0].n,0)
})

test('global coupon limit is serialized across customers; canceled use is released and current order excluded',async()=>{
 const c=(await ok(await call('/coupons','POST',{code:'GLOBALONCE',discountType:'PERCENT',discountValue:10,maxUses:1}),201)).coupon
 const payload=newOrderPayload('2039-06-08',{status:'DRAFT',coupons:['GLOBALONCE']})
 const responses=await Promise.all([call('/orders','POST',payload),call('/orders','POST',{...payload,customerId:a+'_customer2'})])
 assert.deepEqual(responses.map(r=>r.status).sort(),[201,400])
 const bodies=await Promise.all(responses.map(r=>r.json()));const winner=bodies.find(b=>b.order).order
 assert.equal((await ok(await call('/coupons','GET',undefined,undefined,'ADMIN',a,'?q=GLOBALONCE'))).items[0].usedCount,1)
 await ok(await patchOrder(winner.id,{coupons:['GLOBALONCE'],lines:winner.lines.map(line=>({...editLine(line),unitPriceCents:13000}))}))
 assert.equal((await call('/coupons/[id]','PATCH',{code:'RENAMED'},c.id)).status,409)
 await ok(await patchOrder(winner.id,{status:'CANCELED'}))
 assert.equal((await ok(await call('/coupons','GET',undefined,undefined,'ADMIN',a,'?q=GLOBALONCE'))).items[0].usedCount,0)
 const next=(await ok(await call('/orders','POST',payload),201)).order
 await ok(await call('/coupons/[id]','DELETE',undefined,c.id))
 assert.equal((await root.query(`SELECT "isActive" FROM "Coupon" WHERE id=$1`,[c.id])).rows[0].isActive,false)
 assert.equal((await ok(await call('/orders/[id]','GET',undefined,next.id))).order.coupons[0].code,'GLOBALONCE')
})

test('unavailable coupons are rejected instead of silently changing booking discounts',async()=>{
 const before=await orderCounts()
 for(const code of ['MISSING','WELCOME'])assert.equal((await call('/orders','POST',newOrderPayload('2039-06-09',{status:'DRAFT',coupons:[code]}))).status,400)
 await ok(await call('/coupons','POST',{code:'EXPIRED',discountType:'PERCENT',discountValue:10,validTo:'2038-12-31'}),201)
 assert.equal((await call('/orders','POST',newOrderPayload('2039-06-09',{status:'DRAFT',coupons:['EXPIRED']}))).status,400)
 assert.deepEqual(await orderCounts(),before)
})

test('invoice paths use saved prices and product lines with tenant timezone, even when catalogs are disabled',async()=>{
 const saved=(await ok(await call('/orders','POST',newOrderPayload('2039-06-10',{status:'DRAFT',productLines:[productLine()]})),201)).order
 await root.query(`UPDATE "AppSetting" SET "timeZone"='Asia/Kolkata',"dateFormat"='dd/MM/yyyy',"timeFormat"='H24' WHERE "tenantId"=$1`,[a])
 await root.query(`UPDATE "Tenant" SET name='Invoice Test Business' WHERE id=$1`,[a])
 await root.query(`UPDATE "User" SET name='Test Customer',email='customer@example.test' WHERE id=$1`,[a+'_customer'])
 await root.query(`UPDATE "Service" SET "priceCents"=99999 WHERE id=$1`,[service])
 await flag(false,true,'services');await flag(false,true,'inventory')
 try{
  const response=await call('/orders/[id]/invoice','GET',undefined,saved.id,'ADMIN',a,'?download=1')
  assert.equal(response.status,200);assert.match(response.headers.get('content-disposition'),/^attachment;/);assert.equal(response.headers.get('cache-control'),'no-store')
  const bytes=Buffer.from(await response.arrayBuffer());assert.ok(bytes.length>500)
  const source=renderedInvoices.at(-1);assert.equal(source.order.totalCents,saved.totalCents);assert.equal(source.order.lines[0].unitPriceCents,saved.lines[0].unitPriceCents)
  assert.equal(source.order.productLines.length,1);assert.equal(source.settings.timeZone,'Asia/Kolkata');assert.equal(source.businessName,a,'Invoice keeps the business identity saved when the order was created')
  require('node:fs').writeFileSync(path.resolve(__dirname,'../tmp/r2d15-invoice.pdf'),bytes)
  assert.equal((await call('/orders/[id]/invoice','GET',undefined,saved.id,'ADMIN',b)).status,404)
  const sentBefore=sentMail.length
  assert.equal((await call('/orders/[id]/invoice-email','POST',{},saved.id)).status,400);assert.equal(sentMail.length,sentBefore)
  emailConfigured=true;emailFailure=true
  assert.equal((await call('/orders/[id]/invoice-email','POST',{},saved.id)).status,500)
  assert.equal((await root.query(`SELECT count(*)::int n FROM "AuditLog" WHERE "entityId"=$1 AND event='appointments.invoice.emailed'`,[saved.id])).rows[0].n,0)
  emailFailure=false
  await ok(await call('/orders/[id]/invoice-email','POST',{},saved.id))
  assert.equal(sentMail.length,sentBefore+1);assert.equal(sentMail.at(-1).to,'customer@example.test');assert.equal(sentMail.at(-1).attachments[0].contentType,'application/pdf')
  const audit=(await root.query(`SELECT * FROM "AuditLog" WHERE "entityId"=$1 AND event='appointments.invoice.emailed'`,[saved.id])).rows[0]
  assert.equal(audit.after.totalCents,saved.totalCents);assert.equal(audit.actorUserId,a+'_admin');assert.ok(audit.requestId)
  assert.equal((await call('/orders/[id]/invoice-email','POST',{},saved.id,'ADMIN',b)).status,404)
 }finally{
  emailConfigured=false;emailFailure=false
  await flag(true,true,'services');await flag(true,true,'inventory')
  await root.query(`UPDATE "Service" SET "priceCents"=12000 WHERE id=$1`,[service])
  await root.query(`UPDATE "AppSetting" SET "timeZone"='UTC' WHERE "tenantId"=$1`,[a])
 }
})


test('coupon edits reread usage after waiting for a booking transaction',async()=>{
 const saved=(await ok(await call('/coupons','POST',{code:'LOCKEDCODE',discountType:'PERCENT',discountValue:5}),201)).coupon
 await root.query('BEGIN')
 let pending
 try{
  await root.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`workforce-schedules:${a}`])
  pending=call('/coupons/[id]','PATCH',{code:'NEWCODE'},saved.id)
  const deadline=Date.now()+3000;let waiting=false
  while(Date.now()<deadline){if((await root.query("SELECT count(*)::int n FROM pg_locks WHERE locktype='advisory' AND NOT granted")).rows[0].n>0){waiting=true;break}await new Promise(r=>setTimeout(r,20))}
  assert.equal(waiting,true)
  await root.query(`INSERT INTO "AppointmentOrderCoupon" (id,"orderId",code) VALUES ($1,$2,'LOCKEDCODE')`,[`locked_coupon_${suffix}`,order.id])
  await root.query('COMMIT')
  assert.equal((await pending).status,409)
  assert.equal((await root.query('SELECT code FROM "Coupon" WHERE id=$1',[saved.id])).rows[0].code,'LOCKEDCODE')
 }finally{await root.query('ROLLBACK');if(pending)await pending}
})

const pricingTax=`pricing_tax_${suffix}`
test('omitted booking taxes use catalog defaults; explicit empty selections and zero prices are retained',async()=>{
 await root.query('INSERT INTO "Tax" (id,"tenantId",name,percent,"updatedAt") VALUES ($1,$2,\'Pricing tax\',18,now())',[pricingTax,a])
 await root.query('INSERT INTO "ServiceTax" ("serviceId","taxId") VALUES ($1,$2)',[service,pricingTax])
 await root.query('INSERT INTO "InventoryProductTax" ("productId","taxId") VALUES ($1,$2)',[stockProduct,pricingTax])
 const line={...bookingPayload().lines[0]};delete line.taxIds;delete line.taxMode
 const product={...productLine()};delete product.taxIds
 const payload=newOrderPayload('2039-07-01',{status:'DRAFT',lines:[line],productLines:[product]})
 const saved=(await ok(await call('/orders','POST',payload),201)).order
 assert.deepEqual(saved.lines[0].taxIds,[pricingTax]);assert.deepEqual(saved.productLines[0].taxIds,[pricingTax])
 assert.equal(saved.taxCents,2520);assert.equal(saved.totalCents,16520);assert.equal(saved.taxes[0].taxCents,2520)
 const cleared=(await ok(await call('/orders','POST',{...payload,lines:[{...line,taxIds:[]}],productLines:[{...product,taxIds:[]}]}),201)).order
 assert.equal(cleared.taxCents,0);assert.equal(cleared.totalCents,14000)
 const free=(await ok(await call('/orders','POST',{...payload,lines:[{...line,unitPriceCents:0}],productLines:[{...product,unitPriceCents:0}]}),201)).order
 assert.equal(free.totalCents,0);assert.equal(free.lines[0].unitPriceCents,0);assert.equal(free.productLines[0].unitPriceCents,0)
})

test('tax selection rejects unavailable IDs, deduplicates valid IDs and preserves inclusive pennies',async()=>{
 const payload=newOrderPayload('2039-07-02',{status:'DRAFT'})
 const before=await orderCounts()
 for(const taxIds of [['missing-tax'],[pricingTax,'foreign-tax']]){
  assert.equal((await call('/orders','POST',{...payload,lines:[{...payload.lines[0],taxIds}]})).status,400)
 }
 assert.deepEqual(await orderCounts(),before)
 const saved=(await ok(await call('/orders','POST',{...payload,lines:[{...payload.lines[0],unitPriceCents:3,taxMode:'INCLUSIVE',taxIds:[pricingTax,pricingTax]}]}),201)).order
 assert.deepEqual(saved.lines[0].taxIds,[pricingTax]);assert.equal(saved.totalCents,3);assert.equal(saved.taxCents,0)
 assert.equal(saved.taxes.reduce((sum,row)=>sum+row.taxCents,0),saved.taxCents)
 await root.query('UPDATE "Service" SET "taxMode"=\'INCLUSIVE\' WHERE id=$1',[service])
 try{
  const line={...payload.lines[0],unitPriceCents:11800};delete line.taxMode;delete line.taxIds
  const inclusive=(await ok(await call('/orders','POST',{...payload,lines:[line]}),201)).order
  assert.equal(inclusive.lines[0].taxMode,'INCLUSIVE');assert.equal(inclusive.totalCents,11800);assert.equal(inclusive.taxCents,1800)
 }finally{await root.query('UPDATE "Service" SET "taxMode"=\'EXCLUSIVE\' WHERE id=$1',[service])}
})

test('saved prices and tax snapshots survive scheduling and metadata edits; financial edits validate current taxes',async()=>{
 const payload=newOrderPayload('2039-07-03',{status:'DRAFT',lines:[{...bookingPayload().lines[0],taxIds:[pricingTax]}]})
 const saved=(await ok(await call('/orders','POST',payload),201)).order
 await root.query('UPDATE "Tax" SET percent=25,"isActive"=false WHERE id=$1',[pricingTax])
 try{
  assert.equal((await call('/orders','POST',payload)).status,400)
  await ok(await patchOrder(saved.id,{internalNote:'Keep snapshot'}))
  const moved=(await ok(await patchOrder(saved.id,{appointmentStartAt:'2039-07-04T11:00:00Z'}))).order
  assert.equal(moved.appointmentDate,'2039-07-04');assert.equal(moved.taxCents,saved.taxCents);assert.equal(moved.totalCents,saved.totalCents)
  assert.deepEqual(moved.taxes,saved.taxes)
  assert.equal((await patchOrder(saved.id,{lines:[{...editLine(moved.lines[0]),unitPriceCents:14000}]})).status,400)
  const cleared=(await ok(await patchOrder(saved.id,{lines:[{...editLine(moved.lines[0]),taxIds:[]}]}))).order
  assert.equal(cleared.taxCents,0);assert.equal(cleared.totalCents,12000)
 }finally{await root.query('UPDATE "Tax" SET percent=18,"isActive"=true WHERE id=$1',[pricingTax])}
})

test('booking validation rejects impossible dates, clock values, excessive discounts and amount overflow without writes',async()=>{
 const payload=newOrderPayload('2039-07-05',{status:'DRAFT'}),before=await orderCounts()
 for(const patch of [{appointmentDate:'2039-02-29'},{appointmentDate:'2039-04-31'},{appointmentStartTime:'24:00'},
  {appointmentStartTime:'10:60'},{appointmentStartTime:'11:00'},{appointmentDate:'2039-07-06'},
  {lines:[{...payload.lines[0],discountType:'PERCENT',discountValue:101}]},
  {productLines:[{...productLine(),quantity:1000,unitPriceCents:100000000}]},
  {lines:Array.from({length:101},()=>payload.lines[0])}]){
  const response=await call('/orders','POST',{...payload,...patch});assert.equal(response.status,400,JSON.stringify(await response.json()))
 }
 assert.deepEqual(await orderCounts(),before)
})

test('business date/time and instant agree across midnight; partial time/date edits move the actual booking',async()=>{
 await root.query('UPDATE "AppSetting" SET "timeZone"=\'Asia/Kolkata\' WHERE "tenantId"=$1',[a])
 try{
  const payload=newOrderPayload('2039-07-06',{status:'DRAFT',appointmentStartTime:'00:15',appointmentStartAt:'2039-07-05T18:45:00Z'})
  const saved=(await ok(await call('/orders','POST',payload),201)).order
  assert.equal(saved.appointmentDate,'2039-07-06')
  const moved=(await ok(await patchOrder(saved.id,{appointmentStartTime:'01:15'}))).order
  assert.equal(moved.appointmentStartAt,'2039-07-05T19:45:00.000Z');assert.equal(moved.lines[0].startAt,moved.appointmentStartAt)
  const next=(await ok(await patchOrder(saved.id,{appointmentDate:'2039-07-07'}))).order
  assert.equal(next.appointmentStartAt,'2039-07-06T19:45:00.000Z');assert.equal(next.appointmentDate,'2039-07-07')
  assert.equal((await patchOrder(saved.id,{appointmentStartAt:'2039-07-06T20:45:00Z',appointmentStartTime:'01:15'})).status,400)
  const instant=(await ok(await patchOrder(saved.id,{appointmentStartAt:'2039-07-07T20:45:00Z'}))).order
  assert.equal(instant.appointmentDate,'2039-07-08');assert.equal(instant.appointmentStartAt,'2039-07-07T20:45:00.000Z')
 }finally{await root.query('UPDATE "AppSetting" SET "timeZone"=\'UTC\' WHERE "tenantId"=$1',[a])}
})

test('local-time edits reject DST gaps and ambiguity while explicit matching offset instants are accepted',async()=>{
 await root.query('UPDATE "AppSetting" SET "timeZone"=\'America/New_York\' WHERE "tenantId"=$1',[a])
 try{
  const payload=newOrderPayload('2039-03-12',{status:'DRAFT',appointmentStartTime:'01:30',appointmentStartAt:'2039-03-12T06:30:00Z'})
  const saved=(await ok(await call('/orders','POST',payload),201)).order
  assert.equal((await patchOrder(saved.id,{appointmentDate:'2039-03-13',appointmentStartTime:'02:30'})).status,400)
  assert.equal((await patchOrder(saved.id,{appointmentDate:'2039-11-06',appointmentStartTime:'01:30'})).status,400)
  const explicit=(await ok(await patchOrder(saved.id,{appointmentDate:'2039-11-06',appointmentStartTime:'01:30',appointmentStartAt:'2039-11-06T01:30:00-05:00'}))).order
  assert.equal(explicit.appointmentStartAt,'2039-11-06T06:30:00.000Z')
 }finally{await root.query('UPDATE "AppSetting" SET "timeZone"=\'UTC\' WHERE "tenantId"=$1',[a])}
})
const pricePreview=async(input,orderId,role='ADMIN',tenant=a)=>call('/orders/preview','POST',{input,orderId},undefined,role,tenant)
const financialTotals=value=>Object.fromEntries(['subtotalCents','lineDiscountCents','couponDiscountCents','taxCents','totalCents'].map(key=>[key,value[key]]))
const persistedInput=(saved,payload)=>({...payload,lines:saved.lines.map(editLine),productLines:saved.productLines.map(line=>({...productLine(),...line})),coupons:saved.coupons.map(coupon=>coupon.code)})

test('pricing preview shares scoped coupons and mixed inclusive/exclusive tax totals with save without side effects',async()=>{
 await ok(await call('/coupons','POST',{code:'PREVIEWPRODUCT',discountType:'PERCENT',discountValue:10,appliesTo:'PRODUCT_LINES',allowedProductIds:[stockProduct]}),201)
 const payload=newOrderPayload('2039-07-10',{status:'DRAFT',coupons:['PREVIEWPRODUCT'],
  lines:[{...bookingPayload().lines[0],unitPriceCents:11800,discountType:'PERCENT',discountValue:10,taxIds:[pricingTax],taxMode:'INCLUSIVE'}],
  productLines:[{...productLine(),taxIds:[pricingTax]}]})
 const before=await orderCounts(),stock=await stockQty(),audits=(await root.query('SELECT count(*) FROM "AuditLog" WHERE "tenantId"=$1',[a])).rows[0].count
 const result=await ok(await pricePreview(payload))
 assert.equal(result.source,'current');assert.equal(result.totals.totalCents,12744);assert.equal(result.totals.couponDiscountCents,200)
 assert.deepEqual(result.couponHints,[{code:'PREVIEWPRODUCT',eligible:true,discountCents:200}])
 assert.deepEqual(result.lines,[{taxCents:1620,totalCents:10620}]);assert.deepEqual(result.productLines,[{taxCents:324,totalCents:2124}])
 const {subtotalAfterLineDiscounts}=require('../modules/appointments/order-pricing.ts')
 assert.equal(subtotalAfterLineDiscounts(result.totals),11000)
 assert.equal(subtotalAfterLineDiscounts(result.totals)-result.totals.couponDiscountCents+result.totals.taxCents,result.totals.totalCents)
 assert.deepEqual(await orderCounts(),before);assert.equal(await stockQty(),stock)
 assert.equal((await root.query('SELECT count(*) FROM "AuditLog" WHERE "tenantId"=$1',[a])).rows[0].count,audits)
 const saved=(await ok(await call('/orders','POST',payload),201)).order
 assert.deepEqual(result.totals,financialTotals(saved))
 const bytes=Buffer.from(await (await call('/orders/[id]/invoice','GET',undefined,saved.id)).arrayBuffer())
 require('node:fs').writeFileSync(path.resolve(__dirname,'../tmp/r2d15-mixed-tax-invoice.pdf'),bytes)
})

test('pricing preview reports minimum, eligible-scope and exclusive coupon skips from the server rules',async()=>{
 for(const value of [{code:'PREVIEWMIN',minSubtotalCents:50000},{code:'PREVIEWEXCLUSIVE',stackingMode:'EXCLUSIVE'},{code:'PREVIEWSECOND'}])
  await ok(await call('/coupons','POST',{discountType:'PERCENT',discountValue:10,...value}),201)
 const payload=newOrderPayload('2039-07-11',{status:'DRAFT',coupons:['PREVIEWMIN','PREVIEWPRODUCT','PREVIEWEXCLUSIVE','PREVIEWSECOND']})
 const result=await ok(await pricePreview(payload))
 assert.deepEqual(result.couponHints.map(hint=>[hint.code,hint.eligible]),[['PREVIEWMIN',false],['PREVIEWPRODUCT',false],['PREVIEWEXCLUSIVE',true],['PREVIEWSECOND',false]])
 assert.match(result.couponHints[0].reason,/minimum/);assert.match(result.couponHints[1].reason,/eligible/);assert.match(result.couponHints[3].reason,/exclusive/)
 const saved=(await ok(await call('/orders','POST',payload),201)).order
 assert.deepEqual(result.totals,financialTotals(saved));assert.deepEqual(saved.coupons.map(coupon=>coupon.code),['PREVIEWEXCLUSIVE'])
})

test('pricing preview checks current usage and validates scoped order before excluding its coupon use',async()=>{
 await ok(await call('/coupons','POST',{code:'PREVIEWONCE',discountType:'AMOUNT',discountValue:1,maxUses:1,maxUsesPerCustomer:1}),201)
 const payload=newOrderPayload('2039-07-12',{status:'DRAFT',coupons:['PREVIEWONCE']})
 const quoted=await ok(await pricePreview(payload)),saved=(await ok(await call('/orders','POST',payload),201)).order
 assert.deepEqual(quoted.totals,financialTotals(saved))
 assert.equal((await pricePreview(payload)).status,400)
 const edit=persistedInput(saved,payload);edit.lines[0].unitPriceCents+=100
 const repriced=await ok(await pricePreview(edit,saved.id));assert.equal(repriced.source,'current');assert.equal(repriced.totals.totalCents,saved.totalCents+100)
 assert.equal((await pricePreview(edit,saved.id,'ADMIN',b)).status,404)
 assert.equal((await pricePreview(payload,'missing')).status,404)
 assert.equal((await pricePreview({...edit,lines:[{...edit.lines[0],id:'foreign-line'}]},saved.id)).status,400)
 // Preview never reserves a coupon: the write must still revalidate its current use.
 assert.equal((await call('/orders','POST',payload)).status,400)
})

test('metadata preview and save retain historical tax and coupon snapshots; financial edits validate current rules',async()=>{
 const payload=newOrderPayload('2039-07-13',{status:'DRAFT',lines:[{...bookingPayload().lines[0],taxIds:[pricingTax]}]})
 const saved=(await ok(await call('/orders','POST',payload),201)).order
 await root.query('UPDATE "Tax" SET percent=30,"isActive"=false WHERE id=$1',[pricingTax])
 try{
  const input={...persistedInput(saved,payload),internalNote:'Keep saved prices'}
  const result=await ok(await pricePreview(input,saved.id));assert.equal(result.source,'saved');assert.deepEqual(result.totals,financialTotals(saved))
  const updated=(await ok(await patchOrder(saved.id,input))).order;assert.deepEqual(result.totals,financialTotals(updated))
  input.lines[0].unitPriceCents+=100
  assert.equal((await pricePreview(input,saved.id)).status,400)
 }finally{await root.query('UPDATE "Tax" SET percent=18,"isActive"=true WHERE id=$1',[pricingTax])}
})

test('pricing preview uses read permissions and independently enforces services, inventory and coupons access',async()=>{
 const payload=newOrderPayload('2039-07-14',{status:'DRAFT'})
 await perms(['appointments.read']);assert.equal((await pricePreview(payload,undefined,'MANAGER')).status,403)
 await perms(['appointments.read','services.read']);await ok(await pricePreview(payload,undefined,'MANAGER'))
 assert.equal((await pricePreview({...payload,productLines:[productLine()]},undefined,'MANAGER')).status,403)
 assert.equal((await pricePreview({...payload,coupons:['PREVIEWSECOND']},undefined,'MANAGER')).status,403)
 await flag(false,true,'services')
 try{assert.equal((await pricePreview(payload)).status,403)}finally{await flag(true,true,'services')}
 for(const role of ['STAFF','CUSTOMER'])assert.equal((await pricePreview(payload,undefined,role)).status,403)
 assert.equal((await pricePreview({...payload,appointmentStartTime:'25:00'})).status,400)
})

let syncedOrder
const readOrderApi=async id=>(await ok(await call('/orders/[id]','GET',undefined,id))).order
const syncAudits=async id=>(await root.query(`SELECT * FROM "AuditLog" WHERE "entityId"=$1 AND event='appointments.order.appointments_updated' ORDER BY "createdAt"`,[id])).rows

test('individual schedule edits synchronize linked lines and earliest order start while preserving quantities and prices',async()=>{
 for(const profile of [`staff_${suffix}`,a+'_profile2'])for(let day=1;day<=12;day++){
  const date=`2041-09-${String(day).padStart(2,'0')}`
  await root.query(`INSERT INTO "StaffFlexibleAvailability" (id,"staffProfileId",date,"startTime","endTime","sortOrder","updatedAt") VALUES ($1,$2,$3,'00:00','23:00',0,now())`,[`${profile}_${date}`,profile,date])
 }
 const payload=newOrderPayload('2041-09-01',{lines:[{...bookingPayload().lines[0],quantity:2},bookingPayload().lines[0]]})
 syncedOrder=(await ok(await call('/orders','POST',payload),201)).order
 const rows=await orderAppointments(syncedOrder.id),beforeTotals=financialTotals(syncedOrder)
 await root.query('UPDATE "Service" SET "durationMinutes"=90 WHERE id=$1',[service])
 try{await ok(await call('/[id]','PATCH',{startAt:'2041-09-01T14:00:00Z',serviceId:service},rows[0].id))}finally{await root.query('UPDATE "Service" SET "durationMinutes"=60 WHERE id=$1',[service])}
 const saved=await readOrderApi(syncedOrder.id)
 assert.equal(saved.lines[0].startAt,'2041-09-01T14:00:00.000Z');assert.equal(saved.lines[0].endAt,'2041-09-01T16:00:00.000Z')
 assert.equal(saved.lines[0].durationMinutes,120);assert.equal(saved.lines[0].quantity,2)
 assert.equal(saved.appointmentStartAt,'2041-09-01T12:00:00.000Z');assert.deepEqual(financialTotals(saved),beforeTotals)
 assert.deepEqual((await orderAppointments(saved.id))[1],rows[1])
 await ok(await resolve({action:'reassign',appointmentIds:[rows[0].id],targetStaffId:a+'_staff2'}))
 const reassigned=await readOrderApi(saved.id);assert.equal(reassigned.lines[0].staffProfileId,a+'_profile2')
 await ok(await patchOrder(saved.id,{internalNote:'Retain appointment schedule'}))
 assert.equal((await readOrderApi(saved.id)).lines[0].startAt,saved.lines[0].startAt)
 const audits=await syncAudits(saved.id);assert.equal(audits.length,2);assert.equal(audits[0].before.lines[0].startAt,syncedOrder.lines[0].startAt)
 assert.equal(audits[0].after.lines[0].startAt,saved.lines[0].startAt);assert.equal(audits[1].metadata.appointmentsAfter[0].staffProfileId,a+'_profile2')
 assert.equal(audits[0].actorUserId,a+'_admin');assert.ok(audits[0].requestId)
})

test('linked customer/service changes require the order editor and started work cannot be rescheduled',async()=>{
 const row=(await orderAppointments(syncedOrder.id))[0],before=await readOrderApi(syncedOrder.id)
 await ok(await call('/[id]','PATCH',{customerId:a+'_customer2'},row.id),409)
 const otherService=a+'_sync_service'
 await root.query(`INSERT INTO "Service" (id,"tenantId","categoryId",name,"durationMinutes","priceCents","updatedAt") VALUES ($1,$2,$3,'Another service',60,5000,now())`,[otherService,a,`cat_${suffix}`])
 await ok(await call('/[id]','PATCH',{serviceId:otherService},row.id),409)
 assert.deepEqual(await savedRow(row.id),row);assert.deepEqual(await readOrderApi(syncedOrder.id),before)
 await ok(await call('/[id]','PATCH',{status:'IN_PROGRESS'},row.id))
 await ok(await call('/[id]','PATCH',{startAt:'2041-09-01T17:00:00Z'},row.id),409)
 await ok(await resolve({action:'reassign',appointmentIds:[row.id],targetStaffId:a+'_staff'}),409)
 await ok(await call('/[id]','PATCH',{status:'COMPLETED'},row.id))
 assert.equal((await readOrderApi(syncedOrder.id)).status,'CONFIRMED')
})

test('bulk appointment changes synchronize each order without inferring financial cancellation or restocking',async()=>{
 const first=(await ok(await call('/orders','POST',newOrderPayload('2041-09-02',{productLines:[productLine()]})),201)).order
 const second=(await ok(await call('/orders','POST',newOrderPayload('2041-09-03')),201)).order
 const rows=[...(await orderAppointments(first.id)),...(await orderAppointments(second.id))],ids=rows.map(row=>row.id),qty=await stockQty(),counts=await orderCounts()
 await ok(await resolve({action:'reschedule',appointmentIds:ids,rescheduleDate:'2041-09-08',rescheduleTime:'11:00'}))
 assert.equal((await readOrderApi(first.id)).appointmentDate,'2041-09-08');assert.equal((await readOrderApi(second.id)).appointmentDate,'2041-09-09')
 await flag(false,true,'services')
 try{await ok(await resolve({action:'cancel',appointmentIds:ids}))}finally{await flag(true,true,'services')}
 for(const order of [first,second]){const saved=await readOrderApi(order.id);assert.equal(saved.status,'CONFIRMED');assert.deepEqual(financialTotals(saved),financialTotals(order));assert.equal((await orderAppointments(order.id))[0].status,'CANCELED');assert.equal((await syncAudits(order.id)).length,2)}
 assert.equal(await stockQty(),qty);assert.equal((await orderCounts()).movements,counts.movements)
 await ok(await resolve({action:'cancel',appointmentIds:ids}));assert.equal((await syncAudits(first.id)).length,2)
 await ok(await patchOrder(first.id,{status:'CANCELED'}));assert.equal(await stockQty(),qty+1)
 await ok(await call('/[id]','PATCH',{status:'SCHEDULED'},ids[0]),409)
 assert.equal((await savedRow(ids[0])).status,'CANCELED')
})

test('linked order auditing, ambiguous links and tenant boundaries roll back the entire appointment batch',async()=>{
 const order=(await ok(await call('/orders','POST',newOrderPayload('2041-09-04')),201)).order
 const linked=(await orderAppointments(order.id))[0],unrelated=await mutationRow('2041-09-04','15:00'),otherBefore=await savedRow(unrelated)
 const trigger='sync_audit_'+suffix
 await root.query(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."tenantId"='${a}' AND NEW.event='appointments.order.appointments_updated' THEN RAISE EXCEPTION 'Private sync audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER ${trigger} BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION ${trigger}()`)
 try{await ok(await resolve({action:'cancel',appointmentIds:[linked.id,unrelated]}),500)}finally{await root.query(`DROP TRIGGER ${trigger} ON "AuditLog";DROP FUNCTION ${trigger}()`)}
 assert.deepEqual(await readOrderApi(order.id),order);assert.deepEqual(await savedRow(linked.id),linked);assert.deepEqual(await savedRow(unrelated),otherBefore);assert.equal((await syncAudits(order.id)).length,0)
 await ok(await call('/[id]','DELETE',undefined,linked.id,'ADMIN',b),404)
 await root.query('UPDATE "Appointment" SET "orderLineId"=$1 WHERE id=$2',[order.lines[0].id,unrelated])
 try{await ok(await call('/[id]','DELETE',undefined,linked.id),409)}finally{await root.query('UPDATE "Appointment" SET "orderLineId"=null WHERE id=$1',[unrelated])}
 assert.deepEqual(await savedRow(linked.id),linked)
})

test('reverse order dates use tenant timezone across UTC midnight and preserve sibling dates',async()=>{
 const order=(await ok(await call('/orders','POST',newOrderPayload('2041-09-05')),201)).order,row=(await orderAppointments(order.id))[0]
 await root.query('UPDATE "AppSetting" SET "timeZone"=\'Asia/Kolkata\' WHERE "tenantId"=$1',[a])
 try{
  await ok(await call('/[id]','PATCH',{startAt:'2041-09-05T19:00:00Z'},row.id))
  const saved=await readOrderApi(order.id);assert.equal(saved.appointmentDate,'2041-09-06');assert.equal(saved.appointmentStartAt,'2041-09-05T19:00:00.000Z')
 }finally{await root.query('UPDATE "AppSetting" SET "timeZone"=\'UTC\' WHERE "tenantId"=$1',[a])}
})

test('appointment writers refresh module, role and permissions after waiting before changing linked orders',async()=>{
 const order=(await ok(await call('/orders','POST',newOrderPayload('2041-09-07')),201)).order,row=(await orderAppointments(order.id))[0]
 for(const scenario of ['permissions','module','role']){
  await perms(['appointments.read','appointments.archive']);await root.query('BEGIN');let pending
  try{
   await root.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`workforce-schedules:${a}`])
   pending=call('/[id]','DELETE',undefined,row.id,'MANAGER')
   let waiting=false;const deadline=Date.now()+5000
   while(Date.now()<deadline){waiting=(await root.query(`SELECT EXISTS (SELECT 1 FROM pg_locks held JOIN pg_locks waiter ON held.classid=waiter.classid AND held.objid=waiter.objid AND held.objsubid=waiter.objsubid WHERE held.pid=pg_backend_pid() AND held.locktype='advisory' AND NOT waiter.granted) AS waiting`)).rows[0].waiting;if(waiting)break;await new Promise(resolve=>setTimeout(resolve,20))}
   assert.equal(waiting,true)
   if(scenario==='permissions')await perms(['appointments.read'])
   if(scenario==='module')await flag(false)
   if(scenario==='role')await root.query('UPDATE "User" SET role=\'STAFF\' WHERE id=$1',[a+'_manager'])
   await root.query('COMMIT');await ok(await pending,403)
  }finally{await root.query('ROLLBACK');if(pending)await pending;await flag(true);await root.query('UPDATE "User" SET role=\'MANAGER\' WHERE id=$1',[a+'_manager'])}
 }
 assert.deepEqual(await savedRow(row.id),row);assert.deepEqual(await readOrderApi(order.id),order);assert.equal((await syncAudits(order.id)).length,0)
})

test('all booking create/edit paths recheck current write permissions under the shared scheduling lock',async()=>{
 const order=(await ok(await call('/orders','POST',newOrderPayload('2041-09-10',{status:'DRAFT'})),201)).order
 const row=(await orderAppointments(syncedOrder.id))[1]
 const commands=[
  ()=>call('','POST',singlePayload('2041-09-11'),undefined,'MANAGER'),
  ()=>call('/orders','POST',newOrderPayload('2041-09-11',{status:'DRAFT'}),undefined,'MANAGER'),
  ()=>patchOrder(order.id,{internalNote:'Must not save'},'MANAGER'),
  ()=>call('/[id]','PATCH',{status:'COMPLETED'},row.id,'MANAGER'),
  ()=>call('/resolve','POST',{action:'cancel',appointmentIds:[row.id]},undefined,'MANAGER'),
 ]
 const counts=await orderCounts(),original=await savedRow(row.id)
 for(const command of commands){
  await perms(['appointments.read','appointments.create','appointments.edit','appointments.archive','services.read']);await root.query('BEGIN');let pending
  try{
   await root.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`workforce-schedules:${a}`]);pending=command()
   let waiting=false;const deadline=Date.now()+5000
   while(Date.now()<deadline){waiting=(await root.query(`SELECT EXISTS (SELECT 1 FROM pg_locks held JOIN pg_locks waiter ON held.classid=waiter.classid AND held.objid=waiter.objid AND held.objsubid=waiter.objsubid WHERE held.pid=pg_backend_pid() AND held.locktype='advisory' AND NOT waiter.granted) AS waiting`)).rows[0].waiting;if(waiting)break;await new Promise(resolve=>setTimeout(resolve,20))}
   assert.equal(waiting,true);await perms(['appointments.read','services.read']);await root.query('COMMIT');await ok(await pending,403)
  }finally{await root.query('ROLLBACK');if(pending)await pending}
 }
 assert.deepEqual(await orderCounts(),counts);assert.deepEqual(await savedRow(row.id),original);assert.deepEqual(await readOrderApi(order.id),order)
})

test('standalone appointment creation rolls back when its audit cannot be recorded',async()=>{
 const counts=await orderCounts(),trigger='single_create_audit_'+suffix
 await root.query(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."tenantId"='${a}' AND NEW.event='appointment.created' THEN RAISE EXCEPTION 'Private creation audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER ${trigger} BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION ${trigger}()`)
 try{assert.equal((await ok(await call('','POST',singlePayload('2041-09-12')),500)).error,'Unable to complete this request.')}finally{await root.query(`DROP TRIGGER ${trigger} ON "AuditLog";DROP FUNCTION ${trigger}()`)}
 assert.deepEqual(await orderCounts(),counts)
})

test('coupon writers refresh action, archive, module and role access after the scheduling wait',async()=>{
 const saved=(await ok(await call('/coupons','POST',{code:'LOCKCHECK',discountType:'PERCENT',discountValue:5}),201)).coupon
 const scenarios=['create','edit','archive','status','module','role']
 const snapshot=async()=>(await root.query('SELECT * FROM "Coupon" WHERE id=$1',[saved.id])).rows[0]
 const before=await snapshot(),audits=Number((await root.query('SELECT count(*) FROM "AuditLog" WHERE "tenantId"=$1',[a])).rows[0].count)
 for(const scenario of scenarios){
  await perms(['appointmentCoupons.read','appointmentCoupons.create','appointmentCoupons.edit','appointmentCoupons.archive'])
  await root.query('BEGIN');let pending
  try{
   await root.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`workforce-schedules:${a}`])
   pending=scenario==='create'?call('/coupons','POST',{code:'NEVERCREATED',discountType:'PERCENT',discountValue:5},undefined,'MANAGER')
    :scenario==='archive'?call('/coupons/[id]','DELETE',undefined,saved.id,'MANAGER')
    :call('/coupons/[id]','PATCH',scenario==='status'?{isActive:false}:{name:'Must not change'},saved.id,'MANAGER')
   let waiting=false;const deadline=Date.now()+5000
   while(Date.now()<deadline){waiting=(await root.query(`SELECT EXISTS (SELECT 1 FROM pg_locks held JOIN pg_locks waiter ON held.classid=waiter.classid AND held.objid=waiter.objid AND held.objsubid=waiter.objsubid WHERE held.pid=pg_backend_pid() AND held.locktype='advisory' AND NOT waiter.granted) AS waiting`)).rows[0].waiting;if(waiting)break;await new Promise(resolve=>setTimeout(resolve,20))}
   assert.equal(waiting,true)
   if(scenario==='module')await flag(false)
   else if(scenario==='role')await root.query('UPDATE "User" SET role=\'STAFF\' WHERE id=$1',[a+'_manager'])
   else await perms(scenario==='status'?['appointmentCoupons.read','appointmentCoupons.edit']:['appointmentCoupons.read'])
   await root.query('COMMIT');await ok(await pending,403)
  }finally{await root.query('ROLLBACK');if(pending)await pending;await flag(true);await root.query('UPDATE "User" SET role=\'MANAGER\' WHERE id=$1',[a+'_manager'])}
 }
 assert.deepEqual(await snapshot(),before)
 assert.equal(Number((await root.query('SELECT count(*) FROM "Coupon" WHERE "tenantId"=$1 AND code=\'NEVERCREATED\'',[a])).rows[0].count),0)
 assert.equal(Number((await root.query('SELECT count(*) FROM "AuditLog" WHERE "tenantId"=$1',[a])).rows[0].count),audits)
 // Coupon access remains independent of booking access after sharing the helper.
 await perms(['appointmentCoupons.read','appointmentCoupons.edit'])
 assert.equal((await ok(await call('/coupons/[id]','PATCH',{name:'Coupon manager'},saved.id,'MANAGER'))).coupon.name,'Coupon manager')
})
