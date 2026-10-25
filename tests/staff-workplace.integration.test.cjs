/* eslint-disable @typescript-eslint/no-require-imports */
process.env.TZ='UTC'
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Client}=require('pg'),{AsyncLocalStorage}=require('node:async_hooks')
const raw=process.env.CRM_TEST_DATABASE_URL,url=new URL(raw||'http://invalid');if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!='/ls_salon_crm_test')throw Error('Disposable local database only.')
const root=new Client({connectionString:raw}),sessions=new AsyncLocalStorage();url.username='crm_test_runtime';url.password='';process.env.DATABASE_URL=url.toString()
const authPath=require.resolve('../auth.ts');require.cache[authPath]={id:authPath,filename:authPath,loaded:true,exports:{auth:async()=>{await Promise.resolve();return sessions.getStore()||null}}}
require('../lib/logger.ts').logger.info=()=>{};require('../lib/logger.ts').logger.error=()=>{}
const {prisma,runWithTenantDbContext}=require('../lib/prisma.ts'),{runWithDatabaseActor}=require('../lib/database-actor.ts'),{allPermissions}=require('../platform/access/catalog.ts'),{defaultRecordRules,supportedScopes}=require('../platform/access/rules.ts')
const route=require('../app/api/shifts/workplaces/route.ts'),choices=require('../app/api/shifts/workplaces/offices/route.ts')
const tenant='workplace_'+randomUUID().replaceAll('-',''),admin=tenant+'_admin',manager=tenant+'_manager',both=tenant+'_both',reader=tenant+'_reader',unprofiled=tenant+'_unprofiled',role=tenant+'_role',foreign=tenant+'_foreign'
const who=user=>({user:{id:user,tenantId:tenant,role:user===admin?'ADMIN':user===manager||user===both||user===reader||user===unprofiled?'MANAGER':'STAFF'}})
const scoped=(user,fn)=>runWithTenantDbContext(tenant,()=>runWithDatabaseActor(user,async()=>await fn()))
async function call(user,method='GET',data,query='',endpoint=route){return sessions.run(who(user),()=>endpoint[method](new Request(`http://${tenant}.localhost/api/shifts/workplaces${query}`,{method,headers:{host:tenant+'.localhost','content-type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})})))}
async function body(response,status=200){const result=await response.json();assert.equal(response.status,status,JSON.stringify(result));return result}
const view=(staff,user=admin)=>call(user,'GET',undefined,`?staffId=${staff}`).then(r=>body(r))
const post=(staff,payload,user=admin,status=200)=>call(user,'POST',{staffId:staff,...payload}).then(r=>body(r,status))
const assign=(office,version,fromId,startsOn)=>({action:'assign',officeId:office,version,...(fromId?{fromId}:{}),startsOn:startsOn||today})
let a,b,c,today
async function member(user,offices){await root.query('INSERT INTO "BusinessOfficePolicy"("tenantId","userId","updatedAt") VALUES($1,$2,now()) ON CONFLICT DO NOTHING',[tenant,user]);for(const office of offices)await root.query('INSERT INTO "BusinessOfficeGrant"("tenantId","userId","officeId") VALUES($1,$2,$3)',[tenant,user,office])}
async function fresh(){const id=tenant+'_'+randomUUID().replaceAll('-','');await root.query('INSERT INTO "User"(id,"tenantId",email,role,"updatedAt") VALUES($1,$2,$3,\'STAFF\',now())',[id,tenant,id+'@example.test']);await root.query('INSERT INTO "StaffProfile"(id,"userId","updatedAt") VALUES($1,$1,now())',[id]);await member(id,[a,b]);await grant(id);return id}
async function grant(user,permissions=allPermissions){const rules=defaultRecordRules();for(const p of Object.keys(rules))if(supportedScopes(p.split('.')[0]).includes('ALL'))rules[p]='ALL';await root.query('INSERT INTO "TenantUserAccess"("tenantId","userId",rules,"updatedAt") VALUES($1,$2,$3,now()) ON CONFLICT("tenantId","userId") DO UPDATE SET rules=excluded.rules',[tenant,user,rules]);await root.query('INSERT INTO "TenantRoleAssignment"("tenantId","userId","roleId","updatedAt") VALUES($1,$2,$3,now()) ON CONFLICT DO NOTHING',[tenant,user,permissions===allPermissions?role:role+'_read'])}
async function placed(){const staff=await fresh();await post(staff,assign(a,0));return staff}
async function state(staff){return(await root.query('SELECT (SELECT count(*)::int FROM "StaffWorkplaceAssignment" WHERE "staffProfileId"=$1) placements,(SELECT version FROM "StaffWorkplacePolicy" WHERE "staffProfileId"=$1) version,(SELECT count(*)::int FROM "AuditLog" WHERE "tenantId"=$2 AND metadata->>\'staffProfileId\'=$1) audits',[staff,tenant])).rows[0]}
before(async()=>{
 await root.connect();for(const t of [tenant,foreign])await root.query('INSERT INTO "Tenant"(id,name,slug,"updatedAt") VALUES($1,$1,$1,now())',[t])
 const initial=(await root.query('SELECT id FROM "BusinessOffice" WHERE "tenantId"=$1 AND "isInitial"',[tenant])).rows[0].id;a=tenant+'_east';b=tenant+'_west';c=(await root.query('SELECT id FROM "BusinessOffice" WHERE "tenantId"=$1 AND "isInitial"',[foreign])).rows[0].id
 await root.query('INSERT INTO "BusinessOffice"(id,"tenantId","companyId",code,name,"updatedAt") SELECT $1,$2,"companyId",\'EAST\',\'East workplace\',now() FROM "BusinessOffice" WHERE id=$3',[a,tenant,initial])
 await root.query('INSERT INTO "BusinessOffice"(id,"tenantId","companyId",code,name,"updatedAt") SELECT $1,$2,"companyId",\'WEST\',\'West workplace\',now() FROM "BusinessOffice" WHERE id=$3',[b,tenant,a])
 for(const [id,label]of[[admin,'ADMIN'],[manager,'MANAGER'],[both,'MANAGER'],[reader,'MANAGER'],[unprofiled,'MANAGER']])await root.query('INSERT INTO "User"(id,"tenantId",email,role,"updatedAt") VALUES($1,$2,$3,$4,now())',[id,tenant,id+'@example.test',label])
 for(const [id,permissions]of[[role,allPermissions],[role+'_read',['shiftRoster.read']]])await root.query('INSERT INTO "TenantAccessRole"(id,"tenantId",name,"nameKey",permissions,"updatedAt") VALUES($1,$2,$1,$1,$3,now())',[id,tenant,permissions])
 for(const user of [manager,both])await grant(user);await grant(reader,['shiftRoster.read'])
 await member(manager,[a]);await member(both,[a,b]);await member(reader,[a,b]);await member(unprofiled,[a,b])
 for(const key of ['shifts','appointments'])await root.query('INSERT INTO "TenantModule"("tenantId",key,allowed,enabled,"updatedAt") VALUES($1,$2,true,true,now())',[tenant,key])
 await root.query('INSERT INTO "AppSetting"(id,"tenantId","timeZone","updatedAt") VALUES($1,$1,\'UTC\',now())',[tenant]);today=(await root.query("SELECT current_date::text today")).rows[0].today
})
after(async()=>{await root.end();await Promise.all([global.prisma,global.prismaBypassClient,...[...(global.prismaScopedClientCache?.values()||[])].map(entry=>entry.client)].filter(Boolean).map(client=>client.$disconnect()));await global.prismaPool?.end()})

test('new profiles have no implicit placement, grants, creation context or policy',async()=>{
 assert.equal((await root.query("SELECT count(*)::int n FROM pg_trigger WHERE tgname IN ('test_user_office_fixture','aaa_test_record_office_fixture')")).rows[0].n,0)
 const staff=await fresh(),result=await view(staff);assert.equal(result.version,0);assert.equal(result.total,0);assert.equal(result.current,null);assert.equal(result.latest,null)
 assert.deepEqual(await state(staff),{placements:0,version:null,audits:0});assert.equal((await root.query('SELECT "creationOfficeId" FROM "BusinessOfficePolicy" WHERE "userId"=$1',[staff])).rows[0].creationOfficeId,null)
})
test('explicit placement captures date, office and atomic audit without changing access',async()=>{
 const staff=await fresh(),before=(await root.query('SELECT * FROM "BusinessOfficeGrant" WHERE "userId"=$1 ORDER BY "officeId"',[staff])).rows
 await post(staff,assign(a,0));const result=await view(staff);assert.equal(result.version,1);assert.equal(result.current.officeId,a);assert.equal(result.current.startDate,today);assert.equal(result.total,1)
 assert.deepEqual(await state(staff),{placements:1,version:1,audits:1});assert.deepEqual((await root.query('SELECT * FROM "BusinessOfficeGrant" WHERE "userId"=$1 ORDER BY "officeId"',[staff])).rows,before)
 const audit=(await root.query('SELECT before,after FROM "AuditLog" WHERE metadata->>\'staffProfileId\'=$1',[staff])).rows[0];assert.equal(audit.before.version,0);assert.equal(audit.after.version,1)
})
test('foreign, closed, ineligible and forged inputs leave no policy or audit behind',async()=>{
 const staff=await fresh();await post(staff,assign(c,0),admin,403);await post(staff,assign(b,0),manager,403)
 await root.query('DELETE FROM "BusinessOfficeGrant" WHERE "userId"=$1 AND "officeId"=$2',[staff,b]);await post(staff,assign(b,0),admin,403)
 await post(staff,{...assign(a,0),officeIds:[a,b]},admin,400);await post(staff,assign(a,0,undefined,'2020-01-01'),admin,400)
 await root.query('UPDATE "BusinessOffice" SET archived=true WHERE id=$1',[a]);try{await post(staff,assign(a,0),admin,403)}finally{await root.query('UPDATE "BusinessOffice" SET archived=false WHERE id=$1',[a])}
 assert.deepEqual(await state(staff),{placements:0,version:null,audits:0})
})
test('dated transfer closes old window, preserves old office and rejects stale or hidden sources',async()=>{
 const staff=await placed(),old=await view(staff)
 await post(staff,assign(b,old.version,old.latest.id,'2036-01-07'),both)
 const result=await view(staff);assert.equal(result.version,2);assert.equal(result.current.officeId,a);assert.equal(result.latest.officeId,b);assert.equal(result.items.find(x=>x.officeId===a).endDate,'2036-01-06')
 await post(staff,assign(a,1,old.latest.id,'2037-01-01'),admin,409)
 await post(staff,assign(a,2,undefined,'2037-01-01'),manager,409)
 await post(staff,assign(a,2,result.latest.id,'2037-01-01'),manager,403)
 const limited=await view(staff,manager);assert.equal(limited.total,1);assert.equal(limited.latest,null);assert.equal(limited.canAssign,false);assert.equal(JSON.stringify(limited).includes(b),false)
 assert.equal(await scoped(manager,()=>prisma.auditLog.count({where:{tenantId:tenant,entityType:'StaffWorkplaceAssignment',entityId:result.latest.id}})),0)
 assert.equal(await scoped(both,()=>prisma.auditLog.count({where:{tenantId:tenant,entityType:'StaffWorkplaceAssignment',entityId:result.latest.id}})),1)
})
test('personal history survives revoked office grants, without allowing a self transfer',async()=>{
 const staff=await placed();await root.query('DELETE FROM "BusinessOfficeGrant" WHERE "userId"=$1',[staff])
 const own=await view(staff,staff);assert.equal(own.total,1);assert.equal(own.current.officeId,a)
 await post(staff,assign(b,1,own.latest.id,'2036-02-01'),staff,403)
})
test('future cancellation requires edit plus archive and restores predecessor atomically',async()=>{
 const staff=await placed(),old=await view(staff);await post(staff,assign(b,1,old.latest.id,'2036-01-07'))
 const next=await view(staff);await post(staff,{action:'cancel',version:2,assignmentId:next.latest.id},reader,403)
 await post(staff,{action:'cancel',version:2,assignmentId:next.latest.id},both)
 const result=await view(staff);assert.equal(result.version,3);assert.equal(result.latest.id,old.latest.id);assert.equal(result.latest.endDate,null);assert(result.items.find(x=>x.officeId===b).canceledAt)
 await post(staff,{action:'cancel',version:3,assignmentId:old.latest.id},admin,400)
 assert.deepEqual(await state(staff),{placements:2,version:3,audits:3})
})
test('cannot restore a closed or newly ineligible predecessor; first future assignment can be canceled',async()=>{
 const staff=await placed(),old=await view(staff);await post(staff,assign(b,1,old.latest.id,'2036-01-07'));const next=await view(staff)
 await root.query('UPDATE "BusinessOffice" SET archived=true WHERE id=$1',[a]);try{await post(staff,{action:'cancel',version:2,assignmentId:next.latest.id},admin,403)}finally{await root.query('UPDATE "BusinessOffice" SET archived=false WHERE id=$1',[a])}
 assert.equal((await view(staff)).version,2)
 const unplaced=await fresh();await post(unplaced,assign(a,0,undefined,'2036-01-07'));const first=await view(unplaced);await post(unplaced,{action:'cancel',version:1,assignmentId:first.latest.id});assert.equal((await view(unplaced)).latest,null)
})
test('manager labels and office grants cannot replace profile actions, Read bounds or active modules',async()=>{
 const staff=await placed();await body(await call(unprofiled,'GET',undefined,`?staffId=${staff}`),403);await post(staff,assign(b,1,(await view(staff)).latest.id,'2036-01-07'),reader,403)
 await root.query('UPDATE "TenantUserAccess" SET rules=jsonb_set(rules,\'{shiftRoster.read}\',\'"NONE"\') WHERE "userId"=$1',[both]);try{await body(await call(both,'GET',undefined,`?staffId=${staff}`),403)}finally{await grant(both)}
 await root.query('UPDATE "TenantModule" SET enabled=false WHERE "tenantId"=$1 AND key=\'shifts\'',[tenant]);try{await body(await call(admin,'GET',undefined,`?staffId=${staff}`),403);assert.equal(await scoped(admin,()=>prisma.staffWorkplaceAssignment.count()),0)}finally{await root.query('UPDATE "TenantModule" SET enabled=true WHERE "tenantId"=$1 AND key=\'shifts\'',[tenant])}
})
test('native storage rejects direct writes, contextless reads and target forgery',async()=>{
 const staff=await placed(),current=await view(staff)
 assert.equal(await prisma.staffWorkplaceAssignment.count(),0);assert.equal(await scoped(both,()=>prisma.staffWorkplacePolicy.count()),0)
 await assert.rejects(scoped(both,()=>prisma.staffWorkplaceAssignment.updateMany({where:{staffProfileId:staff},data:{officeId:b}})))
 await assert.rejects(scoped(both,()=>prisma.staffWorkplaceAssignment.deleteMany({where:{staffProfileId:staff}})))
 await assert.rejects(scoped(both,()=>prisma.$queryRaw`SELECT app.change_staff_workplace(${foreign},${staff},1,NULL,NULL,NULL,NULL,NULL)`))
 await body(await call(admin,'GET',undefined,'?staffId=missing'),404);await body(await call(admin,'GET',undefined,`?staffId=${staff}&pageSize=101`),400)
 assert.equal((await view(staff)).latest.id,current.latest.id)
})
test('eligible office search is paged, target bound and independent of creation preference',async()=>{
 const staff=await placed();const list=await body(await call(manager,'GET',undefined,`?staffId=${staff}&pageSize=1`,choices));assert.equal(list.total,1);assert.equal(list.items[0].id,a)
 const west=await body(await call(both,'GET',undefined,`?staffId=${staff}&q=West`,choices));assert.equal(west.total,1);assert.equal(west.items[0].id,b)
 await body(await call(reader,'GET',undefined,`?staffId=${staff}`,choices),403)
 await assert.rejects(scoped(both,()=>prisma.$queryRaw`SELECT app.staff_workplace_offices(${tenant},${staff},'',NULL,NULL)`))
})
test('same-office and backwards changes cannot rewrite established history',async()=>{
 const staff=await placed(),v=await view(staff);await post(staff,assign(a,1,v.latest.id,'2036-01-07'),admin,409);await post(staff,assign(b,1,v.latest.id,today),admin,400)
 assert.deepEqual(await state(staff),{placements:1,version:1,audits:1})
})
test('all current/future shift sources block transfer while ended work does not',async()=>{
 const staff=await placed(),v=await view(staff),template=staff+'_template',schedule=staff+'_schedule'
 await root.query('INSERT INTO "ShiftTemplate"(id,"tenantId",name,"startTime","endTime","updatedAt") VALUES($1,$2,\'Private shift\',\'09:00\',\'17:00\',now())',[template,tenant])
 await root.query('INSERT INTO "ShiftSchedule"(id,"tenantId","officeId",name,"startDate","weekOffDay1","weekOff2Weeks","updatedAt") VALUES($1,$2,(SELECT id FROM \"BusinessOffice\" WHERE \"tenantId\"=$2 AND \"isInitial\"),\'Private schedule\',\'2036-01-01\',\'SUNDAY\',ARRAY[]::integer[],now())',[schedule,tenant])
 const sources=[
  ['StaffScheduleAssignment','INSERT INTO "StaffScheduleAssignment"(id,"staffProfileId","scheduleId","startDate","updatedAt") VALUES($1,$1,$2,\'2036-01-01\',now())',[staff,schedule]],
  ['StaffShiftOverride','INSERT INTO "StaffShiftOverride"(id,"staffProfileId",date,"templateId","updatedAt") VALUES($1,$1,\'2036-01-07\',$2,now())',[staff,template]],
  ['StaffFlexibleAvailability','INSERT INTO "StaffFlexibleAvailability"(id,"staffProfileId",date,"startTime","endTime","updatedAt") VALUES($1,$1,\'2036-01-07\',\'09:00\',\'17:00\',now())',[staff]],
  ['StaffFlexibleWeekPlan','INSERT INTO "StaffFlexibleWeekPlan"(id,"staffProfileId","weekStartDate","updatedAt") VALUES($1,$1,\'2036-01-07\',now())',[staff]],
  ['StaffFlexiblePattern','INSERT INTO "StaffFlexiblePattern"(id,"staffProfileId",name,"cycleLengthWeeks","validFrom","isActive","updatedAt") VALUES($1,$1,\'Private pattern\',1,\'2036-01-01\',true,now())',[staff]],
 ]
 for(const [table,sql,args]of sources){await root.query(sql,args);await post(staff,assign(b,1,v.latest.id,'2036-01-07'),admin,409);assert.deepEqual(await state(staff),{placements:1,version:1,audits:1});await root.query(`DELETE FROM "${table}" WHERE "staffProfileId"=$1`,[staff])}
 await root.query('INSERT INTO "StaffShiftOverride"(id,"staffProfileId",date,"templateId","updatedAt") VALUES($1,$1,\'2020-01-01\',$2,now())',[staff,template]);await post(staff,assign(b,1,v.latest.id,'2036-01-07'))
})
test('private future and overdue in-progress appointments block without leaking booking details',async()=>{
 const staff=await placed(),v=await view(staff),customer=staff+'_customer',service=staff+'_service'
 await root.query('INSERT INTO "User"(id,"tenantId",email,role,"updatedAt") VALUES($1,$2,$3,\'CUSTOMER\',now())',[customer,tenant,customer+'@example.test'])
 await root.query('INSERT INTO "ServiceCategory"(id,"tenantId",name,"updatedAt") VALUES($1,$2,\'Private category\',now())',[service,tenant])
 await root.query('INSERT INTO "Service"(id,"tenantId",name,"durationMinutes","priceCents","categoryId","updatedAt") VALUES($1,$2,\'Private service\',30,1000,$1,now())',[service,tenant])
 await root.query('UPDATE "TenantUserAccess" SET rules=jsonb_set(rules,\'{appointments.read}\',\'"NONE"\') WHERE "userId"=$1',[both])
 const booking=async(status,start,end)=>root.query('INSERT INTO "Appointment"(id,"tenantId","staffProfileId","customerId","serviceId","startAt","endAt",status,"updatedAt") VALUES($1,$2,$1,$3,$4,$5,$6,$7,now())',[staff,tenant,customer,service,start,end,status])
 try{
  for(const [status,start,end]of[['SCHEDULED','2036-01-07T10:00:00Z','2036-01-07T11:00:00Z'],['IN_PROGRESS','2020-01-01T10:00:00Z','2020-01-01T11:00:00Z']]){
   await booking(status,start,end);await body(await call(both,'GET',undefined,'',require('../app/api/appointments/route.ts')),403)
   const error=await post(staff,assign(b,1,v.latest.id,'2036-01-07'),both,409);assert.equal(error.error,'Resolve active or future work before changing workplace.');assert(!JSON.stringify(error).includes(customer));await root.query('DELETE FROM "Appointment" WHERE id=$1',[staff])
  }
  await booking('COMPLETED','2020-01-01T10:00:00Z','2020-01-01T11:00:00Z');await post(staff,assign(b,1,v.latest.id,'2036-01-07'),both)
 }finally{await grant(both)}
})
test('competing transfers serialize and only one captured version succeeds',async()=>{
 const staff=await placed(),v=await view(staff)
 const responses=await Promise.all(['2036-01-07','2036-01-08'].map(date=>call(admin,'POST',{staffId:staff,...assign(b,1,v.latest.id,date)})))
 assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);for(const r of responses)await r.json();assert.deepEqual(await state(staff),{placements:2,version:2,audits:2})
})
test('permissions are refreshed after waiting for the shared scheduling lock',async()=>{
 const staff=await placed(),v=await view(staff);await root.query('BEGIN');await root.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['workforce-schedules:'+tenant])
 const pending=call(both,'POST',{staffId:staff,...assign(b,1,v.latest.id,'2036-01-07')})
 try{let waiting=false;for(let i=0;i<80;i++){waiting=(await root.query("SELECT EXISTS(SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE l.locktype='advisory' AND NOT l.granted AND a.usename='crm_test_runtime') waiting")).rows[0].waiting;if(waiting)break;await new Promise(resolve=>setTimeout(resolve,25))}assert(waiting,'Workplace writer must actually wait for the scheduling lock');await root.query('UPDATE "TenantUserAccess" SET rules=jsonb_set(rules,\'{shiftRoster.edit}\',\'"NONE"\') WHERE "userId"=$1',[both]);await root.query('COMMIT');await body(await pending,403);assert.deepEqual(await state(staff),{placements:1,version:1,audits:1})}finally{await root.query('ROLLBACK');await grant(both)}
})
test('audit failure rolls back both windows, placement version and assignment',async()=>{
 const staff=await placed(),v=await view(staff)
 await root.query(`CREATE FUNCTION app.test_fail_workplace_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='workforce.workplace.transferred' THEN RAISE EXCEPTION 'Synthetic audit unavailable';END IF;RETURN NEW;END $$;CREATE TRIGGER test_fail_workplace_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION app.test_fail_workplace_audit()`)
 try{await post(staff,assign(b,1,v.latest.id,'2036-01-07'),admin,500);assert.deepEqual(await state(staff),{placements:1,version:1,audits:1});assert.equal((await view(staff)).latest.endDate,null)}finally{await root.query('DROP TRIGGER test_fail_workplace_audit ON "AuditLog";DROP FUNCTION app.test_fail_workplace_audit()')}
})
test('canceling future placement needs archive even when edit is allowed and cannot bypass newer work',async()=>{
 const staff=await placed(),v=await view(staff);await post(staff,assign(b,1,v.latest.id,'2036-01-07'));const next=await view(staff)
 await root.query('UPDATE "TenantUserAccess" SET rules=jsonb_set(rules,\'{shiftRoster.archive}\',\'"NONE"\') WHERE "userId"=$1',[both])
 try{await post(staff,{action:'cancel',version:2,assignmentId:next.latest.id},both,403)}finally{await grant(both)}
 await root.query('INSERT INTO "StaffFlexibleWeekPlan"(id,"staffProfileId","weekStartDate","updatedAt") VALUES($1,$1,\'2036-01-07\',now())',[staff])
 await post(staff,{action:'cancel',version:2,assignmentId:next.latest.id},admin,409);assert.equal((await view(staff)).version,2)
})
test('historical source access permits moving out of a closed office, without changing history',async()=>{
 const staff=await placed(),v=await view(staff);await root.query('UPDATE "BusinessOffice" SET archived=true WHERE id=$1',[a])
 try{await post(staff,assign(b,1,v.latest.id,'2036-01-07'),both);const next=await view(staff);assert.equal(next.current.officeId,a);assert.equal(next.latest.officeId,b);assert.equal(next.items.find(x=>x.id===v.latest.id).startDate,v.latest.startDate)}finally{await root.query('UPDATE "BusinessOffice" SET archived=false WHERE id=$1',[a])}
})
test('booking boundary uses tenant midnight rather than UTC calendar dates',async()=>{
 const staff=await placed(),v=await view(staff),customer=staff+'_customer',service=staff+'_service'
 await root.query('INSERT INTO "User"(id,"tenantId",email,role,"updatedAt") VALUES($1,$2,$3,\'CUSTOMER\',now())',[customer,tenant,customer+'@example.test'])
 await root.query('INSERT INTO "ServiceCategory"(id,"tenantId",name,"updatedAt") VALUES($1,$2,$1,now())',[service,tenant])
 await root.query('INSERT INTO "Service"(id,"tenantId",name,"durationMinutes","priceCents","categoryId","updatedAt") VALUES($1,$2,\'Timezone service\',30,1000,$1,now())',[service,tenant])
 await root.query('UPDATE "AppSetting" SET "timeZone"=\'America/New_York\' WHERE "tenantId"=$1',[tenant])
 try{
  await root.query('INSERT INTO "Appointment"(id,"tenantId","staffProfileId","customerId","serviceId","startAt","endAt",status,"updatedAt") VALUES($1,$2,$1,$3,$4,\'2036-01-07T03:00:00\',\'2036-01-07T06:00:00\',\'CONFIRMED\',now())',[staff,tenant,customer,service])
  await post(staff,assign(b,1,v.latest.id,'2036-01-07'),admin,409)
  await root.query('UPDATE "Appointment" SET "endAt"=\'2036-01-07T05:00:00\' WHERE id=$1',[staff])
  await post(staff,assign(b,1,v.latest.id,'2036-01-07'));assert.equal((await view(staff)).latest.startDate,'2036-01-07')
 }finally{await root.query('UPDATE "AppSetting" SET "timeZone"=\'UTC\' WHERE "tenantId"=$1',[tenant])}
})
