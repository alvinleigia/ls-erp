/* eslint-disable @typescript-eslint/no-require-imports */
process.env.TZ='UTC'
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Client}=require('pg'),{AsyncLocalStorage}=require('node:async_hooks')
const raw=process.env.CRM_TEST_DATABASE_URL,url=new URL(raw||'http://invalid');if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!='/ls_salon_crm_test')throw Error('Disposable local database only.')
const root=new Client({connectionString:raw}),sessions=new AsyncLocalStorage();url.username='crm_test_runtime';url.password='';process.env.DATABASE_URL=url.toString()
const authPath=require.resolve('../auth.ts');require.cache[authPath]={id:authPath,filename:authPath,loaded:true,exports:{auth:async()=>{await Promise.resolve();return sessions.getStore()||null}}}
const errors=[];require('../lib/logger.ts').logger.info=()=>{};require('../lib/logger.ts').logger.error=(_,c)=>errors.push(c.error?.message)
const {prisma,runWithTenantDbContext}=require('../lib/prisma.ts'),{runWithDatabaseActor}=require('../lib/database-actor.ts'),{createOfficeAccessService}=require('../platform/companies/office-access.ts'),{defaultRecordRules,supportedScopes}=require('../platform/access/rules.ts'),{allPermissions}=require('../platform/access/catalog.ts')
const {loadWorkingTime}=require('../modules/workforce/working-time.ts')
const slots=require('../app/api/shifts/flexible-slots/route.ts'),overrides=require('../app/api/shifts/overrides/route.ts'),history=require('../app/api/shifts/history/route.ts')
const t='daily_offices_'+randomUUID().replaceAll('-',''),admin=t+'_admin',ma=t+'_ma',mb=t+'_mb',reader=t+'_reader',plain=t+'_plain',sa=t+'_sa',sb=t+'_sb',su=t+'_unplaced',pa=t+'_pa',pb=t+'_pb',pu=t+'_pu',role=t+'_role',template=t+'_template'
const scope=(u,fn)=>runWithTenantDbContext(t,()=>runWithDatabaseActor(u,async()=>await fn())),access=u=>createOfficeAccessService(prisma,{tenantId:t,userId:u}),context=u=>scope(u,()=>access(u).getOwnContext())
async function select(u,o){const c=await context(u);await scope(u,()=>access(u).selectCreationOffice({version:c.version,officeId:o}))}
async function call(endpoint,u=admin,method='GET',data,query='',captured){if(method==='POST'&&captured===undefined){const c=await context(u);captured=c.creationOffice?{id:c.creationOffice.id,version:c.version}:null}return sessions.run({user:{id:u,tenantId:t,role:u===admin?'ADMIN':[sa,sb,su].includes(u)?'STAFF':'MANAGER'}},()=>endpoint[method](new Request(`http://${t}.localhost/api/shifts/overrides${query}`,{method,headers:{host:t+'.localhost','content-type':'application/json',...(captured?{'x-office-id':captured.id,'x-office-version':String(captured.version)}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})})))}
async function body(response,status=200){const data=await response.json();assert.equal(response.status,status,JSON.stringify({data,errors:errors.slice(-2)}));return data}
const slot=(staff=sa,date='2036-02-04',extra={})=>({staffId:staff,date,slots:[{startTime:'09:00',endTime:'17:00'}],...extra})
const override=(staff=sa,date='2036-02-04',extra={})=>({staffId:staff,startDate:date,endDate:date,isUnavailable:true,skipWeekOff:false,skipHolidays:false,...extra})
const query=(staff=sa,first='2036-02-04',last=first)=>`?staffIds=${staff}&startDate=${first}&endDate=${last}`
let a,b,slotA,overrideA
before(async()=>{
 await root.connect();await root.query('INSERT INTO "Tenant"(id,name,slug,"updatedAt") VALUES($1,$1,$1,now())',[t]);a=(await root.query('SELECT id FROM "BusinessOffice" WHERE "tenantId"=$1 AND "isInitial"',[t])).rows[0].id;b=t+'_west'
 await root.query('INSERT INTO "BusinessOffice"(id,"tenantId","companyId",code,name,"updatedAt") SELECT $1,$2,"companyId",\'WEST\',\'West\',now() FROM "BusinessOffice" WHERE id=$3',[b,t,a])
 for(const [u,r]of[[admin,'ADMIN'],[ma,'MANAGER'],[mb,'MANAGER'],[reader,'MANAGER'],[plain,'MANAGER'],[sa,'STAFF'],[sb,'STAFF'],[su,'STAFF']])await root.query('INSERT INTO "User"(id,"tenantId",email,role,"updatedAt") VALUES($1,$2,$3,$4,now())',[u,t,u+'@example.test',r])
 const rules=defaultRecordRules();for(const p of Object.keys(rules))if(supportedScopes(p.split('.')[0]).includes('ALL'))rules[p]='ALL'
 for(const [rid,perms]of[[role,allPermissions],[reader,['shiftRoster.read']]])await root.query('INSERT INTO "TenantAccessRole"(id,"tenantId",name,"nameKey",permissions,"updatedAt") VALUES($1,$2,$1,$1,$3,now())',[rid,t,perms])
 for(const u of [ma,mb,reader,sa,sb,su]){await root.query('INSERT INTO "TenantUserAccess"("tenantId","userId",rules,"updatedAt") VALUES($1,$2,$3,now())',[t,u,rules]);await root.query('INSERT INTO "TenantRoleAssignment"("tenantId","userId","roleId","updatedAt") VALUES($1,$2,$3,now())',[t,u,u===reader?reader:role])}
 for(const [u,offices]of[[admin,[a,b]],[ma,[a]],[mb,[b]],[reader,[a]],[plain,[a]],[sa,[a,b]],[sb,[b]],[su,[a,b]]]){await root.query('INSERT INTO "BusinessOfficePolicy"("tenantId","userId","creationOfficeId","updatedAt") VALUES($1,$2,$3,now())',[t,u,offices[0]]);for(const o of offices)await root.query('INSERT INTO "BusinessOfficeGrant"("tenantId","userId","officeId") VALUES($1,$2,$3)',[t,u,o])}
 for(const key of ['shifts','appointments','leaves','services'])await root.query('INSERT INTO "TenantModule"("tenantId",key,allowed,enabled,"updatedAt") VALUES($1,$2,true,true,now())',[t,key])
 await root.query('INSERT INTO "AppSetting"(id,"tenantId","timeZone","updatedAt") VALUES($1,$1,\'UTC\',now())',[t])
 for(const [p,u]of[[pa,sa],[pb,sb],[pu,su]])await root.query('INSERT INTO "StaffProfile"(id,"userId","schedulingMode","updatedAt") VALUES($1,$2,\'FLEXIBLE\',now())',[p,u])
 for(const [p,o]of[[pa,a],[pb,b]]){await root.query('INSERT INTO "StaffWorkplacePolicy"("tenantId","staffProfileId",version,"updatedAt") VALUES($1,$2,1,now())',[t,p]);await root.query('INSERT INTO "StaffWorkplaceAssignment"(id,"tenantId","staffProfileId","officeId","updatedAt") VALUES($1,$2,$1,$3,now())',[p,t,o])}
 await root.query('INSERT INTO "ShiftTemplate"(id,"tenantId",name,"startTime","endTime","updatedAt") VALUES($1,$2,\'Daily consultation\',\'09:00\',\'17:00\',now())',[template,t])
})
after(async()=>{await root.end();await Promise.all([global.prisma,global.prismaBypassClient,...[...(global.prismaScopedClientCache?.values()||[])].map(e=>e.client)].filter(Boolean).map(c=>c.$disconnect()));await global.prismaPool?.end()})

