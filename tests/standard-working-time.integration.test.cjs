/* eslint-disable @typescript-eslint/no-require-imports */
process.env.TZ='UTC'
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Client}=require('pg'),{AsyncLocalStorage}=require('node:async_hooks')
const raw=process.env.CRM_TEST_DATABASE_URL,url=new URL(raw||'http://invalid');if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!='/ls_salon_crm_test')throw Error('Disposable local database only.')
const root=new Client({connectionString:raw}),sessions=new AsyncLocalStorage();url.username='crm_test_runtime';url.password='';process.env.DATABASE_URL=url.toString()
const authPath=require.resolve('../auth.ts');require.cache[authPath]={id:authPath,filename:authPath,loaded:true,exports:{auth:async()=>{await Promise.resolve();return sessions.getStore()||null}}}
require('../lib/logger.ts').logger.info=()=>{};require('../lib/logger.ts').logger.error=()=>{}
const {prisma,runWithTenantDbContext}=require('../lib/prisma.ts'),{runWithDatabaseActor}=require('../lib/database-actor.ts'),{defaultRecordRules,supportedScopes}=require('../platform/access/rules.ts')
const {loadWorkingTime}=require('../modules/workforce/working-time.ts'),{buildStandardScheduleMap}=require('../modules/workforce/standard-schedule.ts')
const availability=require('../app/api/appointments/availability/route.ts'),book=require('../app/api/appointments/route.ts'),templateRoute=require('../app/api/shifts/templates/[id]/route.ts')
const tenant='standard_time_'+randomUUID().replaceAll('-',''),foreign=tenant+'_foreign',admin=tenant+'_admin',scheduler=tenant+'_scheduler',plain=tenant+'_plain',employee=tenant+'_employee',profile=tenant+'_profile',foreignProfile=tenant+'_foreign_profile',role=tenant+'_role',customer=tenant+'_customer',service=tenant+'_service',visibleTemplate=tenant+'_visible_template',privateTemplate='standard_hidden_template_'+tenant,earlyTemplate=tenant+'_early',defaultSchedule=tenant+'_default',assigned='standard_hidden_schedule_'+tenant,assignment='standard_hidden_assignment_'+tenant
const scope=(user,fn)=>runWithTenantDbContext(tenant,()=>runWithDatabaseActor(user,async()=>await fn()))
const query=(user,ids=[profile],start='2036-02-04',end=start)=>scope(user,()=>prisma.$queryRaw`SELECT * FROM app.standard_working_time(${tenant},${ids}::text[],${start}::date,${end}::date)`)
const load=(user,start,end,ids=[profile],db=prisma)=>scope(user,()=>loadWorkingTime(db,tenant,ids,new Date(start),new Date(end||start)))
async function call(handler,user=scheduler,data,record,method='POST'){return sessions.run({user:{id:user,tenantId:tenant,role:user===admin?'ADMIN':user===plain?'MANAGER':'STAFF'}},()=>handler(new Request(`http://${tenant}.localhost/api/appointments`,{method,headers:{host:tenant+'.localhost','content-type':'application/json','x-office-id':'office_'+tenant,'x-office-version':'1'},body:JSON.stringify(data)}),{params:Promise.resolve({id:record})}))}
async function body(response,status=200){const value=await response.json();assert.equal(response.status,status,JSON.stringify(value));return value}
const input=hour=>({staffId:employee,customerId:customer,serviceId:service,startAt:`2036-02-04T${hour}:00:00Z`})
const matrix={id:assigned,startDate:new Date('2035-01-01'),weekOffDay1:'SUNDAY',weekOffDay2:'SATURDAY',weekOff2Weeks:[2,4],blocks:[{id:assigned+'_1',templateId:visibleTemplate,repeatDays:2,sortOrder:0},{id:assigned+'_2',templateId:privateTemplate,repeatDays:1,sortOrder:1}]}
before(async()=>{
 await root.connect();for(const t of [tenant,foreign])await root.query('INSERT INTO "Tenant"(id,name,slug,"updatedAt") VALUES($1,$1,$1,now())',[t])
 for(const [user,label,t]of[[admin,'ADMIN',tenant],[scheduler,'STAFF',tenant],[plain,'MANAGER',tenant],[employee,'STAFF',tenant],[customer,'CUSTOMER',tenant],[foreign+'_employee','STAFF',foreign]])await root.query('INSERT INTO "User"(id,"tenantId",email,role,"updatedAt") VALUES($1,$2,$3,$4,now())',[user,t,user+'@example.test',label])
 for(const user of [admin,scheduler,employee]){await root.query('INSERT INTO "BusinessOfficePolicy"("tenantId","userId","creationOfficeId",version,"updatedAt") VALUES($1,$2,$3,1,now())',[tenant,user,'office_'+tenant]);await root.query('INSERT INTO "BusinessOfficeGrant"("tenantId","userId","officeId") VALUES($1,$2,$3)',[tenant,user,'office_'+tenant])}
 for(const [p,u]of[[profile,employee],[foreignProfile,foreign+'_employee']])await root.query('INSERT INTO "StaffProfile"(id,"userId","updatedAt") VALUES($1,$2,now())',[p,u])
 await root.query('INSERT INTO "StaffWorkplacePolicy"("tenantId","staffProfileId",version,"updatedAt") VALUES($1,$2,1,now())',[tenant,profile]);await root.query('INSERT INTO "StaffWorkplaceAssignment"(id,"tenantId","staffProfileId","officeId","updatedAt") SELECT $2,$1,$2,id,now() FROM "BusinessOffice" WHERE "tenantId"=$1 AND "isInitial"',[tenant,profile])
 for(const key of ['appointments','services','shifts'])await root.query('INSERT INTO "TenantModule"("tenantId",key,allowed,enabled,"updatedAt") VALUES($1,$2,true,true,now())',[tenant,key])
 const rules=defaultRecordRules();for(const p of Object.keys(rules))if(supportedScopes(p.split('.')[0]).includes('ALL'))rules[p]='ALL'
 await root.query('INSERT INTO "TenantAccessRole"(id,"tenantId",name,"nameKey",permissions,"updatedAt") VALUES($1,$2,$1,$1,$3,now())',[role,tenant,['appointments.read','appointments.create','services.read']])
 await root.query('INSERT INTO "TenantUserAccess"("tenantId","userId",rules,"updatedAt") VALUES($1,$2,$3,now())',[tenant,scheduler,rules]);await root.query('INSERT INTO "TenantRoleAssignment"("tenantId","userId","roleId","updatedAt") VALUES($1,$2,$3,now())',[tenant,scheduler,role])
 await root.query('INSERT INTO "AppSetting"(id,"tenantId","timeZone","updatedAt") VALUES($1,$1,\'UTC\',now())',[tenant])
 await root.query('INSERT INTO "ServiceCategory"(id,"tenantId",name,"updatedAt") VALUES($1,$2,$1,now())',[service,tenant]);await root.query('INSERT INTO "Service"(id,"tenantId","categoryId",name,"durationMinutes","priceCents","updatedAt") VALUES($1,$2,$1,\'Working-time service\',60,1000,now())',[service,tenant])
 for(const [id,name,start,end]of[[earlyTemplate,'Visible default','09:00','17:00'],[visibleTemplate,'Editable late shift','12:00','20:00'],[privateTemplate,'Private template label','08:00','16:00']])await root.query('INSERT INTO "ShiftTemplate"(id,"tenantId",name,"startTime","endTime","updatedAt") VALUES($1,$2,$3,$4,$5,now())',[id,tenant,name,start,end])
 await root.query('INSERT INTO "ShiftTemplateBreak"(id,"templateId","startTime","endTime") VALUES($1,$2,\'15:00\',\'15:30\')',['standard_hidden_pause_'+tenant,visibleTemplate])
 await root.query('INSERT INTO "ShiftSchedule"(id,"tenantId","officeId",name,"isDefault","startDate","weekOffDay1","weekOff2Weeks","updatedAt") VALUES($1,$2,(SELECT id FROM \"BusinessOffice\" WHERE \"tenantId\"=$2 AND \"isInitial\"),\'Visible default\',true,\'2035-01-01\',\'SUNDAY\',ARRAY[]::integer[],now())',[defaultSchedule,tenant])
 await root.query('INSERT INTO "ShiftScheduleBlock"(id,"scheduleId","templateId","repeatDays") VALUES($1,$2,$3,1)',[defaultSchedule+'_block',defaultSchedule,earlyTemplate])
 await root.query('INSERT INTO "ShiftSchedule"(id,"tenantId","officeId",name,"startDate","weekOffDay1","weekOffDay2","weekOff2Weeks","updatedAt") VALUES($1,$2,(SELECT id FROM \"BusinessOffice\" WHERE \"tenantId\"=$2 AND \"isInitial\"),\'Private assignment label\',\'2035-01-01\',\'SUNDAY\',\'SATURDAY\',ARRAY[2,4],now())',[assigned,tenant])
 for(const b of matrix.blocks)await root.query('INSERT INTO "ShiftScheduleBlock"(id,"scheduleId","templateId","repeatDays","sortOrder") VALUES($1,$2,$3,$4,$5)',[b.id,assigned,b.templateId,b.repeatDays,b.sortOrder])
 await root.query('INSERT INTO "StaffScheduleAssignment"(id,"staffProfileId","scheduleId","startDate","endDate","updatedAt") VALUES($1,$2,$3,\'2035-01-01\',\'2036-12-31\',now())',[assignment,profile,assigned])
 for(const table of ['ShiftSchedule','ShiftScheduleBlock','StaffScheduleAssignment','ShiftTemplate','ShiftTemplateBreak'])await root.query(`CREATE POLICY test_private_standard_source ON "${table}" AS RESTRICTIVE FOR SELECT USING(id NOT LIKE 'standard_hidden_%')`)
})
after(async()=>{for(const table of ['ShiftSchedule','ShiftScheduleBlock','StaffScheduleAssignment','ShiftTemplate','ShiftTemplateBreak'])await root.query(`DROP POLICY IF EXISTS test_private_standard_source ON "${table}"`);await root.end();await Promise.all([global.prisma,global.prismaBypassClient,...[...(global.prismaScopedClientCache?.values()||[])].map(entry=>entry.client)].filter(Boolean).map(client=>client.$disconnect()));await global.prismaPool?.end()})

