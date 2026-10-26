/* eslint-disable @typescript-eslint/no-require-imports */
const {bookingContext}=require('./helpers/booking-context.cjs')
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Client}=require('pg'),{AsyncLocalStorage}=require('node:async_hooks')
const raw=process.env.CRM_TEST_DATABASE_URL,url=new URL(raw||'http://invalid')
if(!['127.0.0.1','localhost'].includes(url.hostname)||url.pathname!=='/ls_salon_crm_test')throw Error('Disposable local database only.')
const root=new Client({connectionString:raw}),sessions=new AsyncLocalStorage();url.username='crm_test_runtime';url.password='';process.env.DATABASE_URL=url.toString()
const authPath=require.resolve('../auth.ts');require.cache[authPath]={id:authPath,filename:authPath,loaded:true,exports:{auth:async()=>{await Promise.resolve();return sessions.getStore()||null}}}
const logger=require('../lib/logger.ts').logger;logger.info=()=>{};logger.error=()=>{}
const {prisma,runWithTenantDbContext}=require('../lib/prisma.ts'),{runWithDatabaseActor}=require('../lib/database-actor.ts')
const {approvedLeaveBlocks}=require('../modules/workforce/availability-blocks.ts'),{defaultRecordRules}=require('../platform/access/rules.ts')
const {POST:availability}=require('../app/api/appointments/availability/route.ts'),{POST:book}=require('../app/api/appointments/route.ts')
const suffix=randomUUID().replaceAll('-',''),tenant='busy_'+suffix,foreign=tenant+'_foreign',admin=tenant+'_admin',scheduler=tenant+'_scheduler',plain=tenant+'_plain',employee=tenant+'_employee',customer=tenant+'_customer',profile='busy_profile_'+suffix,foreignProfile=profile+'_foreign',access=tenant+'_access',definition=tenant+'_definition',service=tenant+'_service',leave='busy_hidden_'+suffix
const day=value=>new Date(value+'T00:00:00Z'),start=day('2035-01-10'),end=day('2035-01-11')
const scoped=(user,operation,t=tenant)=>runWithTenantDbContext(t,()=>runWithDatabaseActor(user,async()=>await operation()))
const blocks=(user=scheduler,ids=[profile],first=start,last=end)=>scoped(user,()=>approvedLeaveBlocks(prisma,tenant,ids,first,last))
const setPermission=values=>root.query('UPDATE "TenantAccessRole" SET permissions=$1 WHERE id=$2',[values,access])
const permissionSet=['appointments.read','appointments.create','services.read']
async function call(handler){const captured=await bookingContext(root,tenant,scheduler);return sessions.run({user:{id:scheduler,tenantId:tenant,role:'STAFF'}},()=>handler(new Request(`http://${tenant}.localhost/api/appointments`,{method:'POST',headers:{host:tenant+'.localhost','Content-Type':'application/json',...captured},body:JSON.stringify({customerId:customer,serviceId:service,staffId:employee,startAt:'2035-01-10T10:00:00Z'})})))}
before(async()=>{
 await root.connect()
 for(const t of [tenant,foreign])await root.query('INSERT INTO "Tenant"(id,name,slug,"updatedAt") VALUES($1,$1,$1,now())',[t])
 for(const [id,role,t]of[[admin,'ADMIN',tenant],[scheduler,'STAFF',tenant],[plain,'MANAGER',tenant],[employee,'STAFF',tenant],[customer,'CUSTOMER',tenant],[foreign+'_employee','STAFF',foreign]])await root.query('INSERT INTO "User"(id,email,role,"tenantId","updatedAt") VALUES($1,$2,$3,$4,now())',[id,id+'@example.test',role,t])
 for(const [id,user]of[[profile,employee],[foreignProfile,foreign+'_employee']])await root.query('INSERT INTO "StaffProfile"(id,"userId","updatedAt") VALUES($1,$2,now())',[id,user])
 for(const key of ['appointments','services','shifts','leaves'])await root.query('INSERT INTO "TenantModule"("tenantId",key,allowed,enabled,"updatedAt") VALUES($1,$2,true,$3,now())',[tenant,key,key!=='leaves'])
 await root.query('INSERT INTO "TenantAccessRole"(id,"tenantId",name,"nameKey",permissions,"updatedAt") VALUES($1,$2,\'Scheduler\',\'scheduler\',$3,now())',[access,tenant,permissionSet])
 await root.query('INSERT INTO "TenantUserAccess"("tenantId","userId",rules,"updatedAt") VALUES($1,$2,$3,now())',[tenant,scheduler,defaultRecordRules()])
 await root.query('INSERT INTO "TenantRoleAssignment"("tenantId","userId","roleId","updatedAt") VALUES($1,$2,$3,now())',[tenant,scheduler,access])
 await root.query('INSERT INTO "AppSetting"(id,"tenantId","timeZone","updatedAt") VALUES($1,$1,\'UTC\',now())',[tenant])
 await root.query('INSERT INTO "LeaveDefinition"(id,"tenantId",code,name,"leaveType","updatedAt") VALUES($1,$2,\'PRIVATE_CODE\',\'Private medical classification\',\'PAID\',now())',[definition,tenant])
 for(const [id,status,from,to]of[[leave,'APPROVED','2035-01-01','2035-01-20'],[leave+'_duplicate','APPROVED','2035-01-01','2035-01-20'],[leave+'_pending','PENDING','2035-02-01','2035-02-03'],[leave+'_rejected','REJECTED','2035-03-01','2035-03-03']])await root.query('INSERT INTO "LeaveRequest"(id,"tenantId","staffProfileId","leaveDefinitionId","startDate","endDate","daysCount",status,reason,"updatedAt") VALUES($1,$2,$3,$4,$5,$6,1,$7,\'Private health reason\',now())',[id,tenant,profile,definition,from,to,status])
 await root.query('INSERT INTO "ServiceCategory"(id,"tenantId",name,"updatedAt") VALUES($1,$2,\'Availability\',now())',[service+'_cat',tenant])
 await root.query('INSERT INTO "Service"(id,"tenantId","categoryId",name,"durationMinutes","priceCents","updatedAt") VALUES($1,$2,$3,\'Consultation\',60,100,now())',[service,tenant,service+'_cat'])
 await root.query('CREATE POLICY test_private_busy_source ON "LeaveRequest" AS RESTRICTIVE FOR SELECT USING (id NOT LIKE \'busy_hidden_%\')')
})
after(async()=>{await root.query('DROP POLICY IF EXISTS test_private_busy_source ON "LeaveRequest"');await root.end();await Promise.all([global.prisma,global.prismaBypassClient,...[...(global.prismaScopedClientCache?.values()||[])].map(entry=>entry.client)].filter(Boolean).map(client=>client.$disconnect()));await global.prismaPool?.end()})

