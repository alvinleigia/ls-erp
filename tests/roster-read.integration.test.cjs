/* eslint-disable @typescript-eslint/no-require-imports */
process.env.TZ='UTC'
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Client}=require('pg'),{AsyncLocalStorage}=require('node:async_hooks')
const raw=process.env.CRM_TEST_DATABASE_URL,url=new URL(raw||'http://invalid');if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!='/ls_salon_crm_test')throw Error('Disposable local database only.')
const root=new Client({connectionString:raw}),sessions=new AsyncLocalStorage();url.username='crm_test_runtime';url.password='';process.env.DATABASE_URL=url.toString()
const authPath=require.resolve('../auth.ts');require.cache[authPath]={id:authPath,filename:authPath,loaded:true,exports:{auth:async()=>{await Promise.resolve();return sessions.getStore()||null}}}
const errors=[];require('../lib/logger.ts').logger.info=()=>{};require('../lib/logger.ts').logger.error=(_,c)=>errors.push(c.error?.message)
const {prisma,runWithTenantDbContext}=require('../lib/prisma.ts'),{runWithDatabaseActor}=require('../lib/database-actor.ts'),{defaultRecordRules,supportedScopes}=require('../platform/access/rules.ts')
const api=require('../app/api/shifts/roster/route.ts'),patterns=require('../app/api/shifts/flexible-patterns/list/route.ts')
const t='roster_'+randomUUID().replaceAll('-',''),other=t+'_foreign',admin=t+'_admin',ma=t+'_ma',mb=t+'_mb',plain=t+'_plain',sa=t+'_sa',sb=t+'_sb',st=t+'_transfer',sh=t+'_history',su=t+'_unplaced',pa=t+'_pa',pb=t+'_pb',pt=t+'_pt',ph=t+'_ph',pu=t+'_pu',pf=t+'_pf',role=t+'_role',secret=t+'_PRIVATE_CYCLE'
const scope=(u,fn)=>runWithTenantDbContext(t,()=>runWithDatabaseActor(u,async()=>await fn()))
async function call(u=ma,query='startDate=2036-02-04&endDate=2036-02-05',endpoint=api){return sessions.run({user:{id:u,tenantId:t,role:u===admin?'ADMIN':u===sh?'STAFF':'MANAGER'}},()=>endpoint.GET(new Request(`http://${t}.localhost/api/shifts/roster?${query}`,{headers:{host:t+'.localhost'}})))}
async function body(response,status=200){const data=await response.json();assert.equal(response.status,status,JSON.stringify({data,errors:errors.slice(-2)}));return data}
let a,b
before(async()=>{
 await root.connect();for(const tenant of [t,other])await root.query('INSERT INTO "Tenant"(id,name,slug,"updatedAt") VALUES($1,$1,$1,now())',[tenant]);a=(await root.query('SELECT id FROM "BusinessOffice" WHERE "tenantId"=$1 AND "isInitial"',[t])).rows[0].id;b=t+'_west'
 await root.query('INSERT INTO "BusinessOffice"(id,"tenantId","companyId",code,name,"updatedAt") SELECT $1,$2,"companyId",\'WEST\',\'West\',now() FROM "BusinessOffice" WHERE id=$3',[b,t,a])
 for(const [id,r,name,tenant]of[[admin,'ADMIN','Admin',t],[ma,'MANAGER','Manager A',t],[mb,'MANAGER','Manager B',t],[plain,'MANAGER','No profile',t],[sa,'STAFF','East worker',t],[sb,'STAFF','West worker',t],[st,'STAFF','Transfer worker',t],[sh,'STAFF','Historic worker',t],[su,'STAFF','Unplaced worker',t],[other+'_staff','STAFF','Foreign worker',other]])await root.query('INSERT INTO "User"(id,"tenantId",role,name,email,"updatedAt") VALUES($1,$2,$3,$4,$5,now())',[id,tenant,r,name,id+'@example.test'])
 const rules=defaultRecordRules();for(const p of Object.keys(rules))if(supportedScopes(p.split('.')[0]).includes('ALL'))rules[p]='ALL'
 await root.query('INSERT INTO "TenantAccessRole"(id,"tenantId",name,"nameKey",permissions,"updatedAt") VALUES($1,$2,$1,$1,$3,now())',[role,t,['shiftRoster.read']])
 for(const u of [ma,mb,sh]){await root.query('INSERT INTO "TenantUserAccess"("tenantId","userId",rules,"updatedAt") VALUES($1,$2,$3,now())',[t,u,rules]);await root.query('INSERT INTO "TenantRoleAssignment"("tenantId","userId","roleId","updatedAt") VALUES($1,$2,$3,now())',[t,u,role])}
 for(const [u,o]of[[ma,a],[mb,b],[plain,a],[admin,a]]){await root.query('INSERT INTO "BusinessOfficePolicy"("tenantId","userId","creationOfficeId","updatedAt") VALUES($1,$2,$3,now())',[t,u,o]);await root.query('INSERT INTO "BusinessOfficeGrant"("tenantId","userId","officeId") VALUES($1,$2,$3)',[t,u,o])}
 for(const [p,u]of[[pa,sa],[pb,sb],[pt,st],[ph,sh],[pu,su],[pf,other+'_staff']])await root.query('INSERT INTO "StaffProfile"(id,"userId","schedulingMode","updatedAt") VALUES($1,$2,\'FLEXIBLE\',now())',[p,u])
 await root.query('INSERT INTO "StaffWorkplacePolicy"("tenantId","staffProfileId",version,"updatedAt") SELECT $1,p.id,1,now() FROM "StaffProfile" p JOIN "User" u ON u.id=p."userId" WHERE u."tenantId"=$1',[t])
 for(const [p,o,start,end]of[[pa,a,null,null],[pb,b,null,null],[pt,a,null,'2036-02-04'],[pt,b,'2036-02-05',null],[ph,b,null,null]])await root.query('INSERT INTO "StaffWorkplaceAssignment"(id,"tenantId","staffProfileId","officeId","startDate","endDate","updatedAt") VALUES($1,$2,$3,$4,$5,$6,now())',[p+o,t,p,o,start,end])
 for(const key of ['shifts','leaves'])await root.query('INSERT INTO "TenantModule"("tenantId",key,allowed,enabled,"updatedAt") VALUES($1,$2,true,true,now())',[t,key])
 await root.query('INSERT INTO "AppSetting"(id,"tenantId","timeZone","updatedAt") VALUES($1,$1,\'UTC\',now())',[t])
 await root.query('INSERT INTO "StaffFlexiblePattern"(id,"tenantId","officeId","staffProfileId",name,"validFrom","validTo","updatedAt") VALUES($1,$2,$3,$4,$1,\'2036-02-04\',\'2036-02-10\',now())',[secret,t,a,pa])
 await root.query('INSERT INTO "StaffFlexiblePatternWeek"(id,"patternId","weekIndex","updatedAt") VALUES($1,$1,1,now())',[secret]);await root.query('INSERT INTO "StaffFlexiblePatternDay"(id,"weekId",day,"updatedAt") VALUES($1,$1,\'MONDAY\',now())',[secret]);await root.query('INSERT INTO "StaffFlexiblePatternSlot"(id,"dayId","startTime","endTime","updatedAt") VALUES($1,$1,\'09:00\',\'17:00\',now())',[secret]);await root.query('INSERT INTO "StaffFlexiblePatternBreak"(id,"slotId","startTime","endTime","updatedAt") VALUES($1,$1,\'12:00\',\'13:00\',now())',[secret])
 for(const [id,p,o,date,start,end]of[[pt+'_a',pt,a,'2036-02-04','08:00','16:00'],[pt+'_b',pt,b,'2036-02-05','14:00','22:00'],[pb,pb,b,'2036-02-04','10:00','18:00']])await root.query('INSERT INTO "StaffFlexibleAvailability"(id,"tenantId","officeId","staffProfileId",date,"startTime","endTime","updatedAt") VALUES($1,$2,$3,$4,$5,$6,$7,now())',[id,t,o,p,date,start,end])
 await root.query('INSERT INTO "StaffRosterHistoryDay"(id,"tenantId","officeId","staffProfileId",date,source,"templateName","startTime","endTime","paidMinutes","updatedAt") VALUES($1,$2,$3,$4,\'2020-01-06\',\'SCHEDULE\',\'Frozen evidence\',\'08:00\',\'16:00\',333,\'2020-01-07\')',[ph,t,a,ph]);await root.query('UPDATE "User" SET status=\'ARCHIVED\' WHERE id=$1',[sh])
})
after(async()=>{await root.end();await Promise.all([global.prisma,global.prismaBypassClient,...[...(global.prismaScopedClientCache?.values()||[])].map(e=>e.client)].filter(Boolean).map(c=>c.$disconnect()));await global.prismaPool?.end()})

