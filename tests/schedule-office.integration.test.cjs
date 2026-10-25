/* eslint-disable @typescript-eslint/no-require-imports */
process.env.TZ='UTC'
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Client}=require('pg'),{AsyncLocalStorage}=require('node:async_hooks')
const raw=process.env.CRM_TEST_DATABASE_URL,url=new URL(raw||'http://invalid');if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!='/ls_salon_crm_test')throw Error('Disposable local database only.')
const root=new Client({connectionString:raw}),sessions=new AsyncLocalStorage();url.username='crm_test_runtime';url.password='';process.env.DATABASE_URL=url.toString()
const authPath=require.resolve('../auth.ts');require.cache[authPath]={id:authPath,filename:authPath,loaded:true,exports:{auth:async()=>{await Promise.resolve();return sessions.getStore()||null}}}
const errors=[];require('../lib/logger.ts').logger.info=()=>{};require('../lib/logger.ts').logger.error=(_,c)=>errors.push(c.error?.message)
const {prisma,runWithTenantDbContext}=require('../lib/prisma.ts'),{runWithDatabaseActor}=require('../lib/database-actor.ts'),{createOfficeAccessService}=require('../platform/companies/office-access.ts'),{defaultRecordRules,supportedScopes}=require('../platform/access/rules.ts'),{allPermissions}=require('../platform/access/catalog.ts')
const list=require('../app/api/shifts/schedules/route.ts'),record=require('../app/api/shifts/schedules/[id]/route.ts'),assignments=require('../app/api/shifts/assignments/route.ts'),history=require('../app/api/shifts/history/route.ts'),workplaces=require('../app/api/shifts/workplaces/route.ts'),templates=require('../app/api/shifts/templates/[id]/route.ts')
const {loadWorkingTime}=require('../modules/workforce/working-time.ts')
const t='schedule_offices_'+randomUUID().replaceAll('-',''),admin=t+'_admin',ma=t+'_ma',mb=t+'_mb',staff=t+'_staff',unplaced=t+'_unplaced',p=t+'_profile',pu=t+'_unplaced_profile',role=t+'_role',ta=t+'_template_a',tb=t+'_template_b'
const scoped=(u,fn)=>runWithTenantDbContext(t,()=>runWithDatabaseActor(u,async()=>await fn()))
const access=u=>createOfficeAccessService(prisma,{tenantId:t,userId:u})
const context=u=>scoped(u,()=>access(u).getOwnContext())
const select=async(u,o)=>{const v=await context(u);await scoped(u,()=>access(u).selectCreationOffice({version:v.version,officeId:o}))}
async function call(endpoint,user=admin,method='GET',data,id,query='',captured){if(method==='POST'&&captured===undefined){const c=await context(user);captured=c.creationOffice?{id:c.creationOffice.id,version:c.version}:null}return sessions.run({user:{id:user,tenantId:t,role:user===admin?'ADMIN':[staff,unplaced].includes(user)?'STAFF':'MANAGER'}},()=>endpoint[method](new Request(`http://${t}.localhost/api/shifts/schedules${query}`,{method,headers:{host:t+'.localhost','content-type':'application/json',...(captured?{'x-office-id':captured.id,'x-office-version':String(captured.version)}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})}),{params:Promise.resolve({id})}))}
async function body(response,status=200){const data=await response.json();assert.equal(response.status,status,JSON.stringify({data,errors:errors.slice(-2)}));return data}
const schedule=(name,template,extra={})=>({name,isDefault:true,staffIds:[],startDate:'2030-01-01',weekOffDay1:'SUNDAY',weekOffDay2:'',weekOff2Weeks:[],blocks:[{templateId:template,repeatDays:1}],...extra})
let a,b,da,db
before(async()=>{
 await root.connect();await root.query('INSERT INTO "Tenant"(id,name,slug,"updatedAt") VALUES($1,$1,$1,now())',[t]);a=(await root.query('SELECT id FROM "BusinessOffice" WHERE "tenantId"=$1 AND "isInitial"',[t])).rows[0].id;b=t+'_west'
 await root.query('INSERT INTO "BusinessOffice"(id,"tenantId","companyId",code,name,"updatedAt") SELECT $1,$2,"companyId",\'WEST\',\'West office\',now() FROM "BusinessOffice" WHERE id=$3',[b,t,a])
 for(const [id,r]of[[admin,'ADMIN'],[ma,'MANAGER'],[mb,'MANAGER'],[staff,'STAFF'],[unplaced,'STAFF']])await root.query('INSERT INTO "User"(id,"tenantId",email,role,"updatedAt") VALUES($1,$2,$3,$4,now())',[id,t,id+'@example.test',r])
 const rules=defaultRecordRules();for(const k of Object.keys(rules))if(supportedScopes(k.split('.')[0]).includes('ALL'))rules[k]='ALL'
 await root.query('INSERT INTO "TenantAccessRole"(id,"tenantId",name,"nameKey",permissions,"updatedAt") VALUES($1,$2,$1,$1,$3,now())',[role,t,allPermissions])
 for(const u of [ma,mb,staff,unplaced]){await root.query('INSERT INTO "TenantUserAccess"("tenantId","userId",rules,"updatedAt") VALUES($1,$2,$3,now())',[t,u,rules]);await root.query('INSERT INTO "TenantRoleAssignment"("tenantId","userId","roleId","updatedAt") VALUES($1,$2,$3,now())',[t,u,role])}
 for(const [u,offices]of[[admin,[a,b]],[ma,[a]],[mb,[b]],[staff,[a,b]],[unplaced,[a,b]]]){await root.query('INSERT INTO "BusinessOfficePolicy"("tenantId","userId","creationOfficeId","updatedAt") VALUES($1,$2,$3,now())',[t,u,offices[0]]);for(const o of offices)await root.query('INSERT INTO "BusinessOfficeGrant"("tenantId","userId","officeId") VALUES($1,$2,$3)',[t,u,o])}
 for(const key of ['shifts','appointments','leaves'])await root.query('INSERT INTO "TenantModule"("tenantId",key,allowed,enabled,"updatedAt") VALUES($1,$2,true,true,now())',[t,key])
 await root.query('INSERT INTO "AppSetting"(id,"tenantId","timeZone","updatedAt") VALUES($1,$1,\'UTC\',now())',[t])
 for(const [id,u]of[[p,staff],[pu,unplaced]])await root.query('INSERT INTO "StaffProfile"(id,"userId","updatedAt") VALUES($1,$2,now())',[id,u])
 await root.query('INSERT INTO "StaffWorkplacePolicy"("tenantId","staffProfileId",version,"updatedAt") VALUES($1,$2,1,now())',[t,p]);await root.query('INSERT INTO "StaffWorkplaceAssignment"(id,"tenantId","staffProfileId","officeId","updatedAt") VALUES($1,$2,$3,$4,now())',[p,t,p,a])
 for(const [id,start,end]of[[ta,'09:00','17:00'],[tb,'12:00','20:00']])await root.query('INSERT INTO "ShiftTemplate"(id,"tenantId",name,"startTime","endTime","updatedAt") VALUES($1,$2,$1,$3,$4,now())',[id,t,start,end])
})
after(async()=>{await root.end();await Promise.all([global.prisma,global.prismaBypassClient,...[...(global.prismaScopedClientCache?.values()||[])].map(e=>e.client)].filter(Boolean).map(c=>c.$disconnect()));await global.prismaPool?.end()})

