/* eslint-disable @typescript-eslint/no-require-imports */
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path')
const {AsyncLocalStorage}=require('node:async_hooks'),{Client}=require('pg')
const raw=process.env.CRM_TEST_DATABASE_URL,url=new URL(raw||'http://invalid')
if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!='/ls_salon_crm_test')throw Error('Disposable local database only.')
const root=new Client({connectionString:raw});url.username='crm_test_runtime';url.password=''
process.env.DATABASE_URL=url.toString();process.env.RLS_POOL_MAX='1'
const sessions=new AsyncLocalStorage(), authPath=path.resolve(__dirname,'../auth.ts')
require.cache[authPath]={id:authPath,filename:authPath,loaded:true,exports:{auth:async()=>{await Promise.resolve();return sessions.getStore()||null}}}
const {logger}=require('../lib/logger.ts');const errors=[];logger.info=()=>{};logger.error=(_e,c)=>errors.push(c.error?.message)
const {prisma}=require('../lib/prisma.ts')

const fs=require('node:fs')
const notifyPath=path.resolve(__dirname,'../app/api/leaves/_notifications.ts')
require.cache[notifyPath]={id:notifyPath,filename:notifyPath,loaded:true,exports:Object.fromEntries(['notifyLeaveSubmitted','notifyLeaveReviewed','notifyLeaveCanceled','notifyLeaveRevoked'].map(key=>[key,async()=>{}]))}
const endpoints=[]
for(const moduleKey of ['leaves','shifts'])for(const file of fs.readdirSync(path.resolve(__dirname,`../app/api/${moduleKey}`),{recursive:true}).filter(f=>f.endsWith('route.ts'))){
 const key=`${moduleKey}/${file.replaceAll('\\','/').replace('/route.ts','')}`
 const route=require(`../app/api/${moduleKey}/${file}`)
 for(const method of ['GET','POST','PUT','PATCH','DELETE'])if(route[method])endpoints.push({key,method,route})
}
const get=key=>endpoints.find(e=>e.key===key).route
const suffix=require('node:crypto').randomUUID().replaceAll('-',''),a=`wf_a_${suffix}`,b=`wf_b_${suffix}`,rid=`role_${suffix}`
const session=(tenant=a,role='ADMIN')=>({user:{id:`${tenant}_${role.toLowerCase()}`,tenantId:tenant,role}})
const call=(key,method='GET',body,id,role='ADMIN',tenant=a,query='')=>sessions.run(session(tenant,role),()=>get(key)[method](new Request(`http://${tenant}.localhost/api/${key}${query}`,{method,headers:{host:`${tenant}.localhost`,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}),{params:Promise.resolve({id})}))
const perms=p=>root.query('UPDATE "TenantAccessRole" SET permissions=$1 WHERE id=$2',[p,rid])
const flag=(key,enabled,allowed=true)=>root.query('UPDATE "TenantModule" SET enabled=$1,allowed=$2 WHERE "tenantId"=$3 AND key=$4',[enabled,allowed,a,key])
async function ok(res,status=200){const body=await res.json();assert.equal(res.status,status,JSON.stringify({body,errors:errors.slice(-2)}));return body}
let definition,template,pattern
before(async()=>{
 await root.connect()
 for(const tenant of [a,b]){
  await root.query('INSERT INTO "Tenant" (id,name,slug,"updatedAt") VALUES ($1,$1,$1,now())',[tenant])
  for(const role of ['ADMIN','MANAGER','STAFF','CUSTOMER'])await root.query('INSERT INTO "User" (id,name,email,role,"tenantId","updatedAt") VALUES ($1,$1,$2,$3,$4,now())',[`${tenant}_${role.toLowerCase()}`,`${tenant}_${role}@example.test`,role,tenant])
  for(const key of ['leaves','shifts'])await root.query('INSERT INTO "TenantModule" ("tenantId",key,allowed,enabled,"updatedAt") VALUES ($1,$2,true,true,now())',[tenant,key])
  await root.query('INSERT INTO "StaffProfile" (id,"userId","managerUserId","schedulingMode","updatedAt") VALUES ($1,$2,$3,\'FLEXIBLE\',now()),($4,$3,NULL,\'STANDARD\',now())',[tenant+'_profile',tenant+'_staff',tenant+'_manager',tenant+'_managerprofile'])
 }
 await root.query('INSERT INTO "TenantAccessRole" (id,"tenantId",name,"nameKey",permissions,"updatedAt") VALUES ($1,$2,\'Workforce test\',\'workforce test\',$3,now())',[rid,a,[]])
 await root.query('INSERT INTO "TenantRoleAssignment" ("tenantId","userId","roleId","updatedAt") VALUES ($1,$2,$3,now())',[a,a+'_manager',rid])
})
after(async()=>{
 for(const tenant of [a,b]){
  await root.query('DELETE FROM "LeaveRequest" WHERE "tenantId"=$1',[tenant])
  await root.query('DELETE FROM "StaffProfile" WHERE "userId" IN (SELECT id FROM "User" WHERE "tenantId"=$1)',[tenant])
  for(const table of ['LeaveGroup','LeaveDefinition','ShiftSchedule','ShiftTemplate','RealEstateProjectStatus','RealEstatePropertyCategory','RealEstateBuyingTimeframe'])await root.query(`DELETE FROM "${table}" WHERE "tenantId"=$1`,[tenant])
 }
 await root.query('DELETE FROM "TenantRoleAssignment" WHERE "tenantId"=$1',[a]);await root.query('DELETE FROM "Tenant" WHERE id IN ($1,$2)',[a,b]);await root.end();await prisma.$disconnect();await global.prismaPool?.end()
})
test('every Leaves/Shifts endpoint denies disabled, revoked and absent modules before domain work',async()=>{
 assert.ok(endpoints.length>=40)
 for(const state of ['disabled','revoked','missing']){
  for(const key of ['leaves','shifts'])if(state==='missing')await root.query('DELETE FROM "TenantModule" WHERE "tenantId"=$1 AND key=$2',[a,key]);else await flag(key,false,state!=='revoked')
  for(const e of endpoints)assert.equal((await call(e.key,e.method,e.method==='GET'?undefined:{},'missing')).status,403,`${state} ${e.method} ${e.key}`)
 }
 for(const key of ['leaves','shifts'])await root.query('INSERT INTO "TenantModule" ("tenantId",key,allowed,enabled,"updatedAt") VALUES ($1,$2,true,true,now())',[a,key])
})
test('read-only permissions deny every mutation and role ceilings prevent staff management',async()=>{
 const resources=['leaveRequests','leaveApprovals','leaveDefinitions','leaveGroups','shiftTemplates','shiftSchedules','shiftPlans','shiftRoster']
 await perms(resources.map(r=>`${r}.read`))
 for(const e of endpoints.filter(e=>e.method!=='GET'&&!e.key.endsWith('impact-preview')))assert.equal((await call(e.key,e.method,{},'missing','MANAGER')).status,403,`${e.method} ${e.key}`)
 for(const key of ['leaves/definitions','leaves/groups','shifts/templates','shifts/schedules','shifts/flexible-patterns/list']){
  await ok(await call(key,'GET',undefined,undefined,'MANAGER'))
  assert.equal((await call(key,'GET',undefined,undefined,'STAFF')).status,403,key)
 }
})
test('definition and template writes enforce status permission, tenant isolation and record audit snapshots',async()=>{
 definition=(await ok(await call('leaves/definitions','POST',{code:'AL',name:'Annual leave',leaveType:'PAID',minDaysPerRequest:1,maxDaysPerRequest:10,maxPendingRequests:5}),201)).item
 template=(await ok(await call('shifts/templates','POST',{name:'Day shift',startTime:'09:00',endTime:'17:00',breaks:[],isActive:true}))).template
 assert.ok(definition.id);assert.ok(template.id)
 await perms(['leaveDefinitions.read','leaveDefinitions.edit','shiftTemplates.read','shiftTemplates.edit'])
 await ok(await call('leaves/definitions/[id]','PATCH',{name:'Updated annual leave'},definition.id,'MANAGER'))
 assert.equal((await call('leaves/definitions/[id]','PATCH',{status:'INACTIVE'},definition.id,'MANAGER')).status,403)
 assert.equal((await call('shifts/templates/[id]','PATCH',{isActive:false},template.id,'MANAGER')).status,403)
 assert.equal((await call('shifts/templates/[id]','DELETE',undefined,template.id,'MANAGER')).status,403)
 assert.equal((await call('leaves/definitions/[id]','PATCH',{name:'Foreign'},definition.id,'ADMIN',b)).status,404)
 const audit=(await root.query('SELECT * FROM "AuditLog" WHERE "entityId"=$1 AND event=\'workforce.leaveDefinitions.edit\'',[definition.id])).rows[0]
 assert.equal(audit.before.name,'Annual leave');assert.equal(audit.after.name,'Updated annual leave');assert.equal(audit.actorUserId,a+'_manager');assert.ok(audit.requestId)
})
test('own leave access and approval rights retain direct-report scope, prevent self review and stale role escalation',async()=>{
 for(const [id,profile] of [['own',a+'_profile'],['manager',a+'_managerprofile']])await root.query('INSERT INTO "LeaveRequest" (id,"tenantId","staffProfileId","leaveDefinitionId","startDate","endDate","daysCount",reason,"updatedAt") VALUES ($1,$2,$3,$4,\'2030-10-07\',\'2030-10-07\',1,\'Test\',now())',[a+'_'+id,a,profile,definition.id])
 let rows=await ok(await call('leaves/requests','GET',undefined,undefined,'STAFF',a,'?mineOnly=false'));assert.equal(rows.items.length,1);assert.equal(rows.items[0].id,a+'_own')
 await perms(['leaveApprovals.read'])
 rows=await ok(await call('leaves/requests','GET',undefined,undefined,'MANAGER'));assert.equal(rows.items.length,1);assert.equal(rows.items[0].id,a+'_own')
 assert.equal((await call('leaves/requests/[id]/review','PATCH',{status:'APPROVED'},a+'_own','MANAGER')).status,403)
 await perms(['leaveApprovals.read','leaveApprovals.approve'])
 await ok(await call('leaves/requests/[id]/review','PATCH',{status:'APPROVED'},a+'_own','MANAGER'))
 assert.ok([403,404].includes((await call('leaves/requests/[id]/review','PATCH',{status:'APPROVED'},a+'_manager','MANAGER')).status))
 let approved=await ok(await call('leaves/approved','GET',undefined,undefined,'MANAGER',a,'?startDate=2030-10-01&endDate=2030-10-31&staffIds=missing'));assert.equal(approved.items.length,0)
 await root.query('UPDATE "StaffProfile" SET "managerUserId"=NULL WHERE id=$1',[a+'_profile'])
 rows=await ok(await call('leaves/requests','GET',undefined,undefined,'MANAGER'));assert.equal(rows.items.length,0)
 approved=await ok(await call('leaves/approved','GET',undefined,undefined,'MANAGER',a,'?startDate=2030-10-01&endDate=2030-10-31'));assert.equal(approved.items.length,0)
 assert.ok([403,404].includes((await call('leaves/requests/[id]','GET',undefined,a+'_own','MANAGER')).status))
 await root.query('UPDATE "User" SET role=\'STAFF\' WHERE id=$1',[a+'_admin']);assert.equal((await call('shifts/templates')).status,403);await root.query('UPDATE "User" SET role=\'ADMIN\' WHERE id=$1',[a+'_admin'])
 const audit=(await root.query('SELECT * FROM "AuditLog" WHERE "tenantId"=$1 AND event LIKE \'leave.request.%\'',[a])).rows;assert.ok(audit.length)
})
const patternBody=()=>({staffId:a+'_staff',name:'Mornings',cycleLengthWeeks:1,validFrom:'2030-10-07',validTo:'',isActive:true,weeks:[{weekIndex:1,days:['MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY','SUNDAY'].map(day=>({day,isOff:day!=='MONDAY',slots:day==='MONDAY'?[{startTime:'09:00',endTime:'12:00',breaks:[]}]:[]}))}]})
test('recurring plan creation is distinct from editing and replacement requires archive permission',async()=>{
 await perms(['shiftPlans.read','shiftPlans.edit'])
 assert.equal((await call('shifts/flexible-patterns','PUT',patternBody(),undefined,'MANAGER')).status,403)
 await perms(['shiftPlans.read','shiftPlans.create'])
 pattern=(await ok(await call('shifts/flexible-patterns','PUT',patternBody(),undefined,'MANAGER'))).item
 assert.equal((await call('shifts/flexible-patterns','PUT',{...patternBody(),patternId:pattern.id},undefined,'MANAGER')).status,403)
 assert.equal((await call('shifts/flexible-patterns','PUT',patternBody(),undefined,'MANAGER')).status,403)
 assert.equal((await root.query('SELECT "isActive" FROM "StaffFlexiblePattern" WHERE id=$1',[pattern.id])).rows[0].isActive,true)
 await perms(['shiftPlans.read','shiftPlans.create','shiftPlans.archive'])
 await ok(await call('shifts/flexible-patterns','PUT',patternBody(),undefined,'MANAGER'))
 assert.equal((await root.query('SELECT "isActive" FROM "StaffFlexiblePattern" WHERE id=$1',[pattern.id])).rows[0].isActive,false)
 assert.equal((await call('shifts/flexible-patterns/[id]/deactivate','POST',{},pattern.id,'ADMIN',b)).status,404)
})
test('staff profile mode changes respect Shifts activation; omitted mode is preserved',async()=>{
 const userRoute=require('../app/api/users/[id]/route.ts')
 const update=body=>sessions.run(session(),()=>userRoute.PATCH(new Request(`http://${a}.localhost/api/users/${a}_staff`,{method:'PATCH',headers:{host:`${a}.localhost`,'content-type':'application/json'},body:JSON.stringify(body)}),{params:Promise.resolve({id:a+'_staff'})}))
 await flag('shifts',false)
 assert.equal((await update({staffProfile:{schedulingMode:'STANDARD'}})).status,403)
 await ok(await update({staffProfile:{managerUserId:a+'_manager'}}))
 assert.equal((await root.query('SELECT "schedulingMode" FROM "StaffProfile" WHERE id=$1',[a+'_profile'])).rows[0].schedulingMode,'FLEXIBLE')
 await flag('shifts',true)
})

test('groups and schedules validate related read access, audit saves and separate unassignment',async()=>{
 const groupBody={code:'TEAM',name:'Team leaves',assignmentMode:'SELECTED_STAFF',leaveDefinitionIds:[definition.id],staffIds:[a+'_staff'],status:'ACTIVE'}
 await perms(['leaveGroups.read','leaveGroups.create'])
 assert.equal((await call('leaves/groups','POST',groupBody,undefined,'MANAGER')).status,403)
 await perms(['leaveGroups.read','leaveGroups.create','leaveDefinitions.read'])
 const group=(await ok(await call('leaves/groups','POST',groupBody,undefined,'MANAGER'),201)).item
 assert.ok(group.id)
 const body={name:'Default hours',isDefault:true,startDate:'2030-10-07',weekOffDay1:'SUNDAY',weekOffDay2:'',weekOff2Weeks:[],blocks:[{templateId:template.id,repeatDays:5}],staffIds:[]}
 await perms(['shiftSchedules.read','shiftSchedules.create'])
 assert.equal((await call('shifts/schedules','POST',body,undefined,'MANAGER')).status,403)
 await perms(['shiftSchedules.read','shiftSchedules.create','shiftTemplates.read'])
 const schedule=(await ok(await call('shifts/schedules','POST',body,undefined,'MANAGER'))).schedule
 assert.ok(schedule.id)
 assert.equal((await call('shifts/schedules','POST',body,undefined,'MANAGER')).status,403)
 assert.equal((await call('shifts/assignments/[id]','PATCH',{endDate:'2030-10-08'},'missing','MANAGER')).status,403)
 assert.equal((await root.query('SELECT count(*)::int n FROM "AuditLog" WHERE "entityId"=$1 AND event=\'workforce.shiftSchedules.create\'',[schedule.id])).rows[0].n,1)
})
test('nonempty dashboard and audit records are filtered before disclosure; disabled maintenance fails closed',async()=>{
 const dashboard=require('../app/api/dashboard/summary/route.ts'),audit=require('../app/api/reports/audit-logs/route.ts'),seeds=require('../app/api/seeds/route.ts')
 const run=(route,role='ADMIN',method='GET',body)=>sessions.run(session(a,role),()=>route[method](new Request(`http://${a}.localhost/api/check`,{method,headers:{host:`${a}.localhost`,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})})))
 assert.equal((await ok(await run(dashboard))).kpis.pendingLeaves,1)
 await flag('leaves',false)
 assert.equal((await ok(await run(dashboard))).kpis.pendingLeaves,0)
 assert.equal((await run(seeds,'ADMIN','POST',{action:'seed',groups:['leaves']})).status,403)
 const hidden=await ok(await run(audit));assert.ok(hidden.items.every(r=>!r.event.startsWith('leave.request.')&&!r.event.startsWith('workforce.leave')))
 await flag('leaves',true);await perms(['dashboard.read','auditLogs.read','leaveApprovals.read'])
 assert.equal((await ok(await run(dashboard,'MANAGER'))).kpis.pendingLeaves,0)
 const manager=await ok(await run(audit,'MANAGER'));assert.ok(manager.items.every(r=>!r.event.startsWith('leave.request.')&&!r.event.startsWith('workforce.')))
})
test('navigation starts at the first allowed view and hides disabled workforce modules',()=>{
 const {workforceNavigation}=require('../application/navigation.ts'),flags=['leaves','shifts'].map(key=>({key,allowed:true,enabled:true}))
 assert.equal(workforceNavigation(flags,['leaveGroups.read'],'MANAGER')[0].href,'/leaves/groups')
 assert.deepEqual(workforceNavigation(flags,['shiftTemplates.read'],'STAFF'),[])
 assert.deepEqual(workforceNavigation([],undefined,'ADMIN'),[])
})
