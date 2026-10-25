/* eslint-disable @typescript-eslint/no-require-imports */
process.env.TZ='UTC'
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Client}=require('pg'),{AsyncLocalStorage}=require('node:async_hooks')
const raw=process.env.CRM_TEST_DATABASE_URL,url=new URL(raw||'http://invalid')
if(!['127.0.0.1','localhost'].includes(url.hostname)||url.pathname!=='/ls_salon_crm_test')throw Error('Disposable local database only.')
const root=new Client({connectionString:raw}),sessions=new AsyncLocalStorage();url.username='crm_test_runtime';url.password='';process.env.DATABASE_URL=url.toString()
const authPath=require.resolve('../auth.ts');require.cache[authPath]={id:authPath,filename:authPath,loaded:true,exports:{auth:async()=>{await Promise.resolve();return sessions.getStore()||null}}}
const logger=require('../lib/logger.ts').logger;logger.info=()=>{};logger.error=()=>{}
const {prisma,runWithTenantDbContext}=require('../lib/prisma.ts'),{runWithDatabaseActor}=require('../lib/database-actor.ts')
const {appointmentConflictSummary:summary,activeStaffBookingSlots:busy}=require('../modules/appointments/booking-integrity.ts'),{defaultRecordRules}=require('../platform/access/rules.ts')
const {planTransaction}=require('../modules/workforce/plan-transaction.ts')
const {protectPlanBookings}=require('../modules/workforce/plan-bookings.ts'),{scheduleConfirmedOrderLines,AvailabilityConflictError}=require('../modules/appointments/order-scheduling.ts')
const {POST:saveSlots}=require('../app/api/shifts/flexible-slots/route.ts')
const {POST:availability}=require('../app/api/appointments/availability/route.ts'),book=require('../app/api/appointments/route.ts'),detail=require('../app/api/appointments/[id]/route.ts'),{POST:resolve}=require('../app/api/appointments/resolve/route.ts'),{PATCH:review}=require('../app/api/leaves/requests/[id]/review/route.ts')
const id='private_booking_'+randomUUID().replaceAll('-',''),foreign=id+'_foreign',admin=id+'_admin',scheduler=id+'_scheduler',plain=id+'_plain',employee=id+'_employee',employee2=id+'_employee2',customer=id+'_customer',customer2=id+'_customer2',profile=id+'_profile',profile2=id+'_profile2',foreignProfile=id+'_foreignprofile',role=id+'_role',service=id+'_service',hidden='booking_hidden_'+id,visible=id+'_visible',leave=id+'_leave'
const instant=s=>new Date(s),slot=(start='2035-01-10T10:00Z',end='2035-01-10T11:00Z',staffProfileId=profile,customerId)=>({staffProfileId,startAt:instant(start),endAt:instant(end),...(customerId?{customerId}:{})})
const scoped=(user,fn,t=id)=>runWithTenantDbContext(t,()=>runWithDatabaseActor(user,fn))
const permissions=['appointments.read','appointments.create','appointments.edit','appointments.archive','services.read','shiftRoster.read','shiftRoster.edit','shiftPlans.read','leaveApprovals.read','leaveApprovals.approve']
const setPermissions=p=>root.query('UPDATE "TenantAccessRole" SET permissions=$1 WHERE id=$2',[p,role])
const payload={customerId:customer,serviceId:service,staffId:employee,startAt:'2035-01-10T10:00:00Z'}
const call=(handler,method='POST',body=payload,record,who=scheduler)=>sessions.run({user:{id:who,tenantId:id,role:who===admin?'ADMIN':'STAFF'}},()=>handler(new Request(`http://${id}.localhost/api/appointments`,{method,headers:{host:id+'.localhost','Content-Type':'application/json'},...(method==='GET'?{}:{body:JSON.stringify(body)})}),{params:Promise.resolve({id:record})}))
before(async()=>{
 await root.connect()
 for(const tenant of [id,foreign])await root.query('INSERT INTO "Tenant"(id,name,slug,"updatedAt") VALUES($1,$1,$1,now())',[tenant])
 for(const [user,label,tenant]of[[admin,'ADMIN',id],[scheduler,'STAFF',id],[plain,'MANAGER',id],[employee,'STAFF',id],[employee2,'STAFF',id],[customer,'CUSTOMER',id],[customer2,'CUSTOMER',id],[foreign+'_employee','STAFF',foreign]])await root.query('INSERT INTO "User"(id,email,name,role,"tenantId","updatedAt") VALUES($1,$2,\'Private customer name\',$3,$4,now())',[user,user+'@example.test',label,tenant])
 for(const [p,user]of[[profile,employee],[profile2,employee2],[foreignProfile,foreign+'_employee']])await root.query('INSERT INTO "StaffProfile"(id,"userId","schedulingMode","managerUserId","leaveApprovalMode","updatedAt") VALUES($1,$2,\'FLEXIBLE\',$3,\'REPORTING_MANAGER\',now())',[p,user,user===foreign+'_employee'?null:scheduler])
 for(const key of ['appointments','services','shifts','leaves'])await root.query('INSERT INTO "TenantModule"("tenantId",key,allowed,enabled,"updatedAt") VALUES($1,$2,true,true,now())',[id,key])
 await root.query('INSERT INTO "TenantAccessRole"(id,"tenantId",name,"nameKey",permissions,"updatedAt") VALUES($1,$2,\'Scheduler\',\'scheduler\',$3,now())',[role,id,permissions])
 await root.query('INSERT INTO "TenantUserAccess"("tenantId","userId",rules,"updatedAt") VALUES($1,$2,$3,now())',[id,scheduler,defaultRecordRules()])
 await root.query('INSERT INTO "TenantRoleAssignment"("tenantId","userId","roleId","updatedAt") VALUES($1,$2,$3,now())',[id,scheduler,role])
 await root.query('INSERT INTO "AppSetting"(id,"tenantId","timeZone","updatedAt") VALUES($1,$1,\'UTC\',now())',[id])
 await root.query('INSERT INTO "ServiceCategory"(id,"tenantId",name,"updatedAt") VALUES($1,$2,\'Booking integrity\',now())',[service+'_cat',id])
 await root.query('INSERT INTO "Service"(id,"tenantId","categoryId",name,"durationMinutes","priceCents","updatedAt") VALUES($1,$2,$3,\'Private consultation\',60,100,now())',[service,id,service+'_cat'])
 for(const [booking,p,c,day,hour]of[[hidden,profile,customer,'10','10'],[hidden+'_customer',profile2,customer,'10','14'],[visible,profile,customer2,'12','10']])await root.query('INSERT INTO "Appointment"(id,"tenantId","staffProfileId","customerId","serviceId","startAt","endAt","updatedAt") VALUES($1,$2,$3,$4,$5,$6,$7,now())',[booking,id,p,c,service,`2035-01-${day}T${hour}:00Z`,`2035-01-${day}T${Number(hour)+1}:00Z`])
 for(const day of ['10','11','12'])await root.query('INSERT INTO "StaffFlexibleAvailability"(id,"staffProfileId",date,"startTime","endTime","updatedAt") VALUES($1,$2,$3,\'09:00\',\'17:00\',now())',[profile+day,profile,`2035-01-${day}`])
 await root.query('INSERT INTO "LeaveDefinition"(id,"tenantId",code,name,"leaveType","updatedAt") VALUES($1,$2,\'AL\',\'Annual\',\'PAID\',now())',[leave+'_definition',id])
 await root.query('INSERT INTO "LeaveRequest"(id,"tenantId","staffProfileId","leaveDefinitionId","startDate","endDate","daysCount","updatedAt") VALUES($1,$2,$3,$4,\'2035-01-10\',\'2035-01-10\',1,now())',[leave,id,profile,leave+'_definition'])
 await root.query('CREATE POLICY test_private_booking_source ON "Appointment" AS RESTRICTIVE FOR SELECT USING (id NOT LIKE \'booking_hidden_%\')')
})
after(async()=>{await root.query('DROP POLICY IF EXISTS test_private_booking_source ON "Appointment"');await root.end();await Promise.all([global.prisma,global.prismaBypassClient,...[...(global.prismaScopedClientCache?.values()||[])].map(entry=>entry.client)].filter(Boolean).map(client=>client.$disconnect()));await global.prismaPool?.end()})

