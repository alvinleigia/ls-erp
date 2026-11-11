/* eslint-disable @typescript-eslint/no-require-imports */
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Pool}=require('pg'),{PrismaClient}=require('@prisma/client')
const {TenantPgAdapter}=require('../lib/tenant-pg-adapter.ts'),{runWithDatabaseActor}=require('../lib/database-actor.ts'),{authorizeBusinessOperation}=require('../platform/access/operation.ts')
const {createVerificationConfigurationService}=require('../platform/verification/configuration.ts'),{applicationVerificationCases}=require('../application/verification/service.ts')
const {emptyVerificationPolicy,verificationPolicySchema}=require('../platform/verification/contracts.ts'),{createApplicationCrmService}=require('../application/crm/service.ts'),{createAccessRoleService}=require('../platform/access/service.ts'),{createRecordSharingService}=require('../platform/access/sharing-service.ts')
const {defaultRecordRules}=require('../platform/access/rules.ts')
require('../lib/logger.ts').logger.info=()=>{}
const url=new URL(process.env.CRM_TEST_DATABASE_URL||'http://invalid');if(!['127.0.0.1','localhost'].includes(url.hostname)||url.pathname!='/ls_salon_crm_test')throw Error('Disposable local database only.')
const tenant='verification_'+randomUUID(),foreign=tenant+'_foreign',clients=[],pools=[]
function client(tenantId,bypass=false){const u=new URL(url);if(!bypass){u.username='crm_test_runtime';u.password=''}const pool=new Pool({connectionString:u.toString(),max:4});pools.push(pool);const db=new PrismaClient({adapter:new TenantPgAdapter(pool,{tenantId,bypass})});clients.push(db);return db}
const root=client(undefined,true),db=client(tenant),other=client(foreign),identity=u=>({tenantId:u.tenantId,userId:u.id}),status=n=>e=>e.status===n
const config=u=>createVerificationConfigurationService(db,identity(u)),cases=u=>applicationVerificationCases(db,identity(u)),crm=u=>createApplicationCrmService(db,identity(u)),subject=c=>({kind:'PERSON',id:c.id})
const definition={...emptyVerificationPolicy(),facts:[{code:'legal_name',label:'Legal name',type:'TEXT',subjects:['PERSON','BUSINESS'],roles:['CUSTOMER','ADDITIONAL_CUSTOMER']}],documents:[{code:'identity_proof',label:'Accepted identity evidence',subjects:['PERSON'],roles:['CUSTOMER','ADDITIONAL_CUSTOMER']}]}
const direct=(u,fn,requirement='customerVerification.read')=>runWithDatabaseActor(u.id,()=>db.$transaction(async tx=>{await authorizeBusinessOperation(tx,identity(u),requirement);return fn(tx)}))
let admin,manager,collector,foreignAdmin,contact,second,account,foreignContact,profile,profiles
async function grant(user,permissions,rules={}){const p=await profiles.save({name:randomUUID(),permissions}),a=await profiles.assignment(user.id);await profiles.assign(user.id,{version:a.accessPolicy.version,roleIds:[p.id],rules:{...defaultRecordRules(),...rules}});return p}
async function publish(user=admin,patch={}){const s=await config(user).get(),input={version:s.version,definition:{...definition,...patch}},preview=await config(user).preview(input);return config(user).publish({...input,previewHash:preview.previewHash})}
before(async()=>{
 await root.tenant.createMany({data:[tenant,foreign].map(id=>({id,slug:id,name:id}))})
 admin=await root.user.create({data:{tenantId:tenant,role:'ADMIN',email:randomUUID()+'@example.test'}})
 manager=await root.user.create({data:{tenantId:tenant,role:'MANAGER',email:randomUUID()+'@example.test'}})
 collector=await root.user.create({data:{tenantId:tenant,role:'STAFF',email:randomUUID()+'@example.test'}})
 foreignAdmin=await root.user.create({data:{tenantId:foreign,role:'ADMIN',email:randomUUID()+'@example.test'}})
 await root.tenantModule.createMany({data:[tenant,foreign].map(tenantId=>({tenantId,key:'crm',allowed:true,enabled:true}))})
 contact=await crm(admin).createContact({name:'Verification primary'});second=await crm(admin).createContact({name:'Separate additional applicant'});account=await crm(admin).createAccount({name:'Verification business'})
 foreignContact=await createApplicationCrmService(other,identity(foreignAdmin)).createContact({name:'Other tenant person'})
 profiles=createAccessRoleService(db,identity(admin))
})
after(async()=>{await Promise.all(clients.map(c=>c.$disconnect()));await Promise.all(pools.map(p=>p.end()))})

