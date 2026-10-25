/* eslint-disable @typescript-eslint/no-require-imports */
process.env.TZ='UTC'
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Client}=require('pg'),{AsyncLocalStorage}=require('node:async_hooks')
const raw=process.env.CRM_TEST_DATABASE_URL,url=new URL(raw||'http://invalid');if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!='/ls_salon_crm_test')throw Error('Disposable local database only.')
const root=new Client({connectionString:raw}),sessions=new AsyncLocalStorage();url.username='crm_test_runtime';url.password='';process.env.DATABASE_URL=url.toString()
const authPath=require.resolve('../auth.ts');require.cache[authPath]={id:authPath,filename:authPath,loaded:true,exports:{auth:async()=>{await Promise.resolve();return sessions.getStore()||null}}}
require('../lib/logger.ts').logger.info=()=>{};require('../lib/logger.ts').logger.error=()=>{}
const {prisma,runWithTenantDbContext}=require('../lib/prisma.ts'),{runWithDatabaseActor}=require('../lib/database-actor.ts'),{runWithOfficeRequest}=require('../lib/database-office.ts')
const {createOfficeAccessService}=require('../platform/companies/office-access.ts'),{defaultRecordRules,supportedScopes}=require('../platform/access/rules.ts'),{allPermissions}=require('../platform/access/catalog.ts')
const {syncRosterHistoryRange}=require('../modules/workforce/roster-history.ts'),{scheduleTransaction}=require('../modules/workforce/schedule-transaction.ts'),{approvedLeaveBlocks}=require('../modules/workforce/availability-blocks.ts')
const list=require('../app/api/leaves/requests/route.ts'),detail=require('../app/api/leaves/requests/[id]/route.ts'),review=require('../app/api/leaves/requests/[id]/review/route.ts'),cancel=require('../app/api/leaves/requests/[id]/cancel/route.ts'),bulk=require('../app/api/leaves/requests/review-bulk/route.ts'),history=require('../app/api/shifts/history/route.ts')
const id='leave_offices_'+randomUUID().replaceAll('-',''),foreign=id+'_foreign',admin=id+'_admin',employee=id+'_employee',manager=id+'_manager',otherManager=id+'_other',noProfile=id+'_no_profile',noOffice=id+'_no_office',role=id+'_role',profile=id+'_profile',definition=id+'_definition',past=id+'_past',snapshot=id+'_snapshot'
const who=user=>({user:{id:user,tenantId:id,role:user===admin?'ADMIN':user===employee?'STAFF':'MANAGER'}})
const scoped=(user,fn)=>runWithTenantDbContext(id,()=>runWithDatabaseActor(user,async()=>await fn()))
const access=user=>createOfficeAccessService(prisma,{tenantId:id,userId:user})
const context=user=>scoped(user,()=>access(user).getOwnContext())
const select=async(user,office)=>{const p=await context(user);return scoped(user,()=>access(user).selectCreationOffice({version:p.version,officeId:office}))}
async function call(handler,user=employee,method='GET',data,record,office=undefined,query=''){
 let headers={};if(office===undefined&&method==='POST'){const p=await context(user);office=p.creationOffice?{officeId:p.creationOffice.id,version:p.version}:null}if(office)headers={'x-office-id':office.officeId,'x-office-version':String(office.version)}
 return sessions.run(who(user),()=>handler(new Request(`http://${id}.localhost/api/leaves/requests${query}`,{method,headers:{host:id+'.localhost','content-type':'application/json',...headers},...(data===undefined?{}:{body:JSON.stringify(data)})}),{params:Promise.resolve({id:record})}))
}
async function body(response,status=200){const result=await response.json();assert.equal(response.status,status,JSON.stringify(result));return result}
const request=date=>({leaveDefinitionId:definition,startDate:date,endDate:date,reason:'Private office leave reason'})
let a,b,requestA,requestB
before(async()=>{
 await root.connect();for(const t of [id,foreign])await root.query('INSERT INTO "Tenant"(id,name,slug,"updatedAt") VALUES($1,$1,$1,now())',[t])
 a=(await root.query('SELECT * FROM "BusinessOffice" WHERE "tenantId"=$1 AND "isInitial"',[id])).rows[0].id
 b=id+'_west';await root.query('INSERT INTO "BusinessOffice"(id,"tenantId","companyId",code,name,"updatedAt") SELECT $1,$2,"companyId",\'WEST\',\'West\',now() FROM "BusinessOffice" WHERE id=$3',[b,id,a])
 for(const [user,label]of[[admin,'ADMIN'],[employee,'STAFF'],[manager,'MANAGER'],[otherManager,'MANAGER'],[noProfile,'MANAGER'],[noOffice,'MANAGER']])await root.query('INSERT INTO "User"(id,"tenantId",email,role,"updatedAt") VALUES($1,$2,$3,$4,now())',[user,id,user+'@example.test',label])
 const rules=defaultRecordRules();for(const p of Object.keys(rules))if(supportedScopes(p.split('.')[0]).includes('ALL'))rules[p]='ALL'
 await root.query('INSERT INTO "TenantAccessRole"(id,"tenantId",name,"nameKey",permissions,"updatedAt") VALUES($1,$2,\'Office checks\',\'office checks\',$3,now())',[role,id,allPermissions])
 for(const user of [employee,manager,otherManager,noOffice]){await root.query('INSERT INTO "TenantUserAccess"("tenantId","userId",rules,"updatedAt") VALUES($1,$2,$3,now())',[id,user,rules]);await root.query('INSERT INTO "TenantRoleAssignment"("tenantId","userId","roleId","updatedAt") VALUES($1,$2,$3,now())',[id,user,role])}
 for(const [user,offices]of[[admin,[a,b]],[employee,[a,b]],[manager,[a]],[otherManager,[b]],[noProfile,[a]]]){await root.query('INSERT INTO "BusinessOfficePolicy"("tenantId","userId","creationOfficeId","updatedAt") VALUES($1,$2,$3,now())',[id,user,offices[0]]);for(const office of offices)await root.query('INSERT INTO "BusinessOfficeGrant"("tenantId","userId","officeId") VALUES($1,$2,$3)',[id,user,office])}
 for(const key of ['leaves','shifts','appointments'])await root.query('INSERT INTO "TenantModule"("tenantId",key,allowed,enabled,"updatedAt") VALUES($1,$2,true,true,now())',[id,key])
 await root.query('INSERT INTO "AppSetting"(id,"tenantId","timeZone","updatedAt") VALUES($1,$1,\'UTC\',now())',[id])
 await root.query('INSERT INTO "StaffProfile"(id,"userId","managerUserId","schedulingMode","updatedAt") VALUES($1,$2,$3,\'FLEXIBLE\',now())',[profile,employee,manager])
 await root.query('INSERT INTO "LeaveDefinition"(id,"tenantId",code,name,"leaveType","maxPendingRequests","allowWithOtherLeaves","updatedAt") VALUES($1,$2,\'PRIVATE\',\'Private classification\',\'PAID\',100,false,now())',[definition,id])
 await root.query('INSERT INTO "LeaveGroup"(id,"tenantId",code,name,"assignmentMode","updatedAt") VALUES($1,$2,\'ALL\',\'All staff\',\'ALL_STAFF\',now())',[definition,id])
 await root.query('INSERT INTO "LeaveGroupLeave"(id,"leaveGroupId","leaveDefinitionId") VALUES($1,$1,$1)',[definition])
})
after(async()=>{await root.end();await Promise.all([global.prisma,global.prismaBypassClient,...[...(global.prismaScopedClientCache?.values()||[])].map(entry=>entry.client)].filter(Boolean).map(client=>client.$disconnect()));await global.prismaPool?.end()})

