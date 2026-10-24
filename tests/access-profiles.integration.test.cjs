/* eslint-disable @typescript-eslint/no-require-imports */
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Pool}=require('pg'),{PrismaClient}=require('@prisma/client')
const {TenantPgAdapter}=require('../lib/tenant-pg-adapter.ts'),{createAccessRoleService}=require('../platform/access/service.ts'),{createApplicationCrmService}=require('../application/crm/service.ts')
const {findAccessUser,accessContext}=require('../platform/access/server.ts'),{permits}=require('../platform/access/policy.ts'),{moduleProfileTemplates}=require('../platform/access/profiles.ts'),{assignInitialProfiles}=require('../platform/access/user-security.ts')
require('../lib/logger.ts').logger.info=()=>{}
const url=new URL(process.env.CRM_TEST_DATABASE_URL||'http://invalid');if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!='/ls_salon_crm_test')throw Error('Disposable local database only.')
const tenant='profiles_'+randomUUID(),foreign='profiles_'+randomUUID(),clients=[],pools=[]
function client(tenantId,bypass=false){const u=new URL(url);if(!bypass){u.username='crm_test_runtime';u.password=''}const pool=new Pool({connectionString:u.toString(),max:3});pools.push(pool);const db=new PrismaClient({adapter:new TenantPgAdapter(pool,{tenantId,bypass})});clients.push(db);return db}
const root=client(undefined,true),db=client(tenant),other=client(foreign),unscoped=client(undefined),identity=u=>({tenantId:u.tenantId,userId:u.id}),status=code=>e=>e.status===code
let admin,manager,staff,foreignAdmin,roles,crm,limited,sales,inventory,core,otherProfile,own,hidden
async function setProfiles(ids,patch={},user=manager){const current=await roles.assignment(user.id);return roles.assign(user.id,{roleIds:ids,salesRecordScope:current.accessPolicy.salesRecordScope,projectRecordScope:current.accessPolicy.projectRecordScope,version:current.accessPolicy.version,...patch})}
before(async()=>{
 await root.tenant.createMany({data:[tenant,foreign].map(id=>({id,slug:id,name:id}))});const user=(tenantId,role)=>root.user.create({data:{tenantId,role,name:role,email:randomUUID()+'@example.test'}})
 admin=await user(tenant,'ADMIN');manager=await user(tenant,'MANAGER');staff=await user(tenant,'STAFF');foreignAdmin=await user(foreign,'ADMIN')
 await root.tenantModule.createMany({data:['crm','inventory'].map(key=>({tenantId:tenant,key,enabled:true,allowed:true}))})
 roles=createAccessRoleService(db,identity(admin));crm=createApplicationCrmService(db,identity(admin));limited=createApplicationCrmService(db,identity(manager))
 const profile=key=>moduleProfileTemplates.find(t=>t.key===key)
 sales=await roles.save({name:'Sales manager',moduleKey:'crm',permissions:profile('crm:manager').permissions});inventory=await roles.save({name:'Inventory viewer',moduleKey:'inventory',permissions:profile('inventory:viewer').permissions});core=await roles.save({name:'Core viewer',moduleKey:'core',permissions:profile('core:viewer').permissions})
 otherProfile=await createAccessRoleService(other,identity(foreignAdmin)).save({name:'Foreign profile',permissions:[]})
 const contact=await crm.createContact({name:'Profile customer'});own=await crm.createEnquiry({title:'Own lead',contactId:contact.id,assignedUserId:manager.id});hidden=await crm.createEnquiry({title:'Other lead',contactId:contact.id,assignedUserId:staff.id})
})
after(async()=>{await Promise.all(clients.map(c=>c.$disconnect()));await Promise.all(pools.map(p=>p.end()))})
test('new accounts have no implicit business access, even with Manager account authority',async()=>{
 assert.deepEqual((await findAccessUser(db,tenant,manager.id)).accessAssignments,[])
 await assert.rejects(limited.listEnquiries({}),status(403));assert.equal((await roles.assignment(manager.id)).accessPolicy.salesRecordScope,'OWN')
 assert.equal(await unscoped.tenantUserAccess.count(),0)
})
test('Sales Manager plus Inventory Viewer composes actions without widening sales scope',async()=>{
 await setProfiles([sales.id,inventory.id],{salesRecordScope:'OWN',projectRecordScope:'MANAGED_TEAMS'})
 const actor={...identity(manager),...accessContext(await findAccessUser(db,tenant,manager.id))}
 assert.equal(permits(actor,'enquiries.edit'),true);assert.equal(permits(actor,'inventoryProducts.read'),true);assert.equal(permits(actor,'inventoryProducts.edit'),false)
 assert.equal(actor.salesRecordScope,'OWN');assert.equal(actor.projectRecordScope,'MANAGED_TEAMS')
 assert.deepEqual((await limited.listEnquiries({})).items.map(r=>r.id),[own.id]);await assert.rejects(limited.getEnquiry(hidden.id),status(404))
 await setProfiles([sales.id,inventory.id,core.id]);await assert.rejects(limited.getEnquiry(hidden.id),status(404))
 assert.equal((await roles.assignment(manager.id)).accessAssignments.length,3)
})
test('visibility changes are explicit and removing every profile immediately revokes access',async()=>{
 await setProfiles([sales.id,inventory.id],{salesRecordScope:'ALL'});assert.equal((await limited.listEnquiries({})).total,2)
 await setProfiles([inventory.id]);await assert.rejects(limited.listEnquiries({}),status(403))
 await setProfiles([]);const actor=accessContext(await findAccessUser(db,tenant,manager.id));assert.deepEqual(actor.permissions,[]);assert.equal(actor.salesRecordScope,'ALL')
 await setProfiles([sales.id,inventory.id],{salesRecordScope:'OWN'})
})
test('profile editing and revocation refresh active sessions; scope belongs to the user',async()=>{
 sales=await roles.save({name:sales.name,permissions:['dashboard.read','enquiries.read'],version:sales.version},sales.id)
 await assert.rejects(limited.updateEnquiry(own.id,{title:'Denied',assignedUserId:manager.id,status:'NEW',version:own.version}),status(403))
 assert.equal((await limited.listEnquiries({})).total,1)
 await assert.rejects(roles.save({name:sales.name,permissions:['inventoryProducts.read'],version:sales.version},sales.id),status(400))
 await root.tenantAccessRole.update({where:{id:inventory.id},data:{archived:true}})
 const actor=accessContext(await findAccessUser(db,tenant,manager.id));assert.equal(permits(actor,'inventoryProducts.read'),false);assert.equal(permits(actor,'enquiries.read'),true)
 await root.tenantAccessRole.update({where:{id:inventory.id},data:{archived:false}})
})
test('cross-tenant, archived, duplicate and stale assignments cannot replace current profiles',async()=>{
 const before=await roles.assignment(manager.id),body={roleIds:[sales.id],version:before.accessPolicy.version,salesRecordScope:'OWN',projectRecordScope:'OWN'}
 await assert.rejects(roles.assign(manager.id,{...body,roleIds:[otherProfile.id]}),status(409))
 assert.throws(()=>roles.assign(manager.id,{...body,roleIds:[sales.id,sales.id]}))
 await roles.assign(manager.id,body);await assert.rejects(roles.assign(manager.id,{...body,roleIds:[]}),status(409))
 await assert.rejects(roles.assign(admin.id,{...body,version:0}),status(409));assert.equal(await other.tenantUserAccess.count(),0)
 await assert.rejects(roles.save({name:sales.name,permissions:sales.permissions,version:sales.version,archived:true},sales.id),status(409))
})
test('failed audit rolls back profiles and user visibility as one change',async()=>{
 const before=await roles.assignment(manager.id)
 await root.$executeRawUnsafe(`CREATE FUNCTION public.reject_profile_assignment() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='access.assignment.updated' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END $$`)
 await root.$executeRawUnsafe('CREATE TRIGGER reject_profile_assignment BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION public.reject_profile_assignment()')
 try{await assert.rejects(setProfiles([inventory.id],{salesRecordScope:'ALL'}));const after=await roles.assignment(manager.id);assert.equal(after.accessPolicy.version,before.accessPolicy.version);assert.deepEqual(after.accessAssignments,before.accessAssignments)}finally{await root.$executeRawUnsafe('DROP TRIGGER reject_profile_assignment ON "AuditLog"');await root.$executeRawUnsafe('DROP FUNCTION public.reject_profile_assignment()')}
})
test('user creation assigns several profiles atomically and retains own-record defaults',async()=>{
 const forbiddenId=randomUUID()
 await assert.rejects(db.$transaction(async tx=>{const user=await tx.user.create({data:{id:forbiddenId,tenantId:tenant,role:'STAFF',email:forbiddenId+'@example.test'}});await assignInitialProfiles(tx,identity(manager),user,[sales.id])}),status(403))
 assert.equal(await root.user.count({where:{id:forbiddenId}}),0)
 const id=randomUUID();await db.$transaction(async tx=>{const user=await tx.user.create({data:{id,tenantId:tenant,role:'STAFF',email:id+'@example.test'}});await assignInitialProfiles(tx,identity(admin),user,[sales.id,inventory.id])})
 const user=await findAccessUser(db,tenant,id);assert.equal(user.accessAssignments.length,2);assert.equal(user.salesRecordScope,'OWN');assert.equal(accessContext(user).permissions.includes('inventoryProducts.read'),true)
 await assert.rejects(db.$transaction(async tx=>{const user=await tx.user.create({data:{tenantId:tenant,role:'STAFF',email:randomUUID()+'@example.test'}});await assignInitialProfiles(tx,identity(admin),user,[otherProfile.id])}),status(400))
 const audit=await root.auditLog.findFirst({where:{tenantId:tenant,event:'access.assignment.updated',entityId:id}});assert.ok(audit.after.roleIds.includes(inventory.id))
})