test('roster staff lookup is office/date scoped without requiring Users or configuration Read',async()=>{
 const data=await body(await call());assert.deepEqual(data.items.map(row=>row.id).sort(),[sa,st].sort());assert.equal(data.total,2)
 assert.equal((await body(await call(mb))).items.some(row=>row.id===sa),false)
 await body(await call(ma,'',patterns),403)
})
test('hidden source configurations yield accurate neutral hours and breaks without source identities',async()=>{
 assert.equal(await scope(ma,()=>prisma.staffFlexiblePattern.count({where:{id:secret}})),0)
 const data=await body(await call()),day=data.days.find(d=>d.staffId===sa&&d.date==='2036-02-04')
 assert.equal(day.state,'WORKING');assert.equal(day.paidMinutes,420);assert.deepEqual(day.periods,[{startTime:'09:00',endTime:'12:00'},{startTime:'13:00',endTime:'17:00'}]);assert.equal(day.canEdit,false)
 assert.ok(!JSON.stringify(data).includes(secret));assert.ok(!JSON.stringify(data).includes('officeId'))
})
test('transferred employees show an explicit outside state rather than invented zero hours',async()=>{
 const east=await body(await call()),outside=east.days.find(d=>d.staffId===st&&d.date==='2036-02-05')
 assert.equal(outside.state,'OUTSIDE');assert.equal(outside.paidMinutes,null);assert.deepEqual(outside.periods,[]);assert.equal(outside.canEdit,false)
 const west=await body(await call(mb));assert.equal(west.days.find(d=>d.staffId===st&&d.date==='2036-02-05').paidMinutes,480)
 assert.ok(!JSON.stringify(east).includes('14:00'))
})
test('private approved leave still suppresses hours with no reason, classification or request ID',async()=>{
 const leave=secret+'_leave';await root.query('INSERT INTO "LeaveDefinition"(id,"tenantId",code,name,"leaveType","updatedAt") VALUES($1,$2,\'PRIVATE_CODE\',\'Private classification\',\'PAID\',now())',[leave,t])
 await root.query('INSERT INTO "LeaveRequest"(id,"tenantId","officeId","staffProfileId","leaveDefinitionId","startDate","endDate","daysCount",status,reason,"updatedAt") VALUES($1,$2,$3,$4,$1,\'2036-02-04\',\'2036-02-04\',1,\'APPROVED\',\'Private medical reason\',now())',[leave,t,a,pa])
 try{const data=await body(await call()),day=data.days.find(d=>d.staffId===sa&&d.date==='2036-02-04');assert.equal(day.paidMinutes,0);assert.equal(day.state,'NONWORKING');assert.deepEqual(day.periods,[]);for(const value of [leave,'PRIVATE_CODE','Private medical reason'])assert.ok(!JSON.stringify(data).includes(value))}finally{await root.query('DELETE FROM "LeaveRequest" WHERE id=$1',[leave])}
})
test('frozen history and archived staff remain readable from their source office without recomputation',async()=>{
 const read=async()=>(await root.query('SELECT to_jsonb(h) row FROM "StaffRosterHistoryDay" h WHERE id=$1',[ph])).rows[0].row,before=await read()
 const data=await body(await call(ma,'startDate=2020-01-06&endDate=2020-01-06&q=Historic'));assert.equal(data.items[0].status,'ARCHIVED');assert.equal(data.days[0].paidMinutes,333);assert.equal(data.days[0].frozen,true);assert.deepEqual(await read(),before)
})
test('personal frozen history survives office grant revocation without opening current offices',async()=>{
 await root.query('UPDATE "User" SET status=\'ACTIVE\' WHERE id=$1',[sh])
 try{const data=await body(await call(sh,'startDate=2020-01-06&endDate=2020-01-06&q=Historic'));assert.equal(data.days[0].paidMinutes,333);assert.equal((await body(await call(sh))).total,0)}finally{await root.query('UPDATE "User" SET status=\'ARCHIVED\' WHERE id=$1',[sh])}
})
test('only tenant admins can discover unplaced profiles, without an invented working default',async()=>{
 const adminView=await body(await call(admin));assert.equal(adminView.items.some(row=>row.id===su),true);assert.ok(adminView.days.filter(d=>d.staffId===su).every(d=>d.state==='UNPLACED'&&d.paidMinutes===null&&!d.canEdit))
 assert.equal((await body(await call())).items.some(row=>row.id===su),false)
})
test('closed offices retain neutral Read and never advertise editable dates',async()=>{
 await root.query('UPDATE "BusinessOffice" SET archived=true WHERE id=$1',[b])
 try{const data=await body(await call(admin));assert.equal(data.days.find(d=>d.staffId===sb&&d.date==='2036-02-04').paidMinutes,480);assert.equal(data.days.find(d=>d.staffId===sb&&d.date==='2036-02-04').canEdit,false)}finally{await root.query('UPDATE "BusinessOffice" SET archived=false WHERE id=$1',[b])}
})
test('native projections reject whole foreign/wholly unreadable selections and invalid bounds',async()=>{
 for(const profiles of [[pa,pf],[pa,pb]])await assert.rejects(scope(ma,()=>prisma.$queryRaw`SELECT * FROM app.roster_days(${t},${profiles}::text[],'2036-02-04'::date,'2036-02-05'::date)`))
 for(const q of ['startDate=2036-01-01&endDate=2036-04-01','startDate=2036-02-04&endDate=2036-02-05&pageSize=101','startDate=2036-02-04&endDate=2036-02-05&q='+('x'.repeat(161))])await body(await call(ma,q),400)
})
test('revocation, module activation and role labels are freshly enforced on every read',async()=>{
 await body(await call(plain),403)
 await root.query('UPDATE "TenantAccessRole" SET permissions=ARRAY[]::text[] WHERE id=$1',[role]);try{await body(await call(),403)}finally{await root.query('UPDATE "TenantAccessRole" SET permissions=ARRAY[\'shiftRoster.read\'] WHERE id=$1',[role])}
 await root.query('UPDATE "TenantModule" SET enabled=false WHERE "tenantId"=$1 AND key=\'shifts\'',[t]);try{await body(await call(),403)}finally{await root.query('UPDATE "TenantModule" SET enabled=true WHERE "tenantId"=$1 AND key=\'shifts\'',[t])}
 await root.query('DELETE FROM "BusinessOfficeGrant" WHERE "tenantId"=$1 AND "userId"=$2',[t,ma]);try{assert.equal((await body(await call())).total,0)}finally{await root.query('INSERT INTO "BusinessOfficeGrant"("tenantId","userId","officeId") VALUES($1,$2,$3)',[t,ma,a])}
})
test('staff search and explicit pagination cover more than one hundred permitted profiles',async()=>{
 await root.query('INSERT INTO "User"(id,"tenantId",role,name,email,"updatedAt") SELECT $1||n,$2,\'STAFF\',\'Paging \'||lpad(n::text,3,\'0\'),$1||n||\'@example.test\',now() FROM generate_series(1,107)n',[t+'_page_',t])
 await root.query('INSERT INTO "StaffProfile"(id,"userId","schedulingMode","updatedAt") SELECT id,id,\'FLEXIBLE\',now() FROM "User" WHERE "tenantId"=$1 AND name LIKE \'Paging %\'',[t])
 await root.query('INSERT INTO "StaffWorkplacePolicy"("tenantId","staffProfileId",version,"updatedAt") SELECT $1,p.id,1,now() FROM "StaffProfile" p JOIN "User" u ON u.id=p."userId" WHERE u."tenantId"=$1 AND u.name LIKE \'Paging %\'',[t])
 await root.query('INSERT INTO "StaffWorkplaceAssignment"(id,"tenantId","staffProfileId","officeId","updatedAt") SELECT p.id,$1,p.id,$2,now() FROM "StaffProfile" p JOIN "User" u ON u.id=p."userId" WHERE u."tenantId"=$1 AND u.name LIKE \'Paging %\'',[t,a])
 const q='startDate=2036-02-04&endDate=2036-02-04&q=Paging',first=await body(await call(ma,q)),second=await body(await call(ma,q+'&page=2'))
 assert.equal(first.total,107);assert.equal(first.items.length,100);assert.equal(second.items.length,7);assert.equal(new Set([...first.items,...second.items].map(u=>u.id)).size,107)
 assert.equal((await body(await call(ma,q+' 107'))).items.length,1)
})