test('the office suite has no implicit fixture grants or root office fallback',async()=>{
 assert.equal((await root.query("SELECT count(*)::int n FROM pg_trigger WHERE tgname IN ('test_user_office_fixture','aaa_test_record_office_fixture')")).rows[0].n,0)
 assert.equal((await context(noOffice)).creationOffice,null)
 await body(await call(list.POST,employee,'POST',request('2036-01-07'),undefined,null),403)
 await body(await call(list.POST,noProfile,'POST',request('2036-01-07')),403)
 await body(await call(list.POST,noOffice,'POST',request('2036-01-07')),403)
 assert.equal((await root.query('SELECT count(*)::int n FROM "StaffProfile" WHERE "userId"=$1',[noOffice])).rows[0].n,0)
 assert.equal((await root.query('SELECT count(*)::int n FROM "LeaveRequest" WHERE "tenantId"=$1',[id])).rows[0].n,0)
})
test('creation captures office identity and rejects stale forms without saving or auditing',async()=>{
 const old=await context(employee);requestA=(await body(await call(list.POST,employee,'POST',request('2036-01-07')),201)).item
 assert.equal(requestA.officeId,a)
 await select(employee,b)
 await body(await call(list.POST,employee,'POST',request('2036-01-08'),undefined,{officeId:a,version:old.version}),409)
 requestB=(await body(await call(list.POST,employee,'POST',request('2036-01-09')),201)).item;assert.equal(requestB.officeId,b)
 await body(await call(list.POST,employee,'POST',request('2036-01-07')),400)
 assert.equal((await root.query('SELECT count(*)::int n FROM "AuditLog" WHERE "tenantId"=$1 AND event=\'leave.request.submitted\'',[id])).rows[0].n,2)
})
test('personal reads retain both offices; configured reviewers only see offices they can access',async()=>{
 assert.equal((await body(await call(list.GET,employee,'GET',undefined,undefined,undefined,'?mineOnly=true'))).total,2)
 assert.deepEqual((await body(await call(list.GET,manager))).items.map(row=>row.id),[requestA.id])
 assert.equal((await body(await call(list.GET,otherManager))).total,0)
 await body(await call(detail.GET,manager,'GET',undefined,requestB.id),404)
 await body(await call(detail.GET,otherManager,'GET',undefined,requestB.id),404)
 await body(await call(review.PATCH,manager,'PATCH',{status:'APPROVED'},requestB.id),404)
 await body(await call(review.PATCH,otherManager,'PATCH',{status:'APPROVED'},requestB.id),404)
 assert.equal(await scoped(manager,()=>prisma.leaveRequest.count({where:{tenantId:id}})),1)
 assert.equal(await prisma.leaveRequest.count(),0)
})
test('bulk review and audit copies cannot cross the office boundary',async()=>{
 const result=await body(await call(bulk.POST,manager,'POST',{requestIds:[requestA.id,requestB.id],status:'REJECTED',reviewerComment:'Unavailable'}))
 assert.equal(result.updatedCount,1);assert.deepEqual(result.skippedIds,[requestB.id])
 assert.equal(await scoped(manager,()=>prisma.auditLog.count({where:{tenantId:id,entityType:'LeaveRequest',entityId:requestB.id}})),0)
 assert.equal(await scoped(manager,()=>prisma.auditLog.count({where:{tenantId:id,entityType:'LeaveRequest',entityId:requestA.id}})),1)
})
test('office membership alone does not grant actions or replace the reporting relationship',async()=>{
 assert.equal(await scoped(noProfile,()=>prisma.leaveRequest.count({where:{tenantId:id}})),0)
 await body(await call(detail.GET,noProfile,'GET',undefined,requestA.id),403)
 await root.query('INSERT INTO "BusinessOfficeGrant"("tenantId","userId","officeId") VALUES($1,$2,$3)',[id,manager,b])
 assert.equal((await body(await call(list.GET,manager))).total,2)
 await root.query('DELETE FROM "BusinessOfficeGrant" WHERE "tenantId"=$1 AND "userId"=$2 AND "officeId"=$3',[id,manager,b])
 assert.equal((await body(await call(list.GET,manager))).total,1)
})
test('private past snapshots are normalized and hidden from another office, while busy time remains',async()=>{
 await root.query('INSERT INTO "LeaveRequest"(id,"tenantId","officeId","staffProfileId","leaveDefinitionId","startDate","endDate","daysCount",status,reason,"updatedAt") VALUES($1,$2,$3,$4,$5,\'2020-01-06\',\'2020-01-06\',1,\'APPROVED\',\'Private historical reason\',now())',[past,id,b,profile,definition])
 await root.query('INSERT INTO "StaffRosterHistoryDay"(id,"staffProfileId",date,source,"startTime","endTime","paidMinutes","updatedAt") VALUES($1,$2,\'2020-01-06\',\'SCHEDULE\',\'09:00\',\'17:00\',480,now())',[snapshot,profile])
 const generic=await scoped(manager,()=>prisma.staffRosterHistoryDay.findUnique({where:{id:snapshot}}));assert.equal(generic.source,'UNAVAILABLE');assert.equal(generic.paidMinutes,0);for(const key of ['leaveReason','leaveRequestId','leaveDefinitionName','leaveDefinitionCode'])assert(!(key in generic))
 assert.equal(await scoped(manager,()=>prisma.staffRosterLeaveSnapshot.count({where:{historyId:snapshot}})),0)
 const own=await scoped(employee,()=>prisma.staffRosterLeaveSnapshot.findUnique({where:{historyId:snapshot}}));assert.equal(own.leaveReason,'Private historical reason');assert.equal(own.leaveRequestId,past)
 const query=`?startDate=2020-01-06&endDate=2020-01-06&staffIds=${employee}`
 const other=await body(await call(history.GET,manager,'GET',undefined,undefined,undefined,query));assert.equal(other.items[0].source,'UNAVAILABLE');assert.equal(other.items[0].leaveReason,null)
 const mine=await body(await call(history.GET,employee,'GET',undefined,undefined,undefined,query));assert.equal(mine.items[0].source,'LEAVE');assert.equal(mine.items[0].leaveReason,'Private historical reason')
 const blocks=await scoped(manager,()=>approvedLeaveBlocks(prisma,id,[profile],new Date('2020-01-06'),new Date('2020-01-06')));assert.equal(blocks.length,1)
})
test('a hidden leave cannot be overwritten with working time by a history refresh',async()=>{
 await scoped(manager,()=>scheduleTransaction(id,tx=>syncRosterHistoryRange(tx,{tenantId:id,staffProfileIds:[profile],startDate:'2020-01-06',endDate:'2020-01-06',mode:'replace'})))
 const row=(await root.query('SELECT h.source,h."paidMinutes",s."leaveReason",s."leaveRequestId" FROM "StaffRosterHistoryDay" h JOIN "StaffRosterLeaveSnapshot" s ON s."historyId"=h.id WHERE h.id=$1',[snapshot])).rows[0]
 assert.deepEqual(row,{source:'UNAVAILABLE',paidMinutes:0,leaveReason:'Private historical reason',leaveRequestId:past})
 await assert.rejects(scoped(manager,()=>prisma.staffRosterLeaveSnapshot.updateMany({where:{historyId:snapshot},data:{leaveReason:'Changed'}})))
})
test('notification gates intersect recipient permissions, source office and current reporting assignment',async()=>{
 const allowed=(target,request,action='approve')=>scoped(employee,()=>prisma.$queryRaw`SELECT app.leave_notice_recipient(${id},${request},${target},${action}) allowed`)
 assert.equal((await allowed(manager,requestB.id))[0].allowed,false);assert.equal((await allowed(otherManager,requestB.id))[0].allowed,false)
 assert.equal((await allowed(admin,requestB.id))[0].allowed,true)
 assert.equal((await allowed(employee,requestB.id,'read'))[0].allowed,true)
})
test('a transferred employee retains personal history and cancellation without retaining new-office creation access',async()=>{
 await root.query('DELETE FROM "BusinessOfficeGrant" WHERE "tenantId"=$1 AND "userId"=$2 AND "officeId"=$3',[id,employee,b])
 await body(await call(detail.GET,employee,'GET',undefined,requestB.id))
 assert.equal(await scoped(employee,()=>prisma.staffRosterLeaveSnapshot.count({where:{historyId:snapshot}})),1)
 await body(await call(list.POST,employee,'POST',request('2036-01-12')),403)
 await body(await call(cancel.PATCH,employee,'PATCH',{cancelReason:'Transferred'},requestB.id))
 assert.equal((await root.query('SELECT status,"officeId" FROM "LeaveRequest" WHERE id=$1',[requestB.id])).rows[0].officeId,b)
})
test('native identities and foreign references cannot be replaced by an authorized reader',async()=>{
 await assert.rejects(scoped(employee,()=>prisma.leaveRequest.updateMany({where:{id:requestA.id},data:{officeId:b}})))
 assert.equal((await scoped(manager,()=>prisma.leaveRequest.updateMany({where:{id:past},data:{reason:'Changed'}}))).count,0)
 assert.equal((await root.query('SELECT "officeId" FROM "LeaveRequest" WHERE id=$1',[requestA.id])).rows[0].officeId,a)
})
test('current profile, module, account and pooled-context revocation are immediate',async()=>{
 await root.query('UPDATE "TenantAccessRole" SET archived=true WHERE id=$1',[role]);try{assert.equal(await scoped(employee,()=>prisma.leaveRequest.count({where:{tenantId:id}})),0);assert.equal(await scoped(employee,()=>prisma.staffRosterLeaveSnapshot.count({})),0)}finally{await root.query('UPDATE "TenantAccessRole" SET archived=false WHERE id=$1',[role])}
 await root.query('UPDATE "TenantModule" SET enabled=false WHERE "tenantId"=$1 AND key=\'leaves\'',[id]);try{assert.equal(await scoped(admin,()=>prisma.staffRosterLeaveSnapshot.count({})),0);assert.equal((await scoped(manager,()=>approvedLeaveBlocks(prisma,id,[profile],new Date('2020-01-06'),new Date('2020-01-06')))).length,1)}finally{await root.query('UPDATE "TenantModule" SET enabled=true WHERE "tenantId"=$1 AND key=\'leaves\'',[id])}
 await root.query('UPDATE "User" SET status=\'SUSPENDED\' WHERE id=$1',[employee]);try{assert.equal(await scoped(employee,()=>prisma.staffRosterLeaveSnapshot.count({})),0)}finally{await root.query('UPDATE "User" SET status=\'ACTIVE\' WHERE id=$1',[employee])}
 await scoped(employee,()=>runWithOfficeRequest({officeId:b,version:999},()=>prisma.$transaction(async tx=>{await tx.$executeRaw`SELECT set_config('app.office_id',${b},true)`})))
 const [next]=await scoped(manager,()=>prisma.$queryRaw`SELECT current_setting('app.office_id',true) office`);assert.equal(next.office,'')
})
test('closed offices retain authorized history while reviewer writes remain blocked',async()=>{
 const pending=id+'_closed'
 await root.query('INSERT INTO "LeaveRequest"(id,"tenantId","officeId","staffProfileId","leaveDefinitionId","startDate","endDate","daysCount","updatedAt") VALUES($1,$2,$3,$4,$5,\'2036-02-04\',\'2036-02-04\',1,now())',[pending,id,b,profile,definition])
 await root.query('INSERT INTO "BusinessOfficeGrant"("tenantId","userId","officeId") VALUES($1,$2,$3)',[id,manager,b])
 await root.query('UPDATE "BusinessOffice" SET archived=true WHERE id=$1',[b])
 try{
  await body(await call(detail.GET,manager,'GET',undefined,pending))
  assert.equal(await scoped(manager,()=>prisma.staffRosterLeaveSnapshot.count({where:{historyId:snapshot}})),1)
  await body(await call(review.PATCH,manager,'PATCH',{status:'APPROVED'},pending),403)
  assert.equal((await root.query('SELECT status FROM "LeaveRequest" WHERE id=$1',[pending])).rows[0].status,'PENDING')
 }finally{await root.query('UPDATE "BusinessOffice" SET archived=false WHERE id=$1',[b]);await root.query('DELETE FROM "BusinessOfficeGrant" WHERE "tenantId"=$1 AND "userId"=$2 AND "officeId"=$3',[id,manager,b])}
})
test('concurrent personal submissions enforce the pending limit under the shared lock',async()=>{
 await select(employee,a)
 const limited=definition+'_limited'
 await root.query('INSERT INTO "LeaveDefinition"(id,"tenantId",code,name,"leaveType","maxPendingRequests","updatedAt") VALUES($1,$2,\'LIMIT\',\'Limited leave\',\'PAID\',1,now())',[limited,id])
 await root.query('INSERT INTO "LeaveGroupLeave"(id,"leaveGroupId","leaveDefinitionId") VALUES($1,$2,$1)',[limited,definition])
 const responses=await Promise.all(['2036-04-07','2036-04-08'].map(date=>call(list.POST,employee,'POST',{...request(date),leaveDefinitionId:limited})))
 assert.deepEqual(responses.map(response=>response.status).sort(),[201,400])
 assert.equal((await root.query('SELECT count(*)::int n FROM "LeaveRequest" WHERE "leaveDefinitionId"=$1',[limited])).rows[0].n,1)
})
test('a submission audit failure rolls back the request and its staff transaction',async()=>{
 const count=async()=>(await root.query('SELECT count(*)::int n FROM "LeaveRequest" WHERE "tenantId"=$1',[id])).rows[0].n,before=await count()
 await root.query(`CREATE FUNCTION app.test_leave_submit_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='leave.request.submitted' THEN RAISE EXCEPTION 'Simulated submission audit failure'; END IF;RETURN NEW;END $$;CREATE TRIGGER test_leave_submit_audit_failure BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION app.test_leave_submit_audit_failure()`)
 try{await body(await call(list.POST,employee,'POST',request('2036-05-07')),500);assert.equal(await count(),before)}finally{await root.query('DROP TRIGGER test_leave_submit_audit_failure ON "AuditLog";DROP FUNCTION app.test_leave_submit_audit_failure()')}
})
