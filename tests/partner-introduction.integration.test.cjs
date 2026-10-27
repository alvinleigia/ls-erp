/* eslint-disable @typescript-eslint/no-require-imports */
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Pool}=require('pg'),{PrismaClient}=require('@prisma/client')
const {TenantPgAdapter}=require('../lib/tenant-pg-adapter.ts'),{runWithDatabaseActor}=require('../lib/database-actor.ts')
const {createApplicationCrmService}=require('../application/crm/service.ts'),{createCollaboratorService}=require('../platform/collaborators/service.ts'),{createOfficeAccessService}=require('../platform/companies/office-access.ts'),{createAccessRoleService}=require('../platform/access/service.ts'),{authorizeBusinessOperation}=require('../platform/access/operation.ts'),{createRecordSharingService}=require('../platform/access/sharing-service.ts')
const {allPermissions}=require('../platform/access/catalog.ts'),{defaultRecordRules,supportedScopes}=require('../platform/access/rules.ts')
require('../lib/logger.ts').logger.info=()=>{}
const url=new URL(process.env.CRM_TEST_DATABASE_URL||'http://invalid');if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!='/ls_salon_crm_test')throw Error('Disposable local database only.')
const tenant='introduction_'+randomUUID(),foreign=tenant+'_foreign',clients=[],pools=[]
function client(tenantId,bypass=false){const u=new URL(url);if(!bypass){u.username='crm_test_runtime';u.password=''}const pool=new Pool({connectionString:u.toString(),max:4});pools.push(pool);const db=new PrismaClient({adapter:new TenantPgAdapter(pool,{tenantId,bypass})});clients.push(db);return db}
const root=client(undefined,true),db=client(tenant),other=client(foreign),identity=user=>({tenantId:user.tenantId,userId:user.id}),status=n=>error=>error.status===n
const crm=user=>createApplicationCrmService(db,identity(user)),directory=user=>createCollaboratorService(db,identity(user))
let admin,supervisor,staff,partner,partner2,secondLogin,foreignPartner,a,b,contact,pipeline,stage,office,owned
const enquiry=(title,user=admin,extra={})=>crm(user).createEnquiry({title,contactId:contact.id,assignedUserId:user.id,...extra})
const opportunity=(title,user=admin,extra={})=>crm(user).createOpportunity({title,contactId:contact.id,assignedUserId:user.id,pipelineId:pipeline.id,stageId:stage.id,amount:'100',currency:'INR',expectedCloseOn:'2030-01-01',...extra})
const direct=(user,work,requirement='enquiries.create')=>runWithDatabaseActor(user.id,async()=>await db.$transaction(async tx=>{await authorizeBusinessOperation(tx,identity(user),requirement,['crm']);return work(tx)}))
const rawEnquiry=(user,extra={})=>direct(user,tx=>tx.crmEnquiry.create({data:{tenantId:tenant,title:'Direct SQL introduction',assignedUserId:user.id,contactId:contact.id,...extra}}))
before(async()=>{
 await root.tenant.createMany({data:[tenant,foreign].map(id=>({id,slug:id,name:id}))})
 const user=(role,extra={})=>root.user.create({data:{tenantId:tenant,role,name:role,email:randomUUID()+'@example.test',...extra}})
 admin=await user('ADMIN');supervisor=await user('MANAGER');staff=await user('STAFF')
 await root.tenantModule.create({data:{tenantId:tenant,key:'crm',allowed:true,enabled:true}})
 a=await directory(admin).create({name:'Original agency',code:'AGENCY_A',supervisorUserId:supervisor.id,email:'private@example.test',phone:'12345'});b=await directory(admin).create({name:'Second agency',code:'AGENCY_B',supervisorUserId:admin.id})
 partner=await user('STAFF',{collaboratorId:a.id});secondLogin=await user('STAFF',{collaboratorId:a.id});partner2=await user('STAFF',{collaboratorId:b.id})
 const fAdmin=await root.user.create({data:{tenantId:foreign,role:'ADMIN',email:randomUUID()+'@example.test'}})
 foreignPartner=await createCollaboratorService(other,identity(fAdmin)).create({name:'Foreign agency',code:'FOREIGN',supervisorUserId:fAdmin.id})
 office='office_'+tenant
 const access=createOfficeAccessService(db,identity(admin));for(const user of [admin,supervisor,staff,partner,partner2,secondLogin]){const p=await access.getMemberships(user.id);await access.saveMemberships(user.id,{version:p.version,officeIds:[office],companies:[],creationOfficeId:office})}
 const profiles=createAccessRoleService(db,identity(admin)),profile=await profiles.save({name:'Explicit CRM actions',permissions:allPermissions.filter(p=>['contacts','enquiries','opportunities','pipelines','reports'].includes(p.split('.')[0]))}),rules=defaultRecordRules()
 for(const key of Object.keys(rules))if(supportedScopes(key.split('.')[0]).includes('ALL'))rules[key]='ALL'
 for(const user of [staff,partner,partner2,secondLogin]){const p=await profiles.assignment(user.id);await profiles.assign(user.id,{version:p.accessPolicy.version,roleIds:[profile.id],rules})}
 contact=await crm(admin).createContact({name:'Introduction customer'})
 pipeline=await crm(admin).createPipeline({name:'Introduction checks',stages:[{name:'Open',kind:'OPEN',probability:10,color:'#123456'},{name:'Won',kind:'WON',probability:100,color:'#00aa00'},{name:'Lost',kind:'LOST',probability:0,color:'#aa0000'}]});stage=pipeline.stages.find(s=>s.kind==='OPEN')
})
after(async()=>{await Promise.all(clients.map(c=>c.$disconnect()));await Promise.all(pools.map(p=>p.end()))})