test('native suite has no implicit fixture placement and creation needs a captured office',async()=>{
 assert.equal((await root.query("SELECT count(*)::int n FROM pg_trigger WHERE tgname IN ('test_staff_workplace_fixture','test_user_office_fixture')")).rows[0].n,0)
 await body(await call(list,admin,'POST',schedule('No context',ta),undefined,'',null),403)
 assert.equal((await root.query('SELECT count(*)::int n FROM "StaffWorkplaceAssignment" WHERE "staffProfileId"=$1',[pu])).rows[0].n,0)
})
test('office defaults coexist and changing the creation office cannot change working hours',async()=>{
 da=(await body(await call(list,admin,'POST',schedule('East default',ta)))).schedule
 await select(admin,b);db=(await body(await call(list,admin,'POST',schedule('West default',tb)))).schedule
 assert.equal(da.officeId,a);assert.equal(db.officeId,b);assert.equal((await root.query('SELECT count(*)::int n FROM "ShiftSchedule" WHERE "tenantId"=$1 AND "isDefault"',[t])).rows[0].n,2)
 const resolve=await scoped(mb,()=>loadWorkingTime(prisma,t,[p],new Date('2036-02-04'),new Date('2036-02-04')));assert.deepEqual(resolve(p,new Date('2036-02-04')).segments,[{start:540,end:1020}])
 const empty=await scoped(admin,()=>loadWorkingTime(prisma,t,[pu],new Date('2036-02-04'),new Date('2036-02-04')));assert.deepEqual(empty(pu,new Date('2036-02-04')).segments,[])
})
test('source lists, children, labels and audit copies obey office scope',async()=>{
 const east=await body(await call(list,ma));assert.deepEqual(east.items.map(r=>r.id),[da.id]);assert.equal(east.items[0].office.id,a)
 assert.deepEqual((await body(await call(list,mb))).items.map(r=>r.id),[db.id])
 assert.equal(await scoped(mb,()=>prisma.shiftScheduleBlock.count({where:{scheduleId:da.id}})),0)
 assert.equal(await scoped(mb,()=>prisma.auditLog.count({where:{tenantId:t,entityType:'shiftSchedules',entityId:da.id}})),0)
 await body(await call(record,mb,'PATCH',schedule('Forbidden',ta),da.id),404)
})
test('stale creation snapshots fail without saving or rerouting',async()=>{
 const old=await context(admin);await select(admin,a)
 await body(await call(list,admin,'POST',schedule('Stale west',tb),undefined,'',{id:b,version:old.version}),409)
 assert.equal((await root.query('SELECT count(*)::int n FROM "ShiftSchedule" WHERE "tenantId"=$1 AND name=\'Stale west\'',[t])).rows[0].n,0)
})
test('default replacement is confined to the selected office',async()=>{
 const next=(await body(await call(list,admin,'POST',schedule('New east default',ta)))).schedule
 assert.equal((await root.query('SELECT "isDefault" FROM "ShiftSchedule" WHERE id=$1',[db.id])).rows[0].isDefault,true)
 assert.equal((await root.query('SELECT "isDefault" FROM "ShiftSchedule" WHERE id=$1',[da.id])).rows[0].isDefault,false);da=next
})
test('dated workplaces determine both default hours and roster default choices',async()=>{
 await body(await call(workplaces,admin,'POST',{action:'assign',staffId:staff,version:1,fromId:p,officeId:b,startsOn:'2036-03-01'}))
 const hours=await scoped(ma,()=>loadWorkingTime(prisma,t,[p],new Date('2036-02-28'),new Date('2036-03-03')))
 assert.deepEqual(hours(p,new Date('2036-02-28')).segments,[{start:540,end:1020}]);assert.deepEqual(hours(p,new Date('2036-03-03')).segments,[{start:720,end:1200}])
 const all=await body(await call(assignments,admin,'GET',undefined,undefined,`?staffIds=${staff}&startDate=2036-02-28&endDate=2036-03-03`));assert.equal(all.defaults.find(d=>d.date==='2036-03-03').scheduleId,db.id)
 const limited=await body(await call(assignments,ma,'GET',undefined,undefined,`?staffIds=${staff}&startDate=2036-03-03&endDate=2036-03-03`));assert.deepEqual(limited.defaults,[]);assert.deepEqual(limited.defaultSchedules,[])
})
test('assignment creation cannot span an unplaced or different-office workplace window',async()=>{
 const data=schedule('Explicit east',ta,{isDefault:false,staffIds:[staff],assignmentStartDate:'2036-02-01',assignmentEndDate:'2036-03-03',startDate:'2036-02-01'})
 await body(await call(list,admin,'POST',data),400)
 await body(await call(list,admin,'POST',{...data,staffIds:[unplaced],assignmentEndDate:'2036-02-28'}),400)
 const saved=(await body(await call(list,admin,'POST',{...data,assignmentEndDate:'2036-02-28'}))).schedule;assert.equal(saved.assignments.length,1)
 await assert.rejects(scoped(ma,()=>prisma.shiftSchedule.updateMany({where:{id:saved.id},data:{officeId:b}})))
})
test('canonical history is reconstructed despite hidden source schedules and remains office scoped',async()=>{
 await root.query('UPDATE "ShiftSchedule" SET "startDate"=\'2020-01-01\' WHERE id=$1',[da.id])
 await root.query('CREATE POLICY test_schedule_history_hidden ON "ShiftSchedule" AS RESTRICTIVE FOR SELECT USING(id<>\''+da.id+'\')')
 try{
  const mine=await body(await call(history,ma,'GET',undefined,undefined,`?staffIds=${staff}&startDate=2020-01-06&endDate=2020-01-06`));assert.equal(mine.items[0].templateId,ta);assert.equal(mine.items[0].paidMinutes,480)
  const other=await body(await call(history,mb,'GET',undefined,undefined,`?staffIds=${staff}&startDate=2020-01-06&endDate=2020-01-06`));assert.deepEqual(other.items,[])
 }finally{await root.query('DROP POLICY test_schedule_history_hidden ON "ShiftSchedule"')}
 assert.equal((await scoped(ma,()=>prisma.staffRosterHistoryDay.updateMany({where:{staffProfileId:p},data:{paidMinutes:999}}))).count,0)
})
test('self history survives office grant revocation without granting schedule reads',async()=>{
 await root.query('DELETE FROM "BusinessOfficeGrant" WHERE "userId"=$1 AND "officeId"=$2',[staff,a])
 const own=await body(await call(history,staff,'GET',undefined,undefined,`?staffIds=${staff}&startDate=2020-01-06&endDate=2020-01-06`));assert.equal(own.items[0].paidMinutes,480)
 assert.equal(await scoped(staff,()=>prisma.shiftSchedule.count({where:{id:da.id}})),0)
})
test('shared template edits preserve hidden-office history and frozen evidence',async()=>{
 const before=(await root.query('SELECT * FROM "StaffRosterHistoryDay" WHERE "staffProfileId"=$1 AND date=\'2020-01-06\'',[p])).rows[0]
 await body(await call(templates,mb,'PATCH',{name:'Renamed shared template',startTime:'09:00',endTime:'17:00',breaks:[]},ta))
 assert.deepEqual((await root.query('SELECT * FROM "StaffRosterHistoryDay" WHERE id=$1',[before.id])).rows[0],before)
 await body(await call(templates,mb,'DELETE',undefined,ta),409)
 assert.equal((await root.query('SELECT count(*)::int n FROM "ShiftTemplate" WHERE id=$1',[ta])).rows[0].n,1)
})