test('hidden source requests still block dates without returning identifiers, classifications or reasons',async()=>{
 assert.deepEqual(await scoped(scheduler,()=>prisma.leaveRequest.findMany({where:{tenantId:tenant}})),[])
 const rows=await blocks();assert.equal(rows.length,1,'duplicate busy periods must not expose the number of source requests')
 assert.deepEqual(Object.keys(rows[0]).sort(),['endDate','staffProfileId','startDate']);assert.equal(rows[0].staffProfileId,profile)
 assert.equal(rows[0].startDate.toISOString(),start.toISOString());assert.equal(rows[0].endDate.toISOString(),end.toISOString())
 const serialized=JSON.stringify(rows);for(const secret of [leave,'PRIVATE_CODE','Private medical classification','Private health reason'])assert(!serialized.includes(secret))
})
test('booking availability and actual creation both reject hidden leave with a generic message',async()=>{
 const response=await call(availability);assert.equal(response.status,200);assert.deepEqual(await response.json(),{available:false,reason:'Staff member is unavailable on this date.'})
 const saved=await call(book);assert.equal(saved.status,409);assert.equal((await saved.json()).error,'Staff member is unavailable on this date.')
 assert.equal((await root.query('SELECT id FROM "Appointment" WHERE "tenantId"=$1',[tenant])).rowCount,0)
})
test('only approved dates are projected, only inside the requested range',async()=>{
 assert.deepEqual(await blocks(scheduler,[profile],day('2035-02-01'),day('2035-02-03')),[])
 assert.deepEqual(await blocks(scheduler,[profile],day('2035-03-01'),day('2035-03-03')),[])
 assert.deepEqual(await blocks(scheduler,[profile],day('2035-01-21'),day('2035-01-22')),[])
 const single=await blocks(scheduler,[profile],day('2035-01-20'),day('2035-01-20'));assert.equal(single.length,1);assert.equal(single[0].startDate.getTime(),single[0].endDate.getTime())
})
test('a read-only shift scheduler can protect plans even with Appointments and Leaves disabled',async()=>{
 await setPermission(['shiftPlans.read']);await root.query('UPDATE "TenantModule" SET enabled=false WHERE "tenantId"=$1 AND key=\'appointments\'',[tenant])
 try{assert.equal((await blocks()).length,1)}finally{await setPermission(permissionSet);await root.query('UPDATE "TenantModule" SET enabled=true WHERE "tenantId"=$1 AND key=\'appointments\'',[tenant])}
})
test('a manager label, a customer, an unknown or missing actor cannot query busy data',async()=>{
 for(const actor of [plain,customer,'missing'])await assert.rejects(blocks(actor),error=>error.status===403)
 await assert.rejects(runWithTenantDbContext(tenant,()=>approvedLeaveBlocks(prisma,tenant,[profile],start,end)),error=>error.status===403)
})
test('mixed foreign or missing staff selections fail as a whole instead of returning a subset',async()=>{
 for(const ids of [[profile,foreignProfile],[profile,'missing']])await assert.rejects(blocks(scheduler,ids),error=>error.status===403)
 await assert.rejects(scoped(scheduler,()=>approvedLeaveBlocks(prisma,foreign,[foreignProfile],start,end)),error=>error.status===403)
})
test('current profiles, read limits and activation are checked for every projection',async()=>{
 await setPermission([]);try{await assert.rejects(blocks(),error=>error.status===403)}finally{await setPermission(permissionSet)}
 await root.query('UPDATE "TenantAccessRole" SET archived=true WHERE id=$1',[access]);try{await assert.rejects(blocks(),error=>error.status===403)}finally{await root.query('UPDATE "TenantAccessRole" SET archived=false WHERE id=$1',[access])}
 await root.query('UPDATE "TenantUserAccess" SET rules=jsonb_set(rules,\'{appointments.read}\',\'"NONE"\') WHERE "tenantId"=$1 AND "userId"=$2',[tenant,scheduler]);try{await assert.rejects(blocks(),error=>error.status===403)}finally{await root.query('UPDATE "TenantUserAccess" SET rules=$1 WHERE "tenantId"=$2 AND "userId"=$3',[defaultRecordRules(),tenant,scheduler])}
 await root.query('UPDATE "TenantModule" SET allowed=false,enabled=false WHERE "tenantId"=$1 AND key=\'appointments\'',[tenant]);try{await assert.rejects(blocks(),error=>error.status===403)}finally{await root.query('UPDATE "TenantModule" SET allowed=true,enabled=true WHERE "tenantId"=$1 AND key=\'appointments\'',[tenant])}
})
test('account or tenant suspension invalidates projection access immediately',async()=>{
 await root.query('UPDATE "User" SET status=\'SUSPENDED\' WHERE id=$1',[scheduler]);try{await assert.rejects(blocks(),error=>error.status===403)}finally{await root.query('UPDATE "User" SET status=\'ACTIVE\' WHERE id=$1',[scheduler])}
 await root.query('UPDATE "Tenant" SET status=\'SUSPENDED\' WHERE id=$1',[tenant]);try{await assert.rejects(blocks(admin),error=>error.status===403)}finally{await root.query('UPDATE "Tenant" SET status=\'ACTIVE\' WHERE id=$1',[tenant])}
})
test('range and batch bounds fail closed, empty selections have no data, and long valid horizons remain supported',async()=>{
 await assert.rejects(blocks(scheduler,Array.from({length:201},(_,i)=>String(i))),error=>error.status===400)
 await assert.rejects(blocks(scheduler,[profile],end,start),error=>error.status===400)
 await assert.rejects(blocks(scheduler,[profile],new Date('invalid'),end),error=>error.status===400)
 assert.deepEqual(await blocks(scheduler,[]),[])
 assert.equal((await blocks(scheduler,[profile,profile],day('2020-01-01'),day('2099-01-01'))).length,1)
})
test('date-only ranges do not shift when the database connection uses a different time zone',async()=>{
 const rows=await scoped(scheduler,()=>prisma.$transaction(async tx=>{
  await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'America/Los_Angeles'")
  return approvedLeaveBlocks(tx,tenant,[profile],start,end)
 }))
 assert.equal(rows.length,1);assert.equal(rows[0].startDate.toISOString(),start.toISOString());assert.equal(rows[0].endDate.toISOString(),end.toISOString())
})
test('projection does not grant source read, mutate leave history, or leak pooled tenant/actor context',async()=>{
 assert.deepEqual(await scoped(scheduler,()=>prisma.leaveRequest.findMany({where:{tenantId:tenant}})),[])
 assert.equal((await root.query('SELECT reason FROM "LeaveRequest" WHERE id=$1',[leave])).rows[0].reason,'Private health reason')
 assert.equal(await prisma.user.count(),0)
 await assert.rejects(scoped(foreign+'_employee',()=>approvedLeaveBlocks(prisma,tenant,[profile],start,end)),error=>error.status===403)
})