test('a hidden staff booking blocks availability and saving without exposing its source',async()=>{
 assert.equal(await scoped(scheduler,()=>prisma.appointment.count({where:{tenantId:id,id:hidden}})),0)
 for(const [handler,status]of[[availability,200],[book.POST,409]]){
  const response=await call(handler),body=await response.json();assert.equal(response.status,status,JSON.stringify(body));assert.match(body.reason||body.error,/Staff member already has an appointment/)
  for(const secret of [hidden,'Private customer name','Private consultation',customer])assert(!JSON.stringify(body).includes(secret))
 }
 assert.equal((await root.query('SELECT count(*)::int n FROM "Appointment" WHERE "tenantId"=$1',[id])).rows[0].n,3)
})
test('customer conflicts are detected across hidden staff calendars and boundaries remain half-open',async()=>{
 const rows=await scoped(scheduler,()=>summary(prisma,id,[slot('2035-01-10T14:00Z','2035-01-10T15:00Z',profile,customer),slot('2035-01-10T11:00Z','2035-01-10T12:00Z')]))
 assert.deepEqual(rows,[{slotIndex:0,staffConflict:false,customerConflict:true,conflictCount:0},{slotIndex:1,staffConflict:false,customerConflict:false,conflictCount:0}])
 const response=await call(availability,'POST',{...payload,startAt:'2035-01-10T14:00:00Z'});assert.equal(response.status,200);assert.match((await response.json()).reason,/Customer already/)
})
test('moves, bulk resolution and order scheduling cannot collide with hidden bookings',async()=>{
 const edit=await call(detail.PATCH,'PATCH',{startAt:payload.startAt},visible);assert.equal(edit.status,409,JSON.stringify(await edit.json()))
 const bulk=await call(resolve,'POST',{appointmentIds:[visible],action:'reschedule',rescheduleDate:'2035-01-10',rescheduleTime:'10:00'});assert.equal(bulk.status,409,JSON.stringify(await bulk.json()))
 await assert.rejects(scoped(scheduler,()=>scheduleConfirmedOrderLines([{...slot(),durationMinutes:60}],customer,[],id)),error=>error instanceof AvailabilityConflictError&&error.suggestedStartAt==='2035-01-10T11:00:00.000Z')
 assert.equal((await root.query('SELECT "startAt" FROM "Appointment" WHERE id=$1',[visible])).rows[0].startAt.toISOString(),'2035-01-12T10:00:00.000Z')
})
test('an unavailable source cannot be supplied as an edit exclusion or bulk target',async()=>{
 const excluded=await call(availability,'POST',{...payload,appointmentId:hidden});assert.equal(excluded.status,404)
 const bulk=await call(resolve,'POST',{appointmentIds:[hidden],action:'cancel'});assert.equal(bulk.status,404)
 assert.equal((await root.query('SELECT status FROM "Appointment" WHERE id=$1',[hidden])).rows[0].status,'SCHEDULED')
})
test('leave approval blocks hidden bookings even when Appointments is disabled, with no detail query',async()=>{
 await root.query('UPDATE "TenantModule" SET enabled=false WHERE "tenantId"=$1 AND key=\'appointments\'',[id])
 try{const response=await call(review,'PATCH',{status:'APPROVED'},leave),body=await response.json();assert.equal(response.status,409,JSON.stringify(body));assert.equal(body.conflicts[0].conflictCount,1);assert.deepEqual(body.conflicts[0].conflictingAppointments,[])}finally{await root.query('UPDATE "TenantModule" SET enabled=true WHERE "tenantId"=$1 AND key=\'appointments\'',[id])}
 assert.equal((await root.query('SELECT status FROM "LeaveRequest" WHERE id=$1',[leave])).rows[0].status,'PENDING')
})
test('a hidden booking protects a plan change and the tentative change rolls back',async()=>{
 await assert.rejects(scoped(scheduler,()=>planTransaction({tenantId:id,userId:scheduler,role:'STAFF',requestId:randomUUID()},'shiftRoster','edit',async tx=>{
  const check=await protectPlanBookings(tx,id,{id:profile},['2035-01-10'])
  await tx.staffFlexibleAvailability.updateMany({where:{staffProfileId:profile,date:instant('2035-01-10')},data:{endTime:'10:00'}})
  await check()
 })),error=>error.status===409&&error.blockedSlots.length===1&&!JSON.stringify(error.blockedSlots).includes(hidden))
 assert.equal((await root.query('SELECT "endTime" FROM "StaffFlexibleAvailability" WHERE id=$1',[profile+'10'])).rows[0].endTime,'17:00')
})
test('busy projection pages distinct intervals beyond the first 200 and retains overdue in-progress work',async()=>{
 await root.query('INSERT INTO "Appointment"(id,"tenantId","staffProfileId","customerId","serviceId","startAt","endAt",status,"updatedAt") SELECT $1||n,$2,$3,$4,$5,\'2038-01-20T09:00Z\'::timestamp+n*interval \'1 minute\',\'2038-01-20T09:01Z\'::timestamp+n*interval \'1 minute\',\'SCHEDULED\',now() FROM generate_series(1,201)n',[hidden+'_page',id,profile,customer,service])
 const first=await scoped(scheduler,()=>busy(prisma,id,[profile],instant('2037-01-01'))),second=await scoped(scheduler,()=>busy(prisma,id,[profile],instant('2037-01-01'),first.at(-1)))
 assert.equal(first.length,200);assert.equal(second.length,1);assert.deepEqual(Object.keys(second[0]).sort(),['endAt','staffProfileId','startAt'])
 await root.query('UPDATE "Appointment" SET status=\'IN_PROGRESS\',"startAt"=\'2020-01-01T10:00Z\',"endAt"=\'2020-01-01T11:00Z\' WHERE id=$1',[hidden])
 try{const overdue=await scoped(scheduler,()=>busy(prisma,id,[profile],instant('2037-01-01')));assert.equal(overdue[0].startAt.toISOString(),'2020-01-01T10:00:00.000Z')}finally{await root.query('UPDATE "Appointment" SET status=\'SCHEDULED\',"startAt"=\'2035-01-10T10:00Z\',"endAt"=\'2035-01-10T11:00Z\' WHERE id=$1',[hidden])}
})
test('current access and activation gate every invocation, with no implicit manager or customer grant',async()=>{
 for(const who of [plain,customer,'missing'])await assert.rejects(scoped(who,()=>summary(prisma,id,[slot()])),e=>e.status===403)
 await assert.rejects(runWithTenantDbContext(id,()=>summary(prisma,id,[slot()])),e=>e.status===403)
 await setPermissions(['shiftRoster.read'])
 try{assert.equal((await scoped(scheduler,()=>summary(prisma,id,[slot()])))[0].staffConflict,true);await assert.rejects(scoped(scheduler,()=>summary(prisma,id,[slot(undefined,undefined,profile,customer)])),e=>e.status===403);await assert.rejects(scoped(scheduler,()=>summary(prisma,id,[slot()],[visible])),e=>e.status===403)}finally{await setPermissions(permissions)}
 await setPermissions([]);try{await assert.rejects(scoped(scheduler,()=>summary(prisma,id,[slot()])),e=>e.status===403)}finally{await setPermissions(permissions)}
 await root.query('UPDATE "TenantAccessRole" SET archived=true WHERE id=$1',[role]);try{await assert.rejects(scoped(scheduler,()=>summary(prisma,id,[slot()])),e=>e.status===403)}finally{await root.query('UPDATE "TenantAccessRole" SET archived=false WHERE id=$1',[role])}
})
test('read limits and module revocation are fresh even when a profile still grants Appointments',async()=>{
 await setPermissions(['appointments.read'])
 try{
  await root.query('UPDATE "TenantUserAccess" SET rules=jsonb_set(rules,\'{appointments.read}\',\'"NONE"\') WHERE "tenantId"=$1 AND "userId"=$2',[id,scheduler])
  await assert.rejects(scoped(scheduler,()=>summary(prisma,id,[slot()])),e=>e.status===403)
  await root.query('UPDATE "TenantUserAccess" SET rules=$1 WHERE "tenantId"=$2 AND "userId"=$3',[defaultRecordRules(),id,scheduler])
  await root.query('UPDATE "TenantModule" SET enabled=false WHERE "tenantId"=$1 AND key=\'appointments\'',[id])
  await assert.rejects(scoped(scheduler,()=>busy(prisma,id,[profile],new Date())),e=>e.status===403)
 }finally{await setPermissions(permissions);await root.query('UPDATE "TenantUserAccess" SET rules=$1 WHERE "tenantId"=$2 AND "userId"=$3',[defaultRecordRules(),id,scheduler]);await root.query('UPDATE "TenantModule" SET enabled=true WHERE "tenantId"=$1 AND key=\'appointments\'',[id])}
})
test('completed, canceled and no-show appointments do not reserve a slot',async()=>{
 for(const status of ['COMPLETED','CANCELED','NO_SHOW']){
  await root.query('UPDATE "Appointment" SET status=$1::"AppointmentStatus" WHERE id=$2',[status,hidden])
  try{assert.equal((await scoped(scheduler,()=>summary(prisma,id,[slot()])))[0].staffConflict,false)}finally{await root.query('UPDATE "Appointment" SET status=\'SCHEDULED\' WHERE id=$1',[hidden])}
 }
})
test('mixed foreign targets, invalid ranges, suspension and altered pooled context fail closed',async()=>{
 for(const input of [[slot(),slot(undefined,undefined,foreignProfile)],[slot(undefined,undefined,profile,foreign+'_employee')]])await assert.rejects(scoped(scheduler,()=>summary(prisma,id,input)),e=>e.status===403)
 await assert.rejects(scoped(scheduler,()=>busy(prisma,id,[profile,foreignProfile],new Date())),e=>e.status===403)
 await assert.rejects(scoped(scheduler,()=>summary(prisma,foreign,[slot()])),e=>e.status===403)
 await assert.rejects(scoped(scheduler,()=>summary(prisma,id,[slot()],[foreign+'_missing'])),e=>e.status===403)
 await assert.rejects(scoped(scheduler,()=>summary(prisma,id,Array.from({length:201},()=>slot()))),e=>e.status===400)
 await assert.rejects(scoped(scheduler,()=>summary(prisma,id,[slot('2035-01-10T11:00Z','2035-01-10T10:00Z')])),e=>e.status===400)
 for(const table of ['User','Tenant']){await root.query(`UPDATE "${table}" SET status='SUSPENDED' WHERE id=$1`,[table==='User'?scheduler:id]);try{await assert.rejects(scoped(scheduler,()=>summary(prisma,id,[slot()])),e=>e.status===403)}finally{await root.query(`UPDATE "${table}" SET status='ACTIVE' WHERE id=$1`,[table==='User'?scheduler:id])}}
 assert.equal(await prisma.appointment.count(),0)
})
test('timestamp projections remain identical under a non-UTC database connection',async()=>{
 await scoped(scheduler,()=>prisma.$transaction(async tx=>{await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'America/Los_Angeles'");assert.equal((await summary(tx,id,[slot()]))[0].staffConflict,true);const rows=await busy(tx,id,[profile],instant('2034-01-01'));assert.equal(rows[0].startAt.toISOString(),'2035-01-10T10:00:00.000Z')}))
})
test('resolution details page all visible records for a shared busy interval after rollback',async()=>{
 await root.query('INSERT INTO "Appointment"(id,"tenantId","staffProfileId","customerId","serviceId","startAt","endAt","updatedAt") SELECT $1||n,$2,$3,$4,$5,\'2035-01-11T10:00Z\',\'2035-01-11T11:00Z\',now() FROM generate_series(1,201)n',[id+'_duplicate',id,profile,customer,service])
 const response=await call(saveSlots,'POST',{staffId:employee,date:'2035-01-11',slots:[{startTime:'09:00',endTime:'10:00'}]}),body=await response.json()
 assert.equal(response.status,409,JSON.stringify(body));assert.equal(body.conflictCount,1);assert.equal(body.conflicts.length,201)
 assert.equal(new Set(body.conflicts.map(row=>row.id)).size,201)
 assert.equal((await root.query('SELECT "endTime" FROM "StaffFlexibleAvailability" WHERE id=$1',[profile+'11'])).rows[0].endTime,'17:00')
})
