/* eslint-disable @typescript-eslint/no-require-imports */
const {grantPgFixtureUsers}=require("./helpers/access-fixtures.cjs")
process.env.TZ='UTC'
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path')
const {AsyncLocalStorage}=require('node:async_hooks'),{Client}=require('pg')
const raw=process.env.CRM_TEST_DATABASE_URL,url=new URL(raw||'http://invalid')
if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!='/ls_salon_crm_test')throw Error('Disposable local database only.')
const root=new Client({connectionString:raw});url.username='crm_test_runtime';url.password=''
process.env.DATABASE_URL=url.toString();process.env.RLS_POOL_MAX='2'
const sessions=new AsyncLocalStorage(), authPath=path.resolve(__dirname,'../auth.ts')
require.cache[authPath]={id:authPath,filename:authPath,loaded:true,exports:{auth:async()=>{await Promise.resolve();return sessions.getStore()||null}}}
const {logger}=require('../lib/logger.ts');const errors=[];logger.info=()=>{};logger.error=(_e,c)=>errors.push(c.error?.message)
const {prisma}=require('../lib/prisma.ts')

const fs=require('node:fs')
const notifications=[]
const notifyPath=path.resolve(__dirname,'../modules/workforce/leave-notifications.ts')
require.cache[notifyPath]={id:notifyPath,filename:notifyPath,loaded:true,exports:Object.fromEntries(['notifyLeaveSubmitted','notifyLeaveReviewed','notifyLeaveCanceled','notifyLeaveRevoked'].map(key=>[key,async (_db,payload)=>{notifications.push({key,payload})}]))}
const endpoints=[]
for(const moduleKey of ['leaves','shifts'])for(const file of fs.readdirSync(path.resolve(__dirname,`../app/api/${moduleKey}`),{recursive:true}).filter(f=>f.endsWith('route.ts'))){
 const key=`${moduleKey}/${file.replaceAll('\\','/').replace('/route.ts','')}`
 const route=require(`../app/api/${moduleKey}/${file}`)
 for(const method of ['GET','POST','PUT','PATCH','DELETE'])if(route[method])endpoints.push({key,method,route})
}
const get=key=>endpoints.find(e=>e.key===key).route
const suffix=require('node:crypto').randomUUID().replaceAll('-',''),a=`wf_a_${suffix}`,b=`wf_b_${suffix}`,rid=`role_${suffix}`
const session=(tenant=a,role='ADMIN')=>({user:{id:`${tenant}_${role.toLowerCase()}`,tenantId:tenant,role}})
const call=async(key,method='GET',body,id,role='ADMIN',tenant=a,query='')=>{const p=(await root.query('SELECT \"creationOfficeId\",version FROM \"BusinessOfficePolicy\" WHERE \"tenantId\"=$1 AND \"userId\"=$2',[tenant,tenant+'_'+role.toLowerCase()])).rows[0];const office=p?.creationOfficeId?{'x-office-id':p.creationOfficeId,'x-office-version':String(p.version)}:{};return sessions.run(session(tenant,role),()=>get(key)[method](new Request(`http://${tenant}.localhost/api/${key}${query}`,{method,headers:{host:`${tenant}.localhost`,'content-type':'application/json',...office},...(body===undefined?{}:{body:JSON.stringify(body)})}),{params:Promise.resolve({id})}))}
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

 await grantPgFixtureUsers(root,[a,b])
})
after(async()=>{
 for(const tenant of [a,b]){
  await root.query('DELETE FROM "LeaveRequest" WHERE "tenantId"=$1',[tenant])
  await root.query('DELETE FROM "StaffProfile" WHERE "userId" IN (SELECT id FROM "User" WHERE "tenantId"=$1)',[tenant])
  for(const table of ['Service','ServiceCategory','LeaveGroup','LeaveDefinition','ShiftSchedule','ShiftTemplate','RealEstateProjectStatus','RealEstatePropertyCategory','RealEstateBuyingTimeframe'])await root.query(`DELETE FROM "${table}" WHERE "tenantId"=$1`,[tenant])
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
 assert.equal((await call('shifts/templates/[id]','PATCH',{name:'Day shift',startTime:'09:00',endTime:'17:00',breaks:[],isActive:false},template.id,'MANAGER')).status,403)
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
 assert.equal(workforceNavigation(flags,['shiftTemplates.read'],'STAFF')[0].href,'/shifts')
 assert.deepEqual(workforceNavigation(flags,[],'STAFF'),[])
 assert.deepEqual(workforceNavigation([],undefined,'ADMIN'),[])
})

test('shared staff availability preserves overrides, breaks and leave, with explicit tenant scope',async()=>{
 const {checkAsAdministrator:check}=require('./helpers/availability-fixtures.cjs')
 const {runWithTenantDbContext}=require('../lib/prisma.ts')
 await root.query('INSERT INTO "AppSetting" (id,"tenantId","timeZone","updatedAt") VALUES ($1,$2,\'UTC\',now()),($3,$4,\'UTC\',now())',[a+'_settings',a,b+'_settings',b])
 await root.query('INSERT INTO "ShiftTemplateBreak" (id,"templateId","startTime","endTime") VALUES ($1,$2,\'12:00\',\'13:00\')',[a+'_break',template.id])
 await root.query('INSERT INTO "StaffShiftOverride" (id,"staffProfileId",date,"templateId","updatedAt") VALUES ($1,$2,\'2031-10-06\',$3,now())',[a+'_override',a+'_profile',template.id])
 const at=(start,end,tenant=a,profile=a+'_profile')=>runWithTenantDbContext(tenant,()=>check(profile,new Date(`2031-10-06T${start}:00Z`),new Date(`2031-10-06T${end}:00Z`),tenant))
 assert.deepEqual(await at('09:00','10:00'),{ok:true})
 assert.match((await at('11:30','12:30')).reason,/break/)
 await assert.rejects(at('09:00','10:00',b),error=>error.status===403)
 await assert.rejects(check(a+'_profile',new Date(),new Date()),/Tenant context is required/)
 await root.query('INSERT INTO "LeaveRequest" (id,"tenantId","staffProfileId","leaveDefinitionId","startDate","endDate","daysCount",status,"updatedAt") VALUES ($1,$2,$3,$4,\'2031-10-06\',\'2031-10-06\',1,\'APPROVED\',now())',[a+'_availability_leave',a,a+'_profile',definition.id])
 assert.equal((await at('09:00','10:00')).reason,'Staff member is unavailable on this date.')
 await root.query('DELETE FROM "LeaveRequest" WHERE id=$1',[a+'_availability_leave'])
 await root.query('UPDATE "StaffShiftOverride" SET "templateId"=NULL WHERE id=$1',[a+'_override'])
 assert.match((await at('09:00','10:00')).reason,/unavailable/)
 await root.query('INSERT INTO "StaffFlexibleAvailability" (id,"staffProfileId",date,"startTime","endTime","updatedAt") VALUES ($1,$2,\'2031-10-06\',\'10:00\',\'12:00\',now())',[b+'_slot',b+'_profile'])
 assert.deepEqual(await at('10:00','11:00',b,b+'_profile'),{ok:true})
 assert.equal((await at('09:00','10:00',b,b+'_profile')).ok,false)
})


test('leave definitions retain reciprocal exclusions, partial limits and transaction rollback', async () => {
 const create=(code,name,extra={})=>call('leaves/definitions','POST',{code,name,leaveType:'PAID',minDaysPerRequest:1,maxDaysPerRequest:5,maxPendingRequests:5,...extra})
 const first=(await ok(await create('b4-first','Batch four first'),201)).item
 await ok(await create('b4-duplicate','Invalid duplicates',{nonClubbableWithIds:[first.id,first.id]}),400)
 const second=(await ok(await create('b4-second','Batch four second',{nonClubbableWithIds:[first.id]}),201)).item
 assert.equal(first.code,'B4-FIRST')
 assert.equal(second.nonClubbableWith.length,1)
 const read=id=>call('leaves/definitions/[id]','GET',undefined,id)
 assert.equal((await ok(await read(first.id))).item.nonClubbableWith[0].id,second.id)
 await ok(await call('leaves/definitions/[id]','PATCH',{allowedUsers:'FEMALE',noticeDays:3,allowCarryForward:true},first.id))
 await ok(await call('leaves/definitions/[id]','PATCH',{name:'Batch four renamed'},first.id))
 const renamed=(await ok(await read(first.id))).item
 assert.equal(renamed.allowedUsers,'FEMALE');assert.equal(renamed.noticeDays,3);assert.equal(renamed.allowCarryForward,true);assert.equal(renamed.nonClubbableWith[0].id,second.id)
 first.name=renamed.name
 await ok(await create('b4-first','Different name'),409)
 await ok(await call('leaves/definitions/[id]','PATCH',{name:first.name},second.id),409)
 await ok(await call('leaves/definitions/[id]','PATCH',{minDaysPerRequest:6},first.id),400)
 const other=(await ok(await call('leaves/definitions','POST',{code:'FOREIGN',name:'Foreign leave',leaveType:'PAID',minDaysPerRequest:1,maxDaysPerRequest:5,maxPendingRequests:5},undefined,'ADMIN',b),201)).item
 await ok(await call('leaves/definitions/[id]','PATCH',{name:'Must roll back',nonClubbableWithIds:[other.id]},first.id),400)
 const unchanged=(await ok(await read(first.id))).item
 assert.equal(unchanged.name,first.name);assert.equal(unchanged.minDaysPerRequest,1);assert.equal(unchanged.nonClubbableWith[0].id,second.id)
 await ok(await call('leaves/definitions/[id]','PATCH',{nonClubbableWithIds:[]},first.id))
 assert.equal((await ok(await read(second.id))).item.nonClubbableWith.length,0)
 await ok(await call('leaves/definitions/[id]','GET',undefined,first.id,'ADMIN',b),404)
 const page=await ok(await call('leaves/definitions','GET',undefined,undefined,'ADMIN',a,'?q=Batch%20four&pageSize=1&sort=code'))
 assert.equal(page.total,2);assert.equal(page.items.length,1)
 await ok(await call('leaves/definitions/[id]','DELETE',undefined,second.id))
 await ok(await read(second.id),404)
})

test('leave group replacement rejects foreign staff and definitions without partial saves', async () => {
 const other=(await ok(await call('leaves/definitions','POST',{code:'GROUPFOREIGN',name:'Foreign group leave',leaveType:'PAID',minDaysPerRequest:1,maxDaysPerRequest:5,maxPendingRequests:5},undefined,'ADMIN',b),201)).item
 const body={code:'B4GROUP',name:'Batch four group',description:'Keep description',assignmentMode:'SELECTED_STAFF',leaveDefinitionIds:[definition.id],staffIds:[a+'_staff']}
 const group=(await ok(await call('leaves/groups','POST',body),201)).item
 await ok(await call('leaves/groups','POST',body),409)
 await ok(await call('leaves/groups/[id]','PATCH',{description:'Changed description'},group.id))
 const renamed=(await ok(await call('leaves/groups/[id]','GET',undefined,group.id))).item
 assert.equal(renamed.assignmentMode,'SELECTED_STAFF');assert.equal(renamed.assignedStaff[0].userId,a+'_staff')
 for(const bad of [{staffIds:[b+'_staff']},{staffIds:[a+'_manager']},{leaveDefinitionIds:[other.id]}]) {
  await ok(await call('leaves/groups/[id]','PATCH',{name:'Must roll back',...bad},group.id),400)
  const saved=(await ok(await call('leaves/groups/[id]','GET',undefined,group.id))).item
  assert.equal(saved.name,group.name);assert.equal(saved.assignedStaff[0].userId,a+'_staff');assert.equal(saved.leaveDefinitions[0].id,definition.id)
 }
 const all=(await ok(await call('leaves/groups/[id]','PATCH',{assignmentMode:'ALL_STAFF',description:''},group.id))).item
 assert.deepEqual(all.assignedStaff,[]);assert.equal(all.description,null)
 await ok(await call('leaves/groups/[id]','PATCH',{assignmentMode:'SELECTED_STAFF'},group.id),400)
 assert.equal((await ok(await call('leaves/groups/[id]','GET',undefined,group.id))).item.assignmentMode,'ALL_STAFF')
 await ok(await call('leaves/groups/[id]','PATCH',{assignmentMode:'SELECTED_STAFF',staffIds:[a+'_staff']},group.id))
 await ok(await call('leaves/groups/[id]','DELETE',undefined,group.id,'ADMIN',b),404)
 const page=await ok(await call('leaves/groups','GET',undefined,undefined,'ADMIN',a,'?q=B4GROUP&pageSize=1'))
 assert.equal(page.total,1);assert.equal(page.items[0].id,group.id)
 const audit=(await root.query('SELECT "after" FROM "AuditLog" WHERE "entityId"=$1 AND event=$2',[group.id,'workforce.leaveGroups.edit'])).rows
 assert.equal(audit.length,3);assert.ok(audit.some(row=>row.after.assignmentMode==='ALL_STAFF'))
 await ok(await call('leaves/groups/[id]','DELETE',undefined,group.id))
 await ok(await call('leaves/groups/[id]','GET',undefined,group.id),404)
})

test('shift templates keep ordered breaks, bounded table paging and protected referenced deletion', async () => {
 const body={name:'Batch four template',startTime:'09:00',endTime:'18:00',breaks:[{startTime:'12:00',endTime:'13:00',sortOrder:1},{startTime:'15:00',endTime:'15:15',sortOrder:2}],isActive:true}
 const row=(await ok(await call('shifts/templates','POST',body))).template
 assert.deepEqual(row.breaks.map(b=>b.startTime),['12:00','15:00'])
 const changed=(await ok(await call('shifts/templates/[id]','PATCH',{...body,breaks:[{startTime:'13:00',endTime:'14:00'}]},row.id))).template
 assert.equal(changed.breaks.length,1);assert.equal(changed.breaks[0].startTime,'13:00')
 await ok(await call('shifts/templates/[id]','PATCH',{...body,breaks:[{startTime:'08:00',endTime:'10:00'}]},row.id),400)
 await ok(await call('shifts/templates/[id]','PATCH',body,row.id,'ADMIN',b),404)
 for(const query of ['?page=1&pageSize=101','?page=NaN&pageSize=20','?page=1.5&pageSize=20','?pageSize=20'])
  await ok(await call('shifts/templates','GET',undefined,undefined,'ADMIN',a,query),400)
 const page=await ok(await call('shifts/templates','GET',undefined,undefined,'ADMIN',a,'?q=Batch%20four&page=1&pageSize=1'))
 assert.equal(page.total,1);assert.equal(page.items[0].id,row.id);assert.equal(page.items[0].breaks[0].startTime,'13:00')
 for(const sort of ['shift','breaks','isActive','invalid']) {
  const fallback=await ok(await call('shifts/templates','GET',undefined,undefined,'ADMIN',a,`?q=Batch%20four&page=1&pageSize=1&sort=${sort}`))
  assert.equal(fallback.items[0].id,row.id)
 }
 await ok(await call('shifts/templates/[id]','PATCH',{...body,isActive:false,breaks:[]},row.id))
 assert.equal((await ok(await call('shifts/templates','GET',undefined,undefined,'ADMIN',a,'?q=Batch%20four'))).total,0)
 assert.equal((await ok(await call('shifts/templates','GET',undefined,undefined,'ADMIN',a,'?q=Batch%20four&includeInactive=true'))).total,1)
 await ok(await call('shifts/templates/[id]','DELETE',undefined,template.id),409)
 await ok(await call('shifts/templates/[id]','DELETE',undefined,row.id))
 assert.equal((await root.query('SELECT id FROM "ShiftTemplateBreak" WHERE "templateId"=$1',[row.id])).rowCount,0)
})


async function requestFixture(key, {tenant=a, profile=tenant+'_profile', status='PENDING', date='2033-11-07'}={}) {
 const id=tenant+'_'+key
 const def=tenant===a?definition.id:(await root.query('SELECT id FROM "LeaveDefinition" WHERE "tenantId"=$1 LIMIT 1',[tenant])).rows[0].id
 await root.query('INSERT INTO "LeaveRequest" (id,"tenantId","staffProfileId","leaveDefinitionId","startDate","endDate","daysCount",status,reason,"updatedAt") VALUES ($1,$2,$3,$4,$5,$5,1,$6,\'Workflow test\',now())',[id,tenant,profile,def,date,status])
 return id
}

test('submission, paginated personal reads, rule details and cancellation retain ownership and audits', async () => {
 await root.query('UPDATE "StaffProfile" SET "managerUserId"=$1 WHERE id=$2',[a+'_manager',a+'_profile'])
 const body={leaveDefinitionId:definition.id,startDate:'2033-11-08',endDate:'2033-11-08',reason:'  Family event  '}
 await ok(await call('leaves/requests','POST',body),401)
 await ok(await call('leaves/requests','POST',{...body,endDate:'2033-11-07'},undefined,'STAFF'),400)
 const item=(await ok(await call('leaves/requests','POST',body,undefined,'STAFF'),201)).item
 assert.equal(item.reason,'Family event');assert.equal(item.status,'PENDING')
 await ok(await call('leaves/definitions/[id]','PATCH',{allowWithOtherLeaves:false},definition.id))
 await ok(await call('leaves/requests','POST',body,undefined,'STAFF'),400)
 await ok(await call('leaves/definitions/[id]','PATCH',{allowWithOtherLeaves:true},definition.id))
 const foreign=(await root.query('SELECT id FROM "LeaveDefinition" WHERE "tenantId"=$1 LIMIT 1',[b])).rows[0].id
 await ok(await call('leaves/requests','POST',{...body,leaveDefinitionId:foreign},undefined,'STAFF'),400)
 const page=await ok(await call('leaves/requests','GET',undefined,undefined,'STAFF',a,'?q=Family&pageSize=1&mineOnly=false'))
 assert.equal(page.total,1);assert.equal(page.items[0].id,item.id)
 await ok(await call('leaves/requests','GET',undefined,undefined,'STAFF',a,'?pageSize=101'),400)
 const detail=await ok(await call('leaves/requests/[id]','GET',undefined,item.id,'STAFF',a,'?includeRuleChecks=true'))
 assert.ok(detail.ruleChecks.length);assert.equal(detail.timeline[0].key,'submitted')
 await ok(await call('leaves/requests/[id]','GET',undefined,item.id,'ADMIN',b),404)
 await ok(await call('leaves/requests/[id]/cancel','PATCH',{cancelReason:'Changed plans'},item.id,'STAFF'))
 await ok(await call('leaves/requests/[id]/review','PATCH',{status:'APPROVED'},item.id),400)
 const audit=(await root.query('SELECT event,"before","after","actorUserId","requestId" FROM "AuditLog" WHERE "entityId"=$1 ORDER BY "createdAt"',[item.id])).rows
 assert.deepEqual(audit.map(r=>r.event),['leave.request.submitted','leave.request.canceled'])
 assert.equal(audit[1].before.status,'PENDING');assert.equal(audit[1].after.status,'CANCELED');assert.ok(audit.every(r=>r.actorUserId===a+'_staff'&&r.requestId))
})

test('past approval/revocation synchronizes roster history and rolls back when history fails', async t => {
 const id=await requestFixture('past_request',{date:'2020-01-06'})
 const history=require('../modules/workforce/roster-history.ts')
 const stub=t.mock.method(history,'syncRosterHistoryRange',async()=>{throw Error('Simulated history failure')})
 await ok(await call('leaves/requests/[id]/review','PATCH',{status:'APPROVED'},id),500)
 assert.equal((await root.query('SELECT status FROM "LeaveRequest" WHERE id=$1',[id])).rows[0].status,'PENDING')
 assert.equal((await root.query('SELECT count(*)::int n FROM "AuditLog" WHERE "entityId"=$1',[id])).rows[0].n,0)
 stub.mock.restore()
 await ok(await call('leaves/requests/[id]/review','PATCH',{status:'APPROVED'},id))
 const roster=()=>root.query('SELECT h.source,s."leaveRequestId" FROM "StaffRosterHistoryDay" h LEFT JOIN "StaffRosterLeaveSnapshot" s ON s."historyId"=h.id WHERE h."staffProfileId"=$1 AND h.date=\'2020-01-06\'',[a+'_profile'])
 assert.equal((await roster()).rows[0].leaveRequestId,id)
 await ok(await call('leaves/requests/[id]/revoke','PATCH',{revokeReason:''},id),400)
 await ok(await call('leaves/requests/[id]/revoke','PATCH',{revokeReason:'Correction'},id))
 assert.notEqual((await roster()).rows[0].source,'LEAVE');assert.equal((await roster()).rows[0].leaveRequestId,null)
 await ok(await call('leaves/requests/[id]/revoke','PATCH',{revokeReason:'Again'},id),400)
 const audit=(await root.query('SELECT "before","after" FROM "AuditLog" WHERE "entityId"=$1 AND event=\'leave.request.revoked\'',[id])).rows[0]
 assert.equal(audit.before.status,'APPROVED');assert.equal(audit.after.status,'REVOKED')
})

test('bulk review skips foreign, missing, completed and out-of-scope requests and audits only changes', async () => {
 const pending=await requestFixture('bulk_pending'),complete=await requestFixture('bulk_complete',{status:'CANCELED'}),own=await requestFixture('bulk_manager',{profile:a+'_managerprofile'}),foreign=await requestFixture('bulk_foreign',{tenant:b})
 await perms(['leaveApprovals.read','leaveApprovals.approve'])
 const requestIds=[pending,complete,own,foreign,'missing']
 await ok(await call('leaves/requests/review-bulk','POST',{requestIds:[pending,pending],status:'APPROVED'},undefined,'MANAGER'),400)
 const result=await ok(await call('leaves/requests/review-bulk','POST',{requestIds,status:'REJECTED',reviewerComment:'Not available'},undefined,'MANAGER'))
 assert.equal(result.updatedCount,1);assert.equal(result.items[0].id,pending);assert.equal(result.skippedCount,4);assert.deepEqual(result.skippedIds,requestIds.slice(1))
 const audit=(await root.query('SELECT metadata,"actorUserId","requestId" FROM "AuditLog" WHERE "tenantId"=$1 AND event=\'leave.request.bulk_reviewed\' ORDER BY "createdAt" DESC LIMIT 1',[a])).rows[0]
 assert.deepEqual(audit.metadata.requestIds,[pending]);assert.equal(audit.metadata.updatedCount,1);assert.equal(audit.actorUserId,a+'_manager');assert.ok(audit.requestId)
 const again=await ok(await call('leaves/requests/review-bulk','POST',{requestIds,status:'APPROVED'},undefined,'MANAGER'))
 assert.equal(again.updatedCount,0);assert.equal(again.skippedCount,5)
 await root.query('UPDATE "StaffProfile" SET "managerUserId"=NULL WHERE id=$1',[a+'_profile'])
 await perms(['leaveApprovals.read','leaveApprovals.archive'])
 const approved=await requestFixture('unassigned_approved',{status:'APPROVED'})
 await ok(await call('leaves/requests/[id]/revoke','PATCH',{revokeReason:'No access'},approved,'MANAGER'),404)
 await root.query('UPDATE "StaffProfile" SET "managerUserId"=$1 WHERE id=$2',[a+'_manager',a+'_profile'])
})

// Delay only completed eligibility reads; all authorization, tenant context,
// transactions, conditional writes and audit persistence still use the real DB.
function interceptLeaveRead(method, intercept) {
 const dbModule=require('../lib/prisma.ts'), original=dbModule.prisma
 dbModule.prisma=new Proxy(original,{get(target,key){
  if(key!=='leaveRequest')return target[key]
  return new Proxy(target.leaveRequest,{get(delegate,property){
   if(property!==method)return delegate[property]
   return async args=>intercept(args,await delegate[method](args))
  }})
 }})
 return ()=>{dbModule.prisma=original}
}

test('competing reviews from the same pending snapshot allow only one status write and audit', async () => {
 const id=await requestFixture('review_race')
 let arrivals=0, release
 const gate=new Promise(resolve=>{release=resolve})
 const timeout=setTimeout(release,10000)
 const restore=interceptLeaveRead('findFirst',async (args,row)=>{
  if(args.where.id===id&&args.select?.status) { arrivals++;if(arrivals===2)release();await gate }
  return row
 })
 try {
  const results=await Promise.all([
   call('leaves/requests/[id]/review','PATCH',{status:'APPROVED'},id),
   call('leaves/requests/[id]/review','PATCH',{status:'REJECTED',reviewerComment:'Concurrent review'},id),
  ])
  assert.equal(arrivals,2);assert.deepEqual(results.map(r=>r.status).sort(),[200,409])
  const winner=await results.find(r=>r.status===200).json()
  const persisted=(await root.query('SELECT status FROM "LeaveRequest" WHERE id=$1',[id])).rows[0]
  assert.equal(persisted.status,winner.item.status)
  const audit=(await root.query('SELECT "after" FROM "AuditLog" WHERE "entityId"=$1 AND event=\'leave.request.reviewed\'',[id])).rows
  assert.equal(audit.length,1);assert.equal(audit[0].after.status,winner.item.status)
 } finally {clearTimeout(timeout);release();restore()}
})

test('bulk review does not count or notify a request canceled after its eligibility read', async () => {
 const stale=await requestFixture('bulk_stale'),pending=await requestFixture('bulk_remaining')
 const notificationStart=notifications.length
 let intercepted=false
 const restore=interceptLeaveRead('findMany',async (args,rows)=>{
  if(!intercepted&&args.where.status==='PENDING'&&args.where.id?.in?.includes(stale)) {
   intercepted=true
   await ok(await call('leaves/requests/[id]/cancel','PATCH',{cancelReason:'Changed during review'},stale,'STAFF'))
  }
  return rows
 })
 try {
  const result=await ok(await call('leaves/requests/review-bulk','POST',{requestIds:[stale,pending],status:'REJECTED',reviewerComment:'Not available'}))
  assert.equal(intercepted,true);assert.equal(result.updatedCount,1);assert.equal(result.items[0].id,pending);assert.deepEqual(result.skippedIds,[stale])
  assert.equal((await root.query('SELECT status FROM "LeaveRequest" WHERE id=$1',[stale])).rows[0].status,'CANCELED')
  const audit=(await root.query('SELECT metadata FROM "AuditLog" WHERE "tenantId"=$1 AND event=\'leave.request.bulk_reviewed\' ORDER BY "createdAt" DESC LIMIT 1',[a])).rows[0]
  assert.deepEqual(audit.metadata.requestIds,[pending])
  const reviewed=notifications.slice(notificationStart).filter(n=>n.key==='notifyLeaveReviewed')
  assert.equal(reviewed.length,1);assert.equal(reviewed[0].payload.status,'REJECTED')
 } finally {restore()}
})


test('single and bulk approvals block booking conflicts without exposing disabled-module details', async () => {
 const blocked=await requestFixture('conflict_leave',{date:'2034-11-07'}),clear=await requestFixture('clear_leave',{date:'2034-11-08'})
 await root.query(`INSERT INTO "ServiceCategory" (id,"tenantId",name,"updatedAt") VALUES ($1,$2,'Workflow category',now())`,[a+'_service_category',a])
 await root.query(`INSERT INTO "Service" (id,"tenantId",name,"categoryId","durationMinutes","priceCents","updatedAt") VALUES ($1,$2,'Private booking service',$3,60,1000,now())`,[a+'_service',a,a+'_service_category'])
 await root.query(`INSERT INTO "Appointment" (id,"tenantId","staffProfileId","customerId","serviceId","startAt","endAt","updatedAt") VALUES ($1,$2,$3,$4,$5,'2034-11-07T10:00:00Z','2034-11-07T11:00:00Z',now())`,[a+'_booking',a,a+'_profile',a+'_customer',a+'_service'])
 let result=await ok(await call('leaves/requests/[id]/review','PATCH',{status:'APPROVED'},blocked),409)
 assert.equal(result.conflicts[0].conflictCount,1);assert.deepEqual(result.conflicts[0].conflictingAppointments,[])
 result=await ok(await call('leaves/requests/review-bulk','POST',{requestIds:[blocked,clear],status:'APPROVED'}),409)
 assert.deepEqual(result.blockedRequestIds,[blocked]);assert.deepEqual(result.conflicts[0].conflictingAppointments,[])
 assert.equal((await root.query('SELECT count(*)::int n FROM "LeaveRequest" WHERE id=ANY($1) AND status=\'PENDING\'',[[blocked,clear]])).rows[0].n,2)
 await root.query(`INSERT INTO "TenantModule" ("tenantId",key,allowed,enabled,"updatedAt") VALUES ($1,'appointments',true,true,now())`,[a])
 result=await ok(await call('leaves/requests/[id]/review','PATCH',{status:'APPROVED'},blocked),409)
 assert.equal(result.conflicts[0].conflictingAppointments[0].id,a+'_booking')
 await perms(['leaveApprovals.read','leaveApprovals.approve'])
 result=await ok(await call('leaves/requests/[id]/review','PATCH',{status:'APPROVED'},blocked,'MANAGER'),409)
 assert.deepEqual(result.conflicts[0].conflictingAppointments,[])
 await ok(await call('leaves/requests/[id]/review','PATCH',{status:'REJECTED',reviewerComment:'Cannot cover shift'},blocked))
 await root.query('DELETE FROM "Appointment" WHERE id=$1',[a+'_booking'])
})


test('leave options follow active group membership and approved queries keep manager and staff filters', async () => {
 const def=(await ok(await call('leaves/definitions','POST',{code:'B6',name:'Selective leave',leaveType:'PAID',minDaysPerRequest:1,maxDaysPerRequest:5,maxPendingRequests:5}),201)).item
 const group=(await ok(await call('leaves/groups','POST',{code:'B6',name:'Selective leave group',assignmentMode:'SELECTED_STAFF',leaveDefinitionIds:[def.id],staffIds:[a+'_staff']}),201)).item
 const options=role=>call('leaves/request-options','GET',undefined,undefined,role)
 assert.ok((await ok(await options('STAFF'))).items.some(item=>item.value===def.id))
 await perms(['leaveRequests.read','leaveApprovals.read'])
 assert.ok((await ok(await options('MANAGER'))).items.every(item=>item.value!==def.id))
 await ok(await options('ADMIN'),401)
 await ok(await call('leaves/groups/[id]','PATCH',{status:'INACTIVE'},group.id))
 assert.ok((await ok(await options('STAFF'))).items.every(item=>item.value!==def.id))
 await ok(await call('leaves/groups/[id]','PATCH',{status:'ACTIVE'},group.id))
 await ok(await call('leaves/definitions/[id]','PATCH',{status:'INACTIVE'},def.id))
 assert.ok((await ok(await options('STAFF'))).items.every(item=>item.value!==def.id))
 const query='?startDate=2030-10-01&endDate=2030-10-31'
 const listed=await ok(await call('leaves/approved','GET',undefined,undefined,'MANAGER',a,query))
 assert.ok(listed.items.some(item=>item.id===a+'_own'))
 for(const staffIds of ['missing',b+'_staff']) assert.deepEqual((await ok(await call('leaves/approved','GET',undefined,undefined,'MANAGER',a,query+'&staffIds='+staffIds))).items,[])
 for(const dates of ['?startDate=2030-02-30&endDate=2030-03-01','?startDate=2030-10-31&endDate=2030-10-01']) await ok(await call('leaves/approved','GET',undefined,undefined,'ADMIN',a,dates),400)
})

const scheduleBody=(name,extra={})=>({name,isDefault:false,startDate:'2035-11-01',assignmentStartDate:'2035-11-01',assignmentEndDate:'2035-11-10',weekOffDay1:'SUNDAY',weekOffDay2:'',weekOff2Weeks:[],blocks:[{templateId:template.id,repeatDays:5}],staffIds:[a+'_staff'],...extra})
let batchSchedule

test('schedule saves reject mixed foreign staff and templates, preserve paging and independent tenant defaults', async () => {
 await root.query(`UPDATE "StaffProfile" SET "schedulingMode"='STANDARD' WHERE id IN ($1,$2)`,[a+'_profile',b+'_profile'])
 batchSchedule=(await ok(await call('shifts/schedules','POST',scheduleBody('Batch six assigned')))).schedule
 assert.equal(batchSchedule.assignments.length,1);assert.equal(batchSchedule.blocks[0].template.id,template.id)
 await ok(await call('shifts/schedules','POST',scheduleBody('Invalid staff',{staffIds:[a+'_staff',b+'_staff'],assignmentStartDate:'2035-12-01',assignmentEndDate:'2035-12-10'})),404)
 assert.equal((await root.query(`SELECT count(*)::int n FROM "ShiftSchedule" WHERE "tenantId"=$1 AND name='Invalid staff'`,[a])).rows[0].n,0)
 const foreignTemplate=(await ok(await call('shifts/templates','POST',{name:'Tenant B shift',startTime:'09:00',endTime:'17:00',breaks:[]},undefined,'ADMIN',b))).template
 await ok(await call('shifts/schedules/[id]','PATCH',scheduleBody('Must not save',{blocks:[{templateId:foreignTemplate.id,repeatDays:2}]}),batchSchedule.id),400)
 assert.equal((await root.query('SELECT name FROM "ShiftSchedule" WHERE id=$1',[batchSchedule.id])).rows[0].name,'Batch six assigned')
 await ok(await call('shifts/schedules/[id]','PATCH',scheduleBody('Foreign'),batchSchedule.id,'ADMIN',b),404)
 const other=(await ok(await call('shifts/schedules','POST',scheduleBody('Tenant B default',{isDefault:true,staffIds:[],blocks:[{templateId:foreignTemplate.id,repeatDays:5}]}),undefined,'ADMIN',b))).schedule
 assert.equal(other.isDefault,true)
 assert.equal((await root.query('SELECT count(*)::int n FROM "ShiftSchedule" WHERE "tenantId"=ANY($1) AND "isDefault"',[[a,b]])).rows[0].n,2)
 const page=await ok(await call('shifts/schedules','GET',undefined,undefined,'ADMIN',a,'?q=Batch%20six&page=1&pageSize=1&sort=name'))
 assert.equal(page.total,1);assert.equal(page.items[0].id,batchSchedule.id)
 for(const query of ['?page=1','?pageSize=101&page=1','?page=x&pageSize=10','?startDate=2035-02-30']) await ok(await call('shifts/schedules','GET',undefined,undefined,'ADMIN',a,query),400)
 await ok(await call('shifts/schedules','POST',scheduleBody('Invalid date',{startDate:'2035-02-30'})),400)
})

test('assignment lists do not widen unmatched filters; ending assignments checks permissions and overlaps', async () => {
 const query='?startDate=2035-11-01&endDate=2035-11-30'
 for(const staffIds of ['missing',b+'_staff']) assert.deepEqual((await ok(await call('shifts/assignments','GET',undefined,undefined,'ADMIN',a,query+'&staffIds='+staffIds))).items,[])
 const all=await ok(await call('shifts/assignments','GET',undefined,undefined,'ADMIN',a,query))
 assert.ok(all.items.some(item=>item.scheduleId===batchSchedule.id&&item.staffId===a+'_staff'))
 await ok(await call('shifts/assignments','GET',undefined,undefined,'ADMIN',a,'?startDate=2035-11-30&endDate=2035-11-01'),400)
 await ok(await call('shifts/schedules','POST',scheduleBody('Following schedule',{assignmentStartDate:'2035-11-11',assignmentEndDate:'2035-11-20'})))
 const id=batchSchedule.assignments[0].id
 await ok(await call('shifts/assignments/[id]','PATCH',{endDate:'2035-11-12'},id),409)
 await ok(await call('shifts/assignments/[id]','PATCH',{endDate:'2035-10-31'},id),400)
 await ok(await call('shifts/assignments/[id]','PATCH',{endDate:'2035-11-31'},id),400)
 await perms(['shiftSchedules.read','shiftSchedules.edit'])
 await ok(await call('shifts/assignments/[id]','PATCH',{endDate:'2035-11-09'},id,'MANAGER'),403)
 await perms(['shiftSchedules.read','shiftSchedules.archive'])
 const changed=(await ok(await call('shifts/assignments/[id]','PATCH',{endDate:'2035-11-09'},id,'MANAGER'))).item
 assert.equal(changed.endDate,'2035-11-09')
 await ok(await call('shifts/assignments/[id]','PATCH',{endDate:'2035-11-09'},id,'ADMIN',b),404)
 const audit=(await root.query(`SELECT "before","after","actorUserId" FROM "AuditLog" WHERE "entityId"=$1 AND event='workforce.shiftSchedules.archive'`,[id])).rows[0]
 assert.equal(audit.before.endDate.slice(0,10),'2035-11-10');assert.equal(audit.after.endDate.slice(0,10),'2035-11-09');assert.equal(audit.actorUserId,a+'_manager')
})

test('failed schedule block writes roll back default replacement and existing assignments', async () => {
 const fn='wf_fail_'+suffix,trigger='wf_block_'+suffix
 await root.query(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Simulated block write failure'; END $$;
 CREATE TRIGGER ${trigger} BEFORE INSERT ON "ShiftScheduleBlock" FOR EACH ROW WHEN (NEW."repeatDays"=365 AND NEW."templateId"='${template.id}') EXECUTE FUNCTION ${fn}();`)
 const before=(await root.query('SELECT id FROM "ShiftSchedule" WHERE "tenantId"=$1 AND "isDefault"',[a])).rows
 try {
  const badBlocks=[{templateId:template.id,repeatDays:365}]
  await ok(await call('shifts/schedules','POST',scheduleBody('Broken default',{isDefault:true,staffIds:[],blocks:badBlocks})),500)
  assert.deepEqual((await root.query('SELECT id FROM "ShiftSchedule" WHERE "tenantId"=$1 AND "isDefault"',[a])).rows,before)
  const assignmentsBefore=(await root.query('SELECT id,"endDate" FROM "StaffScheduleAssignment" WHERE "scheduleId"=$1 ORDER BY id',[batchSchedule.id])).rows
  await ok(await call('shifts/schedules/[id]','PATCH',scheduleBody('Broken edit',{blocks:badBlocks}),batchSchedule.id),500)
  assert.deepEqual((await root.query('SELECT id,"endDate" FROM "StaffScheduleAssignment" WHERE "scheduleId"=$1 ORDER BY id',[batchSchedule.id])).rows,assignmentsBefore)
  assert.equal((await root.query('SELECT name FROM "ShiftSchedule" WHERE id=$1',[batchSchedule.id])).rows[0].name,'Batch six assigned')
 } finally {await root.query(`DROP TRIGGER ${trigger} ON "ShiftScheduleBlock"; DROP FUNCTION ${fn}();`)}
})

test('concurrent schedule assignments cannot overlap and concurrent default replacement remains tenant scoped', async () => {
 const body=scheduleBody('Concurrent assignment',{assignmentStartDate:'2036-11-01',assignmentEndDate:'2036-11-10'})
 const results=await Promise.all([call('shifts/schedules','POST',body),call('shifts/schedules','POST',body)])
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409])
 assert.equal((await root.query(`SELECT count(*)::int n FROM "ShiftSchedule" WHERE "tenantId"=$1 AND name='Concurrent assignment'`,[a])).rows[0].n,1)
 const oldDefault=(await root.query('SELECT id FROM "ShiftSchedule" WHERE "tenantId"=$1 AND "isDefault"',[a])).rows[0].id
 const defaults=await Promise.all(['Default one','Default two'].map(name=>call('shifts/schedules','POST',scheduleBody(name,{isDefault:true,staffIds:[]}))))
 const saved=[]
 for(const response of defaults) saved.push((await ok(response)).schedule.id)
 const currentDefault=(await root.query('SELECT id FROM "ShiftSchedule" WHERE "tenantId"=$1 AND "isDefault"',[a])).rows[0].id
 const displaced=(await root.query(`SELECT "before" FROM "AuditLog" WHERE "tenantId"=$1 AND event='workforce.shiftSchedules.edit' AND "before" ? 'defaultSchedules'`,[a])).rows.flatMap(row=>row.before.defaultSchedules.map(item=>item.id))
 assert.ok(displaced.includes(oldDefault));assert.ok(displaced.includes(saved.find(id=>id!==currentDefault)));assert.ok(!displaced.includes(currentDefault))
 assert.equal((await root.query('SELECT count(*)::int n FROM "ShiftSchedule" WHERE "tenantId"=$1 AND "isDefault"',[a])).rows[0].n,1)
 assert.equal((await root.query('SELECT count(*)::int n FROM "ShiftSchedule" WHERE "tenantId"=$1 AND "isDefault"',[b])).rows[0].n,1)
 await perms(['shiftSchedules.read','shiftSchedules.create','shiftTemplates.read'])
 await ok(await call('shifts/schedules','POST',scheduleBody('Unauthorized default',{isDefault:true,staffIds:[]}),undefined,'MANAGER'),403)
 await ok(await call('shifts/schedules/[id]','DELETE',undefined,batchSchedule.id))
 assert.equal((await root.query('SELECT id FROM "StaffScheduleAssignment" WHERE "scheduleId"=$1',[batchSchedule.id])).rowCount,0)
})


const overrideBody=(date,extra={})=>({staffId:a+'_staff',templateId:template.id,startDate:date,endDate:date,skipWeekOff:false,skipHolidays:false,...extra})
const slotBody=(date,extra={})=>({staffId:a+'_staff',date,slots:[{startTime:'09:00',endTime:'17:00'}],...extra})
test('daily roster reads reject invalid dates and keep unknown or foreign staff filters empty',async()=>{
 await ok(await call('shifts/overrides','POST',overrideBody('2037-01-07')))
 const foreignTemplate=(await root.query('SELECT id FROM "ShiftTemplate" WHERE "tenantId"=$1 LIMIT 1',[b])).rows[0].id
 await ok(await call('shifts/overrides','POST',overrideBody('2037-01-08',{templateId:foreignTemplate})),404)
 await ok(await call('shifts/overrides','POST',overrideBody('2037-01-08',{staffId:b+'_staff'})),404)
 await root.query(`UPDATE "StaffProfile" SET "schedulingMode"='FLEXIBLE' WHERE id=$1`,[a+'_profile'])
 await ok(await call('shifts/flexible-slots','POST',slotBody('2037-01-07')))
 for(const key of ['overrides','flexible-slots','history']){
  const query='?startDate=2037-01-01&endDate=2037-01-31'
  for(const staff of ['missing',b+'_staff'])assert.deepEqual((await ok(await call('shifts/'+key,'GET',undefined,undefined,'ADMIN',a,query+'&staffIds='+staff))).items,[])
  await ok(await call('shifts/'+key,'GET',undefined,undefined,'ADMIN',a,'?startDate=2037-02-29&endDate=2037-03-01'),400)
  await ok(await call('shifts/'+key,'GET',undefined,undefined,'ADMIN',a,'?startDate=2037-03-02&endDate=2037-03-01'),400)
  if(key!=='history'){
   const rows=(await ok(await call('shifts/'+key,'GET',undefined,undefined,'ADMIN',a,query))).items
   assert.equal(rows.length,1);assert.equal(rows[0].staffId,a+'_staff')
  }
 }
 await perms(['shiftRoster.read'])
 await ok(await call('shifts/flexible-slots','POST',slotBody('2037-01-08'),undefined,'MANAGER'),403)
 await perms(['shiftRoster.read','shiftRoster.edit'])
 await ok(await call('shifts/overrides','POST',overrideBody('2037-01-08'),undefined,'MANAGER'),403)
 await ok(await call('shifts/flexible-slots','DELETE',{staffId:a+'_staff',date:'2037-01-07'},undefined,'MANAGER'),403)
})

test('daily roster conflicts use business dates across UTC midnight and redact private bookings',async()=>{
 const {id,profile}=await modeStaff('daily_midnight','FLEXIBLE'),booking=profile+'_booking',day='2037-01-07'
 const overrides=extra=>overrideBody(day,{staffId:id,...extra}),slots=extra=>slotBody(day,{staffId:id,...extra})
 await ok(await call('shifts/flexible-slots','POST',slots({slots:[{startTime:'00:00',endTime:'23:59'}]})))
 await root.query(`INSERT INTO "Appointment" (id,"tenantId","staffProfileId","customerId","serviceId","startAt","endAt","updatedAt") VALUES ($1,$2,$3,$4,$5,'2037-01-08T04:00:00Z','2037-01-08T05:00:00Z',now())`,[booking,a,profile,a+'_customer',a+'_service'])
 try {
  for(const [timeZone,start,end] of [['America/Los_Angeles','2037-01-08T04:00:00Z','2037-01-08T05:00:00Z'],['Asia/Kolkata','2037-01-06T19:00:00Z','2037-01-06T20:00:00Z']]){
   await root.query('UPDATE "AppSetting" SET "timeZone"=$1 WHERE "tenantId"=$2',[timeZone,a])
   await root.query('UPDATE "Appointment" SET "startAt"=$1,"endAt"=$2 WHERE id=$3',[start,end,booking])
   let result=await ok(await call('shifts/overrides','POST',overrides({isUnavailable:true})),409)
   assert.equal(result.conflictCount,1);assert.equal(result.conflicts[0].id,booking)
   result=await ok(await call('shifts/flexible-slots','POST',slots(),undefined,'MANAGER'),409)
   assert.equal(result.conflictCount,1);assert.deepEqual(result.conflicts,[])
   await flag('appointments',false)
   result=await ok(await call('shifts/overrides','POST',overrides({isUnavailable:true})),409)
   assert.equal(result.conflictCount,1);assert.deepEqual(result.conflicts,[])
   await flag('appointments',true)
  }
  await root.query(`UPDATE "AppSetting" SET "timeZone"='UTC' WHERE "tenantId"=$1`,[a])
  await root.query(`UPDATE "Appointment" SET "startAt"='2037-01-07T12:15:00Z',"endAt"='2037-01-07T12:45:00Z' WHERE id=$1`,[booking])
  await ok(await call('shifts/overrides','POST',overrides()),409)
  await root.query(`UPDATE "Appointment" SET "startAt"='2037-01-07T09:30:00Z',"endAt"='2037-01-07T10:30:00Z' WHERE id=$1`,[booking])
  await ok(await call('shifts/overrides','POST',overrides()))
  // Already-invalid overnight records do not block an unrelated daily-slot edit.
  await root.query(`UPDATE "AppSetting" SET "timeZone"='America/Los_Angeles' WHERE "tenantId"=$1`,[a])
  await root.query(`UPDATE "Appointment" SET "startAt"='2037-01-07T07:00:00Z',"endAt"='2037-01-07T09:00:00Z' WHERE id=$1`,[booking])
  await ok(await call('shifts/flexible-slots','POST',slots()))
  // An appointment ending exactly at local midnight does not occupy the next day.
  await root.query(`UPDATE "Appointment" SET "endAt"='2037-01-07T08:00:00Z' WHERE id=$1`,[booking])
  await ok(await call('shifts/flexible-slots','POST',slots()))
 } finally {await root.query('DELETE FROM "Appointment" WHERE id=$1',[booking]);await root.query(`UPDATE "AppSetting" SET "timeZone"='UTC' WHERE "tenantId"=$1`,[a]);await flag('appointments',true)}
})

test('override history preserves UTC calendar dates and save/delete roll back on history failure',async t=>{
 const history=require('../modules/workforce/roster-history.ts'),date='2020-02-03'
 await root.query(`UPDATE "AppSetting" SET "timeZone"='Asia/Kolkata' WHERE "tenantId"=$1`,[a])
 await ok(await call('shifts/overrides','POST',overrideBody(date)))
 const query='?startDate='+date+'&endDate='+date+'&staffIds='+a+'_staff'
 let rows=(await ok(await call('shifts/history','GET',undefined,undefined,'ADMIN',a,query))).items
 assert.equal(rows.length,1);assert.equal(rows[0].date,date);assert.equal(rows[0].source,'OVERRIDE')
 const stub=t.mock.method(history,'syncRosterHistoryRange',async()=>{throw Error('History rollback test')})
 try {
  await ok(await call('shifts/overrides','POST',overrideBody(date,{isUnavailable:true})),500)
  await ok(await call('shifts/overrides','DELETE',{staffId:a+'_staff',startDate:date,endDate:date}),500)
  assert.equal((await root.query('SELECT "templateId" FROM "StaffShiftOverride" WHERE "staffProfileId"=$1 AND date=$2',[a+'_profile',date])).rows[0].templateId,template.id)
 } finally {stub.mock.restore()}
 await ok(await call('shifts/overrides','DELETE',{staffId:a+'_staff',startDate:date,endDate:date}))
 rows=(await ok(await call('shifts/history','GET',undefined,undefined,'ADMIN',a,query))).items
 assert.notEqual(rows[0].source,'OVERRIDE');assert.equal(rows[0].date,date)
 const audit=(await root.query(`SELECT "before","after" FROM "AuditLog" WHERE "tenantId"=$1 AND event='workforce.shiftRoster.archive' ORDER BY "createdAt" DESC LIMIT 1`,[a])).rows[0]
 assert.equal(audit.before[0].templateId,template.id);assert.deepEqual(audit.after,[])
 await root.query(`UPDATE "AppSetting" SET "timeZone"='UTC' WHERE "tenantId"=$1`,[a])
})

test('daily slot replacement is serialized and its past history commits atomically',async t=>{
 const date='2020-02-04',history=require('../modules/workforce/roster-history.ts')
 await ok(await call('shifts/flexible-slots','POST',slotBody(date)))
 const original=(await root.query('SELECT * FROM "StaffFlexibleAvailability" WHERE "staffProfileId"=$1 AND date=$2',[a+'_profile',date])).rows
 const stub=t.mock.method(history,'syncRosterHistoryRange',async()=>{throw Error('Slot history failure')})
 try {
  await ok(await call('shifts/flexible-slots','POST',slotBody(date,{slots:[{startTime:'10:00',endTime:'12:00'}]})),500)
  await ok(await call('shifts/flexible-slots','DELETE',{staffId:a+'_staff',date}),500)
  assert.deepEqual((await root.query('SELECT * FROM "StaffFlexibleAvailability" WHERE "staffProfileId"=$1 AND date=$2',[a+'_profile',date])).rows,original)
 }finally{stub.mock.restore()}
 const bodies=[[{startTime:'09:00',endTime:'10:00'},{startTime:'11:00',endTime:'12:00'}],[{startTime:'13:00',endTime:'14:00'},{startTime:'15:00',endTime:'16:00'}]]
 for(const response of await Promise.all(bodies.map(slots=>call('shifts/flexible-slots','POST',slotBody(date,{slots})))))await ok(response)
 const saved=(await root.query('SELECT "startTime","endTime" FROM "StaffFlexibleAvailability" WHERE "staffProfileId"=$1 AND date=$2 ORDER BY "sortOrder"',[a+'_profile',date])).rows
 assert.ok(bodies.some(body=>JSON.stringify(body)===JSON.stringify(saved)))
 let rows=(await ok(await call('shifts/history','GET',undefined,undefined,'ADMIN',a,'?startDate='+date+'&endDate='+date+'&staffIds='+a+'_staff'))).items
 assert.equal(rows[0].paidMinutes,120);assert.equal(rows[0].templateName,'Flexible');assert.equal(rows[0].startTime,saved[0].startTime)
 await ok(await call('shifts/flexible-slots','DELETE',{staffId:a+'_staff',date}))
 rows=(await ok(await call('shifts/history','GET',undefined,undefined,'ADMIN',a,'?startDate='+date+'&endDate='+date+'&staffIds='+a+'_staff'))).items
 assert.equal(rows[0].source,'OFF');assert.equal(rows[0].paidMinutes,0)
})


test('skipped holidays and week-offs retain existing overrides and historical snapshots',async()=>{
 const schedule=(await root.query('SELECT id,"startDate" FROM "ShiftSchedule" WHERE "tenantId"=$1 AND "isDefault"',[a])).rows[0]
 await root.query(`UPDATE "ShiftSchedule" SET "startDate"='2020-02-01' WHERE id=$1`,[schedule.id])
 await root.query(`INSERT INTO "AppSettingOverride" (id,"settingId",date,"isOpen") VALUES ($1,$2,'2020-02-03',false)`,[a+'_holiday',a+'_settings'])
 try {
  for(const date of ['2020-02-02','2020-02-03'])await ok(await call('shifts/overrides','POST',overrideBody(date,{isUnavailable:true})))
  await root.query(`UPDATE "StaffRosterHistoryDay" SET "templateName"='Preserved snapshot' WHERE "staffProfileId"=$1 AND date BETWEEN '2020-02-02' AND '2020-02-03'`,[a+'_profile'])
  const result=await ok(await call('shifts/overrides','POST',overrideBody('2020-02-02',{endDate:'2020-02-04',skipHolidays:true,skipWeekOff:true})))
  assert.equal(result.createdCount,1)
  const rows=(await ok(await call('shifts/history','GET',undefined,undefined,'ADMIN',a,'?startDate=2020-02-02&endDate=2020-02-04&staffIds='+a+'_staff'))).items
  assert.deepEqual(rows.map(r=>r.date),['2020-02-02','2020-02-03','2020-02-04'])
  assert.deepEqual(rows.map(r=>r.source),['UNAVAILABLE','UNAVAILABLE','OVERRIDE'])
  assert.deepEqual(rows.slice(0,2).map(r=>r.templateName),['Preserved snapshot','Preserved snapshot'])
  assert.equal(rows[2].paidMinutes,420)
 }finally{
  await root.query('UPDATE "ShiftSchedule" SET "startDate"=$1 WHERE id=$2',[schedule.startDate,schedule.id])
  await root.query('DELETE FROM "AppSettingOverride" WHERE id=$1',[a+'_holiday'])
 }
})


const planDays=(start='09:00',end='17:00')=>['MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY','SUNDAY'].map((day,index)=>({day,isOff:index>=5,sortOrder:6-index,slots:index>=5?[]:[{startTime:start,endTime:end,breaks:[{startTime:'12:00',endTime:'13:00'}]}]}))
const weekBody=()=>({staffId:a+'_staff',weekStartDate:'2038-01-04',days:planDays()})
const cycleBody=(extra={})=>({staffId:a+'_staff',name:'Shared cycle',cycleLengthWeeks:2,validFrom:'2038-01-04',validTo:'2038-02-01',isActive:true,weeks:[{weekIndex:2,days:planDays('10:00','18:00')},{weekIndex:1,days:planDays()}],...extra})
let batchPattern

test('weekly plan round trips share ordering and enforce mode, tenant, dates and access checks',async()=>{
 const body=weekBody()
 await perms(['shiftRoster.read','shiftRoster.edit'])
 const saved=(await ok(await call('shifts/flexible-week-plans','PUT',body,undefined,'MANAGER'))).item
 assert.equal(saved.days.length,7);assert.equal(saved.days[0].day,'SUNDAY');assert.equal(saved.days[6].slots[0].breaks[0].startTime,'12:00')
 const query='?staffId='+a+'_staff'+'&weekStartDate='+body.weekStartDate
 let loaded=await ok(await call('shifts/flexible-week-plans','GET',undefined,undefined,'ADMIN',a,query))
 assert.deepEqual(loaded.item,saved)
 loaded=await ok(await call('shifts/flexible-week-plans','GET',undefined,undefined,'ADMIN',a,query+'&staffIds='+a+'_staff,'+b+'_staff'))
 assert.equal(loaded.item,null);assert.equal(loaded.items.length,1)
 await ok(await call('shifts/flexible-week-plans','PUT',{...body,staffId:b+'_staff'}),404)
 await ok(await call('shifts/flexible-week-plans','GET',undefined,undefined,'ADMIN',b,query),404)
 for(const weekStartDate of ['2038-01-05','2038-02-30'])await ok(await call('shifts/flexible-week-plans','PUT',{...body,weekStartDate}),400)
 await root.query(`UPDATE "StaffProfile" SET "schedulingMode"='STANDARD' WHERE id=$1`,[a+'_profile'])
 await ok(await call('shifts/flexible-week-plans','PUT',body),409)
 await ok(await call('shifts/flexible-week-plans','DELETE',body),409)
 await root.query(`UPDATE "StaffProfile" SET "schedulingMode"='FLEXIBLE' WHERE id=$1`,[a+'_profile'])
 await ok(await call('shifts/flexible-week-plans','DELETE',body,undefined,'MANAGER'),403)
 await perms(['shiftRoster.read','shiftRoster.edit','shiftRoster.archive'])
 assert.equal((await ok(await call('shifts/flexible-week-plans','DELETE',body,undefined,'MANAGER'))).deletedCount,1)
 assert.equal((await ok(await call('shifts/flexible-week-plans','GET',undefined,undefined,'ADMIN',a,query))).item,null)
 await ok(await call('shifts/flexible-week-plans','PUT',body))
})

test('recurring lists, details and clone preserve structure and audit the new destination',async()=>{
 batchPattern=(await ok(await call('shifts/flexible-patterns','PUT',cycleBody()))).item
 assert.deepEqual(batchPattern.weeks.map(w=>w.weekIndex),[1,2]);assert.equal(batchPattern.weeks[0].days[6].slots[0].breaks.length,1)
 assert.deepEqual((await ok(await call('shifts/flexible-patterns/[id]','GET',undefined,batchPattern.id))).item,batchPattern)
 await ok(await call('shifts/flexible-patterns/[id]','GET',undefined,batchPattern.id,'ADMIN',b),404)
 const items=(await ok(await call('shifts/flexible-patterns/list','GET',undefined,undefined,'ADMIN',a,'?q=Shared&effectiveOn=2038-01-04&page=1&pageSize=1'))).items
 assert.equal(items[0].id,batchPattern.id);assert.equal(items[0].isCurrentlyEffective,true)
 for(const query of ['?pageSize=101','?page=1.5','?page=NaN','?effectiveOn=2038-02-30'])await ok(await call('shifts/flexible-patterns/list','GET',undefined,undefined,'ADMIN',a,query),400)
 for(const id of ['missing',b+'_staff'])assert.deepEqual((await ok(await call('shifts/flexible-patterns','GET',undefined,undefined,'ADMIN',a,'?staffId='+id))).items,[])
 await ok(await call('shifts/flexible-patterns','GET',undefined,undefined,'ADMIN',a,'?staffId='+a+'_staff&startDate=2038-02-01&endDate=2038-01-04'),400)
 const clone={validFrom:'2038-01-04',validTo:'2038-02-01',activate:true}
 await perms(['shiftPlans.read','shiftPlans.create'])
 await ok(await call('shifts/flexible-patterns/[id]/clone','POST',clone,batchPattern.id,'MANAGER'),403)
 assert.equal((await root.query('SELECT "isActive" FROM "StaffFlexiblePattern" WHERE id=$1',[batchPattern.id])).rows[0].isActive,true)
 await ok(await call('shifts/flexible-patterns/[id]/clone','POST',{...clone,targetStaffId:b+'_staff'},batchPattern.id),404)
 const inactive=(await ok(await call('shifts/flexible-patterns/[id]/clone','POST',{...clone,activate:false},batchPattern.id,'MANAGER'))).id
 assert.equal((await root.query('SELECT "isActive" FROM "StaffFlexiblePattern" WHERE id=$1',[batchPattern.id])).rows[0].isActive,true)
 const cloned=(await ok(await call('shifts/flexible-patterns/[id]','GET',undefined,inactive))).item
 const structure=row=>row.weeks.map(w=>({weekIndex:w.weekIndex,days:w.days.map(d=>({day:d.day,isOff:d.isOff,sortOrder:d.sortOrder,slots:d.slots.map(s=>({startTime:s.startTime,endTime:s.endTime,sortOrder:s.sortOrder,breaks:s.breaks.map(b=>({startTime:b.startTime,endTime:b.endTime,sortOrder:b.sortOrder}))}))}))}))
 assert.deepEqual(structure(cloned),structure(batchPattern))
 const audit=(await root.query(`SELECT "entityId","before","after" FROM "AuditLog" WHERE "entityId"=$1 AND event='workforce.shiftPlans.create'`,[inactive])).rows[0]
 assert.equal(audit.entityId,inactive);assert.equal(audit.before.id,batchPattern.id);assert.equal(audit.after.id,inactive);assert.equal(audit.after.isActive,false)
 await perms(['shiftPlans.read','shiftPlans.create','shiftPlans.archive'])
 const active=(await ok(await call('shifts/flexible-patterns/[id]/clone','POST',clone,batchPattern.id,'MANAGER'))).id
 assert.equal((await root.query('SELECT "isActive" FROM "StaffFlexiblePattern" WHERE id=$1',[batchPattern.id])).rows[0].isActive,false)
 const changed=(await root.query(`SELECT "before" FROM "AuditLog" WHERE "tenantId"=$1 AND event='workforce.shiftPlans.archive' AND "before" ? 'activePatternIds' ORDER BY "createdAt" DESC LIMIT 1`,[a])).rows[0]
 assert.deepEqual(changed.before.activePatternIds,[batchPattern.id])
 batchPattern=(await ok(await call('shifts/flexible-patterns/[id]','GET',undefined,active))).item
})

test('concurrent recurring writers serialize overlap decisions and require archive on actual displacement',async()=>{
 const extra={validFrom:'2039-01-03',validTo:'2039-01-31'}
 await perms(['shiftPlans.read','shiftPlans.create'])
 const responses=await Promise.all([1,2].map(i=>call('shifts/flexible-patterns','PUT',cycleBody({...extra,name:'Concurrent '+i}),undefined,'MANAGER')))
 assert.deepEqual(responses.map(r=>r.status).sort(),[200,403])
 const active=(await root.query(`SELECT id FROM "StaffFlexiblePattern" WHERE "staffProfileId"=$1 AND "isActive" AND "validFrom"='2039-01-03'`,[a+'_profile'])).rows
 assert.equal(active.length,1)
 const updated=await Promise.all([1,2].map(i=>call('shifts/flexible-patterns','PUT',cycleBody({...extra,name:'Admin concurrent '+i}))))
 for(const response of updated)await ok(response)
 assert.equal((await root.query(`SELECT count(*)::int n FROM "StaffFlexiblePattern" WHERE "staffProfileId"=$1 AND "isActive" AND "validFrom"='2039-01-03'`,[a+'_profile'])).rows[0].n,1)
 assert.equal((await root.query('SELECT "isActive" FROM "StaffFlexiblePattern" WHERE id=$1',[batchPattern.id])).rows[0].isActive,true)
 // An omitted isActive defaults to true; it cannot bypass archive permission on reactivation.
 await ok(await call('shifts/flexible-patterns/[id]/deactivate','POST',{},batchPattern.id))
 await perms(['shiftPlans.read','shiftPlans.edit'])
 const body=cycleBody({patternId:batchPattern.id});delete body.isActive
 await ok(await call('shifts/flexible-patterns','PUT',body,undefined,'MANAGER'),403)
 await ok(await call('shifts/flexible-patterns','PUT',body))
})

test('failed nested plan writes roll back child replacement, displaced patterns and their audits',async()=>{
 const trigger='wf_plan_'+suffix,fn=trigger+'_fail'
 await root.query(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."startTime"='13:37' THEN RAISE EXCEPTION 'Simulated plan break failure'; END IF; RETURN NEW; END $$;
 CREATE TRIGGER ${trigger} BEFORE INSERT ON "StaffFlexibleWeekBreak" FOR EACH ROW EXECUTE FUNCTION ${fn}();
 CREATE TRIGGER ${trigger} BEFORE INSERT ON "StaffFlexiblePatternBreak" FOR EACH ROW EXECUTE FUNCTION ${fn}();`)
 try {
  const existing=(await ok(await call('shifts/flexible-week-plans','GET',undefined,undefined,'ADMIN',a,'?staffId='+a+'_staff&weekStartDate=2038-01-04'))).item
  const days=planDays();days[0].slots[0].breaks=[{startTime:'13:37',endTime:'13:38'}]
  await ok(await call('shifts/flexible-week-plans','PUT',{...weekBody(),days}),500)
  assert.deepEqual((await ok(await call('shifts/flexible-week-plans','GET',undefined,undefined,'ADMIN',a,'?staffId='+a+'_staff&weekStartDate=2038-01-04'))).item,existing)
  const auditCount=async()=>Number((await root.query('SELECT count(*) n FROM "AuditLog" WHERE "tenantId"=$1',[a])).rows[0].n)
  const before=await auditCount(),saved=(await ok(await call('shifts/flexible-patterns/[id]','GET',undefined,batchPattern.id))).item
  const bad=cycleBody({weeks:[{weekIndex:1,days},{weekIndex:2,days:planDays()}]})
  await ok(await call('shifts/flexible-patterns','PUT',bad),500)
  await ok(await call('shifts/flexible-patterns','PUT',{...bad,patternId:batchPattern.id}),500)
  assert.deepEqual((await ok(await call('shifts/flexible-patterns/[id]','GET',undefined,batchPattern.id))).item,saved)
  assert.equal(await auditCount(),before)
 }finally{await root.query(`DROP TRIGGER ${trigger} ON "StaffFlexibleWeekBreak"; DROP TRIGGER ${trigger} ON "StaffFlexiblePatternBreak"; DROP FUNCTION ${fn}();`)}
})

test('pattern previews use bounded business-date windows, count clones consistently and never mutate',async()=>{
 const booking=a+'_plan_booking'
 await root.query(`UPDATE "AppSetting" SET "timeZone"='America/Los_Angeles' WHERE "tenantId"=$1`,[a])
 await root.query(`INSERT INTO "Appointment" (id,"tenantId","staffProfileId","customerId","serviceId","startAt","endAt","updatedAt") VALUES ($1,$2,$3,$4,$5,'2038-01-05T04:00:00Z','2038-01-05T05:00:00Z',now())`,[booking,a,a+'_profile',a+'_customer',a+'_service'])
 const body={mode:'CLONE',patternId:batchPattern.id,validFrom:'2038-01-04',validTo:'2038-01-04',activate:true}
 try{
  await perms(['shiftPlans.read'])
  const preview=(await ok(await call('shifts/flexible-patterns/impact-preview','POST',body,undefined,'MANAGER'))).preview
  assert.equal(preview.affectedAppointmentsCount,1);assert.equal(preview.overlappingActivePatternsCount,1);assert.equal(preview.estimatedBookedMinutesInWindow,420)
  const horizon=(await ok(await call('shifts/flexible-patterns/impact-preview','POST',{...body,validTo:''}))).preview
  assert.equal((Date.parse(horizon.window.truncatedAt)-Date.parse(horizon.window.startDate))/86400000+1,90)
  const draft=cycleBody();draft.weeks[0].days[0].slots[0].breaks=[{startTime:'18:00',endTime:'19:00'}]
  await ok(await call('shifts/flexible-patterns/impact-preview','POST',{...body,weeks:draft.weeks,cycleLengthWeeks:2}),400)
  await ok(await call('shifts/flexible-patterns/impact-preview','POST',{...body,validFrom:'2038-02-30'}),400)
  await ok(await call('shifts/flexible-patterns/impact-preview','POST',body,undefined,'ADMIN',b),404)
  assert.equal((await root.query('SELECT "isActive" FROM "StaffFlexiblePattern" WHERE id=$1',[batchPattern.id])).rows[0].isActive,true)
 }finally{await root.query('DELETE FROM "Appointment" WHERE id=$1',[booking]);await root.query(`UPDATE "AppSetting" SET "timeZone"='UTC' WHERE "tenantId"=$1`,[a])}
})


test('saved weekly plans override recurring availability and clearing restores the recurring cycle',async()=>{
 const {checkAsAdministrator:check}=require('./helpers/availability-fixtures.cjs')
 const {runWithTenantDbContext}=require('../lib/prisma.ts')
 const at=(date,start,end)=>runWithTenantDbContext(a,()=>check(a+'_profile',new Date(date+'T'+start+':00Z'),new Date(date+'T'+end+':00Z'),a))
 assert.equal((await at('2038-01-04','14:00','15:00')).ok,true)
 assert.equal((await at('2038-01-04','12:15','12:45')).ok,false)
 const offDays=planDays().map(day=>({...day,isOff:true,slots:[]}))
 await ok(await call('shifts/flexible-week-plans','PUT',{...weekBody(),days:offDays}))
 assert.equal((await at('2038-01-04','14:00','15:00')).ok,false)
 await ok(await call('shifts/flexible-week-plans','DELETE',weekBody()))
 assert.equal((await at('2038-01-04','14:00','15:00')).ok,true)
 // Week two starts later; breaks are still excluded after reading nested records.
 assert.equal((await at('2038-01-11','09:00','09:30')).ok,false)
 assert.equal((await at('2038-01-11','17:00','17:30')).ok,true)
 await ok(await call('shifts/flexible-patterns','DELETE',{patternId:batchPattern.id}))
 assert.equal((await at('2038-01-11','17:00','17:30')).ok,false)
})

async function waitForScheduleWaiters(minimum=1) {
 const deadline=Date.now()+3000
 while(Date.now()<deadline){
  const n=(await root.query(`SELECT count(*)::int n FROM pg_locks held JOIN pg_locks waiter ON held.classid=waiter.classid AND held.objid=waiter.objid AND held.objsubid=waiter.objsubid WHERE held.pid=pg_backend_pid() AND held.locktype='advisory' AND NOT waiter.granted`)).rows[0].n
  if(n>=minimum)return
  await new Promise(resolve=>setTimeout(resolve,15))
 }
 assert.fail('Expected requests to wait on the shared scheduling lock')
}
async function insertConflict(id, start, end) {
 await root.query('INSERT INTO "Appointment" (id,"tenantId","staffProfileId","customerId","serviceId","startAt","endAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,now())',[id,a,a+'_profile',a+'_customer',a+'_service',start,end])
}

async function modeStaff(key,mode='STANDARD') {
 const id=a+'_mode_'+key,profile=id+'_profile'
 await root.query(`INSERT INTO "User" (id,name,email,role,"tenantId","updatedAt") VALUES ($1,$1,$2,'STAFF',$3,now())`,[id,id+'@example.test',a])
 await root.query(`INSERT INTO "StaffProfile" (id,"userId","schedulingMode","updatedAt") VALUES ($1,$2,$3,now())`,[profile,id,mode])
 return {id,profile}
}
function updateMode(id,body,tenant=a,role='ADMIN') {
 const route=require('../app/api/users/[id]/route.ts')
 return sessions.run(session(tenant,role),()=>route.PATCH(new Request(`http://${tenant}.localhost/api/users/${id}`,{method:'PATCH',headers:{host:`${tenant}.localhost`,'content-type':'application/json'},body:JSON.stringify(body)}),{params:Promise.resolve({id})}))
}

test('staff mode switches preserve historical plans and return the saved mode without duplicate audits',async()=>{
 const {id,profile}=await modeStaff('history','FLEXIBLE')
 await root.query('INSERT INTO "StaffFlexibleAvailability" (id,"staffProfileId",date,"startTime","endTime","sortOrder","updatedAt") VALUES ($1,$2,$3,$4,$5,0,now())',[id+'_slot',profile,'2020-01-06','09:00','17:00'])
 await root.query('INSERT INTO "StaffRosterHistoryDay" (id,"staffProfileId",date,source,"paidMinutes","updatedAt") VALUES ($1,$2,$3,$4,480,now())',[id+'_history',profile,'2020-01-06','SCHEDULE'])
 const before=(await root.query('SELECT * FROM "StaffRosterHistoryDay" WHERE "staffProfileId"=$1',[profile])).rows
 const body={staffProfile:{schedulingMode:'STANDARD'}}
 assert.equal((await ok(await updateMode(id,body))).user.staffProfile.schedulingMode,'STANDARD')
 assert.equal((await ok(await updateMode(id,body))).user.staffProfile.schedulingMode,'STANDARD')
 assert.equal((await root.query('SELECT count(*)::int n FROM "AuditLog" WHERE "entityId"=$1 AND event=$2',[id,'workforce.shiftRoster.edit'])).rows[0].n,1)
 assert.deepEqual((await root.query('SELECT * FROM "StaffRosterHistoryDay" WHERE "staffProfileId"=$1',[profile])).rows,before)
 assert.equal((await root.query('SELECT count(*)::int n FROM "StaffFlexibleAvailability" WHERE "staffProfileId"=$1',[profile])).rows[0].n,1)
 await ok(await updateMode(id,body,b),404)
 await flag('shifts',false)
 try {await ok(await updateMode(id,body));await ok(await updateMode(id,{staffProfile:{schedulingMode:'FLEXIBLE'}}),403)}finally{await flag('shifts',true)}
})

test('concurrent weekly plan creation and mode switching cannot leave a Standard staff member with a new flexible plan',async()=>{
 const {id,profile}=await modeStaff('plan_race','FLEXIBLE')
 await root.query('BEGIN');let plan,mode
 try{
  await root.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`workforce-schedules:${a}`])
  plan=call('shifts/flexible-week-plans','PUT',{...weekBody(),staffId:id})
  mode=updateMode(id,{staffProfile:{schedulingMode:'STANDARD'}})
  await waitForScheduleWaiters(2);await root.query('COMMIT')
  const statuses=(await Promise.all([plan,mode])).map(r=>r.status).sort();assert.deepEqual(statuses,[200,409])
  const current=(await root.query('SELECT "schedulingMode" FROM "StaffProfile" WHERE id=$1',[profile])).rows[0].schedulingMode
  const count=(await root.query('SELECT count(*)::int n FROM "StaffFlexibleWeekPlan" WHERE "staffProfileId"=$1',[profile])).rows[0].n
  assert.equal(count,current==='STANDARD'?0:1)
 }finally{await root.query('ROLLBACK');await Promise.all([plan,mode].filter(Boolean))}
})

