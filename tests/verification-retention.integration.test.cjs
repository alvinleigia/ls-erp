/* eslint-disable @typescript-eslint/no-require-imports */
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Pool}=require('pg'),{PrismaClient}=require('@prisma/client'),sharp=require('sharp')
const {TenantPgAdapter}=require('../lib/tenant-pg-adapter.ts'),{runWithDatabaseActor}=require('../lib/database-actor.ts'),{authorizeBusinessOperation}=require('../platform/access/operation.ts')
const {createVerificationConfigurationService}=require('../platform/verification/configuration.ts'),{applicationVerificationCases,applicationVerificationEvidence}=require('../application/verification/service.ts')
const {emptyVerificationPolicy}=require('../platform/verification/contracts.ts'),{createApplicationCrmService}=require('../application/crm/service.ts'),{createAccessRoleService}=require('../platform/access/service.ts'),{createRecordSharingService}=require('../platform/access/sharing-service.ts'),{defaultRecordRules}=require('../platform/access/rules.ts')
const {applicationVerificationRetention,applicationVerificationSubmissions}=require('../application/verification/service.ts')
const retention=(u=admin)=>applicationVerificationRetention(db,identity(u)),submissions=u=>applicationVerificationSubmissions(db,identity(u))
require('../lib/logger.ts').logger.info=()=>{}
const url=new URL(process.env.CRM_TEST_DATABASE_URL||'http://invalid');if(!['127.0.0.1','localhost'].includes(url.hostname)||url.pathname!='/ls_salon_crm_test')throw Error('Disposable local database only.')
const tenant='retention_'+randomUUID(),foreign=tenant+'_other',clients=[],pools=[],objects=new Map(),calls=[]
function client(tenantId,bypass=false){const u=new URL(url);if(!bypass){u.username='crm_test_runtime';u.password=''}const pool=new Pool({connectionString:u.toString(),max:4});pools.push(pool);const db=new PrismaClient({adapter:new TenantPgAdapter(pool,{tenantId,bypass})});clients.push(db);return db}
const root=client(undefined,true),db=client(tenant),other=client(foreign),identity=u=>({tenantId:u.tenantId,userId:u.id}),status=n=>e=>e.status===n
const storage={async signUpload(path){calls.push(['sign',path]);return 'https://test.invalid/'+path},async read(path){calls.push(['read',path]);if(!objects.has(path))throw Object.assign(Error('Storage unavailable'),{status:503});return objects.get(path)},async download(path){calls.push(['download',path]);return 'https://test.invalid/download/'+path},async remove(path){calls.push(['remove',path]);objects.delete(path)}}
const service=(user,transport=storage,database=db)=>applicationVerificationEvidence(database,identity(user),transport),crm=u=>createApplicationCrmService(db,identity(u))
let admin,collector,reader,foreignAdmin,person,business,caseId,businessCase,png,profiles
const definition={...emptyVerificationPolicy(),documents:[{code:'identity',label:'Identity proof',subjects:['PERSON','BUSINESS'],roles:['CUSTOMER','ADDITIONAL_CUSTOMER']}]}
async function grants(u,permissions){const role=await profiles.save({name:randomUUID(),permissions}),state=await profiles.assignment(u.id);await profiles.assign(u.id,{version:state.accessPolicy.version,roleIds:[role.id],rules:{...defaultRecordRules(),'contacts.read':'ALL','accounts.read':'ALL'}})}
const input=(extra={})=>({caseId,documentCode:'identity',filename:'proof.png',contentType:'image/png',bytes:png.length,...extra})
async function stage(user=collector,extra={},bytes=png){const reservation=await service(user).reserve(input(extra)),row=await root.verificationEvidence.findUniqueOrThrow({where:{id:reservation.id}});objects.set(row.path,bytes);return {reservation,row}}
const direct=(u,work)=>runWithDatabaseActor(u.id,()=>db.$transaction(async tx=>{await authorizeBusinessOperation(tx,identity(u),'customerVerification.read');return work(tx)}))
before(async()=>{
 await root.tenant.createMany({data:[tenant,foreign].map(id=>({id,name:id,slug:id}))})
 admin=await root.user.create({data:{tenantId:tenant,role:'ADMIN',email:randomUUID()+'@example.test'}});collector=await root.user.create({data:{tenantId:tenant,role:'STAFF',email:randomUUID()+'@example.test'}});reader=await root.user.create({data:{tenantId:tenant,role:'MANAGER',email:randomUUID()+'@example.test'}})
 foreignAdmin=await root.user.create({data:{tenantId:foreign,role:'ADMIN',email:randomUUID()+'@example.test'}})
 await root.tenantModule.createMany({data:[tenant,foreign].flatMap(tenantId=>['crm','customerVerification'].map(key=>({tenantId,key,allowed:true,enabled:true})))})
 profiles=createAccessRoleService(db,identity(admin))
 await grants(collector,['contacts.read','accounts.read','customerVerification.read','verificationUploads.read','verificationUploads.create','verificationUploads.cancel'])
 await grants(reader,['contacts.read','accounts.read','customerVerification.read','verificationEvidence.read'])
 person=await crm(admin).createContact({name:'Evidence person'});business=await crm(admin).createAccount({name:'Evidence business'})
 const c=createVerificationConfigurationService(db,identity(admin)),preview=await c.preview({version:0,definition});await c.publish({version:0,definition,previewHash:preview.previewHash})
 caseId=(await applicationVerificationCases(db,identity(admin)).start({kind:'PERSON',id:person.id})).case.id;businessCase=(await applicationVerificationCases(db,identity(admin)).start({kind:'BUSINESS',id:business.id})).case.id
 png=await sharp({create:{width:10,height:10,channels:3,background:'orange'}}).png().toBuffer()
})
after(async()=>{await Promise.all(clients.map(c=>c.$disconnect()));await Promise.all(pools.map(p=>p.end()))})
async function publish(retainDays){const s=await retention().settings(),input={version:s.version,retainDays},p=await retention().preview(input);return retention().publish({...input,previewHash:p.previewHash})}
async function acceptedFile(){const s=await stage();await service(collector).finalize(s.row.id);return s.row}
async function age(id){await root.$transaction(async tx=>{await tx.$executeRawUnsafe('ALTER TABLE "VerificationEvidence" DISABLE TRIGGER verification_evidence_write');await tx.$executeRaw`UPDATE "VerificationEvidence" SET "readyAt"="readyAt"-interval '100 days' WHERE id=${id}`;await tx.$executeRawUnsafe('ALTER TABLE "VerificationEvidence" ENABLE TRIGGER verification_evidence_write')})}
async function decision(e){return direct(admin,async tx=>(await tx.$queryRaw`SELECT app.verification_retention_decision(${tenant},${e.id}) d`)[0].d)}
const change=(data,u=admin)=>retention(u).hold({caseId,reason:'Private preservation instruction',...data})
let ready