test('internal creation and assignment to a partner do not invent origin attribution or grants',async()=>{
 const before=await root.businessOfficeGrant.count({where:{tenantId:tenant}}),row=await enquiry('No introduction',admin,{assignedUserId:partner.id})
 assert.equal(row.introducedByCollaboratorId,null);assert.equal(row.partnerAttribution,null);assert.equal(row.assignedUserId,partner.id)
 assert.equal(await root.businessOfficeGrant.count({where:{tenantId:tenant}}),before)
 const deal=await opportunity('Internal direct');assert.equal(deal.introducedByCollaboratorId,null)
})
test('an administrator may record a minimal introducing-partner snapshot separately from salesperson and source office',async()=>{
 owned=await enquiry('Admin recorded partner',admin,{introducedByCollaboratorId:a.id,assignedUserId:staff.id})
 assert.equal(owned.assignedUserId,staff.id);assert.equal(owned.officeId,office);assert.equal(owned.introducedByCollaboratorId,a.id)
 assert.deepEqual(owned.partnerAttribution,{version:1,code:a.code,name:a.name,supervisorUserId:supervisor.id})
 assert.equal((await crm(admin).getEnquiry(owned.id)).partnerAttribution.name,a.name)
 const audit=await root.auditLog.findFirst({where:{tenantId:tenant,event:'crm.enquiry.created',entityId:owned.id}});assert.equal(audit.after.introducedByCollaboratorId,a.id)
})
test('external logins self-attribute; multiple named logins retain one partner identity and cannot claim another partner',async()=>{
 for(const user of [partner,secondLogin]){const row=await enquiry('Self introduction',user);assert.equal(row.introducedByCollaboratorId,a.id);assert.equal(row.assignedUserId,user.id)}
 await assert.rejects(enquiry('Forged source',partner,{introducedByCollaboratorId:b.id}),status(403))
 await assert.rejects(enquiry('Staff selecting origin',staff,{introducedByCollaboratorId:a.id}),status(403))
 await assert.rejects(enquiry('Foreign source',admin,{introducedByCollaboratorId:foreignPartner.id}),status(400))
 await assert.rejects(enquiry('Missing source',admin,{introducedByCollaboratorId:'missing'}),status(400))
 assert.equal((await direct(partner,tx=>tx.externalCollaborator.findMany(), 'enquiries.read')).length,0)
})
test('direct opportunities and conversion share the same canonical attribution without recapturing the converter',async()=>{
 const directDeal=await opportunity('External direct',partner);assert.equal(directDeal.introducedByCollaboratorId,a.id)
 const converted=await opportunity('Converted introduction',partner2,{enquiryId:owned.id,assignedUserId:staff.id});assert.equal(converted.introducedByCollaboratorId,a.id);assert.deepEqual(converted.partnerAttribution,owned.partnerAttribution)
 assert.equal((await opportunity('Repeated conversion',admin,{enquiryId:owned.id,assignedUserId:staff.id})).id,converted.id)
 assert.equal(await root.crmOpportunity.count({where:{tenantId:tenant,enquiryId:owned.id}}),1)
 const reassigned=await crm(admin).updateOpportunity(converted.id,{title:converted.title,contactId:contact.id,assignedUserId:admin.id,pipelineId:pipeline.id,stageId:stage.id,amount:'120',currency:'INR',expectedCloseOn:'2030-01-01',version:converted.version});assert.deepEqual(reassigned.partnerAttribution,owned.partnerAttribution);assert.equal(reassigned.introducedByCollaboratorId,a.id)
 const ordinary=await enquiry('Unattributed original');const deal=await opportunity('Partner converts ordinary source',partner2,{enquiryId:ordinary.id});assert.equal(deal.introducedByCollaboratorId,null);assert.equal(deal.partnerAttribution,null)
 const claimed=await enquiry('Cannot replace source',partner);await assert.rejects(opportunity('Forged conversion',admin,{enquiryId:claimed.id,introducedByCollaboratorId:b.id}),status(400))
})
test('salesperson reassignment, supervisor changes, rename and archive preserve source evidence and conversion',async()=>{
 let row=await enquiry('Historical source',partner)
 row=await crm(admin).updateEnquiry(row.id,{title:row.title,assignedUserId:staff.id,status:'NEW',version:row.version})
 const frozen=row.partnerAttribution
 a=await directory(admin).update(a.id,{version:a.version,name:'Renamed agency',supervisorUserId:admin.id})
 a=await directory(admin).update(a.id,{version:a.version,archived:true})
 assert.deepEqual((await crm(admin).getEnquiry(row.id)).partnerAttribution,frozen)
 const deal=await opportunity('Conversion after archive',admin,{enquiryId:row.id});assert.deepEqual(deal.partnerAttribution,frozen);assert.equal(deal.introducedByCollaboratorId,a.id)
 await assert.rejects(enquiry('Archived origin',admin,{introducedByCollaboratorId:a.id}),status(400))
 a=await directory(admin).update(a.id,{version:a.version,archived:false})
 // Restoring the directory does not reactivate accounts. Keep later self tests explicit.
 for(const user of [partner,secondLogin])await root.user.update({where:{id:user.id},data:{status:'ACTIVE'}})
 const fresh=await enquiry('New supervisor evidence',partner);assert.equal(fresh.partnerAttribution.supervisorUserId,admin.id);assert.equal(fresh.partnerAttribution.name,'Renamed agency')
})
test('native SQL writes enforce self attribution, prevent forgery, and never expose private directory details',async()=>{
 const row=await rawEnquiry(partner);assert.equal(row.introducedByCollaboratorId,a.id);assert.deepEqual(Object.keys(row.partnerAttribution).sort(),['code','name','supervisorUserId','version'])
 await assert.rejects(rawEnquiry(partner,{introducedByCollaboratorId:b.id}),/Introducing collaborator selection is not permitted/)
 await assert.rejects(rawEnquiry(staff,{introducedByCollaboratorId:b.id}),/Introducing collaborator selection is not permitted/)
 await assert.rejects(rawEnquiry(admin,{partnerAttribution:{version:1,name:'Forged'}}),/Introduction evidence must come from its source/)
 for(const data of [{introducedByCollaboratorId:b.id},{partnerAttribution:{version:1,name:'Rewritten'}}])await assert.rejects(direct(admin,tx=>tx.crmEnquiry.update({where:{tenantId_id:{tenantId:tenant,id:row.id}},data}), 'enquiries.edit'),/Introduction identity and evidence are immutable/)
 assert.throws(()=>crm(admin).updateEnquiry(row.id,{title:row.title,assignedUserId:partner.id,status:'NEW',version:row.version,introducedByCollaboratorId:b.id}),e=>e.name==='ZodError')
})
test('conversion cannot detach its source or reveal attribution from a Restricted enquiry',async()=>{
 const secret=await enquiry('Restricted introduction',admin,{introducedByCollaboratorId:b.id})
 const sharing=createRecordSharingService(db,identity(admin));const state=await sharing.get('enquiries',secret.id);await sharing.save('enquiries',secret.id,{version:state.version,restricted:true,grants:[]})
 await assert.rejects(opportunity('Hidden source',partner2,{enquiryId:secret.id}),status(404))
 await assert.rejects(direct(partner2,tx=>tx.crmOpportunity.create({data:{tenantId:tenant,title:'SQL hidden source',contactId:contact.id,assignedUserId:partner2.id,pipelineId:pipeline.id,stageId:stage.id,amount:'1',currency:'INR',probability:10,expectedCloseOn:new Date('2030-01-01'),enquiryId:secret.id}}),'opportunities.create'),/Introduction source is not permitted|row-level security/)
 const deal=await opportunity('Fixed source',admin,{enquiryId:secret.id})
 await assert.rejects(direct(admin,tx=>tx.crmOpportunity.update({where:{tenantId_id:{tenantId:tenant,id:deal.id}},data:{enquiryId:null}}),'opportunities.edit'),/Introduction identity and evidence are immutable/)
 await assert.rejects(opportunity('No supervisor grant',supervisor,{enquiryId:secret.id}),status(403))
})
test('mandatory audit failure rolls the attributed source back with no orphan origin record',async()=>{
 const count=await root.crmEnquiry.count({where:{tenantId:tenant}})
 await root.$executeRawUnsafe(`CREATE FUNCTION app.test_introduction_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."tenantId"='${tenant}' AND NEW.event='crm.enquiry.created' THEN RAISE EXCEPTION 'synthetic introduction audit failure'; END IF; RETURN NEW; END $$`)
 await root.$executeRawUnsafe('CREATE TRIGGER introduction_audit_failure BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION app.test_introduction_audit_failure()')
 try{await assert.rejects(enquiry('Audit must commit',admin,{introducedByCollaboratorId:b.id}),/synthetic introduction audit failure/)}finally{await root.$executeRawUnsafe('DROP TRIGGER introduction_audit_failure ON "AuditLog"');await root.$executeRawUnsafe('DROP FUNCTION app.test_introduction_audit_failure()')}
 assert.equal(await root.crmEnquiry.count({where:{tenantId:tenant}}),count)
})