test('source action rules and module activation remain mandatory alongside office grants',async()=>{
 const rules=(await root.query('SELECT rules FROM "TenantUserAccess" WHERE "userId"=$1',[ma])).rows[0].rules
 await root.query('UPDATE "TenantUserAccess" SET rules=rules||\'{"shiftSchedules.read":"NONE"}\'::jsonb WHERE "userId"=$1',[ma])
 try{await body(await call(list,ma),403);assert.equal(await scoped(ma,()=>prisma.shiftSchedule.count({where:{tenantId:t}})),0)}finally{await root.query('UPDATE "TenantUserAccess" SET rules=$2 WHERE "userId"=$1',[ma,rules])}
 await root.query('UPDATE "TenantModule" SET enabled=false WHERE "tenantId"=$1 AND key=\'shifts\'',[t])
 try{await body(await call(list,admin),403);assert.equal(await scoped(ma,()=>prisma.shiftSchedule.count({where:{tenantId:t}})),0)}finally{await root.query('UPDATE "TenantModule" SET enabled=true WHERE "tenantId"=$1 AND key=\'shifts\'',[t])}
})

test('unchanged assignment edits preserve IDs after staff office eligibility is revoked; ending still works',async()=>{
 const current=(await body(await call(list,ma))).items.find(s=>s.name==='Explicit east')
 const assignment=current.assignments[0]
 await body(await call(record,ma,'PATCH',schedule('Renamed east',ta,{isDefault:false,staffIds:[staff],startDate:'2036-02-01',assignmentStartDate:'2036-02-01',assignmentEndDate:'2036-02-28'}),current.id))
 assert.equal((await root.query('SELECT id FROM "StaffScheduleAssignment" WHERE "scheduleId"=$1',[current.id])).rows[0].id,assignment.id)
 const ending=require('../app/api/shifts/assignments/[id]/route.ts')
 await body(await call(ending,ma,'PATCH',{endDate:'2036-02-27'},assignment.id))
 assert.equal((await root.query('SELECT "endDate"::text d FROM "StaffScheduleAssignment" WHERE id=$1',[assignment.id])).rows[0].d,'2036-02-27')
})

