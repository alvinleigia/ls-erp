/* eslint-disable @typescript-eslint/no-require-imports */
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { Pool } = require('pg')
const { PrismaClient } = require('@prisma/client')
const { TenantPgAdapter } = require('../lib/tenant-pg-adapter.ts')
const { createAccessRoleService } = require('../platform/access/service.ts')
const { createApplicationCrmService } = require('../application/crm/service.ts')
const { guardUserWrite, auditUserSecurity, assignInitialRole } = require('../platform/access/user-security.ts')
const { allPermissions } = require('../platform/access/catalog.ts')
const { accessRoleSchema } = require('../platform/access/validation.ts')
require('../lib/logger.ts').logger.info = () => {}
const url = new URL(process.env.CRM_TEST_DATABASE_URL || 'http://invalid')
if (!['localhost','127.0.0.1'].includes(url.hostname) || url.pathname !== '/ls_salon_crm_test') throw Error('Use only the isolated local CRM test database.')
const tenant = `roles_${randomUUID()}`, otherTenant = `roles_${randomUUID()}`, pools = [], clients = []
function client(tenantId, bypass = false) {
 const u = new URL(url); if (!bypass) {u.username='crm_test_runtime';u.password=''}
 const pool=new Pool({connectionString:u.toString(),max:4});pools.push(pool)
 const db=new PrismaClient({adapter:new TenantPgAdapter(pool,{tenantId,bypass})});clients.push(db);return db
}
const root=client(undefined,true), db=client(tenant), foreignDb=client(otherTenant), unscoped=client(undefined)
const identity=u=>({tenantId:u.tenantId,userId:u.id})
const status=code=>error=>error.status===code
let admin,manager,staff,outsider,roles,crm,restricted,role,contact,lead
async function permissions(values) {
 role=await roles.save({name:role.name,permissions:values,version:role.version},role.id)
}
before(async()=>{
 await root.tenant.createMany({data:[tenant,otherTenant].map(id=>({id,slug:id,name:id}))})
 const user=(tenantId,role)=>root.user.create({data:{tenantId,role,name:role,email:`${randomUUID()}@example.test`}})
 admin=await user(tenant,'ADMIN');manager=await user(tenant,'MANAGER');staff=await user(tenant,'STAFF');outsider=await user(otherTenant,'ADMIN')
 await root.tenantModule.createMany({data:[tenant,otherTenant].flatMap(tenantId=>['crm','realEstate','salesDocuments','paymentPlans'].map(key=>({tenantId,key,allowed:true,enabled:true})))})
 roles=createAccessRoleService(db,identity(admin));crm=createApplicationCrmService(db,identity(admin));restricted=createApplicationCrmService(db,identity(manager))
 contact=await crm.createContact({name:'Role test buyer'})
 lead=await crm.createEnquiry({title:'Access test',contactId:contact.id,assignedUserId:manager.id})
})
after(async()=>{await Promise.all(clients.map(c=>c.$disconnect()));await Promise.all(pools.map(p=>p.end()))})