test('mode changes recheck bookings and module allowance after waiting and roll back the whole user edit',async()=>{
 const {id,profile}=await modeStaff('booking'),booking=id+'_appointment'
 await root.query('BEGIN');let pending
 try{
  await root.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`workforce-schedules:${a}`])
  pending=updateMode(id,{name:'Must not save',staffProfile:{schedulingMode:'FLEXIBLE'}})
  await waitForScheduleWaiters()
  await root.query('INSERT INTO "Appointment" (id,"tenantId","staffProfileId","customerId","serviceId","startAt","endAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,now())',[booking,a,profile,a+'_customer',a+'_service','2047-01-07T10:00:00Z','2047-01-07T11:00:00Z'])
  await root.query('COMMIT');const response=await ok(await pending,409);assert.match(response.error,/Resolve active\/future appointments/)
  assert.equal((await root.query('SELECT name FROM "User" WHERE id=$1',[id])).rows[0].name,id)
  await root.query('UPDATE "Appointment" SET status=$1,"startAt"=$2,"endAt"=$3 WHERE id=$4',['IN_PROGRESS','2020-01-06T10:00:00Z','2020-01-06T11:00:00Z',booking])
  await ok(await updateMode(id,{staffProfile:{schedulingMode:'FLEXIBLE'}}),409)
  await root.query('UPDATE "Appointment" SET status=$1 WHERE id=$2',['CANCELED',booking])
  await root.query('BEGIN');await root.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`workforce-schedules:${a}`])
  pending=updateMode(id,{staffProfile:{schedulingMode:'FLEXIBLE'}});await waitForScheduleWaiters()
  await flag('shifts',false);await root.query('COMMIT');await ok(await pending,403)
  await flag('shifts',true)
  assert.equal((await ok(await updateMode(id,{staffProfile:{schedulingMode:'FLEXIBLE'}}))).user.staffProfile.schedulingMode,'FLEXIBLE')
 }finally{await root.query('ROLLBACK');if(pending)await pending;await flag('shifts',true);await root.query('DELETE FROM "Appointment" WHERE id=$1',[booking])}
})

