/* eslint-disable @typescript-eslint/no-require-imports */
process.env.TZ='UTC'
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Client}=require('pg'),{AsyncLocalStorage}=require('node:async_hooks')
const raw=process.env.CRM_TEST_DATABASE_URL,url=new URL(raw||'http://invalid');if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!='/ls_salon_crm_test')throw Error('Disposable local database only.')
const root=new Client({connectionString:raw}),sessions=new AsyncLocalStorage();url.username='crm_test_runtime';url.password='';process.env.DATABASE_URL=url.toString()
const authPath=require.resolve('../auth.ts');require.cache[authPath]={id:authPath,filename:authPath,loaded:true,exports:{auth:async()=>{await Promise.resolve();return sessions.getStore()||null}}}
const errors=[];require('../lib/logger.ts').logger.info=()=>{};require('../lib/logger.ts').logger.error=(_,c)=>errors.push(c.error?.message)
const {prisma,runWithTenantDbContext}=require('../lib/prisma.ts'),{runWithDatabaseActor}=require('../lib/database-actor.ts'),{createOfficeAccessService}=require('../platform/companies/office-access.ts'),{defaultRecordRules,supportedScopes}=require('../platform/access/rules.ts'),{allPermissions}=require('../platform/access/catalog.ts')
const {loadWorkingTime}=require('../modules/workforce/working-time.ts')
const week=require('../app/api/shifts/flexible-week-plans/route.ts'),pattern=require('../app/api/shifts/flexible-patterns/route.ts'),list=require('../app/api/shifts/flexible-patterns/list/route.ts'),detail=require('../app/api/shifts/flexible-patterns/[id]/route.ts'),clone=require('../app/api/shifts/flexible-patterns/[id]/clone/route.ts'),deactivate=require('../app/api/shifts/flexible-patterns/[id]/deactivate/route.ts'),preview=require('../app/api/shifts/flexible-patterns/impact-preview/route.ts'),workplaces=require('../app/api/shifts/workplaces/route.ts'),history=require('../app/api/shifts/history/route.ts')
const t='flex_offices_'+randomUUID().replaceAll('-',''),admin=t+'_admin',ma=t+'_ma',mb=t+'_mb',both=t+'_both',reader=t+'_reader',creator=t+'_creator',plain=t+'_plain',sa=t+'_sa',sb=t+'_sb',su=t+'_unplaced',pa=t+'_pa',pb=t+'_pb',pu=t+'_pu',role=t+'_role'
const scope=(u,fn)=>runWithTenantDbContext(t,()=>runWithDatabaseActor(u,async()=>await fn())),access=u=>createOfficeAccessService(prisma,{tenantId:t,userId:u}),context=u=>scope(u,()=>access(u).getOwnContext())
async function select(u,o){const c=await context(u);await scope(u,()=>access(u).selectCreationOffice({version:c.version,officeId:o}))}
async function call(endpoint,u=admin,method='GET',data,id,query='',captured){if(['PUT','POST'].includes(method)&&captured===undefined){const c=await context(u);captured=c.creationOffice?{id:c.creationOffice.id,version:c.version}:null}return sessions.run({user:{id:u,tenantId:t,role:u===admin?'ADMIN':[sa,sb,su].includes(u)?'STAFF':'MANAGER'}},()=>endpoint[method](new Request(`http://${t}.localhost/api/shifts/flexible-patterns${query}`,{method,headers:{host:t+'.localhost','content-type':'application/json',...(captured?{'x-office-id':captured.id,'x-office-version':String(captured.version)}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})}),{params:Promise.resolve({id})}))}
async function body(response,status=200){const data=await response.json();assert.equal(response.status,status,JSON.stringify({data,errors:errors.slice(-2)}));return data}
const days=(start='09:00',end='17:00')=>['MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY','SUNDAY'].map((day,i)=>({day,isOff:i>=5,slots:i>=5?[]:[{startTime:start,endTime:end,breaks:[{startTime:'15:00',endTime:'15:30'}]}]}))
const plan=(staff=sa,extra={})=>({staffId:staff,name:'Office plan',cycleLengthWeeks:1,validFrom:'2036-02-04',validTo:'2036-02-24',isActive:true,weeks:[{weekIndex:1,days:days()}],...extra})
let a,b,wa,ra,rb
before(async()=>{
 await root.connect();await root.query('INSERT INTO "Tenant"(id,name,slug,"updatedAt") VALUES($1,$1,$1,now())',[t]);a=(await root.query('SELECT id FROM "BusinessOffice" WHERE "tenantId"=$1 AND "isInitial"',[t])).rows[0].id;b=t+'_west'
 await root.query('INSERT INTO "BusinessOffice"(id,"tenantId","companyId",code,name,"updatedAt") SELECT $1,$2,"companyId",\'WEST\',\'West\',now() FROM "BusinessOffice" WHERE id=$3',[b,t,a])
 for(const [u,r]of[[admin,'ADMIN'],[ma,'MANAGER'],[mb,'MANAGER'],[both,'MANAGER'],[reader,'MANAGER'],[creator,'MANAGER'],[plain,'MANAGER'],[sa,'STAFF'],[sb,'STAFF'],[su,'STAFF']])await root.query('INSERT INTO "User"(id,"tenantId",email,role,"updatedAt") VALUES($1,$2,$3,$4,now())',[u,t,u+'@example.test',r])
 const rules=defaultRecordRules();for(const p of Object.keys(rules))if(supportedScopes(p.split('.')[0]).includes('ALL'))rules[p]='ALL'
 for(const [rid,perms]of[[role,allPermissions],[reader,['shiftPlans.read','shiftRoster.read']],[creator,['shiftPlans.read','shiftPlans.create']]])await root.query('INSERT INTO "TenantAccessRole"(id,"tenantId",name,"nameKey",permissions,"updatedAt") VALUES($1,$2,$1,$1,$3,now())',[rid,t,perms])
 for(const u of [ma,mb,both,reader,creator,sa,sb,su]){await root.query('INSERT INTO "TenantUserAccess"("tenantId","userId",rules,"updatedAt") VALUES($1,$2,$3,now())',[t,u,rules]);await root.query('INSERT INTO "TenantRoleAssignment"("tenantId","userId","roleId","updatedAt") VALUES($1,$2,$3,now())',[t,u,[reader,creator].includes(u)?u:role])}
 for(const [u,offices]of[[admin,[a,b]],[ma,[a]],[mb,[b]],[both,[a,b]],[reader,[a]],[creator,[a]],[plain,[a]],[sa,[a,b]],[sb,[b]],[su,[a,b]]]){await root.query('INSERT INTO "BusinessOfficePolicy"("tenantId","userId","creationOfficeId","updatedAt") VALUES($1,$2,$3,now())',[t,u,offices[0]]);for(const o of offices)await root.query('INSERT INTO "BusinessOfficeGrant"("tenantId","userId","officeId") VALUES($1,$2,$3)',[t,u,o])}
 for(const key of ['shifts','appointments','leaves'])await root.query('INSERT INTO "TenantModule"("tenantId",key,allowed,enabled,"updatedAt") VALUES($1,$2,true,true,now())',[t,key])
 await root.query('INSERT INTO "AppSetting"(id,"tenantId","timeZone","updatedAt") VALUES($1,$1,\'UTC\',now())',[t])
 for(const [p,u]of[[pa,sa],[pb,sb],[pu,su]])await root.query('INSERT INTO "StaffProfile"(id,"userId","schedulingMode","updatedAt") VALUES($1,$2,\'FLEXIBLE\',now())',[p,u])
 for(const [p,o]of[[pa,a],[pb,b]]){await root.query('INSERT INTO "StaffWorkplacePolicy"("tenantId","staffProfileId",version,"updatedAt") VALUES($1,$2,1,now())',[t,p]);await root.query('INSERT INTO "StaffWorkplaceAssignment"(id,"tenantId","staffProfileId","officeId","updatedAt") VALUES($1,$2,$1,$3,now())',[p,t,o])}
})
after(async()=>{await root.end();await Promise.all([global.prisma,global.prismaBypassClient,...[...(global.prismaScopedClientCache?.values()||[])].map(e=>e.client)].filter(Boolean).map(c=>c.$disconnect()));await global.prismaPool?.end()})

