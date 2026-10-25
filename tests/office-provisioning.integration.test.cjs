/* eslint-disable @typescript-eslint/no-require-imports */
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{AsyncLocalStorage}=require('node:async_hooks'),{Client}=require('pg')
const raw=process.env.CRM_TEST_DATABASE_URL,url=new URL(raw||'http://invalid')
if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!=='/ls_salon_crm_test')throw Error('Disposable local database only.')
const root=new Client({connectionString:raw}),sessions=new AsyncLocalStorage()
url.username='crm_test_runtime';url.password='';process.env.DATABASE_URL=url.toString()
const authPath=require.resolve('../auth.ts');require.cache[authPath]={id:authPath,filename:authPath,loaded:true,exports:{auth:async()=>{await Promise.resolve();return sessions.getStore()||null}}}
const logger=require('../lib/logger.ts').logger;logger.info=()=>{};const errors=[];logger.error=(_event,context)=>errors.push(context.error?.message)
const {POST}=require('../app/api/users/route.ts'),{prisma,runWithTenantDbContext}=require('../lib/prisma.ts'),{runWithDatabaseActor}=require('../lib/database-actor.ts')
const {saveOfficeMemberships}=require('../platform/companies/office-membership.ts')
const tenant='provision_office_'+randomUUID().replaceAll('-',''),foreign=tenant+'_foreign',admin=tenant+'_admin',manager=tenant+'_manager'
let a,b,company,child,foreignOffice
const session=(id=admin,role='ADMIN')=>({user:{id,role,tenantId:tenant}})
const grants=(officeIds=[a],creationOfficeId=a,companies=[])=>({officeIds,creationOfficeId,companies})
async function create(extra={},who=session()){
 const body={name:'Office user',email:randomUUID()+'@example.test',role:'STAFF',password:'IsolatedTest!2026',...extra}
 const response=await sessions.run(who,()=>POST(new Request(`http://${tenant}.localhost/api/users`,{method:'POST',headers:{host:tenant+'.localhost','Content-Type':'application/json'},body:JSON.stringify(body)})))
 const result=await response.json();return{status:response.status,result,email:body.email}
}
const saved=async id=>(await root.query('SELECT "creationOfficeId",version FROM "BusinessOfficePolicy" WHERE "tenantId"=$1 AND "userId"=$2',[tenant,id])).rows[0]
const officeIds=async id=>(await root.query('SELECT "officeId" FROM "BusinessOfficeGrant" WHERE "tenantId"=$1 AND "userId"=$2 ORDER BY "officeId"',[tenant,id])).rows.map(row=>row.officeId)
async function absent(email){assert.equal((await root.query('SELECT id FROM "User" WHERE "tenantId"=$1 AND email=$2',[tenant,email])).rowCount,0)}
before(async()=>{
 await root.connect()
 for(const t of [tenant,foreign])await root.query('INSERT INTO "Tenant"(id,name,slug,"updatedAt") VALUES($1,$1,$1,now())',[t])
 for(const [id,role]of[[admin,'ADMIN'],[manager,'MANAGER']])await root.query('INSERT INTO "User"(id,email,role,"tenantId","updatedAt") VALUES($1,$2,$3,$4,now())',[id,id+'@example.test',role,tenant])
 const initial=(await root.query('SELECT id,"companyId" FROM "BusinessOffice" WHERE "tenantId"=$1 AND "isInitial"',[tenant])).rows[0];a=initial.id;company=initial.companyId
 b=tenant+'_west';await root.query('INSERT INTO "BusinessOffice"(id,"tenantId","companyId",code,name,"updatedAt") VALUES($1,$2,$3,\'WEST\',\'West\',now())',[b,tenant,company])
 child=tenant+'_child';await root.query('INSERT INTO "BusinessCompany"(id,"tenantId","parentId",code,name,"updatedAt") VALUES($1,$2,$3,\'CHILD\',\'Child\',now())',[child,tenant,company])
 foreignOffice=(await root.query('SELECT id FROM "BusinessOffice" WHERE "tenantId"=$1',[foreign])).rows[0].id
})
after(async()=>{await root.end();await Promise.all([global.prisma,global.prismaBypassClient,...[...(global.prismaScopedClientCache?.values()||[])].map(entry=>entry.client)].filter(Boolean).map(c=>c.$disconnect()));await global.prismaPool?.end()})