test('projection matches anchored rotation, alternate month week-offs, leap days, breaks and default gaps',async()=>{
 const start=new Date('2035-01-01'),end=new Date('2037-01-04'),map=buildStandardScheduleMap(matrix,start,end),resolve=await load(scheduler,'2035-01-01','2037-01-04')
 for(let day=new Date(start);day<=end;day.setUTCDate(day.getUTCDate()+1)){
  const key=day.toISOString().slice(0,10),id=key>'2036-12-31'?(day.getUTCDay()===0?null:earlyTemplate):map.get(key)
  const expected=!id?[]:id===earlyTemplate?[{start:540,end:1020}]:id===privateTemplate?[{start:480,end:960}]:[{start:720,end:900},{start:930,end:1200}]
  assert.deepEqual(resolve(profile,day).segments,expected,key)
 }
 assert.equal(await scope(scheduler,()=>prisma.shiftSchedule.count({where:{id:assigned}})),0)
 assert.equal(await scope(scheduler,()=>prisma.staffScheduleAssignment.count({where:{id:assignment}})),0)
})
test('no schedule, assignment, template or break identity or label escapes the projection',async()=>{
 const rows=await query(scheduler);assert(rows.length>0)
 for(const row of rows)assert.deepEqual(Object.keys(row).sort(),['breaks','date','endTime','staffProfileId','startTime'])
 const encoded=JSON.stringify(rows);for(const secret of [assigned,assignment,visibleTemplate,privateTemplate,'Private assignment label','Private template label','standard_hidden_pause_'])assert(!encoded.includes(secret))
})
test('hidden assignments are not replaced with visible defaults in appointment checks',async()=>{
 // Pick a late-rotation day deterministically; the fixed date is also used by
 // the browser flow. The explicit assignment starts before the requested day.
 const expected=buildStandardScheduleMap(matrix,new Date('2036-02-04'),new Date('2036-02-04')).get('2036-02-04');assert.equal(expected,visibleTemplate)
 const outside=await body(await call(availability.POST,scheduler,input('10')));assert.equal(outside.available,false)
 assert.match(outside.reason,/outside staff working hours/)
 const pause=await body(await call(availability.POST,scheduler,input('15')));assert.equal(pause.available,false)
 const inside=await body(await call(availability.POST,scheduler,input('18')));assert.deepEqual(inside,{available:true})
 await body(await call(book.POST,scheduler,input('10')),409)
})
test('source module deactivation preserves hours while an active booking consumer needs them',async()=>{
 await root.query('UPDATE "TenantModule" SET enabled=false WHERE "tenantId"=$1 AND key=\'shifts\'',[tenant])
 try{const rows=await query(scheduler);assert(rows.length>0);assert.deepEqual(await body(await call(availability.POST,scheduler,input('18'))),{available:true})}finally{await root.query('UPDATE "TenantModule" SET enabled=true WHERE "tenantId"=$1 AND key=\'shifts\'',[tenant])}
})
test('active tenant, current profile Read and a legitimate enabled consumer are mandatory',async()=>{
 await assert.rejects(query(plain));await assert.rejects(runWithTenantDbContext(tenant,()=>prisma.$queryRaw`SELECT * FROM app.standard_working_time(${tenant},${[profile]}::text[],'2036-02-04','2036-02-04')`))
 await root.query('UPDATE "TenantAccessRole" SET archived=true WHERE id=$1',[role]);try{await assert.rejects(query(scheduler))}finally{await root.query('UPDATE "TenantAccessRole" SET archived=false WHERE id=$1',[role])}
 await root.query('UPDATE "User" SET status=\'SUSPENDED\' WHERE id=$1',[scheduler]);try{await assert.rejects(query(scheduler))}finally{await root.query('UPDATE "User" SET status=\'ACTIVE\' WHERE id=$1',[scheduler])}
 await root.query('UPDATE "TenantModule" SET enabled=false WHERE "tenantId"=$1 AND key IN (\'shifts\',\'appointments\')',[tenant]);try{await assert.rejects(query(scheduler));await assert.rejects(query(admin))}finally{await root.query('UPDATE "TenantModule" SET enabled=true WHERE "tenantId"=$1 AND key IN (\'shifts\',\'appointments\')',[tenant])}
 await root.query('UPDATE "Tenant" SET status=\'SUSPENDED\' WHERE id=$1',[tenant]);try{await assert.rejects(query(admin))}finally{await root.query('UPDATE "Tenant" SET status=\'ACTIVE\' WHERE id=$1',[tenant])}
})
test('foreign profiles and oversized, impossible or reversed requests fail as a whole',async()=>{
 for(const args of [[[profile,foreignProfile],'2036-02-04','2036-02-04'],[Array(201).fill(profile),'2036-02-04','2036-02-04'],[[profile],'2036-02-05','2036-02-04'],[[profile],'2035-01-01','2036-02-04']])await assert.rejects(query(scheduler,...args))
 assert.deepEqual(await query(scheduler,[]),[])
 await assert.rejects(load(scheduler,'invalid'),/Invalid working-time selection/);await assert.rejects(query(scheduler,[profile],'2036-02-30','2036-02-30'))
 await assert.rejects(load(scheduler,'2036-02-04','2036-02-04',['']),/Invalid working-time selection/)
})
test('a missing or dormant Standard assignment never invents working hours',async()=>{
 await root.query('UPDATE "StaffProfile" SET "schedulingMode"=\'FLEXIBLE\' WHERE id=$1',[profile]);try{assert.deepEqual(await query(scheduler),[])}finally{await root.query('UPDATE "StaffProfile" SET "schedulingMode"=\'STANDARD\' WHERE id=$1',[profile])}
 await root.query('UPDATE "StaffScheduleAssignment" SET "endDate"=\'2036-02-03\' WHERE id=$1',[assignment]);try{const resolve=await load(scheduler,'2036-02-04');assert.deepEqual(resolve(profile,new Date('2036-02-04')).segments,[{start:540,end:1020}])}finally{await root.query('UPDATE "StaffScheduleAssignment" SET "endDate"=\'2036-12-31\' WHERE id=$1',[assignment])}
})
test('a hidden default still supplies hours after an explicit assignment ends',async()=>{
 await root.query('CREATE POLICY test_hidden_default ON "ShiftSchedule" AS RESTRICTIVE FOR SELECT USING(id<>\''+defaultSchedule+'\')')
 try{assert.equal(await scope(scheduler,()=>prisma.shiftSchedule.count({where:{id:defaultSchedule}})),0);const resolve=await load(scheduler,'2037-01-02');assert.deepEqual(resolve(profile,new Date('2037-01-02')).segments,[{start:540,end:1020}])}finally{await root.query('DROP POLICY test_hidden_default ON "ShiftSchedule"')}
})
test('an empty or not-yet-started explicit schedule does not fall back to the visible default',async()=>{
 await root.query('UPDATE "ShiftSchedule" SET "startDate"=\'2036-02-05\' WHERE id=$1',[assigned])
 try{assert.deepEqual(await query(scheduler),[])}finally{await root.query('UPDATE "ShiftSchedule" SET "startDate"=\'2035-01-01\' WHERE id=$1',[assigned])}
 await root.query('BEGIN');await root.query('DELETE FROM "ShiftScheduleBlock" WHERE "scheduleId"=$1',[assigned]);await root.query('COMMIT')
 try{assert.deepEqual(await query(scheduler),[])}finally{for(const b of matrix.blocks)await root.query('INSERT INTO "ShiftScheduleBlock"(id,"scheduleId","templateId","repeatDays","sortOrder") VALUES($1,$2,$3,$4,$5)',[b.id,assigned,b.templateId,b.repeatDays,b.sortOrder])}
})
test('private break timings use shared clipping and overlap rules without exposing break identities',async()=>{
 const pause='standard_hidden_overlap_'+tenant
 await root.query('INSERT INTO "ShiftTemplateBreak"(id,"templateId","startTime","endTime") VALUES($1,$2,\'14:30\',\'16:00\')',[pause,visibleTemplate])
 try{const resolve=await load(scheduler,'2036-02-04');assert.deepEqual(resolve(profile,new Date('2036-02-04')).segments,[{start:720,end:870},{start:960,end:1200}]);assert(!JSON.stringify(await query(scheduler)).includes(pause))}finally{await root.query('DELETE FROM "ShiftTemplateBreak" WHERE id=$1',[pause])}
})
test('existing bookings on hidden schedules prevent destructive template edits atomically',async()=>{
 await body(await call(book.POST,scheduler,input('18')),201)
 const before=(await root.query('SELECT * FROM "ShiftTemplate" WHERE id=$1',[visibleTemplate])).rows[0]
 const auditBefore=(await root.query('SELECT count(*)::int n FROM "AuditLog" WHERE "entityType"=\'shiftTemplates\' AND "entityId"=$1',[visibleTemplate])).rows[0].n
 const conflict=await body(await call(templateRoute.PATCH,admin,{name:'Editable late shift',startTime:'12:00',endTime:'17:00',breaks:[]},visibleTemplate,'PATCH'),409)
 assert.match(conflict.error,/conflicts with existing appointments/)
 assert.deepEqual((await root.query('SELECT * FROM "ShiftTemplate" WHERE id=$1',[visibleTemplate])).rows[0],before)
 assert.equal((await root.query('SELECT count(*)::int n FROM "AuditLog" WHERE "entityType"=\'shiftTemplates\' AND "entityId"=$1',[visibleTemplate])).rows[0].n,auditBefore)
})
test('batching covers every requested profile/day and rechecks authority on subsequent batches',async()=>{
 const ids=[];for(let i=0;i<201;i++)ids.push(tenant+'_batch_'+String(i).padStart(3,'0'))
 await root.query('INSERT INTO "User"(id,"tenantId",email,role,"updatedAt") SELECT x,$1,x||\'@example.test\',\'STAFF\',now() FROM unnest($2::text[]) x',[tenant,ids]);await root.query('INSERT INTO "StaffProfile"(id,"userId","updatedAt") SELECT x,x,now() FROM unnest($1::text[]) x',[ids])
 await root.query('INSERT INTO "StaffWorkplacePolicy"("tenantId","staffProfileId",version,"updatedAt") SELECT $1,x,1,now() FROM unnest($2::text[]) x',[tenant,ids])
 await root.query('INSERT INTO "StaffWorkplaceAssignment"(id,"tenantId","staffProfileId","officeId","updatedAt") SELECT x,$1,x,o.id,now() FROM unnest($2::text[]) x CROSS JOIN "BusinessOffice" o WHERE o."tenantId"=$1 AND o."isInitial"',[tenant,ids])
 let calls=0;const db={$queryRaw:(...args)=>{calls++;return prisma.$queryRaw(...args)}}
 const resolve=await load(scheduler,'2036-01-01','2037-01-01',ids,db);assert.equal(calls,4)
 for(const staff of [ids[0],ids[199],ids[200]])for(const date of ['2036-01-01','2037-01-01'])assert.deepEqual(resolve(staff,new Date(date)).segments,[{start:540,end:1020}])
 calls=0;const revoked={$queryRaw:async(...args)=>{const rows=await prisma.$queryRaw(...args);if(++calls===1)await root.query('UPDATE "TenantAccessRole" SET archived=true WHERE id=$1',[role]);return rows}}
 try{await assert.rejects(load(scheduler,'2036-01-01','2037-01-01',ids,revoked),/Working-time access is not permitted/);assert.equal(calls,1)}finally{await root.query('UPDATE "TenantAccessRole" SET archived=false WHERE id=$1',[role])}
})
