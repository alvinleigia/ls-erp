/* eslint-disable @typescript-eslint/no-require-imports */
process.env.TZ='UTC'
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Client}=require('pg'),{AsyncLocalStorage}=require('node:async_hooks')
const raw=process.env.CRM_TEST_DATABASE_URL,url=new URL(raw||'http://invalid');if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!='/ls_salon_crm_test')throw Error('Disposable local database only.')
const root=new Client({connectionString:raw}),sessions=new AsyncLocalStorage();url.username='crm_test_runtime';url.password='';process.env.DATABASE_URL=url.toString()
const authPath=require.resolve('../auth.ts');require.cache[authPath]={id:authPath,filename:authPath,loaded:true,exports:{auth:async()=>{await Promise.resolve();return sessions.getStore()||null}}}
require('../lib/logger.ts').logger.info=()=>{};require('../lib/logger.ts').logger.error=()=>{}
const {prisma,runWithTenantDbContext}=require('../lib/prisma.ts'),{runWithDatabaseActor}=require('../lib/database-actor.ts'),{defaultRecordRules,supportedScopes}=require('../platform/access/rules.ts')
const {loadWorkingTime}=require('../modules/workforce/working-time.ts'),{syncRosterHistoryRange}=require('../modules/workforce/roster-history.ts')
const preview=require('../app/api/appointments/availability/route.ts'),book=require('../app/api/appointments/route.ts'),templates=require('../app/api/shifts/templates/[id]/route.ts')
const t='effective_'+randomUUID().replaceAll('-',''),foreign=t+'_foreign',admin=t+'_admin',scheduler=t+'_scheduler',plain=t+'_plain',person=t+'_staff',standard=t+'_standard',profile=t+'_profile',ps=t+'_standard_profile',pf=t+'_foreign_profile',role=t+'_role',customer=t+'_customer',service=t+'_service',late=t+'_late',early=t+'_early'
const hidden='hidden_effective_'+t,week=hidden+'_week',pattern=hidden+'_pattern'
const tables=['StaffFlexibleWeekPlan','StaffFlexibleWeekDay','StaffFlexibleWeekSlot','StaffFlexibleWeekBreak','StaffFlexiblePattern','StaffFlexiblePatternWeek','StaffFlexiblePatternDay','StaffFlexiblePatternSlot','StaffFlexiblePatternBreak','StaffFlexibleAvailability','StaffShiftOverride','ShiftTemplate','ShiftTemplateBreak']
const scope=(u,fn)=>runWithTenantDbContext(t,()=>runWithDatabaseActor(u,async()=>await fn()))
const query=(u=scheduler,ids=[profile],first='2036-02-04',last=first)=>scope(u,()=>prisma.$queryRaw`SELECT * FROM app.effective_working_time(${t},${ids}::text[],${first}::date,${last}::date)`)
const load=(u=scheduler,first='2036-02-04',last=first,ids=[profile],db=prisma)=>scope(u,()=>loadWorkingTime(db,t,ids,new Date(first),new Date(last)))
async function call(endpoint,user=scheduler,method='POST',data,id){return sessions.run({user:{id:user,tenantId:t,role:user===admin?'ADMIN':user===plain?'MANAGER':'STAFF'}},()=>endpoint[method](new Request(`http://${t}.localhost/api/appointments`,{method,headers:{host:t+'.localhost','content-type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})}),{params:Promise.resolve({id})}))}
async function body(response,status=200){const data=await response.json();assert.equal(response.status,status,JSON.stringify(data));return data}
const input=(date,hour,staffId=person)=>({customerId:customer,serviceId:service,staffId,startAt:`${date}T${hour}:00:00Z`})
async function day(parent,key,slots=[],off=false,recurring=false){
 const id=parent+'_'+key,table=recurring?'StaffFlexiblePatternDay':'StaffFlexibleWeekDay',slotTable=recurring?'StaffFlexiblePatternSlot':'StaffFlexibleWeekSlot',breakTable=recurring?'StaffFlexiblePatternBreak':'StaffFlexibleWeekBreak'
 await root.query(`INSERT INTO "${table}"(id,"${recurring?'weekId':'planId'}",day,"isOff","updatedAt") VALUES($1,$2,$3,$4,now())`,[id,parent,key,off])
 for(const [i,slot]of slots.entries()){
  await root.query(`INSERT INTO "${slotTable}"(id,"dayId","startTime","endTime","sortOrder","updatedAt") VALUES($1,$2,$3,$4,$5,now())`,[id+'_'+i,id,slot[0],slot[1],i])
  for(const [j,pause]of (slot[2]||[]).entries())await root.query(`INSERT INTO "${breakTable}"(id,"slotId","startTime","endTime","sortOrder","updatedAt") VALUES($1,$2,$3,$4,$5,now())`,[id+'_'+i+'_'+j,id+'_'+i,pause[0],pause[1],j])
 }
}
before(async()=>{
 await root.connect();for(const tenant of [t,foreign])await root.query('INSERT INTO "Tenant"(id,name,slug,"updatedAt") VALUES($1,$1,$1,now())',[tenant])
 for(const [u,r,tenant]of[[admin,'ADMIN',t],[scheduler,'STAFF',t],[plain,'MANAGER',t],[person,'STAFF',t],[standard,'STAFF',t],[customer,'CUSTOMER',t],[foreign+'_staff','STAFF',foreign]])await root.query('INSERT INTO "User"(id,"tenantId",email,role,"updatedAt") VALUES($1,$2,$3,$4,now())',[u,tenant,u+'@example.test',r])
 for(const [p,u,mode]of[[profile,person,'FLEXIBLE'],[ps,standard,'STANDARD'],[pf,foreign+'_staff','FLEXIBLE']])await root.query('INSERT INTO "StaffProfile"(id,"userId","schedulingMode","updatedAt") VALUES($1,$2,$3,now())',[p,u,mode])
 for(const p of[profile,ps]){await root.query('INSERT INTO "StaffWorkplacePolicy"("tenantId","staffProfileId",version,"updatedAt") VALUES($1,$2,1,now())',[t,p]);await root.query('INSERT INTO "StaffWorkplaceAssignment"(id,"tenantId","staffProfileId","officeId","updatedAt") SELECT $2,$1,$2,id,now() FROM "BusinessOffice" WHERE "tenantId"=$1 AND "isInitial"',[t,p])}
 for(const key of ['shifts','appointments','services'])await root.query('INSERT INTO "TenantModule"("tenantId",key,allowed,enabled,"updatedAt") VALUES($1,$2,true,true,now())',[t,key])
 const rules=defaultRecordRules();for(const p of Object.keys(rules))if(supportedScopes(p.split('.')[0]).includes('ALL'))rules[p]='ALL'
 await root.query('INSERT INTO "TenantAccessRole"(id,"tenantId",name,"nameKey",permissions,"updatedAt") VALUES($1,$2,$1,$1,$3,now())',[role,t,['appointments.read','appointments.create','services.read']])
 await root.query('INSERT INTO "TenantUserAccess"("tenantId","userId",rules,"updatedAt") VALUES($1,$2,$3,now())',[t,scheduler,rules]);await root.query('INSERT INTO "TenantRoleAssignment"("tenantId","userId","roleId","updatedAt") VALUES($1,$2,$3,now())',[t,scheduler,role])
 await root.query('INSERT INTO "AppSetting"(id,"tenantId","timeZone","updatedAt") VALUES($1,$1,\'UTC\',now())',[t])
 await root.query('INSERT INTO "ServiceCategory"(id,"tenantId",name,"updatedAt") VALUES($1,$2,$1,now())',[service,t]);await root.query('INSERT INTO "Service"(id,"tenantId","categoryId",name,"durationMinutes","priceCents","updatedAt") VALUES($1,$2,$1,\'Effective hours consultation\',60,1000,now())',[service,t])
 for(const [id,start,end]of[[late,'12:00','20:00'],[early,'09:00','17:00']])await root.query('INSERT INTO "ShiftTemplate"(id,"tenantId",name,"startTime","endTime","updatedAt") VALUES($1,$2,$1,$3,$4,now())',[id,t,start,end])
 await root.query('INSERT INTO "ShiftTemplateBreak"(id,"templateId","startTime","endTime") VALUES($1,$2,\'15:00\',\'15:30\')',[hidden+'_template_break',late])
 await root.query('INSERT INTO "ShiftSchedule"(id,"tenantId","officeId","isDefault","startDate","weekOffDay1","weekOff2Weeks","updatedAt") SELECT $1,$2,id,true,\'2020-01-01\',\'SUNDAY\',ARRAY[]::integer[],now() FROM "BusinessOffice" WHERE "tenantId"=$2 AND "isInitial"',[t+'_default',t])
 await root.query('INSERT INTO "ShiftScheduleBlock"(id,"scheduleId","templateId","repeatDays") VALUES($1,$1,$2,1)',[t+'_default',early])
 await root.query('INSERT INTO "StaffFlexibleWeekPlan"(id,"tenantId","officeId","staffProfileId","weekStartDate","updatedAt") VALUES($1,(SELECT u."tenantId" FROM "StaffProfile" p JOIN "User" u ON u.id=p."userId" WHERE p.id=$2),(SELECT o.id FROM "StaffProfile" p JOIN "User" u ON u.id=p."userId" JOIN "BusinessOffice" o ON o."tenantId"=u."tenantId" AND o."isInitial" WHERE p.id=$2),$2,\'2036-02-04\',now())',[week,profile])
 await day(week,'MONDAY',[['14:00','22:00',[['18:00','19:00']]]]);await day(week,'TUESDAY',[],true);await day(week,'WEDNESDAY',[])
 await root.query('INSERT INTO "StaffFlexiblePattern"(id,"tenantId","officeId","staffProfileId",name,"cycleLengthWeeks","validFrom","updatedAt") VALUES($1,(SELECT u."tenantId" FROM "StaffProfile" p JOIN "User" u ON u.id=p."userId" WHERE p.id=$2),(SELECT o.id FROM "StaffProfile" p JOIN "User" u ON u.id=p."userId" JOIN "BusinessOffice" o ON o."tenantId"=u."tenantId" AND o."isInitial" WHERE p.id=$2),$2,\'Private recurring name\',2,\'2036-02-01\',now())',[pattern,profile])
 for(const i of [1,2])await root.query('INSERT INTO "StaffFlexiblePatternWeek"(id,"patternId","weekIndex","updatedAt") VALUES($1,$2,$3,now())',[pattern+'_'+i,pattern,i])
 await day(pattern+'_1','MONDAY',[['12:00','20:00',[['15:00','15:30']]]],false,true);await day(pattern+'_1','TUESDAY',[['12:00','20:00']],false,true);await day(pattern+'_1','WEDNESDAY',[['12:00','20:00',[['15:00','15:30']]]],false,true);await day(pattern+'_1','THURSDAY',[],true,true);await day(pattern+'_1','FRIDAY',[],false,true)
 await day(pattern+'_2','MONDAY',[['08:00','16:00',[['12:00','13:00']]]],false,true)
 for(const date of ['2036-02-04','2036-02-05','2036-02-06','2036-02-07','2036-02-08','2036-02-09','2020-01-06'])await root.query('INSERT INTO "StaffFlexibleAvailability"(id,"staffProfileId",date,"startTime","endTime","updatedAt") VALUES($1,$2,$3,\'09:00\',\'11:00\',now())',[hidden+'_daily_'+date,profile,date])
 await root.query('INSERT INTO "StaffShiftOverride"(id,"staffProfileId",date,"templateId","updatedAt") VALUES($1,$2,\'2036-02-04\',$3,now()),($4,$5,\'2036-02-04\',$3,now()),($6,$5,\'2036-02-05\',NULL,now())',[hidden+'_override_f',profile,late,hidden+'_override_s',ps,hidden+'_unavailable_s'])
 for(const table of tables)await root.query(`CREATE POLICY test_effective_sources ON "${table}" AS RESTRICTIVE FOR SELECT USING(id NOT LIKE 'hidden_effective_%')`)
})
after(async()=>{for(const table of tables)await root.query(`DROP POLICY IF EXISTS test_effective_sources ON "${table}"`);await root.end();await Promise.all([global.prisma,global.prismaBypassClient,...[...(global.prismaScopedClientCache?.values()||[])].map(e=>e.client)].filter(Boolean).map(c=>c.$disconnect()));await global.prismaPool?.end()})

test('hidden overrides take precedence for both modes without exposing source identities',async()=>{
 assert.equal(await scope(scheduler,()=>prisma.staffShiftOverride.count({where:{staffProfileId:{in:[profile,ps]}}})),0)
 const resolve=await load(scheduler,'2036-02-04','2036-02-05',[profile,ps])
 for(const p of [profile,ps])assert.deepEqual(resolve(p,new Date('2036-02-04')).segments,[{start:720,end:900},{start:930,end:1200}])
 assert.deepEqual(resolve(ps,new Date('2036-02-05')).segments,[])
 const rows=await query(scheduler,[profile,ps]);for(const row of rows)assert.deepEqual(Object.keys(row).sort(),['date','slots','staffProfileId'])
 for(const secret of [hidden,late,'Private recurring name','templateId','officeId','isOff'])assert.ok(!JSON.stringify(rows).includes(secret))
})
test('weekly off wins and empty weekly/recurring days retain the established fallback rules',async()=>{
 const resolve=await load(scheduler,'2036-02-04','2036-02-09')
 assert.deepEqual(resolve(profile,new Date('2036-02-05')).segments,[])
 assert.deepEqual(resolve(profile,new Date('2036-02-06')).segments,[{start:720,end:900},{start:930,end:1200}])
 assert.deepEqual(resolve(profile,new Date('2036-02-07')).segments,[])
 for(const date of ['2036-02-08','2036-02-09'])assert.deepEqual(resolve(profile,new Date(date)).segments,[{start:540,end:660}])
 await root.query('DELETE FROM "StaffShiftOverride" WHERE id=$1',[hidden+'_override_f'])
 try{assert.deepEqual((await load())(profile,new Date('2036-02-04')).segments,[{start:840,end:1080},{start:1140,end:1320}])}finally{await root.query('INSERT INTO "StaffShiftOverride"(id,"staffProfileId",date,"templateId","updatedAt") VALUES($1,$2,\'2036-02-04\',$3,now())',[hidden+'_override_f',profile,late])}
})
test('recurring cycles stay anchored to validFrom, including non-Monday anchors and range boundaries',async()=>{
 const resolve=await load(scheduler,'2036-02-11','2036-02-18')
 assert.deepEqual(resolve(profile,new Date('2036-02-11')).segments,[{start:480,end:720},{start:780,end:960}])
 assert.deepEqual(resolve(profile,new Date('2036-02-18')).segments,[{start:720,end:900},{start:930,end:1200}])
 assert.deepEqual(resolve(profile,new Date('2036-02-19')).segments,[])
})
test('latest eligible recurring pattern wins; empty days do not revive an older overlapping pattern',async()=>{
 const newer=hidden+'_newer';await root.query('INSERT INTO "StaffFlexiblePattern"(id,"tenantId","officeId","staffProfileId",name,"validFrom","updatedAt") VALUES($1,(SELECT u."tenantId" FROM "StaffProfile" p JOIN "User" u ON u.id=p."userId" WHERE p.id=$2),(SELECT o.id FROM "StaffProfile" p JOIN "User" u ON u.id=p."userId" JOIN "BusinessOffice" o ON o."tenantId"=u."tenantId" AND o."isInitial" WHERE p.id=$2),$2,\'Private newer\',\'2036-02-02\',now())',[newer,profile]);await root.query('INSERT INTO "StaffFlexiblePatternWeek"(id,"patternId","weekIndex","updatedAt") VALUES($1,$1,1,now())',[newer]);await day(newer,'MONDAY',[['10:00','18:00']],false,true)
 try{const resolve=await load(scheduler,'2036-02-11','2036-02-13');assert.deepEqual(resolve(profile,new Date('2036-02-11')).segments,[{start:600,end:1080}]);assert.deepEqual(resolve(profile,new Date('2036-02-13')).segments,[])}finally{await root.query('DELETE FROM "StaffFlexiblePattern" WHERE id=$1',[newer])}
})
test('private break overlaps use the common clipping and merging rules',async()=>{
 const id=hidden+'_overlap';await root.query('INSERT INTO "ShiftTemplateBreak"(id,"templateId","startTime","endTime") VALUES($1,$2,\'14:30\',\'16:00\')',[id,late])
 try{assert.deepEqual((await load())(profile,new Date('2036-02-04')).segments,[{start:720,end:870},{start:960,end:1200}])}finally{await root.query('DELETE FROM "ShiftTemplateBreak" WHERE id=$1',[id])}
})
test('source Read denial cannot erase effective timings for an authorized booking consumer',async()=>{
 await body(await call(require('../app/api/shifts/flexible-patterns/list/route.ts'),scheduler,'GET'),403)
 await body(await call(require('../app/api/shifts/overrides/route.ts'),scheduler,'GET',undefined,undefined),403)
 const denied=await body(await call(preview,scheduler,'POST',input('2036-02-04','10')),200);assert.equal(denied.available,false)
 const valid=await body(await call(preview,scheduler,'POST',input('2036-02-04','18')),200);assert.deepEqual(valid,{available:true})
 for(const secret of [hidden,late,'Private recurring name'])assert.ok(!JSON.stringify({denied,valid}).includes(secret))
 const unavailable=await body(await call(preview,scheduler,'POST',input('2036-02-05','10',standard)),200);assert.equal(unavailable.available,false);assert.equal(unavailable.reason,'Staff is unavailable on this date.')
})
test('disabled Shifts retains hidden working hours while an active Appointments consumer needs them',async()=>{
 await root.query('UPDATE "TenantModule" SET enabled=false WHERE "tenantId"=$1 AND key=\'shifts\'',[t])
 try{assert.deepEqual((await load())(profile,new Date('2036-02-04')).segments,[{start:720,end:900},{start:930,end:1200}]);await body(await call(book,scheduler,'POST',input('2036-02-04','18')),201)}finally{await root.query('UPDATE "TenantModule" SET enabled=true WHERE "tenantId"=$1 AND key=\'shifts\'',[t])}
})
test('bookings using hidden overrides block incompatible shared-template edits with complete rollback',async()=>{
 const before=(await root.query('SELECT * FROM "ShiftTemplate" WHERE id=$1',[late])).rows[0],audits=(await root.query('SELECT count(*)::int n FROM "AuditLog" WHERE "tenantId"=$1',[t])).rows[0].n
 const result=await body(await call(templates,admin,'PATCH',{name:'Changed visible template',startTime:'12:00',endTime:'17:00',breaks:[]},late),409)
 assert.match(result.error,/conflicts with existing appointments/);assert.ok(!JSON.stringify(result).includes(hidden))
 assert.deepEqual((await root.query('SELECT * FROM "ShiftTemplate" WHERE id=$1',[late])).rows[0],before);assert.equal((await root.query('SELECT count(*)::int n FROM "AuditLog" WHERE "tenantId"=$1',[t])).rows[0].n,audits)
})
test('active actor, tenant, profile Read and an enabled legitimate consumer are all mandatory',async()=>{
 await assert.rejects(query(plain));await assert.rejects(runWithTenantDbContext(t,()=>prisma.$queryRaw`SELECT * FROM app.effective_working_time(${t},${[profile]}::text[],'2036-02-04'::date,'2036-02-04'::date)`))
 for(const [table,where,change,restore]of[['User','id',"status='SUSPENDED'","status='ACTIVE'"],['TenantAccessRole','id','archived=true','archived=false'],['Tenant','id',"status='SUSPENDED'","status='ACTIVE'"]]){
  const id=table==='User'?scheduler:table==='TenantAccessRole'?role:t;await root.query(`UPDATE "${table}" SET ${change} WHERE "${where}"=$1`,[id]);try{await assert.rejects(query())}finally{await root.query(`UPDATE "${table}" SET ${restore} WHERE "${where}"=$1`,[id])}
 }
 const original=(await root.query('SELECT rules FROM "TenantUserAccess" WHERE "userId"=$1',[scheduler])).rows[0].rules
 await root.query('UPDATE "TenantUserAccess" SET rules=rules||\'{"appointments.read":"NONE"}\'::jsonb WHERE "userId"=$1',[scheduler]);try{await assert.rejects(query())}finally{await root.query('UPDATE "TenantUserAccess" SET rules=$2 WHERE "userId"=$1',[scheduler,original])}
 await root.query('UPDATE "TenantModule" SET enabled=false WHERE "tenantId"=$1 AND key IN (\'appointments\',\'shifts\')',[t]);try{await assert.rejects(query());await assert.rejects(query(admin))}finally{await root.query('UPDATE "TenantModule" SET enabled=true WHERE "tenantId"=$1 AND key IN (\'appointments\',\'shifts\')',[t])}
})
test('foreign/missing profiles and invalid ranges reject the whole batch without partial timings',async()=>{
 for(const args of [[[profile,pf]],[[profile,'missing']],[[null]], [Array(201).fill(profile)],[[profile],'2036-02-05','2036-02-04'],[[profile],'2035-01-01','2036-02-04'],[[profile],'infinity','infinity'],[[profile],'2036-02-30','2036-02-30']])await assert.rejects(query(scheduler,...args))
 assert.deepEqual(await query(scheduler,[]),[])
 await assert.rejects(load(scheduler,'invalid'));await assert.rejects(load(scheduler,'2036-02-04','2036-02-04',['']),e=>e.status===400)
})
test('batching covers 201 staff and 367 dates and rechecks current authority between batches',async()=>{
 const ids=Array.from({length:201},(_,i)=>t+'_batch_'+i)
 await root.query('INSERT INTO "User"(id,"tenantId",email,role,"updatedAt") SELECT x,$1,x||\'@example.test\',\'STAFF\',now() FROM unnest($2::text[]) x',[t,ids]);await root.query('INSERT INTO "StaffProfile"(id,"userId","schedulingMode","updatedAt") SELECT x,x,\'FLEXIBLE\',now() FROM unnest($1::text[]) x',[ids])
 let reads=0;const db={$queryRaw:(...args)=>{reads++;return prisma.$queryRaw(...args)}}
 const resolve=await load(scheduler,'2036-02-04','2036-02-04',ids,db);assert.equal(reads,2);assert.deepEqual(resolve(ids[200],new Date('2036-02-04')).segments,[])
 reads=0;const dates=await load(scheduler,'2020-01-06','2021-01-06',[profile],db);assert.equal(reads,2);assert.deepEqual(dates(profile,new Date('2020-01-06')).segments,[{start:540,end:660}]);assert.deepEqual(dates(profile,new Date('2021-01-06')).segments,[])
 reads=0;const revoked={$queryRaw:async(...args)=>{const rows=await prisma.$queryRaw(...args);if(++reads===1)await root.query('UPDATE "TenantAccessRole" SET archived=true WHERE id=$1',[role]);return rows}}
 try{await assert.rejects(load(scheduler,'2020-01-06','2021-01-06',[profile],revoked),e=>e.status===403);assert.equal(reads,1)}finally{await root.query('UPDATE "TenantAccessRole" SET archived=false WHERE id=$1',[role])}
})
test('canonical history and effective timings agree without exposing hidden source data to booking checks',async()=>{
 await scope(admin,()=>syncRosterHistoryRange(prisma,{tenantId:t,staffProfileIds:[profile],startDate:'2020-01-06',endDate:'2020-01-06'}))
 const row=(await root.query('SELECT "paidMinutes","startTime","endTime" FROM "StaffRosterHistoryDay" WHERE "staffProfileId"=$1 AND date=\'2020-01-06\'',[profile])).rows[0]
 const resolve=await load(scheduler,'2020-01-06');assert.equal(row.paidMinutes,resolve(profile,new Date('2020-01-06')).segments.reduce((n,s)=>n+s.end-s.start,0));assert.deepEqual([row.startTime,row.endTime],['09:00','11:00'])
})