test('scheduling-mode audit failure preserves user details, profile and mode and returns a safe server error',async()=>{
 const {id,profile}=await modeStaff('audit'),trigger='wf_mode_audit_'+suffix
 await root.query(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."entityId"='${id}' AND NEW.event='workforce.shiftRoster.edit' THEN RAISE EXCEPTION 'Private database detail'; END IF; RETURN NEW; END $$; CREATE TRIGGER ${trigger} BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION ${trigger}()`)
 try{
  assert.equal((await ok(await updateMode(id,{name:'Must roll back',staffProfile:{schedulingMode:'FLEXIBLE'}}),500)).error,'Unable to update user.')
  assert.equal((await root.query('SELECT name FROM "User" WHERE id=$1',[id])).rows[0].name,id)
  assert.equal((await root.query('SELECT "schedulingMode" FROM "StaffProfile" WHERE id=$1',[profile])).rows[0].schedulingMode,'STANDARD')
 }finally{await root.query(`DROP TRIGGER ${trigger} ON "AuditLog";DROP FUNCTION ${trigger}()`)}
})

test('full twelve-week recurring plans and clones use bounded bulk inserts under tenant RLS',async()=>{
 const pg=require('pg'),original=pg.Client.prototype.query,counts=new Map()
 pg.Client.prototype.query=function(...args){const sql=typeof args[0]==='string'?args[0]:args[0]?.text;const model=sql?.match(/^INSERT INTO "public"\."(StaffFlexible\w+)"/)?.[1];if(model)counts.set(model,(counts.get(model)||0)+1);return original.apply(this,args)}
 try{
  const body=cycleBody({name:'Twelve weeks',cycleLengthWeeks:12,validFrom:'2043-01-05',validTo:'2043-04-01',weeks:Array.from({length:12},(_,i)=>({weekIndex:i+1,days:planDays()}))})
  const saved=(await ok(await call('shifts/flexible-patterns','PUT',body))).item
  assert.equal(saved.weeks.length,12);assert.equal(saved.weeks.flatMap(w=>w.days).length,84)
  assert.equal([...counts.values()].reduce((a,b)=>a+b,0),5)
  counts.clear()
  const cloned=await ok(await call('shifts/flexible-patterns/[id]/clone','POST',{validFrom:'2044-01-04',validTo:'2044-04-01',activate:false},saved.id))
  assert.ok(cloned.id);assert.equal([...counts.values()].reduce((a,b)=>a+b,0),5)
  counts.clear()
  await ok(await call('shifts/flexible-week-plans','PUT',{...weekBody(),weekStartDate:'2043-01-05'}))
  assert.equal([...counts.values()].reduce((a,b)=>a+b,0),4)
 }finally{pg.Client.prototype.query=original}
})

test('single and bulk leave approval reread booking conflicts after waiting on the schedule lock',async()=>{
 for(const bulk of [false,true]){
  const date=bulk?'2041-02-05':'2041-02-04',id=await requestFixture('locked_'+bulk,{date}),booking=a+'_locked_'+bulk
  await root.query('BEGIN');let pending
  try{
   await root.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`workforce-schedules:${a}`])
   pending=bulk?call('leaves/requests/review-bulk','POST',{requestIds:[id],status:'APPROVED'}):call('leaves/requests/[id]/review','PATCH',{status:'APPROVED'},id)
   await waitForScheduleWaiters()
   await insertConflict(booking,date+'T10:00:00Z',date+'T11:00:00Z')
   await root.query('COMMIT')
   await ok(await pending,409)
   assert.equal((await root.query('SELECT status FROM "LeaveRequest" WHERE id=$1',[id])).rows[0].status,'PENDING')
  }finally{await root.query('ROLLBACK');if(pending)await pending;await root.query('DELETE FROM "Appointment" WHERE id=$1',[booking])}
 }
})

test('concurrent booking and leave approval cannot both reserve the same staff time',async()=>{
 const date='2041-02-06',id=await requestFixture('booking_race',{date})
 await root.query(`INSERT INTO "TenantModule" ("tenantId",key,allowed,enabled,"updatedAt") VALUES ($1,'services',true,true,now()) ON CONFLICT ("tenantId",key) DO UPDATE SET allowed=true,enabled=true`,[a])
 await root.query(`INSERT INTO "StaffFlexibleAvailability" (id,"staffProfileId",date,"startTime","endTime","sortOrder","updatedAt") VALUES ($1,$2,$3,'09:00','17:00',0,now())`,[a+'_race_slot',a+'_profile',date])
 const bookingRoute=require('../app/api/appointments/route.ts')
 await root.query('BEGIN');let approval,booking
 try{
  await root.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`workforce-schedules:${a}`])
  approval=call('leaves/requests/[id]/review','PATCH',{status:'APPROVED'},id)
  booking=sessions.run(session(),()=>bookingRoute.POST(new Request(`http://${a}.localhost/api/appointments`,{method:'POST',headers:{host:`${a}.localhost`,'content-type':'application/json'},body:JSON.stringify({serviceId:a+'_service',staffId:a+'_staff',customerId:a+'_customer',startAt:date+'T10:00:00Z'})})))
  await waitForScheduleWaiters(2);await root.query('COMMIT')
  const responses=await Promise.all([approval,booking]),states=responses.map(r=>r.status)
  assert.ok(states.includes(409),JSON.stringify(states));assert.equal(states.filter(s=>s===200||s===201).length,1)
  const approved=(await root.query('SELECT status FROM "LeaveRequest" WHERE id=$1',[id])).rows[0].status==='APPROVED'
  const count=(await root.query('SELECT count(*)::int n FROM "Appointment" WHERE "tenantId"=$1 AND "startAt"=$2',[a,date+'T10:00:00Z'])).rows[0].n
  assert.equal(count,approved?0:1)
 }finally{await root.query('ROLLBACK');await Promise.all([approval,booking].filter(Boolean));await root.query('DELETE FROM "Appointment" WHERE "tenantId"=$1 AND "startAt"=$2',[a,date+'T10:00:00Z'])}
})

