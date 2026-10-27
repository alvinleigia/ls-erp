/* eslint-disable @typescript-eslint/no-require-imports */
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto')
const {Pool}=require('pg'),{PrismaClient}=require('@prisma/client'),{TenantPgAdapter}=require('../lib/tenant-pg-adapter.ts'),{runWithDatabaseActor}=require('../lib/database-actor.ts')
const {createCollaboratorService}=require('../platform/collaborators/service.ts'),{createAuditReportService}=require('../platform/audit/service.ts'),{fixtureUser}=require('./helpers/access-fixtures.cjs')
require('../lib/logger.ts').logger.info=()=>{}
const url=new URL(process.env.CRM_TEST_DATABASE_URL||'http://invalid');if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!='/ls_salon_crm_test')throw Error('Disposable local database only.')
const tenant='collaborators_'+randomUUID(),foreign='collaborators_'+randomUUID(),pools=[],clients=[]
function client(tenantId,bypass=false){const u=new URL(url);if(!bypass){u.username='crm_test_runtime';u.password=''}const pool=new Pool({connectionString:u.toString(),max:4});pools.push(pool);const db=new PrismaClient({adapter:new TenantPgAdapter(pool,{tenantId,bypass})});clients.push(db);return db}
const root=client(undefined,true),db=client(tenant),otherDb=client(foreign),unscoped=client(undefined),identity=u=>({tenantId:u.tenantId,userId:u.id,requestId:'collaborator-test'}),denied=s=>e=>e.status===s
let admin,manager,manager2,staff,customer,foreignAdmin,service,other,partner
const create=(extra={})=>({name:'  West partner  ',code:' west ',classification:'Channel partner',organizationName:'Agency business',email:' PARTNER@example.test ',phone:'+91 1234567890',supervisorUserId:manager.id,...extra})
const counts=async()=>Promise.all(['user','staffProfile','staffWorkplaceAssignment','tenantRoleAssignment','businessTeamMember','businessOfficeGrant','businessCompanyGrant','crmEnquiry'].map(model=>root[model].count({where:model==='staffProfile'?{user:{tenantId:tenant}}:{tenantId:tenant}})))
before(async()=>{
 await root.tenant.createMany({data:[tenant,foreign].map(id=>({id,name:id,slug:id}))})
 const user=(t,role,name)=>fixtureUser(root,{data:{tenantId:t,role,name,email:randomUUID()+'@example.test'}})
 admin=await user(tenant,'ADMIN','Administrator');manager=await user(tenant,'MANAGER','Area supervisor');manager2=await user(tenant,'MANAGER','Backup supervisor');staff=await user(tenant,'STAFF','Employee');customer=await user(tenant,'CUSTOMER','Customer');foreignAdmin=await user(foreign,'ADMIN','Foreign admin')
 service=createCollaboratorService(db,identity(admin));other=createCollaboratorService(otherDb,identity(foreignAdmin))
})
after(async()=>{await Promise.all(clients.map(c=>c.$disconnect()));await Promise.all(pools.map(p=>p.end()))})