test('history cannot be pre-frozen for future dates or replaced across a hidden office',async()=>{
 await assert.rejects(scoped(ma,()=>prisma.$queryRaw`SELECT app.sync_roster_history(${t},${[p]}::text[],'2036-02-04'::date,'2036-02-04'::date,false)`),/limited to past dates/)
 const before=(await root.query('SELECT * FROM "StaffRosterHistoryDay" WHERE "staffProfileId"=$1 AND date=\'2020-01-06\'',[p])).rows[0]
 const changed=await scoped(mb,()=>prisma.$queryRaw`SELECT app.sync_roster_history(${t},${[p]}::text[],'2020-01-06'::date,'2020-01-06'::date,true) n`)
 assert.equal(changed[0].n,0);assert.deepEqual((await root.query('SELECT * FROM "StaffRosterHistoryDay" WHERE id=$1',[before.id])).rows[0],before)
})

test('office closure preserves source Read while rejecting edits and new schedules',async()=>{
 await root.query('UPDATE "BusinessOffice" SET archived=true WHERE id=$1',[b])
 try{
  const rows=await body(await call(list,mb));assert.equal(rows.items[0].office.active,false)
  await body(await call(record,mb,'PATCH',schedule('Closed west',tb),db.id),403)
  await select(admin,b).catch(()=>{})
  await body(await call(list,admin,'POST',schedule('Closed create',tb),undefined,'',{id:b,version:(await context(admin)).version}),403)
 }finally{await root.query('UPDATE "BusinessOffice" SET archived=false WHERE id=$1',[b])}
})