test('leave approval uses tenant calendar midnight and excludes appointments starting on the following day',async()=>{
 await root.query(`UPDATE "AppSetting" SET "timeZone"='Asia/Kolkata' WHERE "tenantId"=$1`,[a])
 const id=await requestFixture('local_midnight',{date:'2042-01-07'}),booking=a+'_midnight_boundary'
 try{
  await insertConflict(booking,'2042-01-06T18:45:00Z','2042-01-06T19:15:00Z')
  await ok(await call('leaves/requests/[id]/review','PATCH',{status:'APPROVED'},id),409)
  await root.query('UPDATE "Appointment" SET "startAt"=$1,"endAt"=$2 WHERE id=$3',['2042-01-07T18:30:00Z','2042-01-07T19:30:00Z',booking])
  await ok(await call('leaves/requests/[id]/review','PATCH',{status:'APPROVED'},id))
 }finally{await root.query('DELETE FROM "Appointment" WHERE id=$1',[booking]);await root.query(`UPDATE "AppSetting" SET "timeZone"='UTC' WHERE "tenantId"=$1`,[a])}
})

test('leave approval cannot retain a manager scope revoked while waiting for the lock',async()=>{
 const id=await requestFixture('manager_locked',{date:'2041-03-04'})
 await perms(['leaveApprovals.read','leaveApprovals.approve'])
 await root.query('BEGIN');let pending
 try{
  await root.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`workforce-schedules:${a}`])
  pending=call('leaves/requests/[id]/review','PATCH',{status:'APPROVED'},id,'MANAGER')
  await waitForScheduleWaiters()
  await root.query('UPDATE "StaffProfile" SET "managerUserId"=NULL WHERE id=$1',[a+'_profile']);await root.query('COMMIT')
  await ok(await pending,409)
  assert.equal((await root.query('SELECT status FROM "LeaveRequest" WHERE id=$1',[id])).rows[0].status,'PENDING')
 }finally{await root.query('ROLLBACK');if(pending)await pending;await root.query('UPDATE "StaffProfile" SET "managerUserId"=$1 WHERE id=$2',[a+'_manager',a+'_profile'])}
})