test('waiting source writes cannot capture stale administrator authority or a concurrently archived partner',async()=>{
 const operator=await root.user.create({data:{tenantId:tenant,role:'ADMIN',email:randomUUID()+'@example.test'}})
 const access=createOfficeAccessService(db,identity(admin)),membership=await access.getMemberships(operator.id)
 await access.saveMemberships(operator.id,{version:membership.version,officeIds:[office],companies:[],creationOfficeId:office})
 const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return{promise,resolve}}
 for(const change of ['demotion','archive']){
  const held=deferred(),ready=deferred(),count=await root.crmEnquiry.count({where:{tenantId:tenant}})
  const locker=root.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${tenant} FOR UPDATE`;held.resolve();await ready.promise
   if(change==='demotion')await tx.user.update({where:{id:operator.id},data:{role:'STAFF'}})
   else await tx.externalCollaborator.update({where:{id:b.id},data:{archived:true}})
  },{timeout:20000})
  await held.promise
  const attempt=runWithDatabaseActor(operator.id,async()=>await db.$transaction(async tx=>{
   await authorizeBusinessOperation(tx,identity(operator),'enquiries.create',['crm'])
   // Establish the same snapshot as normal create preflight before it waits.
   await tx.externalCollaborator.findFirstOrThrow({where:{tenantId:tenant,id:b.id,archived:false}});ready.resolve()
   return tx.crmEnquiry.create({data:{tenantId:tenant,title:'Stale '+change,assignedUserId:operator.id,contactId:contact.id,introducedByCollaboratorId:b.id}})
  },{isolationLevel:'Serializable',timeout:20000}))
  await Promise.all([locker,assert.rejects(attempt,/could not serialize|write conflict|deadlock|40001/)])
  assert.equal(await root.crmEnquiry.count({where:{tenantId:tenant}}),count)
  if(change==='demotion')await root.user.update({where:{id:operator.id},data:{role:'ADMIN'}})
  else await root.externalCollaborator.update({where:{id:b.id},data:{archived:false}})
 }
})