test('native daily suite has no implicit fixtures and new daily records require captured offices',async()=>{
 assert.equal((await root.query("SELECT count(*)::int n FROM pg_trigger WHERE tgname='aaa_test_daily_office_fixture'")).rows[0].n,0)
 await body(await call(slots,admin,'POST',slot(),'',null),403);await body(await call(overrides,admin,'POST',override(),'',null),403)
})
test('daily slots and overrides store immutable offices and return protected labels',async()=>{
 slotA=(await body(await call(slots,admin,'POST',slot()))).items[0]
 await body(await call(overrides,admin,'POST',override()));overrideA=(await body(await call(overrides,ma,'GET',undefined,query()))).items[0]
 assert.equal(slotA.officeId,a);assert.equal(slotA.office.id,a);assert.equal(overrideA.officeId,a)
 await select(admin,b);await body(await call(slots,admin,'POST',slot(sb)));await body(await call(overrides,admin,'POST',override(sb)))
 assert.equal((await body(await call(slots,mb,'GET',undefined,query()))).items.length,0)
 assert.equal((await body(await call(overrides,mb,'GET',undefined,query()))).items.length,0)
 assert.equal(await scope(mb,()=>prisma.staffFlexibleAvailability.count({where:{id:slotA.id}})),0)
})
test('grants, Read-only profiles and Read operation bindings cannot authorize daily writes',async()=>{
 await body(await call(overrides,plain,'GET',undefined,query()),403)
 await body(await call(slots,reader,'POST',slot()),403);await body(await call(overrides,reader,'DELETE',override()),403)
 await assert.rejects(scope(reader,()=>prisma.$transaction(async tx=>{await tx.$executeRaw`SELECT set_config('app.workforce_operation','shiftRoster.read',true)`;await tx.staffFlexibleAvailability.updateMany({where:{id:slotA.id},data:{endTime:'18:00'}})})))
 await assert.rejects(scope(ma,()=>prisma.$transaction(async tx=>{await tx.$executeRaw`SELECT set_config('app.workforce_operation','shiftRoster.edit',true)`;await tx.staffFlexibleAvailability.deleteMany({where:{id:slotA.id}})})))
})
test('module revocation hides daily sources and audits without erasing integrity timings',async()=>{
 await root.query('UPDATE "TenantModule" SET enabled=false WHERE "tenantId"=$1 AND key=\'shifts\'',[t])
 try{await body(await call(slots,ma,'GET',undefined,query()),403);assert.equal(await scope(ma,()=>prisma.staffShiftOverride.count({where:{tenantId:t}})),0);assert.equal(await scope(ma,()=>prisma.auditLog.count({where:{tenantId:t,entityType:'shiftRoster'}})),0)
  const resolve=await scope(ma,()=>loadWorkingTime(prisma,t,[pa],new Date('2036-02-04'),new Date('2036-02-04')));assert.deepEqual(resolve(pa,new Date('2036-02-04')).segments,[])
 }finally{await root.query('UPDATE "TenantModule" SET enabled=true WHERE "tenantId"=$1 AND key=\'shifts\'',[t])}
})
test('stale new-day forms conflict without rerouting either source family',async()=>{
 const c=await context(admin);await select(admin,a);const stale={id:b,version:c.version}
 await body(await call(slots,admin,'POST',slot(sb,'2036-02-05'),'',stale),409)
 await body(await call(overrides,admin,'POST',override(sb,'2036-02-05'),'',stale),409)
})
test('new dates reject wrong-office or unplaced staff and validate bounded unique slots',async()=>{
 for(const u of [su,sb]){await body(await call(slots,admin,'POST',slot(u,'2036-02-05')),400);await body(await call(overrides,admin,'POST',override(u,'2036-02-05')),400)}
 await body(await call(slots,admin,'POST',slot(sa,'2036-02-05',{slots:[{startTime:'09:00',endTime:'10:00',sortOrder:1},{startTime:'11:00',endTime:'12:00',sortOrder:1}]})),400)
 await body(await call(overrides,admin,'POST',override(sa,'2036-01-01',{endDate:'2037-01-01'})),400)
})
test('existing date edits retain source offices and slot identities after preferences and membership change',async()=>{
 await select(admin,b);await root.query('DELETE FROM "BusinessOfficeGrant" WHERE "userId"=$1 AND "officeId"=$2',[sa,a])
 const saved=(await body(await call(slots,admin,'POST',slot(sa,'2036-02-04',{slots:[{startTime:'07:00',endTime:'19:00'},{startTime:'20:00',endTime:'21:00'}]}),'',null))).items
 assert.equal(saved[0].id,slotA.id);assert.ok(saved.every(row=>row.officeId===a))
 await body(await call(overrides,admin,'POST',override(sa,'2036-02-04',{isUnavailable:false,templateId:template}),'',null))
 const row=(await body(await call(overrides,ma,'GET',undefined,query()))).items[0];assert.equal(row.id,overrideA.id);assert.equal(row.officeId,a)
 await root.query('INSERT INTO "BusinessOfficeGrant"("tenantId","userId","officeId") VALUES($1,$2,$3)',[t,sa,a])
})
test('source identity, date and slot positions cannot be moved',async()=>{
 for(const data of [{officeId:b},{date:new Date('2036-02-06')},{staffProfileId:pb},{sortOrder:8}])await assert.rejects(scope(ma,()=>prisma.staffFlexibleAvailability.updateMany({where:{id:slotA.id},data})))
 await assert.rejects(scope(ma,()=>prisma.staffShiftOverride.updateMany({where:{id:overrideA.id},data:{officeId:b}})))
})
test('Edit-only users can replace slot lists but cannot clear the entire day through Archive',async()=>{
 await root.query('UPDATE "TenantAccessRole" SET permissions=$1 WHERE id=$2',[['shiftRoster.read','shiftRoster.edit'],reader])
 try{const saved=(await body(await call(slots,reader,'POST',slot()))).items;assert.equal(saved.length,1);assert.equal(saved[0].id,slotA.id)
  await body(await call(slots,reader,'DELETE',{staffId:sa,date:'2036-02-04'}),403)
  await body(await call(slots,reader,'POST',slot(sa,'2036-02-04',{slots:[{startTime:'07:00',endTime:'19:00'},{startTime:'20:00',endTime:'21:00'}]})))
 }finally{await root.query('UPDATE "TenantAccessRole" SET permissions=$1 WHERE id=$2',[['shiftRoster.read'],reader])}
})
test('closed offices remain readable while daily edits and deletion are denied',async()=>{
 await root.query('UPDATE "BusinessOffice" SET archived=true WHERE id=$1',[b])
 try{assert.equal((await body(await call(slots,mb,'GET',undefined,query(sb)))).items[0].office.active,false);await body(await call(slots,mb,'POST',slot(sb)),403);await body(await call(overrides,mb,'DELETE',override(sb)),403)}finally{await root.query('UPDATE "BusinessOffice" SET archived=false WHERE id=$1',[b])}
})
test('hidden inconsistent daily collisions fail atomically with opaque conflicts',async()=>{
 await select(admin,a)
 await root.query('INSERT INTO "StaffShiftOverride"(id,"tenantId","officeId","staffProfileId",date,"updatedAt") VALUES($1,$2,$3,$4,\'2036-02-12\',now())',[t+'_hidden_override',t,b,pa])
 await root.query('INSERT INTO "StaffFlexibleAvailability"(id,"tenantId","officeId","staffProfileId",date,"startTime","endTime","updatedAt") VALUES($1,$2,$3,$4,\'2036-02-12\',\'09:00\',\'17:00\',now())',[t+'_hidden_slot',t,b,pa])
 try{for(const [endpoint,data]of[[slots,slot(sa,'2036-02-12')],[overrides,override(sa,'2036-02-12')]]){const result=await body(await call(endpoint,ma,'POST',data),409);assert.ok(!JSON.stringify(result).includes(t+'_hidden'))}
  const resolve=await scope(ma,()=>loadWorkingTime(prisma,t,[pa],new Date('2036-02-12'),new Date('2036-02-12')));assert.deepEqual(resolve(pa,new Date('2036-02-12')).segments,[])
 }finally{await root.query('DELETE FROM "StaffShiftOverride" WHERE id=$1',[t+'_hidden_override']);await root.query('DELETE FROM "StaffFlexibleAvailability" WHERE id=$1',[t+'_hidden_slot'])}
})
test('bulk week-off selection uses hidden office defaults, assignment precedence and holidays',async()=>{
 for(const [id,o,day]of[[t+'_default_a',a,'SUNDAY'],[t+'_default_b',b,'MONDAY']])await root.query('INSERT INTO "ShiftSchedule"(id,"tenantId","officeId","isDefault","startDate","weekOffDay1","weekOff2Weeks","updatedAt") VALUES($1,$2,$3,true,\'2020-01-01\',$4,ARRAY[]::integer[],now())',[id,t,o,day])
 await root.query('UPDATE "TenantUserAccess" SET rules=jsonb_set(rules,\'{shiftSchedules.read}\',\'"NONE"\') WHERE "userId"=$1',[ma])
 assert.equal(await scope(ma,()=>prisma.shiftSchedule.count({where:{tenantId:t}})),0)
 assert.equal((await body(await call(overrides,ma,'POST',override(sa,'2036-02-04',{endDate:'2036-02-10',skipWeekOff:true})))).createdCount,6)
 assert.equal((await body(await call(overrides,ma,'GET',undefined,query(sa,'2036-02-10')))).items.length,0)
 await root.query('INSERT INTO "ShiftSchedule"(id,"tenantId","officeId","isDefault","startDate","weekOffDay1","weekOff2Weeks","updatedAt") VALUES($1,$2,$3,false,\'2020-01-01\',\'WEDNESDAY\',ARRAY[]::integer[],now())',[t+'_assigned',t,a])
 await root.query('INSERT INTO "StaffScheduleAssignment"(id,"staffProfileId","scheduleId","startDate","endDate","updatedAt") VALUES($1,$2,$1,\'2036-02-04\',\'2036-02-10\',now())',[t+'_assigned',pa])
 assert.equal((await body(await call(overrides,ma,'POST',override(sa,'2036-02-04',{endDate:'2036-02-10',skipWeekOff:true})))).createdCount,6)
 assert.equal((await body(await call(overrides,ma,'GET',undefined,query(sa,'2036-02-10')))).items.length,1)
 await root.query('INSERT INTO "AppSettingOverride"(id,"settingId",date,"isOpen") VALUES($1,$2,\'2036-02-05\',false)',[t+'_holiday',t])
 const prior=(await root.query('SELECT to_jsonb(r) row FROM "StaffShiftOverride" r WHERE "staffProfileId"=$1 AND date=\'2036-02-05\'',[pa])).rows[0].row
 assert.equal((await body(await call(overrides,ma,'POST',override(sa,'2036-02-04',{endDate:'2036-02-10',skipWeekOff:true,skipHolidays:true})))).createdCount,5)
 assert.deepEqual((await root.query('SELECT to_jsonb(r) row FROM "StaffShiftOverride" r WHERE "staffProfileId"=$1 AND date=\'2036-02-05\'',[pa])).rows[0].row,prior)
})
test('range edits across existing office boundaries split their audit snapshots by office',async()=>{
 await root.query('UPDATE "StaffWorkplaceAssignment" SET "endDate"=\'2036-02-29\' WHERE id=$1',[pa]);await root.query('INSERT INTO "StaffWorkplaceAssignment"(id,"tenantId","staffProfileId","officeId","startDate","updatedAt") VALUES($1,$2,$3,$4,\'2036-03-01\',now())',[t+'_transfer',t,pa,b])
 await select(admin,a);await body(await call(overrides,admin,'POST',override(sa,'2036-02-29')));await select(admin,b);await body(await call(overrides,admin,'POST',override(sa,'2036-03-01')))
 const start=new Date();await body(await call(overrides,admin,'POST',override(sa,'2036-02-29',{endDate:'2036-03-01'})))
 const audits=(await root.query('SELECT metadata,before,after,"requestId" FROM "AuditLog" WHERE "tenantId"=$1 AND "createdAt">=$2 AND metadata->>\'officeFamily\'=\'dailyRoster\' ORDER BY "createdAt"',[t,start])).rows
 assert.equal(audits.length,2);assert.equal(audits[0].requestId,audits[1].requestId)
 for(const audit of audits)assert.ok([...audit.before,...audit.after].every(row=>row.officeId===audit.metadata.officeId))
 const bIds=audits.filter(row=>row.metadata.officeId===b).flatMap(row=>row.after.map(x=>x.id))
 const visible=await scope(ma,()=>prisma.auditLog.findMany({where:{tenantId:t,createdAt:{gte:start},entityType:'shiftRoster'}}));for(const row of visible)for(const id of bIds)assert.ok(!JSON.stringify(row).includes(id))
 await select(admin,a);await body(await call(overrides,admin,'POST',override(sa,'2036-02-27',{endDate:'2036-03-02'})),400)
 assert.equal((await body(await call(overrides,admin,'GET',undefined,query(sa,'2036-02-27')))).items.length,0)
})
test('historical daily corrections replace only selected dates and obey history office Read',async()=>{
 await body(await call(overrides,ma,'POST',override(sa,'2020-01-06')))
 const first=(await body(await call(history,ma,'GET',undefined,query(sa,'2020-01-06')))).items[0];assert.equal(first.paidMinutes,0)
 await body(await call(overrides,ma,'POST',override(sa,'2020-01-06',{isUnavailable:false,templateId:template})))
 assert.equal((await body(await call(history,ma,'GET',undefined,query(sa,'2020-01-06')))).items[0].paidMinutes,480)
 assert.deepEqual((await body(await call(history,mb,'GET',undefined,query(sa,'2020-01-06')))).items,[])
})
test('hidden daily overrides and slots still protect future bookings and compatible fallback',async()=>{
 await body(await call(overrides,ma,'POST',override(sa,'2036-02-04',{isUnavailable:false,templateId:template})))
 const customer=t+'_customer',service=t+'_service',booking=t+'_booking'
 await root.query('INSERT INTO "User"(id,"tenantId",email,role,"updatedAt") VALUES($1,$2,$3,\'CUSTOMER\',now())',[customer,t,customer+'@example.test'])
 await root.query('INSERT INTO "ServiceCategory"(id,"tenantId",name,"updatedAt") VALUES($1,$2,$1,now())',[service,t]);await root.query('INSERT INTO "Service"(id,"tenantId","categoryId",name,"durationMinutes","priceCents","updatedAt") VALUES($1,$2,$1,$1,60,1000,now())',[service,t])
 await root.query('INSERT INTO "Appointment"(id,"tenantId","customerId","staffProfileId","serviceId","startAt","endAt",status,"updatedAt") VALUES($1,$2,$3,$4,$5,\'2036-02-04 10:00Z\',\'2036-02-04 11:00Z\',\'SCHEDULED\',now())',[booking,t,customer,pa,service])
 const result=await body(await call(overrides,ma,'POST',override()),409);assert.equal(result.conflictCount,1)
 const resolve=await scope(mb,()=>loadWorkingTime(prisma,t,[pa],new Date('2036-02-04'),new Date('2036-02-04')));assert.deepEqual(resolve(pa,new Date('2036-02-04')).segments,[{start:540,end:1020}])
 assert.equal((await body(await call(overrides,ma,'DELETE',override()))).deletedCount,1)
 await body(await call(slots,ma,'DELETE',{staffId:sa,date:'2036-02-04'}),409)
 await root.query('DELETE FROM "Appointment" WHERE id=$1',[booking])
})
test('required audit failure restores daily records, slot IDs and historical evidence atomically',async()=>{
 const state=async()=>Promise.all(['StaffShiftOverride','StaffFlexibleAvailability','StaffRosterHistoryDay'].map(async table=>(await root.query(`SELECT to_jsonb(r) row FROM "${table}" r WHERE "staffProfileId"=$1 ORDER BY id`,[pa])).rows))
 const before=await state();await root.query(`CREATE FUNCTION app.test_daily_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."tenantId"='${t}' AND NEW.metadata->>'officeFamily'='dailyRoster' THEN RAISE EXCEPTION 'Private audit detail';END IF;RETURN NEW;END $$;CREATE TRIGGER test_daily_audit_failure BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION app.test_daily_audit_failure()`)
 try{await body(await call(slots,ma,'POST',slot(sa,'2036-02-04',{slots:[{startTime:'10:00',endTime:'18:00'}]})),500);await body(await call(overrides,ma,'POST',override(sa,'2020-01-06')),500);assert.deepEqual(await state(),before)}finally{await root.query('DROP TRIGGER test_daily_audit_failure ON "AuditLog";DROP FUNCTION app.test_daily_audit_failure()')}
})
test('hidden deletions are empty operations and visible daily deletion keeps office-scoped audits',async()=>{
 assert.equal((await body(await call(slots,mb,'DELETE',{staffId:sa,date:'2036-02-04'}))).deletedCount,0)
 assert.equal((await body(await call(slots,ma,'DELETE',{staffId:sa,date:'2036-02-04'}))).deletedCount,2)
 const records=await scope(mb,()=>prisma.auditLog.findMany({where:{tenantId:t,entityId:pa,event:'workforce.shiftRoster.archive'}}));assert.ok(records.every(row=>row.metadata.officeId===b))
})
test('the full supported 366-date bulk override is atomic under native ownership guards',async()=>{
 await root.query('INSERT INTO "StaffWorkplacePolicy"("tenantId","staffProfileId",version,"updatedAt") VALUES($1,$2,1,now())',[t,pu])
 await root.query('INSERT INTO "StaffWorkplaceAssignment"(id,"tenantId","staffProfileId","officeId","updatedAt") VALUES($1,$2,$1,$3,now())',[pu,t,a])
 const saved=await body(await call(overrides,ma,'POST',override(su,'2020-01-01',{endDate:'2020-12-31'})));assert.equal(saved.createdCount,366)
 const rows=(await root.query('SELECT count(*)::int n,count(DISTINCT "officeId")::int offices FROM "StaffShiftOverride" WHERE "tenantId"=$1 AND "staffProfileId"=$2',[t,pu])).rows[0];assert.equal(rows.n,366);assert.equal(rows.offices,1)
 assert.equal((await root.query('SELECT count(*)::int n FROM "StaffRosterHistoryDay" WHERE "staffProfileId"=$1 AND source=\'UNAVAILABLE\'',[pu])).rows[0].n,366)
})