test('leave transition audit failures roll back statuses and roster history without sending notifications',async()=>{
 const trigger='wf_leave_audit_'+suffix
 await root.query(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."tenantId"='${a}' AND NEW.event IN ('leave.request.reviewed','leave.request.canceled','leave.request.revoked','leave.request.bulk_reviewed') THEN RAISE EXCEPTION 'Simulated leave audit failure'; END IF; RETURN NEW; END $$;
 CREATE TRIGGER ${trigger} BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION ${trigger}()`)
 try{
  for(const [key,status,body,role] of [['review','PENDING',{status:'APPROVED'},'ADMIN'],['cancel','APPROVED',{cancelReason:'Test'},'STAFF'],['revoke','APPROVED',{revokeReason:'Test'},'ADMIN'],['bulk','PENDING',{status:'REJECTED',reviewerComment:'Test rejection'},'ADMIN']]){
   const id=await requestFixture('audit_'+key,{date:'2020-01-06',status}),before=notifications.length
   const history=(await root.query('SELECT * FROM "StaffRosterHistoryDay" WHERE "staffProfileId"=$1 ORDER BY date',[a+'_profile'])).rows
   const response=key==='bulk'?await call('leaves/requests/review-bulk','POST',{...body,requestIds:[id]}):await call('leaves/requests/[id]/'+key,'PATCH',body,id,role)
   assert.equal((await ok(response,500)).error,'Unable to complete this request.')
   assert.equal((await root.query('SELECT status FROM "LeaveRequest" WHERE id=$1',[id])).rows[0].status,status)
   assert.deepEqual((await root.query('SELECT * FROM "StaffRosterHistoryDay" WHERE "staffProfileId"=$1 ORDER BY date',[a+'_profile'])).rows,history)
   assert.equal(notifications.length,before)
  }
 }finally{await root.query(`DROP TRIGGER ${trigger} ON "AuditLog";DROP FUNCTION ${trigger}()`)}
})

let historyStaff,historyPattern
test('flexible history and live availability share weekly, recurring and daily precedence with breaks and cycle rollover',async()=>{
 historyStaff=await modeStaff('history_parity','FLEXIBLE')
 const {id,profile}=historyStaff
 historyPattern=(await ok(await call('shifts/flexible-patterns','PUT',cycleBody({staffId:id,validFrom:'2020-01-06',validTo:'2020-01-26'})))).item
 const days=planDays('10:00','18:00')
 days[1]={...days[1],isOff:true,slots:[]}
 days[2]={...days[2],isOff:false,slots:[]}
 await ok(await call('shifts/flexible-week-plans','PUT',{...weekBody(),staffId:id,weekStartDate:'2020-01-06',days}))
 for(const date of ['2020-01-06','2020-01-07','2020-01-18','2020-01-27'])await root.query('INSERT INTO "StaffFlexibleAvailability" (id,"staffProfileId",date,"startTime","endTime","sortOrder","updatedAt") VALUES ($1,$2,$3,$4,$5,0,now())',[id+'_'+date,profile,date,'09:00','11:00'])
 const {runWithTenantDbContext:scope}=require('../lib/prisma.ts'),{syncHistoryAsAdministrator:sync}=require('./helpers/availability-fixtures.cjs')
 const foreignBefore=(await root.query('SELECT * FROM "StaffRosterHistoryDay" WHERE "staffProfileId"=$1 ORDER BY date',[b+'_profile'])).rows
 await assert.rejects(scope(a,()=>sync(prisma,{tenantId:a,staffProfileIds:[profile,b+'_profile'],startDate:'2020-01-06',endDate:'2020-01-27'})))
 assert.equal(await scope(a,()=>sync(prisma,{tenantId:a,staffProfileIds:[profile],startDate:'2020-01-06',endDate:'2020-01-27'})),22)
 const rows=(await root.query('SELECT * FROM "StaffRosterHistoryDay" WHERE "staffProfileId"=$1 ORDER BY date',[profile])).rows
 const byDate=new Map(rows.map(row=>[row.date.toISOString().slice(0,10),row]))
 for(const [date,start,end,minutes] of [['2020-01-06','10:00','18:00',420],['2020-01-07',null,null,0],['2020-01-08','09:00','17:00',420],['2020-01-13','10:00','18:00',420],['2020-01-18',null,null,0],['2020-01-20','09:00','17:00',420],['2020-01-27','09:00','11:00',120]]){
  const row=byDate.get(date);assert.deepEqual([row.startTime,row.endTime,row.paidMinutes],[start,end,minutes],date)
 }
 const {checkAsAdministrator:check}=require('./helpers/availability-fixtures.cjs')
 for(const [date,start,end,expected] of [['2020-01-06','09:00','10:00',false],['2020-01-06','10:00','11:00',true],['2020-01-06','12:00','12:30',false],['2020-01-07','10:00','11:00',false],['2020-01-08','09:00','10:00',true],['2020-01-13','09:00','10:00',false],['2020-01-13','17:00','18:00',true],['2020-01-18','09:00','10:00',false],['2020-01-20','09:00','10:00',true],['2020-01-27','09:00','10:00',true]]){
  assert.equal((await scope(a,()=>check(profile,new Date(date+'T'+start+':00Z'),new Date(date+'T'+end+':00Z'),a))).ok,expected,date+' '+start)
 }
 assert.deepEqual((await root.query('SELECT * FROM "StaffRosterHistoryDay" WHERE "staffProfileId"=$1 ORDER BY date',[b+'_profile'])).rows,foreignBefore)
})

test('capturing missing history preserves saved snapshots while explicit corrections retain leave and override precedence',async()=>{
 const {profile}=historyStaff,{runWithTenantDbContext:scope}=require('../lib/prisma.ts'),{syncHistoryAsAdministrator:sync}=require('./helpers/availability-fixtures.cjs')
 const params={tenantId:a,staffProfileIds:[profile],startDate:'2020-01-06',endDate:'2020-01-27'}
 const before=(await root.query('SELECT * FROM "StaffRosterHistoryDay" WHERE "staffProfileId"=$1 ORDER BY date',[profile])).rows
 await root.query('UPDATE "StaffFlexiblePattern" SET "isActive"=false WHERE id=$1',[historyPattern.id])
 assert.equal(await scope(a,()=>sync(prisma,params)),0)
 assert.deepEqual((await root.query('SELECT * FROM "StaffRosterHistoryDay" WHERE "staffProfileId"=$1 ORDER BY date',[profile])).rows,before)
 await root.query('UPDATE "StaffFlexiblePattern" SET "isActive"=true WHERE id=$1',[historyPattern.id])
 await root.query('INSERT INTO "StaffShiftOverride" (id,"staffProfileId",date,"templateId","updatedAt") VALUES ($1,$2,$3,NULL,now())',[profile+'_off',profile,'2020-01-06'])
 await requestFixture('history_parity',{profile,date:'2020-01-06',status:'APPROVED'})
 await scope(a,()=>sync(prisma,{...params,startDate:'2020-01-06',endDate:'2020-01-06',mode:'replace'}))
 assert.equal((await root.query('SELECT COALESCE(s.source,h.source) source FROM "StaffRosterHistoryDay" h LEFT JOIN "StaffRosterLeaveSnapshot" s ON s."historyId"=h.id WHERE h."staffProfileId"=$1 AND date=$2',[profile,'2020-01-06'])).rows[0].source,'LEAVE')
 await root.query('UPDATE "LeaveRequest" SET status=$1 WHERE "staffProfileId"=$2',['REVOKED',profile])
 await scope(a,()=>sync(prisma,{...params,startDate:'2020-01-06',endDate:'2020-01-06',mode:'replace'}))
 assert.equal((await root.query('SELECT COALESCE(s.source,h.source) source FROM "StaffRosterHistoryDay" h LEFT JOIN "StaffRosterLeaveSnapshot" s ON s."historyId"=h.id WHERE h."staffProfileId"=$1 AND date=$2',[profile,'2020-01-06'])).rows[0].source,'UNAVAILABLE')
 const others=(await root.query('SELECT * FROM "StaffRosterHistoryDay" WHERE "staffProfileId"=$1 AND date>$2 ORDER BY date',[profile,'2020-01-06'])).rows
 assert.deepEqual(others,before.slice(1))
})

test('flexible working-time batches reject foreign staff and resolve dates without source reads',async()=>{
 const {loadWorkingTime:load}=require('../modules/workforce/working-time.ts'),{runWithTenantDbContext}=require('../lib/prisma.ts'),{runWithDatabaseActor}=require('../lib/database-actor.ts')
 const scope=(tenant,fn)=>runWithTenantDbContext(tenant,()=>runWithDatabaseActor(tenant+'_admin',fn))
 let count=0;const db={$queryRaw:(...args)=>{count++;return prisma.$queryRaw(...args)}}
 await assert.rejects(()=>load(db,'',[historyStaff.profile],new Date('2020-01-06'),new Date('2020-01-06')),e=>e.status===403)
 const first=await scope(a,()=>load(db,a,[historyStaff.profile],new Date('2020-01-06'),new Date('2020-01-06')));assert.equal(count,1)
 // The prior test installed an explicit unavailable override on this date.
 // Effective timings must retain it, rather than return the lower Flexible plan.
 assert.deepEqual(first(historyStaff.profile,new Date('2020-01-06')).segments,[])
 count=0
 const range=await scope(a,()=>load(db,a,[historyStaff.profile],new Date('2020-01-06'),new Date('2020-01-31')))
 assert.equal(count,1)
 assert.equal(range(historyStaff.profile,new Date('2020-01-08')).segments.length,2)
 for(let day=6;day<=31;day++)range(historyStaff.profile,new Date('2020-01-'+String(day).padStart(2,'0')))
 assert.equal(count,1);assert.deepEqual(range(b+'_profile',new Date('2020-01-06')).segments,[])
 await assert.rejects(scope(a,()=>load(db,a,[historyStaff.profile,b+'_profile'],new Date('2020-01-06'),new Date('2020-01-31'))),e=>e.status===403)
 await assert.rejects(scope(b,()=>load(db,b,[historyStaff.profile],new Date('2020-01-06'),new Date('2020-01-31'))),e=>e.status===403)
})

test('weekly history keeps its calendar date when a booking falls on the previous UTC day',async()=>{
 const {id,profile}=await modeStaff('history_midnight','FLEXIBLE')
 const days=planDays().map(day=>({...day,isOff:true,slots:[]}))
 days[0]={...days[0],isOff:false,slots:[{startTime:'00:15',endTime:'01:15',breaks:[{startTime:'00:30',endTime:'00:45'}]}]}
 await ok(await call('shifts/flexible-week-plans','PUT',{staffId:id,weekStartDate:'2020-01-06',days}))
 const {runWithTenantDbContext:scope}=require('../lib/prisma.ts'),{syncHistoryAsAdministrator:sync}=require('./helpers/availability-fixtures.cjs'),{checkAsAdministrator:check}=require('./helpers/availability-fixtures.cjs')
 await root.query('UPDATE "AppSetting" SET "timeZone"=$1 WHERE "tenantId"=$2',['Asia/Kolkata',a])
 try{
  await scope(a,()=>sync(prisma,{tenantId:a,staffProfileIds:[profile],startDate:'2020-01-06',endDate:'2020-01-06'}))
  const row=(await root.query('SELECT date,"paidMinutes","startTime","endTime" FROM "StaffRosterHistoryDay" WHERE "staffProfileId"=$1',[profile])).rows[0]
  assert.equal(row.date.toISOString(),'2020-01-06T00:00:00.000Z');assert.deepEqual([row.startTime,row.endTime,row.paidMinutes],['00:15','01:15',45])
  assert.equal((await scope(a,()=>check(profile,new Date('2020-01-05T18:45:00Z'),new Date('2020-01-05T19:00:00Z'),a))).ok,true)
  assert.equal((await scope(a,()=>check(profile,new Date('2020-01-05T19:00:00Z'),new Date('2020-01-05T19:15:00Z'),a))).ok,false)
 }finally{await root.query('UPDATE "AppSetting" SET "timeZone"=$1 WHERE "tenantId"=$2',['UTC',a])}
})

let standardHistory
async function standardHistoryFixture(){
 const staff=await modeStaff('standard_history'),{runWithTenantDbContext:scope}=require('../lib/prisma.ts')
 const savedDefault=(await root.query('SELECT id FROM "ShiftSchedule" WHERE "tenantId"=$1 AND "isDefault"=true',[a])).rows[0]?.id
 await root.query('UPDATE "ShiftSchedule" SET "isDefault"=false WHERE "tenantId"=$1',[a])
 const data=await scope(a,async()=>{
  const early=await prisma.shiftTemplate.create({data:{tenantId:a,name:'History early',startTime:'09:00',endTime:'17:00',breaks:{create:{startTime:'12:00',endTime:'13:00'}}}})
  const late=await prisma.shiftTemplate.create({data:{tenantId:a,name:'History late',startTime:'10:00',endTime:'18:00',breaks:{create:{startTime:'12:00',endTime:'13:00'}}}})
  const office=(await root.query('SELECT id FROM "BusinessOffice" WHERE "tenantId"=$1 AND "isInitial"',[a])).rows[0].id
  const base=(await root.query('INSERT INTO "ShiftSchedule"(id,"tenantId","officeId","isDefault","startDate","weekOffDay1","weekOff2Weeks","updatedAt") VALUES($1,$2,$3,true,\'2020-01-06\',\'MONDAY\',ARRAY[]::integer[],now()) RETURNING *',[staff.id+'_base',a,office])).rows[0]
  const rotation=(await root.query('INSERT INTO "ShiftSchedule"(id,"tenantId","officeId","startDate","weekOffDay1","weekOffDay2","weekOff2Weeks","updatedAt") VALUES($1,$2,$3,\'2020-01-06\',\'SUNDAY\',\'SATURDAY\',ARRAY[]::integer[],now()) RETURNING *',[staff.id+'_rotation',a,office])).rows[0]
  for(const [id,source,template,repeat,order]of[[base.id+'_block',base.id,early.id,1,0],[rotation.id+'_early',rotation.id,early.id,2,0],[rotation.id+'_late',rotation.id,late.id,1,1]])await root.query('INSERT INTO "ShiftScheduleBlock"(id,"scheduleId","templateId","repeatDays","sortOrder") VALUES($1,$2,$3,$4,$5)',[id,source,template,repeat,order])
  await root.query('INSERT INTO "StaffScheduleAssignment"(id,"staffProfileId","scheduleId","startDate","endDate","updatedAt") VALUES($1,$2,$3,\'2020-01-08\',\'2020-01-12\',now())',[staff.id+'_assignment',staff.profile,rotation.id])
  return {early,late,base,rotation}
 })
 return {...staff,...data,savedDefault}
}

test('standard history and live availability share schedule-anchored rotation, assignment gaps, breaks and off days',async()=>{
 standardHistory=await standardHistoryFixture()
 const {profile,early,late}=standardHistory,{runWithTenantDbContext:scope}=require('../lib/prisma.ts'),{syncHistoryAsAdministrator:sync}=require('./helpers/availability-fixtures.cjs'),{checkAsAdministrator:check}=require('./helpers/availability-fixtures.cjs')
 await assert.rejects(scope(a,()=>sync(prisma,{tenantId:a,staffProfileIds:[profile,b+'_managerprofile'],startDate:'2020-01-05',endDate:'2020-01-14'})))
 await scope(a,()=>sync(prisma,{tenantId:a,staffProfileIds:[profile],startDate:'2020-01-05',endDate:'2020-01-14'}))
 const rows=(await root.query('SELECT * FROM "StaffRosterHistoryDay" WHERE "staffProfileId"=$1 ORDER BY date',[profile])).rows
 const expected=[null,null,early.id,late.id,early.id,early.id,null,null,null,early.id]
 assert.deepEqual(rows.map(r=>r.templateId),expected)
 assert.deepEqual(rows.map(r=>r.paidMinutes),expected.map(id=>id?420:0))
 for(let i=0;i<rows.length;i++){
  const day=rows[i].date.toISOString().slice(0,10)
  const checkAt=(start,end)=>scope(a,()=>check(profile,new Date(day+'T'+start+':00Z'),new Date(day+'T'+end+':00Z'),a))
  const available=await checkAt('10:00','11:00');assert.equal(available.ok,!!expected[i],day)
  assert.equal('templateId' in available,false)
  assert.equal((await checkAt('12:00','12:30')).ok,false,day+' break')
 }
 assert.equal((await scope(a,()=>check(profile,new Date('2020-01-08T09:00:00Z'),new Date('2020-01-08T10:00:00Z'),a))).ok,false)
 assert.equal((await root.query('SELECT count(*)::int n FROM "StaffRosterHistoryDay" WHERE "staffProfileId"=$1',[b+'_managerprofile'])).rows[0].n,0)
})

test('standard range loading stays bounded and excludes foreign staff even with a tenant default',async()=>{
 const {loadWorkingTime:load}=require('../modules/workforce/working-time.ts'),{runWithTenantDbContext}=require('../lib/prisma.ts'),{runWithDatabaseActor}=require('../lib/database-actor.ts')
 const scope=(tenant,fn)=>runWithTenantDbContext(tenant,()=>runWithDatabaseActor(tenant+'_admin',fn))
 const pg=require('pg'),original=pg.Client.prototype.query;let count=0
 pg.Client.prototype.query=function(...args){const sql=typeof args[0]==='string'?args[0]:args[0]?.text;if(sql?.includes('SELECT * FROM app.effective_working_time('))count++;return original.apply(this,args)}
 try{
  const ids=[standardHistory.profile]
  await assert.rejects(()=>load(prisma,'',ids,new Date('2020-01-08'),new Date('2020-01-08')),e=>e.status===403)
  await assert.rejects(scope(a,()=>load(prisma,a,[...ids,b+'_managerprofile'],new Date('2020-01-08'),new Date('2020-01-08'))),e=>e.status===403);count=0
  await scope(a,()=>load(prisma,a,ids,new Date('2020-01-08'),new Date('2020-01-08')));const single=count
  assert.equal(single,1);count=0
  const resolve=await scope(a,()=>load(prisma,a,ids,new Date('2020-01-05'),new Date('2020-01-31')))
  assert.equal(count,single)
  for(let day=5;day<=31;day++)resolve(standardHistory.profile,new Date('2020-01-'+String(day).padStart(2,'0')))
  assert.equal(count,single)
  for(const id of [b+'_managerprofile','unrequested'])assert.deepEqual(resolve(id,new Date('2020-01-08')).segments,[])
 }finally{pg.Client.prototype.query=original}
})

test('standard history retains saved snapshots and explicit corrections preserve higher-priority leave and overrides',async()=>{
 const {profile,rotation,base,savedDefault,late}=standardHistory,{runWithTenantDbContext:scope}=require('../lib/prisma.ts'),{syncHistoryAsAdministrator:sync}=require('./helpers/availability-fixtures.cjs'),{checkAsAdministrator:check}=require('./helpers/availability-fixtures.cjs')
 const params={tenantId:a,staffProfileIds:[profile],startDate:'2020-01-05',endDate:'2020-01-14'}
 const read=async()=>(await root.query('SELECT h.*,COALESCE(s.source,h.source) source FROM "StaffRosterHistoryDay" h LEFT JOIN "StaffRosterLeaveSnapshot" s ON s."historyId"=h.id WHERE h."staffProfileId"=$1 ORDER BY h.date',[profile])).rows
 const before=await read()
 try{
  await root.query('UPDATE "ShiftSchedule" SET "startDate"=$1 WHERE id=$2',['2020-01-07',rotation.id])
  assert.equal(await scope(a,()=>sync(prisma,params)),0);assert.deepEqual(await read(),before)
  await scope(a,()=>prisma.staffShiftOverride.create({data:{staffProfileId:profile,date:new Date('2020-01-08'),templateId:late.id}}))
  const correct=()=>scope(a,()=>sync(prisma,{...params,startDate:'2020-01-08',endDate:'2020-01-08',mode:'replace'}))
  await correct();let row=(await read())[3];assert.equal(row.source,'OVERRIDE');assert.equal(row.paidMinutes,420)
  await requestFixture('standard_leave',{profile,date:'2020-01-08',status:'APPROVED'})
  await correct();row=(await read())[3];assert.equal(row.source,'LEAVE');assert.equal(row.paidMinutes,0)
  assert.equal((await scope(a,()=>check(profile,new Date('2020-01-08T10:00:00Z'),new Date('2020-01-08T11:00:00Z'),a))).ok,false)
  assert.deepEqual((await read()).filter((_,i)=>i!==3),before.filter((_,i)=>i!==3))
 }finally{
  await root.query('UPDATE "ShiftSchedule" SET "isDefault"=false WHERE id=$1',[base.id])
  if(savedDefault)await root.query('UPDATE "ShiftSchedule" SET "isDefault"=true WHERE id=$1',[savedDefault])
 }
})

const offPlanDays=()=>planDays().map(day=>({...day,isOff:true,slots:[]}))
async function planBooking(profile,key,day='2038-01-04',start='10:00',end='11:00',status='CONFIRMED'){
 const id=profile+'_'+key
 await root.query('INSERT INTO "Appointment" (id,"tenantId","staffProfileId","customerId","serviceId","startAt","endAt",status,"updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())',[id,a,profile,a+'_customer',a+'_service',day+'T'+start+':00Z',day+'T'+end+':00Z',status])
 return id
}
const planAuditCount=async()=>Number((await root.query('SELECT count(*) n FROM "AuditLog" WHERE "tenantId"=$1',[a])).rows[0].n)

test('weekly saves and deletes roll back booking regressions, while compatible fallback and repeat deletion remain valid',async()=>{
 const {id,profile}=await modeStaff('guard_week','FLEXIBLE'),body={...weekBody(),staffId:id}
 const saved=(await ok(await call('shifts/flexible-week-plans','PUT',body))).item
 await planBooking(profile,'booked')
 const before=await planAuditCount()
 const denied=await ok(await call('shifts/flexible-week-plans','PUT',{...body,days:offPlanDays()}),409)
 assert.match(denied.error,/existing appointments/);assert.deepEqual(Object.keys(denied),['error'])
 await ok(await call('shifts/flexible-week-plans','DELETE',body),409)
 assert.equal(await planAuditCount(),before)
 assert.deepEqual((await ok(await call('shifts/flexible-week-plans','GET',undefined,undefined,'ADMIN',a,'?staffId='+id+'&weekStartDate='+body.weekStartDate))).item,saved)
 const breakDays=planDays();breakDays[0].slots[0].breaks=[{startTime:'10:00',endTime:'11:00'}]
 await ok(await call('shifts/flexible-week-plans','PUT',{...body,days:breakDays}),409)
 await ok(await call('shifts/flexible-patterns','PUT',cycleBody({staffId:id})))
 assert.equal((await ok(await call('shifts/flexible-week-plans','DELETE',body))).deletedCount,1)
 const count=await planAuditCount()
 assert.equal((await ok(await call('shifts/flexible-week-plans','DELETE',body))).deletedCount,0)
 assert.equal(await planAuditCount(),count)
})

test('recurring mutations protect far-future bookings and displacement outside the replacement range',async()=>{
 const {id,profile}=await modeStaff('guard_pattern','FLEXIBLE'),body=cycleBody({staffId:id,cycleLengthWeeks:1,validTo:'',weeks:[{weekIndex:1,days:planDays()}]})
 const saved=(await ok(await call('shifts/flexible-patterns','PUT',body))).item
 await planBooking(profile,'far','2040-01-02')
 const before=await planAuditCount()
 await ok(await call('shifts/flexible-patterns','PUT',{...body,patternId:saved.id,weeks:[{weekIndex:1,days:offPlanDays()}]}),409)
 await ok(await call('shifts/flexible-patterns/[id]/deactivate','POST',{},saved.id),409)
 await ok(await call('shifts/flexible-patterns','DELETE',{patternId:saved.id}),409)
 await ok(await call('shifts/flexible-patterns','PUT',{...body,validTo:'2038-01-11'}),409)
 await ok(await call('shifts/flexible-patterns/[id]/clone','POST',{validFrom:'2038-01-04',validTo:'2038-01-11',activate:true},saved.id),409)
 assert.equal(await planAuditCount(),before)
 assert.deepEqual((await ok(await call('shifts/flexible-patterns/[id]','GET',undefined,saved.id))).item,saved)
 const draft=(await ok(await call('shifts/flexible-patterns/[id]/clone','POST',{validFrom:'2038-01-04',validTo:'2038-01-11',activate:false},saved.id))).id
 assert.ok(draft)
 await ok(await call('shifts/flexible-patterns','PUT',{...body,patternId:saved.id,name:'Compatible rename'}))
 await root.query('UPDATE "Appointment" SET status=$1 WHERE "staffProfileId"=$2',['CANCELED',profile])
 await ok(await call('shifts/flexible-patterns/[id]/deactivate','POST',{},saved.id))
 const count=await planAuditCount();await ok(await call('shifts/flexible-patterns/[id]/deactivate','POST',{},saved.id));assert.equal(await planAuditCount(),count)
})

test('plan guards retain override and leave precedence and allow repairs with unrelated pre-existing conflicts',async()=>{
 const {id,profile}=await modeStaff('guard_precedence','FLEXIBLE'),body={...weekBody(),staffId:id}
 await ok(await call('shifts/flexible-week-plans','PUT',body))
 await planBooking(profile,'override');await planBooking(profile,'leave','2038-01-05');await planBooking(profile,'already_invalid','2038-01-06','07:00','08:00')
 await root.query('INSERT INTO "StaffShiftOverride" (id,"staffProfileId",date,"templateId","updatedAt") VALUES ($1,$2,$3,$4,now())',[profile+'_override',profile,'2038-01-04',template.id])
 await requestFixture('guard_leave',{profile,date:'2038-01-05',status:'APPROVED'})
 await ok(await call('shifts/flexible-week-plans','PUT',{...body,days:offPlanDays()}))
 const {runWithTenantDbContext:scope}=require('../lib/prisma.ts'),{checkAsAdministrator:check}=require('./helpers/availability-fixtures.cjs')
 assert.equal((await scope(a,()=>check(profile,new Date('2038-01-04T10:00:00Z'),new Date('2038-01-04T11:00:00Z'),a))).ok,true)
})

test('plan checks use tenant calendar dates and protect overdue in-progress work without rewriting history',async()=>{
 const {id,profile}=await modeStaff('guard_midnight','FLEXIBLE'),days=planDays().map(day=>({...day,isOff:false,slots:[{startTime:'00:15',endTime:'01:15',breaks:[]}]}))
 const body={staffId:id,weekStartDate:'2020-01-06',days}
 await ok(await call('shifts/flexible-week-plans','PUT',body))
 const {runWithTenantDbContext:scope}=require('../lib/prisma.ts'),{syncHistoryAsAdministrator:sync}=require('./helpers/availability-fixtures.cjs')
 await scope(a,()=>sync(prisma,{tenantId:a,staffProfileIds:[profile],startDate:'2020-01-06',endDate:'2020-01-06'}))
 const history=(await root.query('SELECT * FROM "StaffRosterHistoryDay" WHERE "staffProfileId"=$1',[profile])).rows
 await root.query('UPDATE "AppSetting" SET "timeZone"=$1 WHERE "tenantId"=$2',['Asia/Kolkata',a])
 try{
  await planBooking(profile,'midnight','2020-01-05','18:45','19:00','IN_PROGRESS')
  await ok(await call('shifts/flexible-week-plans','PUT',{...body,days:offPlanDays()}),409)
  await ok(await call('shifts/flexible-week-plans','DELETE',body),409)
  assert.deepEqual((await root.query('SELECT * FROM "StaffRosterHistoryDay" WHERE "staffProfileId"=$1',[profile])).rows,history)
 }finally{await root.query('UPDATE "AppSetting" SET "timeZone"=$1 WHERE "tenantId"=$2',['UTC',a])}
})

test('every flexible plan write and its audit commit together; failed audits restore nested plans and displacements',async()=>{
 const {id}=await modeStaff('guard_audits','FLEXIBLE'),body={...weekBody(),staffId:id},patternBody=cycleBody({staffId:id})
 const week=(await ok(await call('shifts/flexible-week-plans','PUT',body))).item,pattern=(await ok(await call('shifts/flexible-patterns','PUT',patternBody))).item
 const trigger='wf_all_plan_audit_'+suffix,before=await planAuditCount()
 await root.query(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."tenantId"='${a}' AND NEW.event LIKE 'workforce.shift%' AND NEW."entityId" IS NOT NULL THEN RAISE EXCEPTION 'Private audit failure detail'; END IF; RETURN NEW; END $$; CREATE TRIGGER ${trigger} BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION ${trigger}()`)
 try{
  for(const response of [
   await call('shifts/flexible-week-plans','PUT',{...body,days:offPlanDays()}),
   await call('shifts/flexible-week-plans','PUT',{...body,weekStartDate:'2038-02-01'}),
   await call('shifts/flexible-week-plans','DELETE',body),
   await call('shifts/flexible-patterns','PUT',{...patternBody,patternId:pattern.id,name:'Must roll back'}),
   await call('shifts/flexible-patterns','PUT',patternBody),
   await call('shifts/flexible-patterns','PUT',{...patternBody,isActive:false}),
   await call('shifts/flexible-patterns/[id]/clone','POST',{validFrom:patternBody.validFrom,activate:false},pattern.id),
   await call('shifts/flexible-patterns/[id]/clone','POST',{validFrom:patternBody.validFrom,activate:true},pattern.id),
   await call('shifts/flexible-patterns/[id]/deactivate','POST',{},pattern.id),
  ])assert.equal((await ok(response,500)).error,'Unable to complete this request.')
  assert.equal(await planAuditCount(),before)
  assert.deepEqual((await ok(await call('shifts/flexible-week-plans','GET',undefined,undefined,'ADMIN',a,'?staffId='+id+'&weekStartDate='+body.weekStartDate))).item,week)
  assert.equal((await ok(await call('shifts/flexible-week-plans','GET',undefined,undefined,'ADMIN',a,'?staffId='+id+'&weekStartDate=2038-02-01'))).item,null)
  assert.deepEqual((await ok(await call('shifts/flexible-patterns/[id]','GET',undefined,pattern.id))).item,pattern)
  assert.equal((await ok(await call('shifts/flexible-patterns','GET',undefined,undefined,'ADMIN',a,'?staffId='+id))).items.length,1)
 }finally{await root.query(`DROP TRIGGER ${trigger} ON "AuditLog";DROP FUNCTION ${trigger}()`)}
})