test('retention defaults indefinitely without publishing, deletion, evidence changes or access backfill',async()=>{
 const before=await root.verificationRetentionVersion.count();assert.deepEqual(await retention().settings(),{version:0,retainDays:null,canPublish:true});assert.equal(await root.verificationRetentionVersion.count(),before);
 ready=await acceptedFile();assert.equal((await decision(ready)).decision,'INDEFINITE');assert.equal((await retention().view({kind:'PERSON',id:person.id})).active,false);assert.ok(objects.has(ready.path));
})
test('retention publication is bounded, preview-bound, versioned and administrative',async()=>{
 for(const n of [0,-1,1.5,36501])await assert.rejects(publish(n));const state=await retention().settings(),p=await retention().preview({version:state.version,retainDays:30});await assert.rejects(retention().publish({version:state.version,retainDays:31,previewHash:p.previewHash}),status(409));
 const result=await publish(30);assert.equal(result.version,1);assert.equal((await decision(ready)).decision,'PERIOD');assert.match((await decision(ready)).retainUntil,/(Z|[+]00:00)$/);
 await grants(reader,['contacts.read','customerVerification.read','verificationRetention.read','verificationRetention.edit']);assert.equal((await retention(reader).settings()).canPublish,false);await assert.rejects(retention(reader).preview({version:1,retainDays:1}),status(403));
 await assert.rejects(root.verificationRetentionVersion.updateMany({where:{tenantId:tenant},data:{retainDays:1}}),/immutable/);await assert.rejects(root.verificationRetentionVersion.deleteMany({where:{tenantId:tenant}}),/immutable/);
})
test('database-clock eligibility is review-only and never deletes original bytes or identity metadata',async()=>{
 await age(ready.id);const d=await decision(ready);assert.equal(d.decision,'REVIEW');assert.ok(new Date(d.retainUntil)<new Date(d.evaluatedAt));assert.ok(objects.has(ready.path));assert.equal(calls.filter(c=>c[0]==='remove').length,0);
 await assert.rejects(root.verificationEvidence.delete({where:{id:ready.id}}));assert.equal((await service(admin).download(ready.id)).url.startsWith('https:'),true);
})
test('placing a case hold retains all accepted originals with immutable reasoned history and minimal ordinary audit',async()=>{
 await change({version:0,action:'PLACE'});assert.equal((await decision(ready)).decision,'HOLD');await publish(1);assert.equal((await decision(ready)).decision,'HOLD');
 const view=await retention().view({kind:'PERSON',id:person.id});assert.equal(view.active,true);assert.equal(view.history[0].reason,'Private preservation instruction');assert.equal(view.decisions[0].decision,'HOLD');
 const audit=await root.auditLog.findMany({where:{tenantId:tenant,event:'customerVerification.holdChanged'}});assert.equal(audit.length,1);assert.equal(JSON.stringify(audit).includes('Private preservation instruction'),false);
 await assert.rejects(root.verificationHoldEvent.updateMany({where:{tenantId:tenant},data:{reason:'Changed instruction'}}),/immutable/);await assert.rejects(root.verificationHoldEvent.deleteMany({where:{tenantId:tenant}}),/immutable/);
})
test('duplicate and stale hold requests fail; release is a separate grant and requires a reason',async()=>{
 await assert.rejects(change({version:0,action:'PLACE'}),status(409));await assert.rejects(change({version:1,action:'PLACE'}),status(409));assert.throws(()=>change({version:1,action:'RELEASE',reason:' '}));
 await grants(collector,['contacts.read','accounts.read','customerVerification.read','verificationHolds.read','verificationHolds.create']);await assert.rejects(change({version:1,action:'RELEASE'},collector),status(403));
 await change({version:1,action:'RELEASE',reason:'The instruction has been resolved'});assert.equal((await decision(ready)).decision,'REVIEW');assert.equal((await retention().view({kind:'PERSON',id:person.id})).history.length,2);assert.ok(objects.has(ready.path));
 const a=await Promise.allSettled([change({version:2,action:'PLACE'}),change({version:2,action:'PLACE'})]);assert.equal(a.filter(r=>r.status==='fulfilled').length,1);assert.equal(a.find(r=>r.status==='rejected').reason.status,409);
})
test('delegated custodians use canonical case scope and cannot gain evidence or administrative disposal review',async()=>{
 const v=await retention(collector).view({kind:'PERSON',id:person.id});assert.equal(v.active,true);assert.deepEqual(v.decisions,[]);assert.equal(v.canReview,false);assert.equal(v.canRelease,false);
 await assert.rejects(service(collector).download(ready.id),status(403));const [raw]=await direct(collector,tx=>tx.$queryRaw`SELECT app.verification_retention_decision(${tenant},${ready.id}) d`);assert.equal(raw.d,null);
 await grants(collector,['contacts.read','accounts.read','customerVerification.read','verificationHolds.read','verificationHolds.cancel']);await change({version:3,action:'RELEASE'},collector);assert.equal((await decision(ready)).decision,'REVIEW');
})
test('saved submissions retain selected originals even if pending, superseded or revoked; hold release cannot override references',async()=>{
 const v=await submissions(admin).view({kind:'PERSON',id:person.id});await submissions(admin).submit({caseId,version:0,policyVersion:v.policy.version,role:'CUSTOMER',facts:[],evidenceIds:[ready.id]});assert.equal((await decision(ready)).decision,'SUBMISSION_REFERENCE');
 await change({version:4,action:'PLACE'});assert.equal((await decision(ready)).decision,'HOLD');await change({version:5,action:'RELEASE'});assert.equal((await decision(ready)).decision,'SUBMISSION_REFERENCE');
 await publish(null);assert.equal((await decision(ready)).decision,'SUBMISSION_REFERENCE');assert.ok(objects.has(ready.path));
})
test('foreign, external, missing and Restricted sources cannot expose hold reasons or native retention decisions',async()=>{
 await assert.rejects(applicationVerificationRetention(other,identity(foreignAdmin)).view({kind:'PERSON',id:person.id}),status(404));
 const shared=createRecordSharingService(db,identity(admin)),s=await shared.get('contacts',person.id);await shared.save('contacts',person.id,{version:s.version,restricted:true,grants:[]});await assert.rejects(retention(collector).view({kind:'PERSON',id:person.id}),status(404));
 assert.equal((await runWithDatabaseActor(collector.id,()=>db.verificationHoldEvent.findMany())).length,0);const p=await root.externalCollaborator.create({data:{tenantId:tenant,name:'Outside custodian',code:'OUT',supervisorUserId:admin.id}}),u=await root.user.create({data:{tenantId:tenant,role:'STAFF',collaboratorId:p.id,email:randomUUID()+'@example.test'}});await grants(u,['contacts.read','customerVerification.read','verificationHolds.read','verificationRetention.read']);await assert.rejects(retention(u).view({kind:'PERSON',id:person.id}),status(403));
 const [r]=await direct(admin,tx=>tx.$queryRaw`SELECT app.verification_retention_decision(${foreign},${ready.id}) d`);assert.equal(r.d,null);
})
test('module disablement and current grant revocation deny hold changes and native private review',async()=>{
 await root.tenantModule.update({where:{tenantId_key:{tenantId:tenant,key:'customerVerification'}},data:{enabled:false}});await assert.rejects(retention().settings(),status(403));await assert.rejects(change({version:6,action:'PLACE'}),status(403));
 const [r]=await direct(admin,tx=>tx.$queryRaw`SELECT app.verification_retention_decision(${tenant},${ready.id}) d`);assert.equal(r.d,null);await root.tenantModule.update({where:{tenantId_key:{tenantId:tenant,key:'customerVerification'}},data:{enabled:true}});
 await grants(collector,['contacts.read','customerVerification.read']);await assert.rejects(retention(collector).view({kind:'PERSON',id:person.id}),status(403));
})
test('business and person holds are independent; native actor, case and sequence invariants cannot be forged',async()=>{
 await retention().hold({caseId:businessCase,version:0,action:'PLACE',reason:'Business preservation instruction'});const b=await retention().view({kind:'BUSINESS',id:business.id}),p=await retention().view({kind:'PERSON',id:person.id});assert.equal(b.active,true);assert.equal(p.active,false);
 await assert.rejects(direct(admin,tx=>tx.verificationHoldEvent.create({data:{tenantId:tenant,caseId:businessCase,number:2,action:'RELEASE',reason:'Forged actor instruction',actorUserId:collector.id}})),/not permitted/);
 await assert.rejects(direct(admin,tx=>tx.verificationHoldEvent.create({data:{tenantId:tenant,caseId,number:99,action:'PLACE',reason:'Out of sequence instruction',actorUserId:admin.id}})),/changed/);
 await assert.rejects(direct(admin,tx=>tx.verificationHoldEvent.create({data:{tenantId:foreign,caseId,number:1,action:'PLACE',reason:'Cross-tenant instruction',actorUserId:admin.id}})));
});

test('private native errors are sanitised and failed ordinary audit rolls back holds and policy versions',async()=>{
 await root.$executeRawUnsafe(`CREATE FUNCTION app.test_retention_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."tenantId"='${tenant}' AND NEW.event IN ('customerVerification.holdChanged','customerVerification.retentionPublished') THEN RAISE EXCEPTION 'Synthetic audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_retention_audit_failure BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION app.test_retention_audit_failure()`);
 const before=await root.verificationHoldEvent.count({where:{tenantId:tenant}}),policy=await retention().settings();try{await assert.rejects(change({version:6,action:'PLACE'}),e=>e.status===409&&!e.message.includes('Private preservation'));await assert.rejects(publish(10),status(409));assert.equal(await root.verificationHoldEvent.count({where:{tenantId:tenant}}),before);assert.equal((await retention().settings()).version,policy.version)}finally{await root.$executeRawUnsafe('DROP TRIGGER test_retention_audit_failure ON "AuditLog"; DROP FUNCTION app.test_retention_audit_failure()')}
})