test('concurrent default replacement and child deletion keep office boundaries and audits',async()=>{
 await select(admin,b)
 const results=await Promise.all([1,2].map(n=>call(list,admin,'POST',schedule('Concurrent west '+n,tb))))
 for(const result of results)await body(result)
 assert.equal((await root.query('SELECT count(*)::int n FROM "ShiftSchedule" WHERE "tenantId"=$1 AND "officeId"=$2 AND "isDefault"',[t,b])).rows[0].n,1)
 assert.equal((await root.query('SELECT "isDefault" FROM "ShiftSchedule" WHERE id=$1',[da.id])).rows[0].isDefault,true)
 const spare=(await body(await call(list,admin))).items.find(s=>s.name==='Concurrent west 1')
 await body(await call(record,admin,'DELETE',undefined,spare.id))
 assert.equal((await root.query('SELECT count(*)::int n FROM "ShiftScheduleBlock" WHERE "scheduleId"=$1',[spare.id])).rows[0].n,0)
 assert.equal(await scoped(ma,()=>prisma.auditLog.count({where:{tenantId:t,entityType:'shiftSchedules',entityId:spare.id}})),0)
})

test('hidden assignment overlap rejects the whole save without disclosing source details',async()=>{
 await root.query('INSERT INTO "StaffWorkplacePolicy"("tenantId","staffProfileId",version,"updatedAt") VALUES($1,$2,1,now())',[t,pu])
 await root.query('INSERT INTO "StaffWorkplaceAssignment"(id,"tenantId","staffProfileId","officeId","updatedAt") VALUES($2,$1,$2,$3,now())',[t,pu,a])
 const hidden=t+'_hidden_assignment'
 // Deliberately inconsistent privileged fixture: the ordinary writer must not
 // miss an overlap merely because the existing source belongs to another office.
 await root.query('INSERT INTO "StaffScheduleAssignment"(id,"scheduleId","staffProfileId","startDate","endDate","updatedAt") VALUES($1,$2,$3,\'2036-02-01\',\'2036-02-20\',now())',[hidden,db.id,pu])
 const result=await body(await call(list,ma,'POST',schedule('Overlap attempt',ta,{isDefault:false,staffIds:[unplaced],startDate:'2036-02-01',assignmentStartDate:'2036-02-01',assignmentEndDate:'2036-02-20'})),409)
 assert.ok(!JSON.stringify(result).includes(hidden));assert.ok(!JSON.stringify(result).includes(db.id))
 assert.equal((await root.query('SELECT count(*)::int n FROM "ShiftSchedule" WHERE "tenantId"=$1 AND name=\'Overlap attempt\'',[t])).rows[0].n,0)
 await root.query('DELETE FROM "StaffScheduleAssignment" WHERE id=$1',[hidden])
})