test('flexible plan writers reread bookings, module allowance and manager permissions after waiting on the lock',async()=>{
 const {id,profile}=await modeStaff('guard_wait','FLEXIBLE'),body={...weekBody(),staffId:id}
 await ok(await call('shifts/flexible-week-plans','PUT',body))
 for(const scenario of ['booking','module','permission']){
  await perms(['shiftRoster.read','shiftRoster.edit'])
  await root.query('BEGIN');let pending
  try{
   await root.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`workforce-schedules:${a}`])
   pending=call('shifts/flexible-week-plans','PUT',{...body,days:offPlanDays()},undefined,'MANAGER')
   await waitForScheduleWaiters()
   if(scenario==='booking')await planBooking(profile,'waiting')
   else if(scenario==='module')await flag('shifts',false,false)
   else await perms(['shiftRoster.read'])
   await root.query('COMMIT')
   await ok(await pending,scenario==='booking'?409:403)
  }finally{await root.query('ROLLBACK');if(pending)await pending;await flag('shifts',true);await root.query('DELETE FROM "Appointment" WHERE "staffProfileId"=$1',[profile])}
 }
})
const standardPlanBody=(staffId,templateId,extra={})=>scheduleBody('Protected standard schedule',{startDate:'2038-01-01',assignmentStartDate:'2038-01-01',assignmentEndDate:'',staffIds:[staffId],blocks:[{templateId,repeatDays:1}],...extra})
const templateBody=(extra={})=>({name:'Protected hours',startTime:'09:00',endTime:'17:00',breaks:[],isActive:true,...extra})
async function withoutDefault(work){
 const saved=(await root.query('SELECT id FROM "ShiftSchedule" WHERE "tenantId"=$1 AND "isDefault"=true',[a])).rows[0]?.id
 await root.query('UPDATE "ShiftSchedule" SET "isDefault"=false WHERE "tenantId"=$1',[a])
 try{return await work()}finally{
  await root.query('UPDATE "ShiftSchedule" SET "isDefault"=false WHERE "tenantId"=$1',[a])
  if(saved)await root.query('UPDATE "ShiftSchedule" SET "isDefault"=true WHERE id=$1',[saved])
 }
}