test('legacy access preserved; role setup is admin only and tenant isolated',async()=>{
 assert.equal((await restricted.listEnquiries({})).total,1)
 assert.throws(()=>accessRoleSchema.parse({name:'Invalid',permissions:['enquiries.edit']}))
 await assert.rejects(createAccessRoleService(db,identity(manager)).save({name:'Escalation',permissions:allPermissions}),status(403))
 role=await roles.save({name:'Restricted manager',permissions:['enquiries.read']})
 await roles.assign(manager.id,{roleId:role.id,previousRoleId:null})
 await assert.rejects(roles.assign(admin.id,{roleId:role.id,previousRoleId:null}),status(409))
 await assert.rejects(createAccessRoleService(foreignDb,identity(outsider)).get(role.id),status(404))
 assert.equal(await unscoped.tenantAccessRole.count(),0)
 assert.equal(await foreignDb.tenantRoleAssignment.count(),0)
 await assert.rejects(root.tenantRoleAssignment.create({data:{tenantId:otherTenant,userId:outsider.id,roleId:role.id}}))
})
test('read-only and denied entities cover lists, details, exports and secondary writes',async()=>{
 assert.equal((await restricted.getEnquiry(lead.id)).title,lead.title)
 await assert.rejects(restricted.listContacts({}),status(403))
 await assert.rejects(restricted.getContact(contact.id),status(403))
 await assert.rejects(restricted.listEnquiries({},true),status(403))
 await assert.rejects(restricted.addNote(lead.id,{message:'No edit permission'}),status(403))
 await assert.rejects(restricted.updateEnquiry(lead.id,{title:'Denied',assignedUserId:manager.id,status:'NEW',version:lead.version}),status(403))
 await assert.rejects(restricted.listQuotations(undefined,{}),status(403))
 await assert.rejects(restricted.getQuotation('unknown',undefined,true),status(403))
 await assert.rejects(restricted.listExtensionChoices('projects',{}),status(403))
 await permissions(['reports.read','reports.export','enquiries.read','opportunities.read','activities.read'])
 await assert.rejects(restricted.exportSalesReport({view:'leads'}),status(403))
 await permissions(['enquiries.read','enquiries.create'])
 const count=await root.crmContact.count({where:{tenantId:tenant}})
 await assert.rejects(restricted.createEnquiry({title:'Inline bypass',assignedUserId:manager.id,newContact:{name:'Should rollback'}}),status(403))
 assert.equal(await root.crmContact.count({where:{tenantId:tenant}}),count)
})
test('edit does not imply archive, reassignment or creation of follow-ups',async()=>{
 await permissions(['contacts.read','contacts.edit','enquiries.read','enquiries.edit','activities.read','activities.edit'])
 await restricted.updateContact(contact.id,{name:'Updated buyer',version:contact.version,archived:false})
 const current=await crm.getContact(contact.id)
 await assert.rejects(restricted.updateContact(contact.id,{name:current.name,version:current.version,archived:true}),status(403))
 await assert.rejects(restricted.updateEnquiry(lead.id,{title:lead.title,assignedUserId:staff.id,status:'NEW',version:lead.version}),status(403))
 const task=await crm.createWork({title:'Call',type:'CALL',callDirection:'OUTBOUND',contactId:contact.id,assignedUserId:manager.id,dueOn:'2026-10-01'})
 const completion={version:task.version,outcome:'CONNECTED',summary:'Done',occurredAt:new Date(Date.now()-60000).toISOString()}
 await assert.rejects(restricted.completeWork(task.id,{...completion,followUp:{title:'Unauthorized follow-up',type:'CALL',callDirection:'OUTBOUND',assignedUserId:manager.id,dueOn:'2026-10-02'}}),status(403))
 assert.equal((await crm.getWork(task.id)).status,'OPEN')
 await restricted.completeWork(task.id,completion)
 assert.equal((await crm.getWork(task.id)).status,'COMPLETED')
})
test('assignment is version-aware; assigned roles cannot be archived; changes take effect without login',async()=>{
 await assert.rejects(roles.assign(manager.id,{roleId:null,previousRoleId:null}),status(409))
 await assert.rejects(roles.save({name:role.name,permissions:role.permissions,archived:true,version:role.version},role.id),status(409))
 await assert.rejects(roles.save({name:role.name,permissions:[],version:role.version-1},role.id),status(409))
 await permissions([])
 await assert.rejects(restricted.listEnquiries({}),status(403))
 await roles.assign(manager.id,{roleId:null,previousRoleId:role.id})
 assert.equal((await restricted.listEnquiries({})).total,1)
 await root.user.update({where:{id:admin.id},data:{role:'STAFF'}})
 await assert.rejects(roles.list({}),status(403))
 await root.user.update({where:{id:admin.id},data:{role:'ADMIN'}})
 const audit=await root.auditLog.findFirst({where:{tenantId:tenant,event:'access.assignment.updated',entityId:manager.id}})
 assert.equal(audit.actorUserId,admin.id)
})
test('audit failures roll back role writes and initial assignments atomically',async()=>{
 await root.$executeRawUnsafe(`CREATE FUNCTION public.reject_role_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='access.role.updated' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END $$`)
 await root.$executeRawUnsafe(`CREATE TRIGGER reject_role_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION public.reject_role_audit()`)
 try { await assert.rejects(roles.save({name:'Must not persist',permissions:[],version:role.version},role.id));assert.equal((await roles.get(role.id)).name,role.name) }
 finally {await root.$executeRawUnsafe('DROP TRIGGER reject_role_audit ON "AuditLog"');await root.$executeRawUnsafe('DROP FUNCTION public.reject_role_audit()')}
 const foreignRole=await createAccessRoleService(foreignDb,identity(outsider)).save({name:'Foreign',permissions:[]})
 const id=randomUUID()
 await assert.rejects(db.$transaction(async tx=>{await guardUserWrite(tx,identity(admin));const created=await tx.user.create({data:{id,tenantId:tenant,role:'STAFF',email:`${id}@example.test`}});await assignInitialRole(tx,identity(admin),created,foreignRole.id)}),status(400))
 assert.equal(await root.user.count({where:{id}}),0)
})
test('last active administrator survives concurrent demotion; stale admins cannot write',async()=>{
 await assert.rejects(db.$transaction(tx=>guardUserWrite(tx,identity(admin),admin.id,{status:'SUSPENDED'})),status(409))
 const second=await root.user.create({data:{tenantId:tenant,role:'ADMIN',email:`${randomUUID()}@example.test`}})
 const demote=u=>db.$transaction(async tx=>{const before=await guardUserWrite(tx,identity(u),u.id,{role:'STAFF'});await tx.user.update({where:{id:u.id},data:{role:'STAFF'}});await auditUserSecurity(tx,identity(u),u.id,before,{role:'STAFF',status:'ACTIVE'})})
 const results=await Promise.allSettled([demote(admin),demote(second)])
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
 assert.equal(await root.user.count({where:{tenantId:tenant,role:'ADMIN',status:'ACTIVE'}}),1)
 const demoted=results[0].status==='fulfilled'?admin:second
 await assert.rejects(db.$transaction(tx=>guardUserWrite(tx,identity(demoted))),status(403))
})