test('external identity creation normalizes contacts without creating logins, employees, grants or business records',async()=>{
 const before=await counts();partner=await service.create(create());assert.equal(partner.code,'WEST');assert.equal(partner.name,'West partner');assert.equal(partner.email,'partner@example.test');assert.equal(partner.supervisor.id,manager.id);assert.deepEqual(await counts(),before)
 await assert.rejects(service.create(create()),denied(409));assert.equal((await service.list({})).total,1)
 for(const body of [create({role:'ADMIN'}),create({name:' '}),create({email:'typo'}),create({supervisorUserId:''}),create({officeIds:['x']})])assert.throws(()=>service.create(body))
})
test('supervisors must be current tenant internal management accounts, without inheriting their actions',async()=>{
 for(const user of [staff,customer,foreignAdmin])await assert.rejects(service.create(create({code:'BAD',supervisorUserId:user.id})),denied(400))
 await root.user.update({where:{id:manager2.id},data:{status:'SUSPENDED'}})
 try{await assert.rejects(service.update(partner.id,{version:partner.version,supervisorUserId:manager2.id}),denied(400));assert.equal((await service.supervisors({q:'Backup'})).total,0)}finally{await root.user.update({where:{id:manager2.id},data:{status:'ACTIVE'}})}
 const before=await counts();partner=await service.update(partner.id,{version:partner.version,supervisorUserId:manager2.id});assert.equal(partner.supervisor.id,manager2.id);assert.deepEqual(await counts(),before)
 for(const user of [manager,manager2,staff]){
  const restricted=createCollaboratorService(db,identity(user));await assert.rejects(restricted.list({}),denied(403));await assert.rejects(restricted.get(partner.id),denied(403));await assert.rejects(restricted.supervisors({}),denied(403));await assert.rejects(restricted.update(partner.id,{version:partner.version,name:'Denied'}),denied(403))
 }
})
test('foreign identities, supervisor choices and counts never cross tenant boundaries',async()=>{
 const row=await other.create(create({code:'FOREIGN',supervisorUserId:foreignAdmin.id}))
 await assert.rejects(service.get(row.id),denied(404));await assert.rejects(service.update(row.id,{version:row.version,name:'Denied'}),denied(404))
 assert.equal((await service.list({q:'FOREIGN'})).total,0);assert.equal((await service.supervisors({q:'Foreign'})).total,0)
 await assert.rejects(root.externalCollaborator.update({where:{id:partner.id},data:{supervisorUserId:foreignAdmin.id}}),/active internal/)
})
test('search, status, sorting and paging apply one bounded population',async()=>{
 const second=await service.create(create({code:'EAST',name:'East partner',classification:'Consultant',organizationName:null,email:null,phone:null}))
 assert.equal((await service.list({q:'CONSULTANT'})).items[0].id,second.id)
 const a=await service.list({pageSize:1,sort:'code'}),b=await service.list({pageSize:1,page:2,sort:'code'});assert.equal(a.total,2);assert.equal(a.totalPages,2);assert.notEqual(a.items[0].id,b.items[0].id)
 const supervisors=await service.supervisors({pageSize:1});assert.equal(supervisors.total,3);assert.equal(supervisors.items.length,1);assert.equal((await service.supervisors({q:'Area'})).items[0].id,manager.id)
 await root.user.update({where:{id:manager2.id},data:{name:null}});try{assert.equal((await service.supervisors({q:manager2.email})).items[0].name,manager2.email)}finally{await root.user.update({where:{id:manager2.id},data:{name:'Backup supervisor'}})}
 for(const invalid of [{page:0},{pageSize:101},{sort:'passwordHash'},{status:'unknown'}])assert.throws(()=>service.list(invalid))
})
test('concurrent changes produce one winner and preserve the stale draft version',async()=>{
 const results=await Promise.allSettled(['A','B'].map(name=>service.update(partner.id,{version:partner.version,name})))
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.filter(x=>x.status==='rejected'&&x.reason.status===409).length,1);partner=await service.get(partner.id)
 assert.throws(()=>service.update(partner.id,{version:partner.version,code:'NEW'}));for(const data of [{id:randomUUID()},{tenantId:foreign},{code:'NEW'}])await assert.rejects(root.externalCollaborator.update({where:{id:partner.id},data}),/identity is immutable/)
})
test('inactive supervisor remains historical; restoring requires active assignment and never silently substitutes',async()=>{
 await root.user.update({where:{id:manager2.id},data:{status:'SUSPENDED'}})
 try{
  assert.equal((await service.get(partner.id)).supervisor.status,'SUSPENDED');assert.equal((await service.supervisors({q:'Backup'})).total,0)
  partner=await service.update(partner.id,{version:partner.version,archived:true});assert.equal((await service.list({status:'archived'})).items[0].id,partner.id)
  await assert.rejects(service.update(partner.id,{version:partner.version,archived:false}),denied(400))
  partner=await service.update(partner.id,{version:partner.version,archived:false,supervisorUserId:manager.id});assert.equal(partner.supervisor.id,manager.id)
 }finally{await root.user.update({where:{id:manager2.id},data:{status:'ACTIVE'}})}
})
test('fresh operator role, account and tenant status deny saved-session administration',async()=>{
 for(const [model,where,data,restore]of [['user',{id:admin.id},{role:'MANAGER'},{role:'ADMIN'}],['user',{id:admin.id},{status:'SUSPENDED'},{status:'ACTIVE'}],['tenant',{id:tenant},{status:'SUSPENDED'},{status:'ACTIVE'}]]){
  await root[model].update({where,data});try{await assert.rejects(service.list({}),denied(403));await assert.rejects(service.update(partner.id,{version:partner.version,name:'Denied'}),denied(403))}finally{await root[model].update({where,data:restore})}
 }
})
test('forced RLS protects raw directory rows and audit copies; ordinary actors cannot hard-delete',async()=>{
 const where={entityType:'ExternalCollaborator'}
 assert.equal(await unscoped.externalCollaborator.count(),0);assert.equal(await db.externalCollaborator.count(),0)
 for(const user of [manager,staff]){assert.equal(await runWithDatabaseActor(user.id,async()=>await db.externalCollaborator.count()),0);assert.equal(await runWithDatabaseActor(user.id,async()=>await db.auditLog.count({where})),0)}
 assert.equal(await runWithDatabaseActor(admin.id,async()=>await otherDb.externalCollaborator.count()),0)
 assert.equal(await runWithDatabaseActor(admin.id,async()=>await db.externalCollaborator.count()),2)
 assert.equal((await runWithDatabaseActor(admin.id,async()=>await db.externalCollaborator.deleteMany())).count,0)
 await assert.rejects(runWithDatabaseActor(manager.id,async()=>await db.externalCollaborator.create({data:{tenantId:tenant,...create({code:'RAW'})}})))
 const [role]=await db.$queryRaw`SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`;assert.equal(role.rolsuper,false);assert.equal(role.rolbypassrls,false)
})
test('supervisor changes retain before/after evidence and failed mandatory audit rolls back the directory update',async()=>{
 const report=await createAuditReportService(db,identity(admin)).list({entityType:'ExternalCollaborator',category:'security'});assert.ok(report.total>=6)
 assert.equal((await createAuditReportService(db,identity(manager)).list({entityType:'ExternalCollaborator'})).total,0)
 const events=await root.auditLog.findMany({where:{tenantId:tenant,event:'collaborator.updated',entityId:partner.id}});assert.ok(events.some(e=>e.before.supervisorUserId!==e.after.supervisorUserId))
 const faulty=new Proxy(db,{get(target,key){if(key==='$transaction')return fn=>target.$transaction(tx=>fn(new Proxy(tx,{get(t,k){if(k==='auditLog')return {createMany:()=>{throw Error('Required audit unavailable')}};return t[k]}})));return target[key]}})
 await assert.rejects(createCollaboratorService(faulty,identity(admin)).update(partner.id,{version:partner.version,name:'Unlogged'}),/Required audit unavailable/)
 assert.deepEqual(await service.get(partner.id),partner)
})

test('privileged whole-tenant cleanup removes external identities with their supervisors without orphaning other tenants',async()=>{
 const id='cleanup_collaborator_'+randomUUID();await root.tenant.create({data:{id,slug:id,name:'Disposable cleanup'}})
 const owner=await fixtureUser(root,{data:{tenantId:id,role:'ADMIN',email:randomUUID()+'@example.test'}})
 await root.externalCollaborator.create({data:{tenantId:id,code:'CLEANUP',name:'Disposable external identity',supervisorUserId:owner.id}})
 await root.$transaction(async tx=>{
  await tx.realEstateProjectStatus.deleteMany({where:{tenantId:id}});await tx.realEstatePropertyCategory.deleteMany({where:{tenantId:id}});await tx.realEstateBuyingTimeframe.deleteMany({where:{tenantId:id}})
  await tx.tenant.delete({where:{id}})
 })
 assert.equal(await root.externalCollaborator.count({where:{tenantId:id}}),0);assert.equal(await root.user.count({where:{tenantId:id}}),0);assert.equal(await root.externalCollaborator.count({where:{tenantId:tenant}}),2)
})