test('standard edits, removal and assignment endings protect bookings and allow compatible default fallback',async()=>{
 await withoutDefault(async()=>{
  const {id,profile}=await modeStaff('standard_guard'),other=await modeStaff('standard_guard_other')
  const t=(await ok(await call('shifts/templates','POST',templateBody()))).template,body=standardPlanBody(id,t.id)
  const saved=(await ok(await call('shifts/schedules','POST',body))).schedule
  await planBooking(profile,'far','2040-01-02')
  const before=await planAuditCount(),assignment=saved.assignments[0].id
  for(const response of [
   await call('shifts/schedules/[id]','PATCH',{...body,weekOffDay1:'MONDAY'},saved.id),
   await call('shifts/schedules/[id]','PATCH',{...body,staffIds:[other.id]},saved.id),
   await call('shifts/schedules/[id]','DELETE',undefined,saved.id),
   await call('shifts/assignments/[id]','PATCH',{endDate:'2038-01-02'},assignment),
  ])assert.match((await ok(response,409)).error,/existing appointments/)
  assert.equal(await planAuditCount(),before)
  assert.equal((await root.query('SELECT "endDate" FROM "StaffScheduleAssignment" WHERE id=$1',[assignment])).rows[0].endDate,null)
  await ok(await call('shifts/schedules/[id]','PATCH',{...body,name:'Compatible rename'},saved.id))
  await ok(await call('shifts/schedules','POST',standardPlanBody(id,t.id,{isDefault:true,staffIds:[]})))
  const current=(await root.query('SELECT id FROM "StaffScheduleAssignment" WHERE "scheduleId"=$1',[saved.id])).rows[0].id
  await ok(await call('shifts/assignments/[id]','PATCH',{endDate:'2038-01-02'},current))
  const n=await planAuditCount();await ok(await call('shifts/assignments/[id]','PATCH',{endDate:'2038-01-02'},current));assert.equal(await planAuditCount(),n)
  await ok(await call('shifts/schedules/[id]','DELETE',undefined,saved.id))
  await root.query('UPDATE "Appointment" SET status=\'CANCELED\' WHERE "staffProfileId"=$1',[profile])
 })
})

test('default schedule edits and displacement protect unassigned staff without applying Standard rules to Flexible bookings',async()=>{
 await withoutDefault(async()=>{
  const {id,profile}=await modeStaff('default_guard'),flex=await modeStaff('default_guard_flex','FLEXIBLE')
  const t=(await ok(await call('shifts/templates','POST',templateBody()))).template,body=standardPlanBody(id,t.id,{isDefault:true,staffIds:[]})
  const saved=(await ok(await call('shifts/schedules','POST',body))).schedule
  await planBooking(profile,'default')
  const before=await planAuditCount()
  await ok(await call('shifts/schedules','POST',{...body,weekOffDay1:'MONDAY'}),409)
  await ok(await call('shifts/schedules/[id]','PATCH',{...body,startDate:'2038-02-01'},saved.id),409)
  await ok(await call('shifts/schedules/[id]','DELETE',undefined,saved.id),409)
  assert.equal(await planAuditCount(),before)
  assert.equal((await root.query('SELECT id FROM "ShiftSchedule" WHERE "tenantId"=$1 AND "isDefault"=true',[a])).rows[0].id,saved.id)
  await root.query('UPDATE "Appointment" SET status=\'CANCELED\' WHERE "staffProfileId"=$1',[profile])
  await ok(await call('shifts/flexible-week-plans','PUT',{...weekBody(),staffId:flex.id}))
  await planBooking(flex.profile,'flex')
  await ok(await call('shifts/schedules/[id]','DELETE',undefined,saved.id))
  await root.query('UPDATE "Appointment" SET status=\'CANCELED\' WHERE "staffProfileId"=$1',[flex.profile])
 })
})

test('template changes protect both standard assignments and flexible overrides, including added breaks and overdue work',async()=>{
 await withoutDefault(async()=>{
  const staff=await modeStaff('template_standard'),flex=await modeStaff('template_flexible','FLEXIBLE')
  const body=templateBody(),t=(await ok(await call('shifts/templates','POST',body))).template
  await ok(await call('shifts/schedules','POST',standardPlanBody(staff.id,t.id)))
  await planBooking(staff.profile,'assigned')
  const override=flex.profile+'_template'
  await root.query('INSERT INTO "StaffShiftOverride" (id,"staffProfileId",date,"templateId","updatedAt") VALUES ($1,$2,$3,$4,now())',[override,flex.profile,'2038-01-04',t.id])
  await planBooking(flex.profile,'override')
  const before=await planAuditCount()
  await ok(await call('shifts/templates/[id]','PATCH',{...body,startTime:'11:00'},t.id),409)
  await ok(await call('shifts/templates/[id]','PATCH',{...body,breaks:[{startTime:'10:00',endTime:'11:00'}]},t.id),409)
  assert.equal(await planAuditCount(),before)
  await root.query('UPDATE "Appointment" SET status=\'CANCELED\' WHERE "staffProfileId"=$1',[staff.profile])
  await ok(await call('shifts/templates/[id]','PATCH',{...body,startTime:'11:00'},t.id),409)
  await ok(await call('shifts/templates/[id]','PATCH',{...body,name:'Retired selection',isActive:false},t.id))
  await root.query('UPDATE "Appointment" SET "startAt"=\'2020-01-06T10:00Z\',"endAt"=\'2020-01-06T11:00Z\',status=\'IN_PROGRESS\' WHERE "staffProfileId"=$1',[flex.profile])
  await root.query('UPDATE "StaffShiftOverride" SET date=\'2020-01-06\' WHERE id=$1',[override])
  await ok(await call('shifts/templates/[id]','PATCH',{...body,startTime:'11:00'},t.id),409)
  await root.query('UPDATE "Appointment" SET status=\'CANCELED\' WHERE "staffProfileId"=$1',[flex.profile])
  await root.query('DELETE FROM "StaffShiftOverride" WHERE id=$1',[override])
 })
})

test('template edits preserve saved history, capture missing old hours and refuse deletion of historical references',async()=>{
 const {profile}=await modeStaff('template_history','FLEXIBLE'),body=templateBody(),t=(await ok(await call('shifts/templates','POST',body))).template
 const yesterday=new Date();yesterday.setUTCDate(yesterday.getUTCDate()-1);const date=yesterday.toISOString().slice(0,10)
 const {runWithTenantDbContext:scope}=require('../lib/prisma.ts')
 await scope(a,()=>prisma.staffShiftOverride.create({data:{staffProfileId:profile,date:new Date(date),templateId:t.id}}))
 await ok(await call('shifts/templates/[id]','PATCH',{...body,startTime:'08:00'},t.id))
 const read=async()=>(await root.query('SELECT * FROM "StaffRosterHistoryDay" WHERE "staffProfileId"=$1',[profile])).rows
 const history=await read();assert.equal(history.length,1);assert.equal(history[0].startTime,'09:00')
 await ok(await call('shifts/templates/[id]','PATCH',{...body,startTime:'07:00'},t.id));assert.deepEqual(await read(),history)
 await root.query('DELETE FROM "StaffShiftOverride" WHERE "staffProfileId"=$1',[profile])
 await ok(await call('shifts/templates/[id]','DELETE',undefined,t.id),409)
 assert.deepEqual(await read(),history)
 await ok(await call('shifts/templates/[id]','DELETE',undefined,t.id,'ADMIN',b),404)
})