test('native plan suite has no implicit office fixtures; missing creation snapshots fail closed',async()=>{
 assert.equal((await root.query("SELECT count(*)::int n FROM pg_trigger WHERE tgname='aaa_test_flexible_office_fixture'")).rows[0].n,0)
 await body(await call(pattern,admin,'PUT',plan(),undefined,'',null),403)
 await body(await call(week,admin,'PUT',{staffId:sa,weekStartDate:'2036-02-04',days:days()},undefined,'',null),403)
})
test('weekly and recurring roots and nested rows inherit captured tenant/office ownership',async()=>{
 wa=(await body(await call(week,admin,'PUT',{staffId:sa,weekStartDate:'2036-02-04',days:days()}))).item
 ra=(await body(await call(pattern,admin,'PUT',plan()))).item;await select(admin,b);rb=(await body(await call(pattern,admin,'PUT',plan(sb,{name:'West plan'})))).item
 assert.equal(wa.officeId,a);assert.equal(ra.officeId,a);assert.equal(rb.officeId,b);assert.equal(ra.office.id,a)
 assert.equal((await body(await call(list,ma))).total,1);assert.equal((await body(await call(list,mb))).items[0].id,rb.id)
 assert.equal(await scope(mb,()=>prisma.staffFlexibleWeekSlot.count({where:{day:{planId:wa.id}}})),0)
 assert.equal(await scope(mb,()=>prisma.staffFlexiblePatternBreak.count({where:{slot:{day:{week:{patternId:ra.id}}}}})),0)
 await body(await call(detail,mb,'GET',undefined,ra.id),404)
})
test('office grants alone and Read-only profiles cannot create, edit or archive plans',async()=>{
 await body(await call(list,plain),403);assert.equal(await scope(plain,()=>prisma.staffFlexiblePattern.count({where:{tenantId:t}})),0)
 await body(await call(pattern,reader,'PUT',plan(sa,{patternId:ra.id})),403)
 await body(await call(deactivate,reader,'POST',{},ra.id),403)
 await body(await call(week,reader,'DELETE',{staffId:sa,weekStartDate:'2036-02-04'}),403)
 await assert.rejects(scope(reader,()=>prisma.$transaction(async tx=>{
  await tx.$executeRaw`SELECT set_config('app.workforce_operation','shiftPlans.read',true)`
  await tx.staffFlexiblePatternDay.updateMany({where:{week:{patternId:ra.id}},data:{isOff:true}})
 })))
 await root.query('UPDATE "TenantModule" SET enabled=false WHERE "tenantId"=$1 AND key=\'shifts\'',[t])
 try{
  await body(await call(list,ma),403)
  assert.equal(await scope(ma,()=>prisma.staffFlexiblePattern.count({where:{id:ra.id}})),0)
  assert.equal(await scope(ma,()=>prisma.staffFlexibleWeekSlot.count({where:{day:{planId:wa.id}}})),0)
  assert.equal(await scope(ma,()=>prisma.auditLog.count({where:{tenantId:t,entityType:'shiftPlans'}})),0)
 }finally{await root.query('UPDATE "TenantModule" SET enabled=true WHERE "tenantId"=$1 AND key=\'shifts\'',[t])}
})
test('stale captured offices reject weekly/recurring creates and clones without rerouting',async()=>{
 const captured=await context(admin);await select(admin,a)
 const old={id:b,version:captured.version}
 await body(await call(pattern,admin,'PUT',plan(sb,{name:'Stale'}),undefined,'',old),409)
 await body(await call(week,admin,'PUT',{staffId:sb,weekStartDate:'2036-03-03',days:days()},undefined,'',old),409)
 await body(await call(clone,admin,'POST',{targetStaffId:sb,validFrom:'2037-01-05',validTo:'2037-01-11',activate:true},ra.id,'',old),409)
 assert.equal((await root.query('SELECT count(*)::int n FROM "StaffFlexiblePattern" WHERE "tenantId"=$1',[t])).rows[0].n,2)
})
test('new plan windows require full workplace coverage and reject unplaced or different-office staff',async()=>{
 await body(await call(pattern,admin,'PUT',plan(su)),400)
 await body(await call(pattern,admin,'PUT',plan(sb)),400)
 await body(await call(workplaces,admin,'POST',{action:'assign',staffId:sa,version:1,fromId:pa,officeId:b,startsOn:'2036-03-01'}))
 await body(await call(pattern,admin,'PUT',plan(sa,{validFrom:'2036-02-25',validTo:'2036-03-10'})),400)
 await body(await call(week,admin,'PUT',{staffId:sa,weekStartDate:'2036-02-25',days:days()}),400)
})
test('saved identities cannot be moved between staff, offices or parents',async()=>{
 await assert.rejects(scope(ma,()=>prisma.staffFlexiblePattern.updateMany({where:{id:ra.id},data:{officeId:b}})))
 const source=(await root.query('SELECT id FROM "StaffFlexiblePatternWeek" WHERE "patternId"=$1',[ra.id])).rows[0].id
 await assert.rejects(scope(ma,()=>prisma.staffFlexiblePatternWeek.updateMany({where:{id:source},data:{patternId:rb.id}})))
})
test('cross-office cloning creates a new destination record without source-office audit leakage',async()=>{
 await select(both,b)
 const id=(await body(await call(clone,both,'POST',{targetStaffId:sb,validFrom:'2037-01-05',validTo:'2037-01-11',name:'Destination copy',activate:true},ra.id))).id
 const saved=(await body(await call(detail,mb,'GET',undefined,id))).item;assert.equal(saved.officeId,b)
 const audit=await scope(mb,()=>prisma.auditLog.findFirst({where:{tenantId:t,entityType:'shiftPlans',entityId:id}}))
 assert.equal(audit.before,null);assert.equal(audit.metadata.officeId,b);assert.ok(!JSON.stringify(audit).includes(ra.id));assert.ok(!JSON.stringify(audit).includes(sa))
 assert.equal(await scope(ma,()=>prisma.auditLog.count({where:{tenantId:t,entityType:'shiftPlans',entityId:id}})),0)
 const source=await scope(ma,()=>prisma.auditLog.findFirst({where:{tenantId:t,event:'workforce.shiftPlans.clone_source',entityId:ra.id}}))
 assert.equal(source.requestId,audit.requestId);assert.equal(source.metadata.officeId,a);assert.ok(!JSON.stringify(source).includes(id))
 assert.equal(await scope(mb,()=>prisma.auditLog.count({where:{tenantId:t,event:'workforce.shiftPlans.clone_source',entityId:ra.id}})),0)
})
test('clone previews enforce captured destination and target coverage before returning counts',async()=>{
 const data={mode:'CLONE',patternId:ra.id,targetStaffId:sb,validFrom:'2037-01-05',validTo:'2037-01-11',activate:true}
 await body(await call(preview,ma,'POST',data),400)
 await body(await call(preview,both,'POST',data),200)
 await body(await call(preview,mb,'POST',data),404)
})
test('Create-only profiles can add children to their new pattern without gaining Edit',async()=>{
 const saved=(await body(await call(pattern,creator,'PUT',plan(sa,{name:'Create only',validFrom:'2035-01-08',validTo:'2035-01-14'})))).item
 assert.equal(saved.weeks[0].days.length,7)
 const draft=(await body(await call(clone,creator,'POST',{validFrom:'2035-01-08',validTo:'2035-01-14',activate:false},saved.id))).id
 assert.equal((await body(await call(detail,creator,'GET',undefined,draft))).item.isActive,false)
 await body(await call(pattern,creator,'PUT',plan(sa,{patternId:saved.id,validFrom:'2035-01-08',validTo:'2035-01-14'})),403)
})
test('hidden cross-office overlaps reject the whole save with an opaque conflict',async()=>{
 const hidden=t+'_hidden_overlap';await root.query('INSERT INTO "StaffFlexiblePattern"(id,"tenantId","officeId","staffProfileId","validFrom","validTo","updatedAt") VALUES($1,$2,$3,$4,\'2036-01-25\',\'2036-02-03\',now())',[hidden,t,b,pa])
 try{const result=await body(await call(pattern,ma,'PUT',plan(sa,{name:'Overlap attempt',validFrom:'2036-01-26',validTo:'2036-02-03'})),409);assert.ok(!JSON.stringify(result).includes(hidden));assert.equal((await root.query('SELECT count(*)::int n FROM "StaffFlexiblePattern" WHERE "tenantId"=$1 AND name=\'Overlap attempt\'',[t])).rows[0].n,0)}finally{await root.query('DELETE FROM "StaffFlexiblePattern" WHERE id=$1',[hidden])}
})
test('office-scoped source hiding cannot erase effective hours for booking consumers',async()=>{
 const resolve=await scope(mb,()=>loadWorkingTime(prisma,t,[pa],new Date('2036-02-04'),new Date('2036-02-04')))
 assert.deepEqual(resolve(pa,new Date('2036-02-04')).segments,[{start:540,end:900},{start:930,end:1020}])
 assert.equal(await scope(mb,()=>prisma.staffFlexibleWeekPlan.count({where:{id:wa.id}})),0)
})
test('closed offices keep source Read while rejecting writes',async()=>{
 await root.query('UPDATE "BusinessOffice" SET archived=true WHERE id=$1',[b])
 try{assert.equal((await body(await call(detail,mb,'GET',undefined,rb.id))).item.office.active,false);await body(await call(pattern,mb,'PUT',plan(sb,{patternId:rb.id})),403);await body(await call(deactivate,mb,'POST',{},rb.id),403)}finally{await root.query('UPDATE "BusinessOffice" SET archived=false WHERE id=$1',[b])}
})
test('unchanged edits retain source IDs and past anchors after employee office grant revocation',async()=>{
 await root.query('DELETE FROM "BusinessOfficeGrant" WHERE "userId"=$1 AND "officeId"=$2',[sa,a])
 await body(await call(pattern,ma,'PUT',plan(sa,{patternId:ra.id,name:'Renamed east'})))
 const saved=(await root.query('SELECT "officeId","validFrom"::text first FROM "StaffFlexiblePattern" WHERE id=$1',[ra.id])).rows[0];assert.equal(saved.officeId,a);assert.equal(saved.first,'2036-02-04')
 await body(await call(week,ma,'PUT',{staffId:sa,weekStartDate:'2036-02-04',days:days()}));assert.equal((await root.query('SELECT id FROM "StaffFlexibleWeekPlan" WHERE "staffProfileId"=$1',[pa])).rows[0].id,wa.id)
})
test('canonical historic capture follows source office while self history survives grant revocation',async()=>{
 await root.query('UPDATE "StaffFlexiblePattern" SET "validFrom"=\'2020-01-06\' WHERE id=$1',[ra.id])
 const data=(await body(await call(history,ma,'GET',undefined,undefined,`?staffIds=${sa}&startDate=2020-01-06&endDate=2020-01-06`))).items[0]
 assert.equal(data.paidMinutes,450)
 assert.deepEqual((await body(await call(history,mb,'GET',undefined,undefined,`?staffIds=${sa}&startDate=2020-01-06&endDate=2020-01-06`))).items,[])
 assert.equal((await body(await call(history,sa,'GET',undefined,undefined,`?staffIds=${sa}&startDate=2020-01-06&endDate=2020-01-06`))).items[0].paidMinutes,450)
})
test('weekly delete cascades and audit copies retain their office boundaries',async()=>{
 await body(await call(week,mb,'DELETE',{staffId:sa,weekStartDate:'2036-02-04'}))
 assert.equal((await root.query('SELECT count(*)::int n FROM "StaffFlexibleWeekPlan" WHERE id=$1',[wa.id])).rows[0].n,1)
 await body(await call(week,ma,'DELETE',{staffId:sa,weekStartDate:'2036-02-04'}))
 assert.equal((await root.query('SELECT count(*)::int n FROM "StaffFlexibleWeekDay" WHERE "planId"=$1',[wa.id])).rows[0].n,0)
 assert.equal(await scope(mb,()=>prisma.auditLog.count({where:{tenantId:t,entityType:'shiftRoster',entityId:wa.id}})),0)
 assert.ok(await scope(ma,()=>prisma.auditLog.count({where:{tenantId:t,entityType:'shiftRoster',entityId:wa.id}}))>0)
})
test('required audit failure restores recurring records, child rows and history atomically',async()=>{
 const before=(await root.query('SELECT to_jsonb(p) data FROM "StaffFlexiblePattern" p WHERE id=$1',[rb.id])).rows[0].data
 await root.query(`CREATE FUNCTION app.test_flexible_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."entityId"='${rb.id}' THEN RAISE EXCEPTION 'Private audit detail'; END IF; RETURN NEW; END $$;CREATE TRIGGER test_flexible_audit_failure BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION app.test_flexible_audit_failure()`)
 try{await body(await call(pattern,mb,'PUT',plan(sb,{patternId:rb.id,name:'Audit failure'})),500);assert.deepEqual((await root.query('SELECT to_jsonb(p) data FROM "StaffFlexiblePattern" p WHERE id=$1',[rb.id])).rows[0].data,before)}finally{await root.query('DROP TRIGGER test_flexible_audit_failure ON "AuditLog";DROP FUNCTION app.test_flexible_audit_failure()')}
})
