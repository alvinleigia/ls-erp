/* eslint-disable @typescript-eslint/no-require-imports */
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path')
const {AsyncLocalStorage}=require('node:async_hooks'),{Client}=require('pg')
const raw=process.env.CRM_TEST_DATABASE_URL,url=new URL(raw||'http://invalid')
if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!='/ls_salon_crm_test')throw Error('Disposable local database only.')
const root=new Client({connectionString:raw});url.username='crm_test_runtime';url.password=''
process.env.DATABASE_URL=url.toString();process.env.RLS_POOL_MAX='1'
const sessions=new AsyncLocalStorage(),authPath=path.resolve(__dirname,'../auth.ts')
require.cache[authPath]={id:authPath,filename:authPath,loaded:true,exports:{auth:async()=>{await Promise.resolve();return sessions.getStore()||null}}}
const {logger}=require('../lib/logger.ts');const errors=[];logger.info=()=>{};logger.error=(_e,c)=>errors.push(c.error?.message)
const {prisma}=require('../lib/prisma.ts')
const suffix=require('node:crypto').randomUUID().replaceAll('-',''),a=`core_a_${suffix}`,b=`core_b_${suffix}`,rid=`role_${suffix}`
const session=(tenant=a,role='ADMIN')=>({user:{id:`${tenant}_${role.toLowerCase()}`,tenantId:tenant,role}})
const call=(key,method='GET',body,id,role='ADMIN',tenant=a,query='')=>sessions.run(session(tenant,role),()=>require(`../app/api/${key}/route.ts`)[method](new Request(`http://${tenant}.localhost/api/${key}${query}`,{method,headers:{host:`${tenant}.localhost`,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}),{params:Promise.resolve({id})}))
const perms=p=>root.query('UPDATE "TenantAccessRole" SET permissions=$1 WHERE id=$2',[p,rid])
async function ok(res,status=200){const body=await res.json();assert.equal(res.status,status,JSON.stringify({body,errors:errors.slice(-2)}));return body}
const settings={locale:'en-IN',currency:'INR',timeZone:'Asia/Kolkata',dateFormat:'dd/MM/yyyy',workingHours:[{day:'MONDAY',isOpen:true,periods:[{kind:'WORK',startTime:'09:00',endTime:'17:00',sortOrder:0}]}],overrides:[]}
let tax
before(async()=>{
 await root.connect()
 for(const tenant of [a,b]){
  await root.query('INSERT INTO "Tenant" (id,name,slug,"updatedAt") VALUES ($1,$1,$1,now())',[tenant])
  for(const role of ['ADMIN','MANAGER','STAFF','CUSTOMER'])await root.query('INSERT INTO "User" (id,name,email,role,"tenantId","updatedAt") VALUES ($1,$1,$2,$3,$4,now())',[`${tenant}_${role.toLowerCase()}`,`${tenant}_${role}@example.test`,role,tenant])
  for(const key of ['appointments','services','inventory','leaves','shifts'])await root.query('INSERT INTO "TenantModule" ("tenantId",key,allowed,enabled,"updatedAt") VALUES ($1,$2,true,true,now())',[tenant,key])
 }
 await root.query('INSERT INTO "TenantAccessRole" (id,"tenantId",name,"nameKey",permissions,"updatedAt") VALUES ($1,$2,\'Core test\',\'core test\',$3,now())',[rid,a,[]])
 await root.query('INSERT INTO "TenantRoleAssignment" ("tenantId","userId","roleId","updatedAt") VALUES ($1,$2,$3,now())',[a,a+'_manager',rid])
})
after(async()=>{
 for(const tenant of [a,b])for(const table of ['RealEstateProjectStatus','RealEstatePropertyCategory','RealEstateBuyingTimeframe'])await root.query(`DELETE FROM "${table}" WHERE "tenantId"=$1`,[tenant])
 await root.query('DELETE FROM "TenantRoleAssignment" WHERE "tenantId"=$1',[a]);await root.query('DELETE FROM "Tenant" WHERE id IN ($1,$2)',[a,b]);await root.end();await prisma.$disconnect();await global.prismaPool?.end()
})
test('core screens and mutations deny ungranted roles, including invitation administration',async()=>{
 for(const key of ['dashboard/summary','reports/audit-logs','users','settings','settings/taxes','invites'])assert.equal((await call(key,'GET',undefined,undefined,'MANAGER',a,key==='directory'?'?role=STAFF':'')).status,403,key)
 for(const [key,method] of [['users','POST'],['users/[id]','PATCH'],['settings','PATCH'],['settings/taxes','POST'],['settings/taxes/[id]','PATCH'],['settings/taxes/[id]','DELETE'],['invites','POST'],['invites/[id]','DELETE']])assert.equal((await call(key,method,{},a+'_staff','MANAGER')).status,403,`${method} ${key}`)
 await perms(['users.read']);await ok(await call('users','GET',undefined,undefined,'MANAGER'))
 assert.equal((await call('users','POST',{},undefined,'MANAGER')).status,403)
})
test('settings reads never create rows; edit permission saves and audits settings',async()=>{
 await perms(['businessSettings.read'])
 assert.equal((await call('settings','GET',undefined,undefined,'MANAGER')).status,503)
 assert.equal((await root.query('SELECT count(*)::int n FROM "AppSetting" WHERE "tenantId"=$1',[a])).rows[0].n,0)
 assert.equal((await call('settings','PATCH',settings,undefined,'MANAGER')).status,403)
 await perms(['businessSettings.read','businessSettings.edit'])
 const saved=await ok(await call('settings','PATCH',settings,undefined,'MANAGER'));assert.equal(saved.settings.currency,'INR')
 await ok(await call('settings','PATCH',{...settings,currency:'USD'},undefined,'MANAGER'))
 const audit=(await root.query('SELECT * FROM "AuditLog" WHERE "tenantId"=$1 AND event=\'core.businessSettings.edit\' ORDER BY "createdAt" DESC',[a])).rows[0]
 assert.equal(audit.before.currency,'INR');assert.equal(audit.after.currency,'USD');assert.equal(audit.actorUserId,a+'_manager');assert.ok(audit.requestId)
})
test('tax writes separate edit from archive, isolate tenants and audit deletion',async()=>{
 await perms(['taxRates.read','taxRates.create','taxRates.edit'])
 tax=(await ok(await call('settings/taxes','POST',{name:'VAT',percent:5},undefined,'MANAGER'),201)).tax
 await ok(await call('settings/taxes/[id]','PATCH',{percent:7},tax.id,'MANAGER'))
 assert.equal((await call('settings/taxes/[id]','PATCH',{isActive:false},tax.id,'MANAGER')).status,403)
 assert.equal((await call('settings/taxes/[id]','DELETE',undefined,tax.id,'MANAGER')).status,403)
 assert.equal((await call('settings/taxes/[id]','PATCH',{name:'Foreign'},tax.id,'ADMIN',b)).status,404)
 await perms(['taxRates.read','taxRates.archive']);await ok(await call('settings/taxes/[id]','DELETE',undefined,tax.id,'MANAGER'))
 const audit=(await root.query('SELECT * FROM "AuditLog" WHERE "entityId"=$1 AND event=\'core.taxRates.archive\'',[tax.id])).rows[0];assert.equal(audit.before.name,'VAT');assert.equal(audit.after.deleted,true)
})
test('supporting lookups preserve authorized forms without administrative data or GET mutations',async()=>{
 await perms(['appointments.read'])
 assert.equal((await call('users','GET',undefined,undefined,'MANAGER')).status,403)
 assert.equal((await call('settings','GET',undefined,undefined,'MANAGER')).status,403)
 const directory=await ok(await call('directory','GET',undefined,undefined,'MANAGER',a,'?role=STAFF&pageSize=1'))
 assert.equal(directory.total,1);assert.equal(directory.items[0].id,a+'_staff');assert.equal(directory.items[0].staffProfile,null)
 assert.deepEqual(Object.keys(directory.items[0]).sort(),['email','id','name','role','staffProfile'])
 assert.equal((await root.query('SELECT count(*)::int n FROM "StaffProfile" WHERE "userId"=$1',[a+'_staff'])).rows[0].n,0)
 const operations=await ok(await call('settings/operations','GET',undefined,undefined,'MANAGER'));assert.equal(operations.settings.workingHours[0].periods[0].startTime,'09:00');assert.equal(operations.emailDelivery,undefined);assert.equal(operations.settings.emailNotificationsEnabled,undefined)
 await ok(await call('lookups/taxes','GET',undefined,undefined,'MANAGER'))
 assert.equal((await call('directory','GET',undefined,undefined,'MANAGER',a,'?pageSize=101')).status,400)
 await root.query('UPDATE "TenantModule" SET enabled=false WHERE "tenantId"=$1 AND key=\'appointments\'',[a])
 for(const key of ['directory','settings/operations','lookups/taxes'])assert.equal((await call(key,'GET',undefined,undefined,'MANAGER',a,key==='directory'?'?role=STAFF':'')).status,403,key)
 await root.query('UPDATE "TenantModule" SET enabled=true WHERE "tenantId"=$1 AND key=\'appointments\'',[a])
})
test('own profile survives directory restrictions without allowing escalation; GET is read-only',async()=>{
 for(const role of ['MANAGER','STAFF','CUSTOMER']){
  const id=a+'_'+role.toLowerCase();await ok(await call('users/[id]','GET',undefined,id,role))
  await ok(await call('users/[id]','PATCH',{name:'Own profile',role:'ADMIN',status:'SUSPENDED'},id,role))
  const user=(await root.query('SELECT name,role,status FROM "User" WHERE id=$1',[id])).rows[0];assert.equal(user.name,'Own profile');assert.equal(user.role,role);assert.equal(user.status,'ACTIVE')
  assert.equal((await call('users/[id]','GET',undefined,a+'_admin',role)).status,403)
 }
 assert.equal((await root.query('SELECT count(*)::int n FROM "StaffProfile" WHERE "userId"=$1',[a+'_staff'])).rows[0].n,0)
})
test('dashboard and audit visibility require both report and underlying resource permissions',async()=>{
 await perms(['dashboard.read','auditLogs.read'])
 const hidden=await ok(await call('dashboard/summary','GET',undefined,undefined,'MANAGER'))
 assert.equal(hidden.kpis.activeStaff,0)
 assert.deepEqual(hidden.visibility,{appointments:false,leaves:false,services:false,inventory:false})
 for(const event of ['inventory.inventoryProducts.edit','inventory.inventorySuppliers.edit','services.services.edit','access.user.updated','crm.opportunity.updated','unknown.event'])await root.query('INSERT INTO "AuditLog" (id,"tenantId",event,"entityType",after) VALUES ($1,$2,$3,\'Test\',$4)',[a+event,a,event,{private:'snapshot'}])
 assert.equal((await ok(await call('reports/audit-logs','GET',undefined,undefined,'MANAGER'))).total,0)
 await perms(['dashboard.read','users.read','auditLogs.read','inventoryProducts.read'])
 const visible=await ok(await call('dashboard/summary','GET',undefined,undefined,'MANAGER'))
 assert.equal(visible.kpis.activeStaff,1)
 assert.deepEqual(visible.visibility,{appointments:false,leaves:false,services:false,inventory:true})
 const rows=await ok(await call('reports/audit-logs','GET',undefined,undefined,'MANAGER',a,'?pageSize=1'));assert.equal(rows.total,1);assert.equal(rows.items[0].event,'inventory.inventoryProducts.edit')
})
test('current account and tenant state override stale session claims',async()=>{
 await root.query('UPDATE "User" SET role=\'STAFF\' WHERE id=$1',[a+'_admin'])
 for(const key of ['users','settings','settings/taxes','invites','reports/audit-logs'])assert.equal((await call(key)).status,403,key)
 await root.query('UPDATE "User" SET role=\'ADMIN\',status=\'SUSPENDED\' WHERE id=$1',[a+'_admin']);assert.equal((await call('dashboard/summary')).status,403)
 await root.query('UPDATE "User" SET status=\'ACTIVE\' WHERE id=$1',[a+'_admin']);await root.query('UPDATE "Tenant" SET status=\'SUSPENDED\' WHERE id=$1',[a]);assert.equal((await call('settings')).status,404)
 await root.query('UPDATE "Tenant" SET status=\'ACTIVE\' WHERE id=$1',[a])
 assert.equal((await call('users/[id]','GET',undefined,b+'_staff')).status,404)
})

test('invitation removal is tenant isolated and audited without authentication tokens',async()=>{
 const id=a+'_invite';await root.query('INSERT INTO "Invitation" (id,email,role,token,"tenantId","expiresAt","invitedById") VALUES ($1,$2,\'CUSTOMER\',$3,$4,now()+interval \'1 day\',$5)',[id,'invite@example.test',a+'_secret',a,a+'_admin'])
 assert.equal((await call('invites/[id]','DELETE',undefined,id,'ADMIN',b)).status,404)
 await ok(await call('invites/[id]','DELETE',undefined,id))
 const audit=(await root.query('SELECT * FROM "AuditLog" WHERE "entityId"=$1 AND event=\'core.invitations.archive\'',[id])).rows[0]
 assert.equal(audit.before.email,'invite@example.test');assert.equal(audit.before.token,undefined);assert.ok(audit.requestId)
})