test('standard and template audit failures roll back records, child replacements and default displacement',async()=>{
 await withoutDefault(async()=>{
  const {id}=await modeStaff('standard_audit'),body=templateBody(),t=(await ok(await call('shifts/templates','POST',body))).template
  const plan=standardPlanBody(id,t.id),saved=(await ok(await call('shifts/schedules','POST',plan))).schedule
  const defaultPlan=(await ok(await call('shifts/schedules','POST',{...plan,isDefault:true,staffIds:[]}))).schedule
  const spare=(await ok(await call('shifts/templates','POST',{...body,name:'Unused'}))).template
  const before=await planAuditCount(),trigger='wf_standard_audit_'+suffix
  const read=async()=>(await root.query('SELECT id,name,"isDefault","updatedAt" FROM "ShiftSchedule" WHERE "tenantId"=$1 ORDER BY id',[a])).rows
  const original=await read()
  await root.query(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."tenantId"='${a}' AND NEW.event LIKE 'workforce.shift%' AND NEW."entityId" IS NOT NULL THEN RAISE EXCEPTION 'Private audit detail'; END IF; RETURN NEW; END $$; CREATE TRIGGER ${trigger} BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION ${trigger}()`)
  try{
   for(const response of [
    await call('shifts/schedules/[id]','PATCH',{...plan,name:'Changed'},saved.id),
    await call('shifts/schedules','POST',{...plan,isDefault:true,staffIds:[]}),
    await call('shifts/schedules/[id]','DELETE',undefined,saved.id),
    await call('shifts/assignments/[id]','PATCH',{endDate:'2038-01-02'},saved.assignments[0].id),
    await call('shifts/templates','POST',{...body,name:'Failed create'}),
    await call('shifts/templates/[id]','PATCH',{...body,breaks:[{startTime:'12:00',endTime:'13:00'}]},t.id),
    await call('shifts/templates/[id]','DELETE',undefined,spare.id),
   ])assert.doesNotMatch((await ok(response,500)).error,/Private audit/)
   assert.equal(await planAuditCount(),before);assert.deepEqual(await read(),original)
   assert.equal((await root.query('SELECT "endDate" FROM "StaffScheduleAssignment" WHERE id=$1',[saved.assignments[0].id])).rows[0].endDate,null)
   assert.equal((await root.query('SELECT count(*) n FROM "ShiftTemplateBreak" WHERE "templateId"=$1',[t.id])).rows[0].n,'0')
   assert.equal((await root.query('SELECT "isDefault" FROM "ShiftSchedule" WHERE id=$1',[defaultPlan.id])).rows[0].isDefault,true)
  }finally{await root.query(`DROP TRIGGER ${trigger} ON "AuditLog";DROP FUNCTION ${trigger}()`)}
 })
})

test('standard writers recheck bookings and template permissions; template and assignment writers recheck access after the lock',async()=>{
 await withoutDefault(async()=>{
  const {id,profile}=await modeStaff('standard_wait'),body=templateBody(),t=(await ok(await call('shifts/templates','POST',body))).template
  const plan=standardPlanBody(id,t.id),saved=(await ok(await call('shifts/schedules','POST',plan))).schedule
  for(const scenario of ['booking','template-read','template-module','assignment-archive']){
   await perms(['shiftSchedules.read','shiftSchedules.edit','shiftSchedules.archive','shiftTemplates.read','shiftTemplates.edit'])
   await root.query('BEGIN');let pending
   try{
    await root.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`workforce-schedules:${a}`])
    pending=scenario==='template-module'?call('shifts/templates/[id]','PATCH',body,t.id,'MANAGER')
     :scenario==='assignment-archive'?call('shifts/assignments/[id]','PATCH',{endDate:'2038-01-02'},saved.assignments[0].id,'MANAGER')
     :call('shifts/schedules/[id]','PATCH',{...plan,weekOffDay1:'MONDAY'},saved.id,'MANAGER')
    await waitForScheduleWaiters()
    if(scenario==='booking')await planBooking(profile,'waiting')
    else if(scenario==='template-module')await flag('shifts',false,false)
    else if(scenario==='template-read')await perms(['shiftSchedules.read','shiftSchedules.edit'])
    else await perms(['shiftSchedules.read'])
    await root.query('COMMIT');await ok(await pending,scenario==='booking'?409:403)
   }finally{await root.query('ROLLBACK');if(pending)await pending;await flag('shifts',true);await root.query('DELETE FROM "Appointment" WHERE "staffProfileId"=$1',[profile])}
  }
 })
})
test('daily override saves and deletes roll back whole ranges and retain compatible Standard fallback',async()=>{
 await withoutDefault(async()=>{
  const {id,profile}=await modeStaff('daily_override_guard'),day='2038-01-04',end='2038-01-05'
  const t=(await ok(await call('shifts/templates','POST',templateBody()))).template
  const body=overrideBody(day,{staffId:id,templateId:t.id,endDate:end})
  await ok(await call('shifts/overrides','POST',body))
  const bookings=[await planBooking(profile,'first'),await planBooking(profile,'second',end)]
  const read=async()=>(await root.query('SELECT * FROM "StaffShiftOverride" WHERE "staffProfileId"=$1 ORDER BY date',[profile])).rows
  const before=await read(),count=await planAuditCount()
  for(const method of ['POST','DELETE']){
   const result=await ok(await call('shifts/overrides',method,{...body,isUnavailable:true}),409)
   assert.equal(result.conflictCount,2);assert.deepEqual(result.conflicts.map(c=>c.id).sort(),bookings.sort())
   assert.deepEqual(await read(),before);assert.equal(await planAuditCount(),count)
  }
  await ok(await call('shifts/schedules','POST',standardPlanBody(id,t.id)))
  assert.equal((await ok(await call('shifts/overrides','DELETE',body))).deletedCount,2)
  const n=await planAuditCount();assert.equal((await ok(await call('shifts/overrides','DELETE',body))).deletedCount,0);assert.equal(await planAuditCount(),n)
  await root.query('DELETE FROM "Appointment" WHERE "staffProfileId"=$1',[profile])
 })
})

test('daily slot saves and deletions respect weekly, recurring, override and leave precedence',async()=>{
 const {id,profile}=await modeStaff('daily_slot_guard','FLEXIBLE'),day='2038-01-04',body=slotBody(day,{staffId:id})
 await ok(await call('shifts/flexible-slots','POST',body));await planBooking(profile,'covered')
 const read=async()=>(await root.query('SELECT * FROM "StaffFlexibleAvailability" WHERE "staffProfileId"=$1 ORDER BY id',[profile])).rows
 const before=await read(),count=await planAuditCount()
 await ok(await call('shifts/flexible-slots','POST',{...body,slots:[{startTime:'11:00',endTime:'17:00'}]}),409)
 await ok(await call('shifts/flexible-slots','DELETE',body),409)
 assert.deepEqual(await read(),before);assert.equal(await planAuditCount(),count)
 for(const higher of ['weekly','recurring','override','leave']){
  if(higher==='weekly')await ok(await call('shifts/flexible-week-plans','PUT',{...weekBody(),staffId:id}))
  if(higher==='recurring')await ok(await call('shifts/flexible-patterns','PUT',cycleBody({staffId:id})))
  if(higher==='override')await ok(await call('shifts/overrides','POST',overrideBody(day,{staffId:id})))
  if(higher==='leave')await requestFixture('daily_guard_leave',{profile,date:day,status:'APPROVED'})
  await ok(await call('shifts/flexible-slots','POST',{...body,slots:[{startTime:'11:00',endTime:'17:00'}]}))
  await ok(await call('shifts/flexible-slots','DELETE',body))
  const n=await planAuditCount();assert.equal((await ok(await call('shifts/flexible-slots','DELETE',body))).deletedCount,0);assert.equal(await planAuditCount(),n)
  // Fixture cleanup restores only the tested source for the next precedence case.
  await root.query('DELETE FROM "StaffFlexibleWeekPlan" WHERE "staffProfileId"=$1',[profile])
  await root.query('DELETE FROM "StaffFlexiblePattern" WHERE "staffProfileId"=$1',[profile])
  await root.query('DELETE FROM "StaffShiftOverride" WHERE "staffProfileId"=$1',[profile])
 }
 await root.query('DELETE FROM "Appointment" WHERE "staffProfileId"=$1',[profile])
})

test('daily conflict responses require current booking access and failed changes produce no audit',async()=>{
 const {id,profile}=await modeStaff('daily_private','FLEXIBLE'),body=slotBody('2038-01-04',{staffId:id})
 await ok(await call('shifts/flexible-slots','POST',body));await planBooking(profile,'private')
 const before=await planAuditCount()
 try{
  await perms(['shiftRoster.read','shiftRoster.archive'])
  const hidden=await ok(await call('shifts/flexible-slots','DELETE',body,undefined,'MANAGER'),409)
  assert.deepEqual(hidden.conflicts,[]);assert.equal(hidden.conflictCount,1)
  assert.deepEqual(Object.keys(hidden).sort(),['conflictCount','conflicts','error'])
  const visible=await ok(await call('shifts/flexible-slots','DELETE',body),409)
  assert.equal(visible.conflicts[0].id,profile+'_private');assert.ok(visible.conflicts[0].customerEmail)
  await flag('appointments',false,false)
  const disabled=await ok(await call('shifts/flexible-slots','DELETE',body),409)
  assert.deepEqual(disabled.conflicts,[]);assert.equal(disabled.conflictCount,1)
  assert.equal(await planAuditCount(),before)
 }finally{await flag('appointments',true);await root.query('DELETE FROM "Appointment" WHERE "staffProfileId"=$1',[profile])}
})

test('daily writes and corrected history roll back together if strict auditing fails',async()=>{
 const {id,profile}=await modeStaff('daily_audit','FLEXIBLE'),date='2020-02-03',over=overrideBody(date,{staffId:id}),slots=slotBody(date,{staffId:id})
 await ok(await call('shifts/flexible-slots','POST',slots));await ok(await call('shifts/overrides','POST',over))
 const read=async()=>{
  const rows=[];for(const table of ['StaffShiftOverride','StaffFlexibleAvailability','StaffRosterHistoryDay'])rows.push((await root.query(`SELECT * FROM "${table}" WHERE "staffProfileId"=$1 ORDER BY id`,[profile])).rows)
  return rows
 }
 const before=await read(),count=await planAuditCount(),trigger='wf_daily_audit_'+suffix
 await root.query(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."tenantId"='${a}' AND NEW."entityId"='${profile}' AND NEW.event LIKE 'workforce.shiftRoster.%' THEN RAISE EXCEPTION 'Private daily audit detail'; END IF; RETURN NEW; END $$; CREATE TRIGGER ${trigger} BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION ${trigger}()`)
 try{
  for(const response of [
   await call('shifts/overrides','POST',{...over,isUnavailable:true}),
   await call('shifts/overrides','DELETE',over),
   await call('shifts/flexible-slots','POST',{...slots,slots:[{startTime:'11:00',endTime:'14:00'}]}),
   await call('shifts/flexible-slots','DELETE',slots),
  ])assert.equal((await ok(response,500)).error,'Unable to complete this request.')
  assert.equal(await planAuditCount(),count);assert.deepEqual(await read(),before)
 }finally{await root.query(`DROP TRIGGER ${trigger} ON "AuditLog";DROP FUNCTION ${trigger}()`)}
 await ok(await call('shifts/overrides','DELETE',over))
 const audit=(await root.query(`SELECT "before","after" FROM "AuditLog" WHERE "entityId"=$1 AND event='workforce.shiftRoster.archive' ORDER BY "createdAt" DESC LIMIT 1`,[profile])).rows[0]
 assert.equal(audit.before[0].templateId,template.id);assert.deepEqual(audit.after,[])
})

test('daily writers reread permissions, modules, mode and bookings after waiting for the scheduling lock',async()=>{
 const {id,profile}=await modeStaff('daily_wait','FLEXIBLE'),day='2038-01-04',body=slotBody(day,{staffId:id}),over=overrideBody(day,{staffId:id})
 await ok(await call('shifts/flexible-slots','POST',body))
 for(const scenario of ['booking','module','permission','template-read','mode','disclosure']){
  await perms(['shiftRoster.read','shiftRoster.edit','shiftRoster.archive','shiftTemplates.read','appointments.read'])
  await root.query('BEGIN');let pending
  try{
   await root.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`workforce-schedules:${a}`])
   pending=scenario==='template-read'?call('shifts/overrides','POST',over,undefined,'MANAGER')
    :scenario==='mode'?call('shifts/flexible-slots','POST',body,undefined,'MANAGER')
    :call('shifts/flexible-slots','DELETE',body,undefined,'MANAGER')
   await waitForScheduleWaiters()
   if(scenario==='booking'||scenario==='disclosure')await planBooking(profile,'wait')
   if(scenario==='module')await flag('shifts',false,false)
   if(scenario==='permission')await perms(['shiftRoster.read'])
   if(scenario==='template-read')await perms(['shiftRoster.read','shiftRoster.edit'])
   if(scenario==='mode')await root.query('UPDATE "StaffProfile" SET "schedulingMode"=\'STANDARD\' WHERE id=$1',[profile])
   if(scenario==='disclosure')await perms(['shiftRoster.read','shiftRoster.archive'])
   await root.query('COMMIT')
   const result=await ok(await pending,['booking','mode','disclosure'].includes(scenario)?409:403)
   if(scenario==='disclosure'){assert.deepEqual(result.conflicts,[]);assert.equal(result.conflictCount,1)}
  }finally{
   await root.query('ROLLBACK');if(pending)await pending;await flag('shifts',true)
   await root.query('DELETE FROM "Appointment" WHERE "staffProfileId"=$1',[profile])
   await root.query('UPDATE "StaffProfile" SET "schedulingMode"=\'FLEXIBLE\' WHERE id=$1',[profile])
  }
 }
})

test('daily deletion protects overdue work and failed edits preserve historical snapshots',async()=>{
 const {id,profile}=await modeStaff('daily_overdue','FLEXIBLE'),date='2020-02-03',body=slotBody(date,{staffId:id})
 await ok(await call('shifts/flexible-slots','POST',body));await planBooking(profile,'active',date,'10:00','11:00','IN_PROGRESS')
 const read=async()=>(await root.query('SELECT * FROM "StaffRosterHistoryDay" WHERE "staffProfileId"=$1 ORDER BY date',[profile])).rows
 const before=await read()
 await ok(await call('shifts/flexible-slots','DELETE',body),409)
 await ok(await call('shifts/overrides','POST',overrideBody(date,{staffId:id,isUnavailable:true})),409)
 assert.deepEqual(await read(),before)
 await root.query('UPDATE "Appointment" SET status=\'COMPLETED\' WHERE "staffProfileId"=$1',[profile])
 await ok(await call('shifts/flexible-slots','DELETE',body))
})

test('weekly edits and removal preserve old missing history while explicit daily corrections affect only chosen dates',async()=>{
 const {id,profile}=await modeStaff('past_week','FLEXIBLE'),body={...weekBody(),staffId:id,weekStartDate:'2020-01-06'}
 const read=async()=>(await root.query('SELECT * FROM "StaffRosterHistoryDay" WHERE "staffProfileId"=$1 ORDER BY date',[profile])).rows
 await ok(await call('shifts/flexible-week-plans','PUT',body));assert.equal((await read()).length,0)
 await ok(await call('shifts/flexible-week-plans','PUT',{...body,days:planDays('10:00','18:00')}))
 const before=await read();assert.equal(before.length,7);assert.equal(before[0].startTime,'09:00');assert.equal(before[0].paidMinutes,420)
 await ok(await call('shifts/flexible-week-plans','DELETE',body));assert.deepEqual(await read(),before)
 await ok(await call('shifts/flexible-slots','POST',slotBody('2020-01-06',{staffId:id,slots:[{startTime:'11:00',endTime:'15:00'}]})))
 const corrected=await read();assert.equal(corrected[0].startTime,'11:00');assert.equal(corrected[0].paidMinutes,240);assert.deepEqual(corrected.slice(1),before.slice(1))
})

test('recurring edits, deactivation and active clone displacement capture the full old range but drafts and dormant plans do not',async()=>{
 for(const action of ['edit','deactivate','clone','draft','dormant']){
  const {id,profile}=await modeStaff('past_pattern_'+action,'FLEXIBLE')
  const body=cycleBody({staffId:id,validFrom:'2020-01-06',validTo:'2020-01-26',isActive:action!=='draft'})
  const saved=(await ok(await call('shifts/flexible-patterns','PUT',body))).item
  if(action==='dormant')await root.query('UPDATE "StaffProfile" SET "schedulingMode"=\'STANDARD\' WHERE id=$1',[profile])
  if(action==='edit'||action==='draft')await ok(await call('shifts/flexible-patterns','PUT',{...body,patternId:saved.id,validTo:'2020-01-12'}))
  else if(action==='clone')await ok(await call('shifts/flexible-patterns/[id]/clone','POST',{validFrom:'2020-01-13',validTo:'2020-01-19',activate:true},saved.id))
  else await ok(await call('shifts/flexible-patterns','DELETE',{patternId:saved.id}))
  const rows=(await root.query('SELECT * FROM "StaffRosterHistoryDay" WHERE "staffProfileId"=$1 ORDER BY date',[profile])).rows
  assert.equal(rows.length,['draft','dormant'].includes(action)?0:21,action)
  if(rows.length){assert.equal(rows[0].startTime,'09:00');assert.equal(rows[7].startTime,'10:00');assert.equal(rows[14].paidMinutes,420)}
 }
})

test('failed booking guards and history capture roll back historical plan writes and audits',async t=>{
 const {id,profile}=await modeStaff('past_rollback','FLEXIBLE'),body={...weekBody(),staffId:id,weekStartDate:'2020-01-06'}
 await ok(await call('shifts/flexible-week-plans','PUT',body));await planBooking(profile,'active','2020-01-06','10:00','11:00','IN_PROGRESS')
 const count=await planAuditCount()
 const historyCount=async()=>Number((await root.query('SELECT count(*) FROM "StaffRosterHistoryDay" WHERE "staffProfileId"=$1',[profile])).rows[0].count)
 await ok(await call('shifts/flexible-week-plans','PUT',{...body,days:offPlanDays()}),409)
 assert.equal(await historyCount(),0);assert.equal(await planAuditCount(),count)
 await root.query('DELETE FROM "Appointment" WHERE "staffProfileId"=$1',[profile])
 const trigger='wf_past_audit_'+suffix
 await root.query(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."tenantId"='${a}' AND NEW.event='workforce.shiftRoster.archive' THEN RAISE EXCEPTION 'Audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER ${trigger} BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION ${trigger}()`)
 try{await ok(await call('shifts/flexible-week-plans','DELETE',body),500)}finally{await root.query(`DROP TRIGGER ${trigger} ON "AuditLog";DROP FUNCTION ${trigger}()`)}
 assert.equal(await historyCount(),0);assert.equal(await planAuditCount(),count)
 const history=require('../modules/workforce/roster-history.ts'),stub=t.mock.method(history,'syncRosterHistoryRange',async()=>{throw Error('History failure')})
 try{await ok(await call('shifts/flexible-week-plans','DELETE',body),500)}finally{stub.mock.restore()}
 assert.equal(await historyCount(),0);assert.equal(await planAuditCount(),count)
 assert.equal(Number((await root.query('SELECT count(*) FROM "StaffFlexibleWeekPlan" WHERE "staffProfileId"=$1',[profile])).rows[0].count),1)
})

test('a leave review waiting for the scheduling lock rechecks revoked approval permissions',async()=>{
 const id=await requestFixture('approval_permission_wait')
 const original=(await root.query('SELECT permissions FROM "TenantAccessRole" WHERE id=$1',[rid])).rows[0].permissions
 await root.query('UPDATE "StaffProfile" SET "managerUserId"=$1,"leaveApprovalMode"=\'REPORTING_MANAGER\' WHERE id=$2',[a+'_manager',a+'_profile'])
 await flag('leaves',true);await perms(['leaveApprovals.read','leaveApprovals.approve'])
 await root.query('BEGIN');let pending
 try{
  await root.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`workforce-schedules:${a}`])
  pending=call('leaves/requests/[id]/review','PATCH',{status:'REJECTED',reviewerComment:'Permission revocation check'},id,'MANAGER')
  let waiting=false;const deadline=Date.now()+5000
  while(Date.now()<deadline){waiting=(await root.query(`SELECT EXISTS(SELECT 1 FROM pg_locks held JOIN pg_locks waiter ON held.classid=waiter.classid AND held.objid=waiter.objid AND held.objsubid=waiter.objsubid WHERE held.pid=pg_backend_pid() AND held.locktype='advisory' AND NOT waiter.granted) waiting`)).rows[0].waiting;if(waiting)break;await new Promise(resolve=>setTimeout(resolve,20))}
  assert.equal(waiting,true)
  await perms(['leaveApprovals.read']);await root.query('COMMIT');await ok(await pending,403)
 }finally{await root.query('ROLLBACK');if(pending)await pending;await perms(original)}
 assert.equal((await root.query('SELECT status FROM "LeaveRequest" WHERE id=$1',[id])).rows[0].status,'PENDING')
 assert.equal(Number((await root.query('SELECT count(*) FROM "AuditLog" WHERE "entityId"=$1',[id])).rows[0].count),0)
})
