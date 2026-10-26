/* eslint-disable @typescript-eslint/no-require-imports */
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Client}=require('pg'),{AsyncLocalStorage}=require('node:async_hooks')
const raw=process.env.CRM_TEST_DATABASE_URL,url=new URL(raw||'http://invalid');if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!='/ls_salon_crm_test')throw Error('Disposable local database only.')
const root=new Client({connectionString:raw}),sessions=new AsyncLocalStorage();url.username='crm_test_runtime';url.password='';process.env.DATABASE_URL=url.toString()
const authPath=require.resolve('../auth.ts');require.cache[authPath]={id:authPath,filename:authPath,loaded:true,exports:{auth:async()=>sessions.getStore()||null}}
const errors=[];require('../lib/logger.ts').logger.info=()=>{};require('../lib/logger.ts').logger.error=(_,c)=>errors.push(c.error?.message)
const {prisma,runWithTenantDbContext}=require('../lib/prisma.ts'),{runWithDatabaseActor}=require('../lib/database-actor.ts'),{defaultRecordRules,supportedScopes}=require('../platform/access/rules.ts')
const api=require('../app/api/shifts/staff-choices/route.ts'),directory=require('../app/api/directory/route.ts')
const t='choices_'+randomUUID().replaceAll('-',''),other=t+'_other',actor=t+'_manager',reader=t+'_reader',plain=t+'_plain',role=t+'_role',readRole=t+'_read',source=t+'_source',pattern=t+'_pattern'
let a,b
const u=name=>t+'_'+name,p=name=>u(name)+'_profile'
async function call(extra={},user=actor,headers=true,endpoint=api){const query={family:'SCHEDULE',action:'create',startDate:'2036-02-04',endDate:'2036-02-05',...extra};return sessions.run({user:{id:user,tenantId:t,role:'MANAGER'}},()=>endpoint.GET(new Request('http://'+t+'.localhost/api/shifts/staff-choices?'+new URLSearchParams(Object.entries(query).filter(([,v])=>v!==undefined&&v!=="")),{headers:{host:t+'.localhost',...(headers?{'x-office-id':a,'x-office-version':'5'}:{})}})))}
async function body(r,status=200){const data=await r.json();assert.equal(r.status,status,JSON.stringify({data,errors:errors.slice(-2)}));return data}
before(async()=>{
 await root.connect();for(const tenant of [t,other])await root.query('INSERT INTO "Tenant"(id,name,slug,"updatedAt") VALUES($1,$1,$1,now())',[tenant]);const initial=(await root.query('SELECT id FROM "BusinessOffice" WHERE "tenantId"=$1 AND "isInitial"',[t])).rows[0].id;a=t+'_east';b=t+'_west';await root.query('INSERT INTO "BusinessOffice"(id,"tenantId","companyId",code,name,"updatedAt") SELECT $1,$2,"companyId",\'EAST\',\'East\',now() FROM "BusinessOffice" WHERE id=$3',[a,t,initial])
 await root.query('INSERT INTO "BusinessOffice"(id,"tenantId","companyId",code,name,"updatedAt") SELECT $1,$2,"companyId",\'WEST\',\'West\',now() FROM "BusinessOffice" WHERE id=$3',[b,t,a])
 const rules=defaultRecordRules();for(const permission of Object.keys(rules))if(supportedScopes(permission.split('.')[0]).includes('ALL'))rules[permission]='ALL'
 for(const [id,permissions]of[[role,['shiftSchedules.read','shiftSchedules.create','shiftSchedules.edit','shiftPlans.read','shiftPlans.create','shiftPlans.edit']],[readRole,['shiftSchedules.read','shiftPlans.read']]])await root.query('INSERT INTO "TenantAccessRole"(id,"tenantId",name,"nameKey",permissions,"updatedAt") VALUES($1,$2,$1,$1,$3,now())',[id,t,permissions])
 for(const id of [actor,reader,plain]){await root.query('INSERT INTO "User"(id,"tenantId",email,role,"updatedAt") VALUES($1,$2,$1||\'@example.test\',\'MANAGER\',now())',[id,t]);await root.query('INSERT INTO "BusinessOfficePolicy"("tenantId","userId","creationOfficeId",version,"updatedAt") VALUES($1,$2,$3,5,now())',[t,id,a]);await root.query('INSERT INTO "BusinessOfficeGrant"("tenantId","userId","officeId") VALUES($1,$2,$3)',[t,id,a]);if(id!==plain){await root.query('INSERT INTO "TenantUserAccess"("tenantId","userId",rules,"updatedAt") VALUES($1,$2,$3,now())',[t,id,rules]);await root.query('INSERT INTO "TenantRoleAssignment"("tenantId","userId","roleId","updatedAt") VALUES($1,$2,$3,now())',[t,id,id===reader?readRole:role])}}
 for(const [name,mode,office,end]of[['East','STANDARD',a,null],['West','STANDARD',b,null],['Transfer','STANDARD',a,'2036-02-04'],['Flexible','FLEXIBLE',a,null],['Unplaced','STANDARD',null,null],['Saved','STANDARD',b,null]]){
  await root.query('INSERT INTO "User"(id,"tenantId",name,email,role,"updatedAt") VALUES($1,$2,$3,$4,\'STAFF\',now())',[u(name),t,name,name+'@example.test']);await root.query('INSERT INTO "StaffProfile"(id,"userId","schedulingMode","updatedAt") VALUES($1,$2,$3,now())',[p(name),u(name),mode]);await root.query('INSERT INTO "StaffWorkplacePolicy"("tenantId","staffProfileId",version,"updatedAt") VALUES($1,$2,1,now())',[t,p(name)]);
  if(office){await root.query('INSERT INTO "BusinessOfficePolicy"("tenantId","userId","creationOfficeId","updatedAt") VALUES($1,$2,$3,now())',[t,u(name),office]);await root.query('INSERT INTO "BusinessOfficeGrant"("tenantId","userId","officeId") VALUES($1,$2,$3)',[t,u(name),office]);await root.query('INSERT INTO "StaffWorkplaceAssignment"(id,"tenantId","staffProfileId","officeId","endDate","updatedAt") VALUES($2,$1,$2,$3,$4,now())',[t,p(name),office,end])}
 }
 for(const [id,office]of[[source,a],[source+'_hidden',b]])await root.query('INSERT INTO "ShiftSchedule"(id,"tenantId","officeId","startDate","weekOffDay1","weekOff2Weeks","updatedAt") VALUES($1,$2,$3,\'2036-02-04\',\'SUNDAY\',ARRAY[]::integer[],now())',[id,t,office])
 for(const [id,profile,schedule]of[[source,p('Saved'),source],[source+'_hidden',p('West'),source+'_hidden']])await root.query('INSERT INTO "StaffScheduleAssignment"(id,"staffProfileId","scheduleId","startDate","updatedAt") VALUES($1,$2,$3,\'2036-02-04\',now())',[id,profile,schedule])
 await root.query('INSERT INTO "StaffFlexiblePattern"(id,"tenantId","officeId","staffProfileId","validFrom","updatedAt") VALUES($1,$2,$3,$4,\'2036-02-04\',now())',[pattern,t,a,p('Flexible')]);await root.query('INSERT INTO "TenantModule"("tenantId",key,allowed,enabled,"updatedAt") VALUES($1,\'shifts\',true,true,now())',[t]);
})
after(async()=>{await root.end();await Promise.all([global.prisma,global.prismaBypassClient,...[...(global.prismaScopedClientCache?.values()||[])].map(e=>e.client)].filter(Boolean).map(c=>c.$disconnect()));await global.prismaPool?.end()})
test('choices require a profile, mode, office grant and full-window workplace coverage',async()=>{
 const data=await body(await call());assert.deepEqual(data.items.map(x=>x.name),['East']);assert.equal(data.total,1);assert.equal(data.items[0].eligible,true)
 const short=await body(await call({endDate:'2036-02-04'}));assert.deepEqual(short.items.map(x=>x.name),['East','Transfer'])
 const open=await body(await call({endDate:''}));assert.equal(open.total,1)
 assert.deepEqual((await body(await call({family:'PATTERN'}))).items.map(x=>x.name),['Flexible'])
})
test('read-only filters are derived from permitted source records, including former staff',async()=>{
 const data=await body(await call({action:'browse'},reader,false));assert.deepEqual(data.items.map(x=>x.name),['Saved']);assert.equal((await body(await call({action:'browse',family:'PATTERN'},reader,false))).items[0].name,'Flexible')
 await body(await call({},reader),403);await body(await call({},plain),403)
})
test('edit choices retain saved assignees without certifying new eligibility or using workspace office',async()=>{
 await root.query('UPDATE "User" SET status=\'ARCHIVED\' WHERE id=$1',[u('Saved')]);try{const data=await body(await call({action:'edit',sourceId:source,selected:u('Saved')},actor,false));assert.equal(data.selected[0].name,'Saved');assert.equal(data.selected[0].eligible,false);assert.equal(data.selected[0].retained,true);assert.equal(data.items.some(x=>x.name==='West'),false)}finally{await root.query('UPDATE "User" SET status=\'ACTIVE\' WHERE id=$1',[u('Saved')])}
})
test('unknown/hidden source and arbitrary selected IDs reveal no unrelated staff',async()=>{
 for(const sourceId of [source+'_hidden','missing',other])await body(await call({action:'edit',sourceId},actor,false),404)
 const data=await body(await call({selected:[u('West'),u('Unplaced'),other].join(',')}));assert.deepEqual(data.selected,[])
})
test('create choices require the captured office/version and reject stale preference changes',async()=>{
 await body(await call({},actor,false),403);await root.query('UPDATE "BusinessOfficePolicy" SET version=6 WHERE "tenantId"=$1 AND "userId"=$2',[t,actor]);try{await body(await call(),409);await body(await call({action:'edit',sourceId:source},actor,false))}finally{await root.query('UPDATE "BusinessOfficePolicy" SET version=5 WHERE "tenantId"=$1 AND "userId"=$2',[t,actor])}
})
test('closed office keeps browse history but rejects new/edit choices',async()=>{
 await root.query('UPDATE "BusinessOffice" SET archived=true WHERE id=$1',[a]);try{await body(await call(),403);await body(await call({action:'edit',sourceId:source},actor,false),403);assert.equal((await body(await call({action:'browse'},actor,false))).total,1)}finally{await root.query('UPDATE "BusinessOffice" SET archived=false WHERE id=$1',[a])}
})
test('authorization, module and office revocation are fresh; shifts do not delegate the generic directory',async()=>{
 await body(await sessions.run({user:{id:actor,tenantId:t,role:'MANAGER'}},()=>directory.GET(new Request('http://'+t+'.localhost/api/directory?role=STAFF',{headers:{host:t+'.localhost'}}))),403)
 await root.query('UPDATE "TenantModule" SET enabled=false WHERE "tenantId"=$1',[t]);try{await body(await call(),403)}finally{await root.query('UPDATE "TenantModule" SET enabled=true WHERE "tenantId"=$1',[t])}
 await root.query('DELETE FROM "BusinessOfficeGrant" WHERE "tenantId"=$1 AND "userId"=$2',[t,actor]);try{await body(await call(),403);assert.equal((await body(await call({action:'browse'},actor,false))).total,0)}finally{await root.query('INSERT INTO "BusinessOfficeGrant"("tenantId","userId","officeId") VALUES($1,$2,$3)',[t,actor,a])}
})
test('native function rejects invalid paging, dates, family and foreign tenant before disclosure',async()=>{
 for(const query of [{pageSize:'101'},{endDate:'2036-02-03'},{q:'x'.repeat(161)},{family:'UNKNOWN'},{action:'edit'},{selected:Array(101).fill('a').join(',')}])await body(await call(query),400)
 await assert.rejects(runWithTenantDbContext(t,()=>runWithDatabaseActor(actor,()=>prisma.$queryRaw`SELECT app.workforce_staff_choices(${other},'SCHEDULE','browse',NULL,NULL,NULL,ARRAY[]::text[],'',20,0)`)))
})
test('search, selected labels and paging cover more than 100 eligible staff without truncation',async()=>{
 await root.query('INSERT INTO "User"(id,"tenantId",name,email,role,"updatedAt") SELECT $1||n,$2,\'Paging \'||lpad(n::text,3,\'0\'),$1||n||\'@example.test\',\'STAFF\',now() FROM generate_series(1,107)n',[u('page'),t]);await root.query('INSERT INTO "StaffProfile"(id,"userId","schedulingMode","updatedAt") SELECT id,id,\'STANDARD\',now() FROM "User" WHERE "tenantId"=$1 AND name LIKE \'Paging %\'',[t]);
 await root.query('INSERT INTO "BusinessOfficePolicy"("tenantId","userId","creationOfficeId","updatedAt") SELECT $1,id,$2,now() FROM "User" WHERE "tenantId"=$1 AND name LIKE \'Paging %\'',[t,a]);await root.query('INSERT INTO "BusinessOfficeGrant"("tenantId","userId","officeId") SELECT $1,id,$2 FROM "User" WHERE "tenantId"=$1 AND name LIKE \'Paging %\'',[t,a]);await root.query('INSERT INTO "StaffWorkplacePolicy"("tenantId","staffProfileId",version,"updatedAt") SELECT $1,id,1,now() FROM "User" WHERE "tenantId"=$1 AND name LIKE \'Paging %\'',[t]);await root.query('INSERT INTO "StaffWorkplaceAssignment"(id,"tenantId","staffProfileId","officeId","updatedAt") SELECT id,$1,id,$2,now() FROM "User" WHERE "tenantId"=$1 AND name LIKE \'Paging %\'',[t,a]);
 const first=await body(await call({q:'Paging',pageSize:'100'})),last=await body(await call({q:'Paging',pageSize:'100',page:'2'}));assert.equal(first.total,107);assert.equal(first.items.length,100);assert.equal(last.items.length,7);assert.equal(new Set([...first.items,...last.items].map(x=>x.id)).size,107)
 const search=await body(await call({q:'Paging 107',selected:u('page1')}));assert.equal(search.items.length,1);assert.equal(search.selected[0].name,'Paging 001')
 await root.query('UPDATE "StaffProfile" SET "schedulingMode"=\'FLEXIBLE\' WHERE id IN (SELECT id FROM "User" WHERE "tenantId"=$1 AND name LIKE \'Paging %\')',[t]);const flexible=await body(await call({family:'PATTERN',q:'Paging',pageSize:'100'}));assert.equal(flexible.total,107);assert.equal(flexible.items.length,100)
})