test('disabled and unallowed module deny services and raw reads without creating data',async()=>{
 await assert.rejects(config(admin).get(),status(403));await assert.rejects(cases(admin).start(subject(contact)),status(403))
 assert.equal((await direct(admin,tx=>tx.customerVerificationCase.findMany(),'contacts.read')).length,0)
 await root.tenantModule.create({data:{tenantId:tenant,key:'customerVerification',allowed:false,enabled:false}})
 await assert.rejects(config(admin).get(),status(403))
 await root.tenantModule.update({where:{tenantId_key:{tenantId:tenant,key:'customerVerification'}},data:{allowed:true,enabled:true}})
 assert.equal(await root.customerVerificationCase.count({where:{tenantId:tenant}}),0)
})
test('reading defaults is read-only and no policy means no collection',async()=>{
 const current=await config(admin).get();assert.equal(current.version,0);assert.deepEqual(current.definition,emptyVerificationPolicy())
 assert.equal((await cases(admin).get(subject(contact))).status,'NOT_STARTED')
 await assert.rejects(cases(admin).start(subject(contact)),status(409));assert.equal(await root.verificationPolicyVersion.count({where:{tenantId:tenant}}),0)
})
test('preview binds tenant/version/definition and publication keeps immutable history',async()=>{
 const input={version:0,definition},preview=await config(admin).preview(input)
 await assert.rejects(config(admin).publish({...input,definition:{...definition,validityDays:365},previewHash:preview.previewHash}),status(409))
 assert.equal((await config(admin).publish({...input,previewHash:preview.previewHash})).version,1)
 const row=await root.verificationPolicyVersion.findFirstOrThrow({where:{tenantId:tenant,version:1}})
 await assert.rejects(root.verificationPolicyVersion.update({where:{id:row.id},data:{definition:emptyVerificationPolicy()}}),/immutable/)
 await assert.rejects(root.verificationPolicyVersion.delete({where:{id:row.id}}),/immutable/)
 assert.equal((await publish(admin,{validityDays:365})).version,2)
 assert.deepEqual((await root.verificationPolicyVersion.findUniqueOrThrow({where:{id:row.id}})).definition,definition)
 await assert.rejects(config(admin).publish({...input,previewHash:preview.previewHash}),status(409))
})
test('same-version concurrent policy publication accepts exactly one and stale preview fails',async()=>{
 const current=await config(admin).get(),input={version:current.version,definition},preview=await config(admin).preview(input)
 const results=await Promise.allSettled([1,2].map(()=>config(admin).publish({...input,previewHash:preview.previewHash})))
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.status,409)
})
test('manager account role grants neither policy administration nor collection',async()=>{
 await assert.rejects(config(manager).get(),status(403));await assert.rejects(cases(manager).start(subject(contact)),status(403))
 await grant(manager,['verificationPolicies.read','verificationPolicies.edit'])
 assert.equal((await config(manager).get()).canPublish,false);await assert.rejects(config(manager).preview({version:3,definition}),status(403))
 await assert.rejects(direct(manager,tx=>tx.verificationPolicyVersion.create({data:{tenantId:tenant,version:4,definition,publishedByUserId:manager.id}}),'verificationPolicies.edit'),/not permitted/)
})
test('collector explicitly starts cases without policy-directory permission; starting is idempotent, never approval',async()=>{
 profile=await grant(collector,['contacts.read','accounts.read','customerVerification.read','customerVerification.create'],{'contacts.read':'ALL','accounts.read':'ALL'})
 await assert.rejects(config(collector).get(),status(403))
 const first=await cases(collector).start(subject(contact)),again=await cases(collector).start(subject(contact))
 assert.equal(first.case.id,again.case.id);assert.equal(first.status,'IN_PROGRESS');assert.equal(first.case.policyVersion,3)
 assert.equal('verifiedAt' in first.case,false);assert.equal((await direct(collector,tx=>tx.verificationPolicyVersion.findMany())).length,0)
 const [co,business]=await Promise.all([cases(collector).start(subject(second)),cases(collector).start({kind:'BUSINESS',id:account.id})])
 assert.notEqual(co.case.id,first.case.id);assert.notEqual(business.case.id,first.case.id)
 assert.equal(await root.customerVerificationCase.count({where:{tenantId:tenant}}),3)
})
test('case reads and native SQL respect directory Own, explicit sharing and Restricted visibility',async()=>{
 const assignment=await profiles.assignment(collector.id);await profiles.assign(collector.id,{version:assignment.accessPolicy.version,roleIds:[profile.id],rules:{...assignment.accessPolicy.rules,'contacts.read':'OWN'}})
 await assert.rejects(cases(collector).get(subject(contact)),status(404))
 assert.equal((await direct(collector,tx=>tx.customerVerificationCase.findMany())).filter(c=>c.contactId).length,0)
 const sharing=createRecordSharingService(db,identity(admin)),state=await sharing.get('contacts',contact.id)
 await sharing.save('contacts',contact.id,{version:state.version,restricted:true,grants:[{kind:'USER',id:collector.id,level:'READ'}]})
 assert.equal((await cases(collector).get(subject(contact))).status,'IN_PROGRESS')
 assert.equal((await direct(collector,tx=>tx.customerVerificationCase.findMany())).filter(c=>c.contactId).length,1)
 const updated=await sharing.get('contacts',contact.id);await sharing.save('contacts',contact.id,{version:updated.version,restricted:true,grants:[]})
 await assert.rejects(cases(collector).get(subject(contact)),status(404))
})
test('cross-tenant, invalid, archived and forged subjects cannot create cases',async()=>{
 await assert.rejects(cases(admin).start(subject(foreignContact)),status(404))
 await assert.rejects(cases(admin).start({kind:'PERSON',id:contact.id,tenantId:foreign}),/Unrecognized key/)
 const archived=await crm(admin).createContact({name:'Archived customer'});await root.crmContact.update({where:{id:archived.id},data:{archived:true,version:{increment:1}}})
 await assert.rejects(cases(admin).start(subject(archived)),status(409))
 await assert.rejects(direct(admin,tx=>tx.customerVerificationCase.create({data:{tenantId:tenant,contactId:foreignContact.id,policyVersion:3,createdByUserId:admin.id}})),/not permitted|row-level security|foreign key/)
 await assert.rejects(direct(admin,tx=>tx.customerVerificationCase.create({data:{tenantId:tenant,contactId:archived.id,policyVersion:3,createdByUserId:admin.id}})),/active customer/)
})
test('native policy validator rejects malformed definitions and keeps application/native contract agreement',async()=>{
 const invalid=[null,{},[],{...definition,validityDays:'365'},{...definition,validityDays:1.5},{...definition,preventSelfApproval:false},{...definition,facts:[...definition.facts,...definition.facts]},{...definition,documents:[{...definition.documents[0],subjects:['PERSON','PERSON']}]},{...definition,required:'everything'}]
 for(const d of [emptyVerificationPolicy(),definition,...invalid]){const [row]=await root.$queryRaw`SELECT app.verification_policy_valid(${JSON.stringify(d)}::jsonb) AS valid`;assert.equal(row.valid,verificationPolicySchema.safeParse(d).success,JSON.stringify(d))}
 await assert.rejects(direct(admin,tx=>tx.verificationPolicyVersion.create({data:{tenantId:tenant,version:4,definition:{...definition,facts:[...definition.facts,...definition.facts]},publishedByUserId:admin.id}}),'verificationPolicies.edit'),/check constraint/)
})
test('case identities and accepted policy references are immutable; audit has no private facts',async()=>{
 const row=await root.customerVerificationCase.findFirstOrThrow({where:{tenantId:tenant}})
 await assert.rejects(root.customerVerificationCase.update({where:{id:row.id},data:{policyVersion:1}}),/immutable/);await assert.rejects(root.customerVerificationCase.delete({where:{id:row.id}}),/immutable/)
 const events=await root.auditLog.findMany({where:{tenantId:tenant,event:{in:['verificationPolicy.published','customerVerification.started']}}})
 assert.equal(events.length,6)
 for(const event of events){const text=JSON.stringify([event.before,event.after,event.metadata]);assert.equal(/legal_name|identity_proof|address|sha256|storage|email|phone/.test(text),false)}
})
test('new profile grants need both case Read and canonical customer Read, including native queries',async()=>{
 const user=await root.user.create({data:{tenantId:tenant,role:'STAFF',email:randomUUID()+'@example.test'}})
 await grant(user,['customerVerification.read','customerVerification.create'])
 await assert.rejects(cases(user).get(subject(second)),status(403))
 assert.equal((await direct(user,tx=>tx.customerVerificationCase.findMany())).length,0)
 await assert.rejects(direct(user,tx=>tx.customerVerificationCase.create({data:{tenantId:tenant,contactId:second.id,policyVersion:3,createdByUserId:user.id}})),/not permitted/)
 await assert.rejects(grant(user,['contacts.read','customerVerification.create'],{'contacts.read':'ALL'}),/Read access is required/)
 await grant(user,['contacts.read','customerVerification.read','customerVerification.create'],{'contacts.read':'ALL','customerVerification.read':'NONE'})
 await assert.rejects(cases(user).start(subject(second)),status(403))
})
test('external identities cannot inherit collection or policy access from explicit profiles',async()=>{
 const partner=await root.externalCollaborator.create({data:{tenantId:tenant,name:'Outside collector',code:'KYC_OUTSIDE',supervisorUserId:admin.id}})
 const user=await root.user.create({data:{tenantId:tenant,role:'STAFF',email:randomUUID()+'@example.test',collaboratorId:partner.id}})
 await grant(user,['contacts.read','customerVerification.read','customerVerification.create','verificationPolicies.read','verificationPolicies.edit'],{'contacts.read':'ALL'})
 await assert.rejects(cases(user).get(subject(second)),status(403));await assert.rejects(config(user).get(),status(403))
 assert.equal((await direct(user,tx=>tx.customerVerificationCase.findMany(),'contacts.read')).length,0)
})
test('concurrent case starts reuse one case and forged collectors, policy versions or owner combinations fail',async()=>{
 const person=await crm(admin).createContact({name:'Concurrent verification customer'})
 const [a,b]=await Promise.all([cases(admin).start(subject(person)),cases(admin).start(subject(person))]);assert.equal(a.case.id,b.case.id)
 const another=await crm(admin).createContact({name:'Native guard customer'})
 for(const patch of [{createdByUserId:collector.id},{policyVersion:1},{accountId:account.id}])await assert.rejects(direct(admin,tx=>tx.customerVerificationCase.create({data:{tenantId:tenant,contactId:another.id,policyVersion:3,createdByUserId:admin.id,...patch}})),/not permitted|current verification policy|check constraint/)
 const [foreignVersion]=await direct(admin,tx=>tx.$queryRaw`SELECT app.verification_latest_version(${foreign}) AS version`);assert.equal(foreignVersion.version,null)
})
test('mandatory audit failure rolls policy and case writes back',async()=>{
 const failing=new Proxy(db,{get(target,key){if(key==='$transaction')return (fn,options)=>target.$transaction(tx=>fn(new Proxy(tx,{get(t,k){if(k==='auditLog')return new Proxy(t.auditLog,{get(a,p){return p==='createMany'?async()=>{throw Error('Audit unavailable')}:Reflect.get(a,p)}});return Reflect.get(t,k)}})),options);return Reflect.get(target,key)}})
 const current=await config(admin).get(),input={version:current.version,definition},preview=await config(admin).preview(input)
 await assert.rejects(createVerificationConfigurationService(failing,identity(admin)).publish({...input,previewHash:preview.previewHash}),/Audit unavailable/)
 assert.equal((await config(admin).get()).version,current.version)
 const contact=await crm(admin).createContact({name:'Audit rollback customer'})
 await assert.rejects(applicationVerificationCases(failing,identity(admin)).start(subject(contact)),/Audit unavailable/)
 assert.equal((await cases(admin).get(subject(contact))).status,'NOT_STARTED')
})
test('revoking module access takes effect on service and native reads',async()=>{
 await root.tenantModule.update({where:{tenantId_key:{tenantId:tenant,key:'customerVerification'}},data:{enabled:false}})
 await assert.rejects(cases(admin).get(subject(contact)),status(403));await assert.rejects(config(admin).get(),status(403))
 assert.equal((await direct(admin,tx=>tx.customerVerificationCase.findMany(),'contacts.read')).length,0)
 assert.equal(await root.customerVerificationCase.count({where:{tenantId:tenant}}),4)
})
