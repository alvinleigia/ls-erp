/* eslint-disable @typescript-eslint/no-require-imports */
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Pool}=require('pg'),{PrismaClient}=require('@prisma/client'),sharp=require('sharp')
const {TenantPgAdapter}=require('../lib/tenant-pg-adapter.ts'),{runWithDatabaseActor}=require('../lib/database-actor.ts')
const {createVerificationConfigurationService}=require('../platform/verification/configuration.ts'),{applicationVerificationCases,applicationVerificationEvidence}=require('../application/verification/service.ts')
const {emptyVerificationPolicy}=require('../platform/verification/contracts.ts'),{createApplicationCrmService}=require('../application/crm/service.ts'),{createAccessRoleService}=require('../platform/access/service.ts'),{defaultRecordRules}=require('../platform/access/rules.ts')
const {applicationVerificationRetention,applicationVerificationSubmissions}=require('../application/verification/service.ts')
const retention=(u=admin)=>applicationVerificationRetention(db,identity(u)),submissions=u=>applicationVerificationSubmissions(db,identity(u))
const {applicationVerificationDisposal}=require('../application/verification/service.ts'),{createHash}=require('node:crypto')
require('../lib/logger.ts').logger.info=()=>{}
const url=new URL(process.env.CRM_TEST_DATABASE_URL||'http://invalid');if(!['127.0.0.1','localhost'].includes(url.hostname)||url.pathname!='/ls_salon_crm_test')throw Error('Disposable local database only.')
const tenant='disposal_'+randomUUID(),foreign=tenant+'_other',clients=[],pools=[],objects=new Map(),calls=[]
function client(tenantId,bypass=false){const u=new URL(url);if(!bypass){u.username='crm_test_runtime';u.password=''}const pool=new Pool({connectionString:u.toString(),max:4});pools.push(pool);const db=new PrismaClient({adapter:new TenantPgAdapter(pool,{tenantId,bypass})});clients.push(db);return db}
const root=client(undefined,true),db=client(tenant),other=client(foreign),identity=u=>({tenantId:u.tenantId,userId:u.id}),status=n=>e=>e.status===n
const storage={async signUpload(path){calls.push(['sign',path]);return 'https://test.invalid/'+path},async read(path){calls.push(['read',path]);if(!objects.has(path))throw Object.assign(Error('Storage unavailable'),{status:503});return objects.get(path)},async download(path){calls.push(['download',path]);return 'https://test.invalid/download/'+path},async remove(path){calls.push(['remove',path]);objects.delete(path)}}
const service=(user,transport=storage,database=db)=>applicationVerificationEvidence(database,identity(user),transport),crm=u=>createApplicationCrmService(db,identity(u))
let admin,collector,reader,foreignAdmin,person,business,caseId,png,profiles
const definition={...emptyVerificationPolicy(),documents:[{code:'identity',label:'Identity proof',subjects:['PERSON','BUSINESS'],roles:['CUSTOMER','ADDITIONAL_CUSTOMER']}]}
async function grants(u,permissions){const role=await profiles.save({name:randomUUID(),permissions}),state=await profiles.assignment(u.id);await profiles.assign(u.id,{version:state.accessPolicy.version,roleIds:[role.id],rules:{...defaultRecordRules(),'contacts.read':'ALL','accounts.read':'ALL'}})}
const input=(extra={})=>({caseId,documentCode:'identity',filename:'proof.png',contentType:'image/png',bytes:png.length,...extra})
async function stage(user=collector,extra={},bytes=png){const reservation=await service(user).reserve(input(extra)),row=await root.verificationEvidence.findUniqueOrThrow({where:{id:reservation.id}});objects.set(row.path,bytes);return {reservation,row}}
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
 caseId=(await applicationVerificationCases(db,identity(admin)).start({kind:'PERSON',id:person.id})).case.id;await applicationVerificationCases(db,identity(admin)).start({kind:'BUSINESS',id:business.id})
 png=await sharp({create:{width:10,height:10,channels:3,background:'orange'}}).png().toBuffer()
})
after(async()=>{await Promise.all(clients.map(c=>c.$disconnect()));await Promise.all(pools.map(p=>p.end()))})
const disposeStorage={async inspect(path){const b=objects.get(path);return b?{exists:true,bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')}:{exists:false}},async remove(path){calls.push(['dispose',path]);objects.delete(path)}}
const disposal=(u=admin,transport=disposeStorage,database=db)=>applicationVerificationDisposal(database,identity(u),transport)
async function publish(days){const c=await retention().settings(),d={version:c.version,retainDays:days},p=await retention().preview(d);return retention().publish({...d,previewHash:p.previewHash})}
async function age(e){await root.$transaction(async tx=>{await tx.$executeRawUnsafe('ALTER TABLE "VerificationEvidence" DISABLE TRIGGER verification_evidence_write');await tx.$executeRaw`UPDATE "VerificationEvidence" SET "readyAt"="readyAt"-interval '100 days' WHERE id=${e.id}`;await tx.$executeRawUnsafe('ALTER TABLE "VerificationEvidence" ENABLE TRIGGER verification_evidence_write')})}
async function ready(){const s=await stage();await service(collector).finalize(s.row.id);await age(s.row);return s.row}
async function request(e,s=disposal()){const p=await s.preview({evidenceId:e.id}),input={evidenceId:e.id,requestKey:randomUUID(),previewHash:p.previewHash,reason:'Private disposal instruction',reviewed:true};return {row:await s.request(input),input}}
async function mature(id){await root.$transaction(async tx=>{await tx.$executeRawUnsafe('ALTER TABLE "VerificationDisposal" DISABLE TRIGGER verification_disposal_write');await tx.$executeRawUnsafe('ALTER TABLE "VerificationDisposal" DISABLE TRIGGER verification_disposal_after');await tx.$executeRaw`UPDATE "VerificationDisposal" SET "retryAfter"=clock_timestamp()-interval '1 second' WHERE id=${id}`;await tx.$executeRawUnsafe('ALTER TABLE "VerificationDisposal" ENABLE TRIGGER verification_disposal_write');await tx.$executeRawUnsafe('ALTER TABLE "VerificationDisposal" ENABLE TRIGGER verification_disposal_after')})}
const execute=r=>disposal().act({id:r.id,version:r.version,action:'execute'})
let original,pending,completed,uncertain

test('disposal defaults closed: indefinite periods, holds and saved submissions cannot be removed',async()=>{
 original=await ready();await assert.rejects(disposal().preview({evidenceId:original.id}),status(409));await publish(30);
 await retention().hold({caseId,version:0,action:'PLACE',reason:'Preserve this evidence'});await assert.rejects(disposal().preview({evidenceId:original.id}),status(409));await retention().hold({caseId,version:1,action:'RELEASE',reason:'Preservation resolved'});
 const e=await ready(),view=await submissions(admin).view({kind:'PERSON',id:person.id});await submissions(admin).submit({caseId,version:0,policyVersion:view.policy.version,role:'CUSTOMER',facts:[],evidenceIds:[e.id]});await assert.rejects(disposal().preview({evidenceId:e.id}),status(409));assert.ok(objects.has(e.path));
})
test('preview-bound requests quarantine exact originals, are idempotent and reject reused keys or changed policy',async()=>{
 const p=await disposal().preview({evidenceId:original.id});await publish(31);await assert.rejects(disposal().request({evidenceId:original.id,requestKey:randomUUID(),previewHash:p.previewHash,reason:'A valid private reason',reviewed:true}),status(409));
 pending=await request(original);assert.equal(pending.row.state,'PENDING');assert.deepEqual(await disposal().request(pending.input),pending.row);await assert.rejects(disposal().request({...pending.input,reason:'Different request contents'}),status(409));
 for(const u of [admin,reader,collector])await assert.rejects(service(u).download(original.id),e=>[403,404].includes(e.status));assert.equal((await service(admin).view({kind:'PERSON',id:person.id})).evidence.some(e=>e.id===original.id),false);
 const v=await submissions(admin).view({kind:'PERSON',id:person.id});await assert.rejects(submissions(admin).submit({caseId,version:v.submission.number,policyVersion:v.policy.version,role:'CUSTOMER',facts:[],evidenceIds:[original.id],reason:'Must not use quarantined evidence'}),status(403));
})
test('a pending request can be cancelled without storage I/O and a hold arriving after preview prevents execution',async()=>{
 const before=calls.filter(c=>c[0]==='dispose').length;await retention().hold({caseId,version:2,action:'PLACE',reason:'New preservation instruction'});await assert.rejects(execute(pending.row),status(409));assert.equal(calls.filter(c=>c[0]==='dispose').length,before);
 await disposal().act({id:pending.row.id,version:1,action:'cancel'});assert.ok((await service(reader).download(original.id)).url);await retention().hold({caseId,version:3,action:'RELEASE',reason:'Preservation now resolved'});pending=await request(original);
})
test('successful confirmed removal scrubs file metadata, preserves a minimal tombstone and immutable native history',async()=>{
 completed=await execute(pending.row);assert.equal(completed.state,'COMPLETED');assert.equal(objects.has(original.path),false);
 const e=await root.verificationEvidence.findUniqueOrThrow({where:{id:original.id}});assert.equal(e.state,'DISPOSED');assert.equal(e.filename,'Disposed original');assert.equal(e.bytes,0);assert.equal(e.sha256,null);assert.ok(e.cleanedAt);assert.equal(e.path,original.path);
 assert.deepEqual(await execute(pending.row),completed);await assert.rejects(service(admin).download(e.id),status(404));assert.equal((await root.verificationDisposalEvent.findMany({where:{disposalId:completed.id},orderBy:{version:'asc'}})).map(r=>r.state).join(','),'PENDING,DELETING,COMPLETED');
 await assert.rejects(root.verificationDisposal.update({where:{id:completed.id},data:{state:'PENDING',version:4}}));await assert.rejects(root.verificationEvidence.update({where:{id:e.id},data:{filename:'Restore filename'}}));await assert.rejects(root.verificationDisposalEvent.deleteMany({where:{disposalId:completed.id}}),/immutable/);
})
test('an uncertain network outcome remains quarantined and is reconciled without deleting a different or restored file',async()=>{
 const e=await ready(),r=await request(e),s=disposal(admin,{...disposeStorage,async remove(path){objects.delete(path);throw Error('Lost storage acknowledgement')}});await assert.rejects(s.act({id:r.row.id,version:1,action:'execute'}),status(503));uncertain=await root.verificationDisposal.findUniqueOrThrow({where:{id:r.row.id}});assert.equal(uncertain.state,'DELETING');
 await assert.rejects(disposal().act({id:uncertain.id,version:uncertain.version,action:'cancel'}),status(409));await assert.rejects(disposal().act({id:uncertain.id,version:uncertain.version,action:'reconcile'}),status(409));await assert.rejects(retention().hold({caseId,version:4,action:'PLACE',reason:'Late hold must not silently commit'}),status(409));
 await mature(uncertain.id);const done=await disposal().act({id:uncertain.id,version:uncertain.version,action:'reconcile'});assert.equal(done.state,'COMPLETED');assert.equal((await root.verificationEvidence.findUniqueOrThrow({where:{id:e.id}})).state,'DISPOSED');
})
test('storage failures retaining the object can retry; checksum mismatch or unknown missing status never authorizes removal',async()=>{
 const e=await ready(),r=await request(e),before=calls.filter(c=>c[0]==='dispose').length;
 await assert.rejects(disposal(admin,{...disposeStorage,async inspect(){throw Error('Storage unavailable')}}).act({id:r.row.id,version:1,action:'execute'}));assert.equal((await root.verificationDisposal.findUniqueOrThrow({where:{id:r.row.id}})).state,'PENDING');
 objects.set(e.path,Buffer.from('changed original'));await assert.rejects(execute(r.row),status(409));assert.equal(calls.filter(c=>c[0]==='dispose').length,before);objects.set(e.path,png);
 await assert.rejects(disposal(admin,{...disposeStorage,async remove(){throw Error('Storage rejected removal')}}).act({id:r.row.id,version:1,action:'execute'}),status(503));const d=await root.verificationDisposal.findUniqueOrThrow({where:{id:r.row.id}});await mature(d.id);assert.equal((await disposal().act({id:d.id,version:d.version,action:'reconcile'})).state,'COMPLETED');
})
test('current authority and preservation are rechecked after storage reads; losing concurrent actions cannot remove another file',async()=>{
 const e=await ready(),r=await request(e),s=disposal(admin,{...disposeStorage,async inspect(path){const b=await disposeStorage.inspect(path);await retention().hold({caseId,version:4,action:'PLACE',reason:'Hold arrived during storage read'});return b}});await assert.rejects(s.act({id:r.row.id,version:1,action:'execute'}),status(409));assert.ok(objects.has(e.path));await retention().hold({caseId,version:5,action:'RELEASE',reason:'Hold resolved before removal'});
 const result=await Promise.allSettled([execute(r.row),execute(r.row)]);assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal(objects.has(e.path),false);
})
test('foreign, delegated and external users cannot preview or act even with a manager profile',async()=>{
 const e=await ready();await assert.rejects(applicationVerificationDisposal(other,identity(foreignAdmin),disposeStorage).preview({evidenceId:e.id}),status(404));await grants(reader,['contacts.read','accounts.read','customerVerification.read','verificationEvidence.read','verificationRetention.read','verificationDisposals.read','verificationDisposals.create','verificationDisposals.approve','verificationDisposals.cancel']);await assert.rejects(disposal(reader).preview({evidenceId:e.id}),status(403));assert.equal((await runWithDatabaseActor(reader.id,()=>db.verificationDisposal.findMany())).length,0);
 const p=await root.externalCollaborator.create({data:{tenantId:tenant,name:'Outside eraser',code:'ERASE',supervisorUserId:admin.id}}),u=await root.user.create({data:{tenantId:tenant,role:'STAFF',email:randomUUID()+'@example.test',collaboratorId:p.id}});await grants(u,['contacts.read','customerVerification.read','verificationDisposals.read','verificationDisposals.create']);await assert.rejects(disposal(u).preview({evidenceId:e.id}),status(403));
})
test('audit rollback after remote removal keeps the durable intent, and reconciliation completes exactly once',async()=>{
 const e=await ready(),r=await request(e);await root.$executeRawUnsafe(`CREATE FUNCTION app.test_disposal_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."tenantId"='${tenant}' AND NEW.event='customerVerification.disposalChanged' AND NEW."after"->>'state'='COMPLETED' THEN RAISE EXCEPTION 'Synthetic audit failure';END IF;RETURN NEW;END $$;CREATE TRIGGER test_disposal_audit_failure BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION app.test_disposal_audit_failure()`);
 try{await assert.rejects(execute(r.row),status(503));assert.equal(objects.has(e.path),false);assert.equal((await root.verificationEvidence.findUniqueOrThrow({where:{id:e.id}})).state,'READY')}finally{await root.$executeRawUnsafe('DROP TRIGGER test_disposal_audit_failure ON "AuditLog";DROP FUNCTION app.test_disposal_audit_failure()')}
 const d=await root.verificationDisposal.findUniqueOrThrow({where:{id:r.row.id}});await mature(d.id);await disposal().act({id:d.id,version:d.version,action:'reconcile'});const audit=await root.auditLog.findMany({where:{tenantId:tenant,event:'customerVerification.disposalChanged'}});assert.equal(JSON.stringify(audit).includes('Private disposal instruction'),false);assert.equal(JSON.stringify(audit).includes('proof.png'),false);
})
test('native mutation, forged history, missing confirmation and key reuse are rejected before external removal',async()=>{
 const e=await ready(),r=await request(e);await assert.rejects(root.verificationEvidence.update({where:{id:e.id},data:{state:'DISPOSED',filename:'Disposed original',bytes:0,sha256:null,cleanedAt:new Date()}}));await assert.rejects(root.verificationDisposalEvent.create({data:{tenantId:tenant,disposalId:r.row.id,version:99,state:'COMPLETED',actorUserId:admin.id}}));
 assert.throws(()=>disposal().request({...r.input,reviewed:false}));await assert.rejects(disposal().act({id:completed.id,version:1,action:'cancel'}),status(409));assert.ok(objects.has(e.path));
})

test('module and administrator authority loss during storage I/O stop removal and preserve reconciliation',async()=>{
 const e=await ready(),r=await request(e),before=calls.filter(c=>c[0]==='dispose').length;
 const disabled=disposal(admin,{...disposeStorage,async inspect(path){const o=await disposeStorage.inspect(path);await root.tenantModule.update({where:{tenantId_key:{tenantId:tenant,key:'customerVerification'}},data:{enabled:false}});return o}})
 try{await assert.rejects(disabled.act({id:r.row.id,version:1,action:'execute'}),status(403));assert.equal(calls.filter(c=>c[0]==='dispose').length,before);assert.equal((await root.verificationDisposal.findUniqueOrThrow({where:{id:r.row.id}})).state,'PENDING')}finally{await root.tenantModule.update({where:{tenantId_key:{tenantId:tenant,key:'customerVerification'}},data:{enabled:true}})}
 const revoked=disposal(admin,{...disposeStorage,async remove(path){await disposeStorage.remove(path);await root.user.update({where:{id:admin.id},data:{role:'STAFF'}})}})
 try{await assert.rejects(revoked.act({id:r.row.id,version:1,action:'execute'}),status(503));assert.equal(objects.has(e.path),false);assert.equal((await root.verificationDisposal.findUniqueOrThrow({where:{id:r.row.id}})).state,'DELETING')}finally{await root.user.update({where:{id:admin.id},data:{role:'ADMIN'}})}
 const d=await root.verificationDisposal.findUniqueOrThrow({where:{id:r.row.id}});await mature(d.id);assert.equal((await disposal().act({id:d.id,version:d.version,action:'reconcile'})).state,'COMPLETED')
})

test('quarantine arriving during signed-download generation prevents releasing the link',async()=>{
 const e=await ready();let pending
 await assert.rejects(service(admin,{...storage,async download(){pending=await request(e);return 'https://test.invalid/must-not-return'}}).download(e.id),status(409));assert.ok(pending);assert.ok(objects.has(e.path));await disposal().act({id:pending.row.id,version:1,action:'cancel'})
})