test('account creation commits explicit office grants, preference and mandatory audit together',async()=>{
 const response=await create({officeAccess:grants([a,b],b)})
 assert.equal(response.status,200,JSON.stringify({response,errors}));const id=response.result.user.id
 assert.deepEqual(await officeIds(id),[a,b].sort());assert.deepEqual(await saved(id),{creationOfficeId:b,version:1})
 const audit=(await root.query('SELECT "after" FROM "AuditLog" WHERE "tenantId"=$1 AND "entityId"=$2 AND event=\'structure.officeMembership.updated\'',[tenant,id])).rows
 assert.equal(audit.length,1);assert.equal(audit[0].after.creationOfficeId,b)
 assert.equal((await root.query('SELECT * FROM "TenantRoleAssignment" WHERE "userId"=$1',[id])).rowCount,0,'office eligibility must not add business permissions')
 assert.equal(response.result.user.passwordHash,undefined)
})
test('omitting office access never copies the creator office or selects a default',async()=>{
 const response=await create();assert.equal(response.status,200);assert.equal(await saved(response.result.user.id),undefined);assert.deepEqual(await officeIds(response.result.user.id),[])
})
test('explicitly unassigned creation remains possible with no grants or preference',async()=>{
 const response=await create({officeAccess:grants([],null)});assert.equal(response.status,200)
 assert.deepEqual(await saved(response.result.user.id),{creationOfficeId:null,version:1});assert.deepEqual(await officeIds(response.result.user.id),[])
})
test('company membership is persisted independently from exact offices and includes subsidiaries only explicitly',async()=>{
 const response=await create({role:'MANAGER',officeAccess:grants([],b,[{companyId:company,includeSubsidiaries:false}])})
 assert.equal(response.status,200,JSON.stringify({response,errors}));assert.deepEqual(await officeIds(response.result.user.id),[])
 const rows=(await root.query('SELECT "companyId","includeSubsidiaries" FROM "BusinessCompanyGrant" WHERE "userId"=$1',[response.result.user.id])).rows
 assert.deepEqual(rows,[{companyId:company,includeSubsidiaries:false}])
})
test('foreign, missing, duplicate and forged office grants reject the whole account creation',async()=>{
 for(const officeAccess of [grants([foreignOffice],foreignOffice),grants(['missing'],'missing'),grants([a,a]),{...grants(),version:999},grants([],null,[{companyId:child,includeSubsidiaries:false},{companyId:child,includeSubsidiaries:true}])]){
  const response=await create({officeAccess});assert.equal(response.status,400,JSON.stringify({response,errors}));await absent(response.email)
 }
})
test('a creation office outside the explicit grants rolls back the user and access policy',async()=>{
 const response=await create({officeAccess:grants([b],a)});assert.equal(response.status,400,JSON.stringify({response,errors}));await absent(response.email)
})
test('customer, invited and suspended accounts cannot acquire office eligibility at creation',async()=>{
 for(const extra of [{role:'CUSTOMER'},{status:'INVITED'},{status:'SUSPENDED'}]){
  const response=await create({...extra,officeAccess:grants()});assert.equal(response.status,400,JSON.stringify({response,errors}));await absent(response.email)
 }
})
test('closed offices cannot become a new creation preference',async()=>{
 await root.query('UPDATE "BusinessOffice" SET archived=true WHERE id=$1',[b])
 try{const response=await create({officeAccess:grants([b],b)});assert.equal(response.status,400);await absent(response.email)}finally{await root.query('UPDATE "BusinessOffice" SET archived=false WHERE id=$1',[b])}
})
test('manager labels, anonymous users and stale administrator sessions cannot initialize grants',async()=>{
 assert.equal((await create({officeAccess:grants()},session(manager,'MANAGER'))).status,403)
 assert.equal((await create({officeAccess:grants()},null)).status,401)
 await root.query('UPDATE "User" SET role=\'MANAGER\' WHERE id=$1',[admin])
 try{const response=await create({officeAccess:grants()});assert.equal(response.status,403);await absent(response.email)}finally{await root.query('UPDATE "User" SET role=\'ADMIN\' WHERE id=$1',[admin])}
})
test('a mandatory office audit failure rolls back account, profile policy and grants',async()=>{
 await root.query('ALTER TABLE "AuditLog" ADD CONSTRAINT office_provision_audit_failure CHECK(event <> \'structure.officeMembership.updated\') NOT VALID')
 try{const response=await create({officeAccess:grants()});assert.equal(response.status,500);await absent(response.email)}finally{await root.query('ALTER TABLE "AuditLog" DROP CONSTRAINT office_provision_audit_failure')}
})
test('version-zero initialization cannot overwrite a policy already created or subsequently edited',async()=>{
 const response=await create({officeAccess:grants()});assert.equal(response.status,200);const id=response.result.user.id
 await assert.rejects(runWithTenantDbContext(tenant,()=>runWithDatabaseActor(admin,()=>prisma.$transaction(tx=>saveOfficeMemberships(tx,{tenantId:tenant,userId:admin},id,{...grants([b],b),version:0})))),error=>error.status===409)
 assert.deepEqual(await officeIds(id),[a]);assert.equal((await saved(id)).creationOfficeId,a)
})
test('transaction membership helper rechecks authority and never accepts a foreign target user',async()=>{
 await assert.rejects(runWithTenantDbContext(tenant,()=>prisma.$transaction(tx=>saveOfficeMemberships(tx,{tenantId:tenant,userId:manager},manager,{...grants(),version:0}))),error=>error.status===403)
 await assert.rejects(runWithTenantDbContext(tenant,()=>prisma.$transaction(tx=>saveOfficeMemberships(tx,{tenantId:tenant,userId:admin},'missing',{...grants(),version:0}))),error=>error.status===404)
 assert.equal(await prisma.user.count(),0,'transaction actor/tenant context must not leak')
})