test('required audit failure restores source blocks, office defaults and frozen history atomically',async()=>{
 const capture=async()=>(await root.query('SELECT (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM "ShiftSchedule" s WHERE "tenantId"=$1) schedules,(SELECT jsonb_agg(to_jsonb(b) ORDER BY b.id) FROM "ShiftScheduleBlock" b JOIN "ShiftSchedule" s ON s.id=b."scheduleId" WHERE s."tenantId"=$1) blocks,(SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM "StaffRosterHistoryDay" h WHERE "tenantId"=$1) history',[t])).rows[0]
 const before=await capture()
 await root.query(`CREATE FUNCTION app.test_schedule_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."tenantId"='${t}' AND NEW.event='workforce.shiftSchedules.create' THEN RAISE EXCEPTION 'Private audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_schedule_audit_failure BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION app.test_schedule_audit_failure()`)
 try{await select(admin,a);const result=await body(await call(list,admin,'POST',schedule('Audit failure',ta)),500);assert.ok(!JSON.stringify(result).includes('Private audit failure'));assert.deepEqual(await capture(),before)}finally{await root.query('DROP TRIGGER test_schedule_audit_failure ON "AuditLog";DROP FUNCTION app.test_schedule_audit_failure()')}
})

test('editing a saved past rotation anchor preserves that anchor and frozen history',async()=>{
 const before=(await root.query('SELECT * FROM "StaffRosterHistoryDay" WHERE "staffProfileId"=$1 AND date=\'2020-01-06\'',[p])).rows[0]
 await body(await call(record,ma,'PATCH',schedule('Historical east default',ta,{startDate:'2020-01-01',assignmentStartDate:'2020-01-01'}),da.id))
 assert.equal((await root.query('SELECT "startDate"::text d FROM "ShiftSchedule" WHERE id=$1',[da.id])).rows[0].d,'2020-01-01')
 await body(await call(record,ma,'PATCH',schedule('Invalid anchor change',ta,{startDate:'2019-01-01'}),da.id),400)
 assert.deepEqual((await root.query('SELECT * FROM "StaffRosterHistoryDay" WHERE id=$1',[before.id])).rows[0],before)
})
