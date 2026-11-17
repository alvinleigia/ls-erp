/* eslint-disable @typescript-eslint/no-require-imports */
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto'),{Pool}=require('pg'),{PrismaClient}=require('@prisma/client'),sharp=require('sharp')
const {TenantPgAdapter}=require('../lib/tenant-pg-adapter.ts'),{runWithDatabaseActor}=require('../lib/database-actor.ts'),{authorizeBusinessOperation}=require('../platform/access/operation.ts')
const {createVerificationConfigurationService}=require('../platform/verification/configuration.ts'),{applicationVerificationCases,applicationVerificationEvidence,applicationVerificationSubmissions,applicationVerificationRetention,applicationVerificationDisposal}=require('../application/verification/service.ts')
const {emptyVerificationPolicy}=require('../platform/verification/contracts.ts'),{createApplicationCrmService}=require('../application/crm/service.ts'),{createAccessRoleService}=require('../platform/access/service.ts'),{defaultRecordRules}=require('../platform/access/rules.ts')
require('../lib/logger.ts').logger.info=()=>{}
const url=new URL(process.env.CRM_TEST_DATABASE_URL||'http://invalid');if(!['127.0.0.1','localhost'].includes(url.hostname)||url.pathname!='/ls_salon_crm_test')throw Error('Disposable local database only.')
const tenant='unused_'+randomUUID(),foreign=tenant+'_other',clients=[],pools=[],objects=new Map(),removals=[]
function client(tenantId,bypass=false){const u=new URL(url);if(!bypass){u.username='crm_test_runtime';u.password=''}const pool=new Pool({connectionString:u.toString(),max:4});pools.push(pool);const db=new PrismaClient({adapter:new TenantPgAdapter(pool,{tenantId,bypass})});clients.push(db);return db}
const root=client(undefined,true),db=client(tenant),other=client(foreign),identity=u=>({tenantId:u.tenantId,userId:u.id}),status=n=>e=>e.status===n
const uploadStorage={async signUpload(){return 'https://test.invalid/upload'},async read(p){return objects.get(p)},async download(){return 'https://test.invalid/download'},async remove(p){objects.delete(p)}}
const storage={async inspect(p){const bytes=objects.get(p);return bytes?{exists:true,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}:{exists:false}},async remove(p){removals.push(p);objects.delete(p)}}
const disposal=(user=admin,transport=storage,database=db)=>applicationVerificationDisposal(database,identity(user),transport),evidence=user=>applicationVerificationEvidence(db,identity(user),uploadStorage),retention=()=>applicationVerificationRetention(db,identity(admin)),submissions=user=>applicationVerificationSubmissions(db,identity(user))
let admin,reviewer,collector,manager,foreignAdmin,external,profiles,png
async function grant(u,permissions){const p=await profiles.save({name:randomUUID(),permissions}),state=await profiles.assignment(u.id);await profiles.assign(u.id,{version:state.accessPolicy.version,roleIds:[p.id],rules:{...defaultRecordRules(),'contacts.read':'ALL','accounts.read':'ALL'}})}
before(async()=>{
 await root.tenant.createMany({data:[tenant,foreign].map(id=>({id,name:id,slug:id}))});const user=(tenantId,role)=>root.user.create({data:{tenantId,role,email:randomUUID()+'@example.test'}})
 admin=await user(tenant,'ADMIN');reviewer=await user(tenant,'ADMIN');collector=await user(tenant,'STAFF');manager=await user(tenant,'MANAGER');foreignAdmin=await user(foreign,'ADMIN')
 await root.tenantModule.createMany({data:[tenant,foreign].flatMap(tenantId=>['crm','customerVerification'].map(key=>({tenantId,key,allowed:true,enabled:true})))})
 profiles=createAccessRoleService(db,identity(admin));await grant(collector,['contacts.read','accounts.read','customerVerification.read','verificationUploads.read','verificationUploads.create','verificationUploads.cancel'])
 const disposalPermissions=['contacts.read','accounts.read','customerVerification.read','verificationEvidence.read','verificationRetention.read','verificationDisposals.read','verificationDisposals.create','verificationDisposals.approve','verificationDisposals.cancel']
 await grant(manager,disposalPermissions)
 const partner=await root.externalCollaborator.create({data:{tenantId:tenant,name:'Synthetic outside collector',code:randomUUID().replaceAll('-','').toUpperCase(),supervisorUserId:admin.id}})
 external=await root.user.create({data:{tenantId:tenant,role:'STAFF',collaboratorId:partner.id,email:randomUUID()+'@example.test'}});await grant(external,disposalPermissions)
 const definition={...emptyVerificationPolicy(),documents:[{code:'identity',label:'Identity proof',subjects:['PERSON','BUSINESS'],roles:['CUSTOMER']}]},c=createVerificationConfigurationService(db,identity(admin)),p=await c.preview({version:0,definition});await c.publish({version:0,definition,previewHash:p.previewHash})
 png=await sharp({create:{width:10,height:10,channels:3,background:'orange'}}).png().toBuffer()
})
after(async()=>{await Promise.all(clients.map(c=>c.$disconnect()));await Promise.all(pools.map(p=>p.end()))})
async function fixture(kind='PERSON'){
 const crm=createApplicationCrmService(db,identity(admin)),person=kind==='PERSON'?await crm.createContact({name:'Synthetic unused evidence customer'}):await crm.createAccount({name:'Synthetic unused evidence business'}),subject={kind,id:person.id}
 return{subject,caseId:(await applicationVerificationCases(db,identity(admin)).start(subject)).case.id}
}
async function ready(f){const s=await evidence(collector).reserve({caseId:f.caseId,documentCode:'identity',filename:'private-unused.png',contentType:'image/png',bytes:png.length}),row=await root.verificationEvidence.findUniqueOrThrow({where:{id:s.id}});objects.set(row.path,png);await evidence(collector).finalize(s.id);return row}
async function request(e,svc=disposal()){const p=await svc.preview({evidenceId:e.id,kind:'UNSUBMITTED'}),input={evidenceId:e.id,kind:'UNSUBMITTED',requestKey:randomUUID(),previewHash:p.previewHash,reason:'Uncropped accidental upload must be replaced',reviewed:true};return{row:await svc.request(input),preview:p,input}}
const execute=(r,svc=disposal())=>svc.act({id:r.id,version:r.version,action:'execute'})
const direct=(user,work)=>runWithDatabaseActor(user.id,()=>db.$transaction(async tx=>{await authorizeBusinessOperation(tx,identity(user),'customerVerification.read');return work(tx)}))
const raw=(f,e,extra={})=>({id:randomUUID(),tenantId:tenant,caseId:f.caseId,evidenceId:e.id,kind:'UNSUBMITTED',policyVersion:null,retainedEvidenceId:null,previewHash:'a'.repeat(64),reason:'Explicit synthetic unused upload deletion',createdByUserId:admin.id,actorUserId:admin.id,...extra})
const submit=(f,e,extra={})=>submissions(admin).submit({caseId:f.caseId,version:0,policyVersion:1,role:'CUSTOMER',facts:[],evidenceIds:[e.id],...extra})

test('the only unused file may be removed without retention publication; bytes disappear and immutable history remains',async()=>{
 const f=await fixture(),e=await ready(f),policy=await retention().settings();assert.equal(policy.version,0)
 assert.equal((await retention().view(f.subject)).decisions.find(d=>d.id===e.id).canRemoveUnused,true)
 const r=await request(e);assert.equal(r.preview.policyVersion,null);assert.equal(r.preview.retained,null);assert.deepEqual(await disposal().request(r.input),r.row)
 await assert.rejects(disposal().request({...r.input,kind:'DUPLICATE'}),status(409))
 const done=await execute(r.row);assert.equal(done.state,'COMPLETED');assert.deepEqual(await execute(r.row),done);assert.equal(objects.has(e.path),false)
 const row=await root.verificationEvidence.findUniqueOrThrow({where:{id:e.id}});assert.equal(row.state,'DISPOSED');assert.equal(row.bytes,0);assert.equal(row.filename,'Disposed original');assert.equal(row.sha256,null)
 const saved=await root.verificationDisposal.findUniqueOrThrow({where:{id:r.row.id}});assert.equal(saved.kind,'UNSUBMITTED');assert.equal(saved.policyVersion,null);assert.equal(saved.retainedEvidenceId,null)
 assert.equal((await root.verificationDisposalEvent.findMany({where:{disposalId:r.row.id},orderBy:{version:'asc'}})).map(e=>e.state).join(','),'PENDING,DELETING,COMPLETED')
 assert.deepEqual(await retention().settings(),policy);await assert.rejects(evidence(admin).download(e.id),status(404));await assert.rejects(root.verificationEvidence.delete({where:{id:e.id}}))
 const audit=JSON.stringify(await root.auditLog.findMany({where:{tenantId:tenant,event:'customerVerification.disposalChanged'}}));assert.equal(audit.includes(r.input.reason),false);assert.equal(audit.includes('private-unused.png'),false)
})

test('both unused identical uploads can be removed, including the last original, for people and businesses',async()=>{
 for(const kind of ['PERSON','BUSINESS']){const f=await fixture(kind),a=await ready(f),b=await ready(f);await execute((await request(b)).row);await execute((await request(a)).row);assert.equal(objects.has(a.path)||objects.has(b.path),false);assert.equal(await root.verificationEvidence.count({where:{caseId:f.caseId,state:'READY'}}),0)}
})

test('saved submission selection blocks removal before approval and after correction, approval and revocation',async()=>{
 for(const decision of [null,'CHANGES_REQUIRED','APPROVED','REVOKED']){
  const f=await fixture(),e=await ready(f),s=await submit(f,e)
  if(decision){await submissions(reviewer).review({submissionId:s.id,version:1,reviewVersion:0,decision:decision==='REVOKED'?'APPROVED':decision,reviewed:decision!=='CHANGES_REQUIRED',...(decision==='CHANGES_REQUIRED'?{reason:'Synthetic review correction'}:{})});if(decision==='REVOKED')await submissions(reviewer).review({submissionId:s.id,version:1,reviewVersion:1,decision:'REVOKED',reviewed:false,reason:'Synthetic review revocation'})}
  await assert.rejects(disposal().preview({evidenceId:e.id,kind:'UNSUBMITTED'}),status(409));assert.equal((await retention().view(f.subject)).decisions.find(d=>d.id===e.id).canRemoveUnused,false)
  await assert.rejects(direct(admin,tx=>tx.verificationDisposal.create({data:raw(f,e)})));assert.ok(objects.has(e.path))
 }
})

test('a newer unused file can be removed without deleting an older selected original or its saved revisions',async()=>{
 const f=await fixture(),selected=await ready(f),s=await submit(f,selected),unused=await ready(f);await execute((await request(unused)).row)
 assert.ok(objects.has(selected.path));assert.equal(await root.verificationSubmissionEvidence.count({where:{submissionId:s.id}}),1);await assert.rejects(disposal().preview({evidenceId:selected.id,kind:'UNSUBMITTED'}),status(409))
})

test('a submitted file arriving after preview invalidates both the service request and direct native insertion',async()=>{
 const f=await fixture(),e=await ready(f),p=await disposal().preview({evidenceId:e.id,kind:'UNSUBMITTED'});await submit(f,e)
 await assert.rejects(disposal().request({evidenceId:e.id,kind:'UNSUBMITTED',requestKey:randomUUID(),previewHash:p.previewHash,reason:'Stale unused deletion denied',reviewed:true}),status(409));await assert.rejects(direct(admin,tx=>tx.verificationDisposal.create({data:raw(f,e)})));assert.ok(objects.has(e.path))
})

test('holds after preview and during storage inspection block irreversible removal; pending requests remain cancellable',async()=>{
 const f=await fixture(),e=await ready(f),r=await request(e),transport={...storage,async inspect(p){const v=await storage.inspect(p);await retention().hold({caseId:f.caseId,version:0,action:'PLACE',reason:'Preserve before removal starts'});return v}}
 await assert.rejects(execute(r.row,disposal(admin,transport)),status(409));assert.ok(objects.has(e.path));assert.equal((await root.verificationDisposal.findUniqueOrThrow({where:{id:r.row.id}})).state,'PENDING')
 await assert.rejects(disposal().preview({evidenceId:e.id,kind:'UNSUBMITTED'}),status(409));await disposal().act({id:r.row.id,version:1,action:'cancel'});assert.ok(objects.has(e.path))
})

test('collectors, capability-rich managers, external users and other tenants cannot remove unused evidence',async()=>{
 const f=await fixture(),e=await ready(f)
 for(const user of [collector,manager,external])await assert.rejects(disposal(user).preview({evidenceId:e.id,kind:'UNSUBMITTED'}),status(403))
 await assert.rejects(disposal(foreignAdmin,storage,other).preview({evidenceId:e.id,kind:'UNSUBMITTED'}),status(404))
 await assert.rejects(direct(manager,tx=>tx.verificationDisposal.create({data:raw(f,e,{createdByUserId:manager.id,actorUserId:manager.id})})))
 assert.equal((await direct(admin,tx=>tx.$queryRaw`SELECT app.verification_unused_original(${foreign},${e.id}) allowed`))[0].allowed,false);assert.ok(objects.has(e.path))
})

test('native purpose constraints reject forged retention/keeper values and quarantine blocks new submissions',async()=>{
 const f=await fixture(),e=await ready(f)
 for(const extra of [{retainedEvidenceId:e.id},{policyVersion:1},{kind:'UNKNOWN'}])await assert.rejects(direct(admin,tx=>tx.verificationDisposal.create({data:raw(f,e,extra)})))
 const r=await request(e);await assert.rejects(submit(f,e),status(403));await assert.rejects(evidence(admin).download(e.id),status(404))
 await assert.rejects(direct(admin,tx=>tx.verificationDisposal.update({where:{id:r.row.id},data:{kind:'RETENTION',version:2,actorUserId:admin.id}})))
 await disposal().act({id:r.row.id,version:1,action:'cancel'});assert.ok(await evidence(admin).download(e.id))
})

test('a duplicate keeper is protected from unused-file removal until its pending request is cancelled',async()=>{
 const f=await fixture(),keep=await ready(f),e=await ready(f),p=await disposal().preview({evidenceId:e.id,kind:'DUPLICATE'}),r=await disposal().request({evidenceId:e.id,kind:'DUPLICATE',previewHash:p.previewHash,requestKey:randomUUID(),reason:'Synthetic exact duplicate removal',reviewed:true})
 await assert.rejects(disposal().preview({evidenceId:keep.id,kind:'UNSUBMITTED'}),status(409));await assert.rejects(direct(admin,tx=>tx.verificationDisposal.create({data:raw(f,keep)})))
 await disposal().act({id:r.id,version:1,action:'cancel'});assert.ok(await disposal().preview({evidenceId:keep.id,kind:'UNSUBMITTED'}));assert.ok(objects.has(keep.path)&&objects.has(e.path))
})

test('storage checksum mismatch or authority loss during inspection leaves bytes intact before irreversible start',async()=>{
 const f=await fixture(),e=await ready(f),r=await request(e),before=removals.length
 await assert.rejects(execute(r.row,disposal(admin,{...storage,async inspect(){return{exists:true,bytes:png.length,sha256:'a'.repeat(64)}}})),status(409))
 const transport={...storage,async inspect(p){const result=await storage.inspect(p);await root.tenantModule.update({where:{tenantId_key:{tenantId:tenant,key:'customerVerification'}},data:{enabled:false}});return result}}
 try{await assert.rejects(execute(r.row,disposal(admin,transport)),status(403))}finally{await root.tenantModule.update({where:{tenantId_key:{tenantId:tenant,key:'customerVerification'}},data:{enabled:true}})}
 assert.equal(removals.length,before);assert.ok(objects.has(e.path));await disposal().act({id:r.row.id,version:1,action:'cancel'})
})

test('concurrent unused requests have one winner; uncertain storage outcomes reconcile without restoring removed bytes',async()=>{
 const f=await fixture(),e=await ready(f),attempts=await Promise.allSettled([request(e),request(e)]);assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);const r=attempts.find(r=>r.status==='fulfilled').value.row
 await assert.rejects(execute(r,disposal(admin,{...storage,async remove(p){objects.delete(p);throw Error('Synthetic lost acknowledgement')}})),status(503))
 const pending=await root.verificationDisposal.findUniqueOrThrow({where:{id:r.id}});assert.equal(pending.state,'DELETING');await assert.rejects(disposal().act({id:r.id,version:pending.version,action:'cancel'}),status(409))
 // Advance only the retry clock in this disposable fixture; production writes always run every guard.
 await root.$transaction(async tx=>{for(const trigger of ['verification_disposal_write','verification_unused_disposal_write','verification_disposal_after'])await tx.$executeRawUnsafe(`ALTER TABLE "VerificationDisposal" DISABLE TRIGGER ${trigger}`);await tx.$executeRaw`UPDATE "VerificationDisposal" SET "retryAfter"=clock_timestamp()-interval '1 second' WHERE id=${r.id}`;for(const trigger of ['verification_disposal_write','verification_unused_disposal_write','verification_disposal_after'])await tx.$executeRawUnsafe(`ALTER TABLE "VerificationDisposal" ENABLE TRIGGER ${trigger}`)})
 await disposal().act({id:r.id,version:pending.version,action:'reconcile'});assert.equal((await root.verificationEvidence.findUniqueOrThrow({where:{id:e.id}})).state,'DISPOSED');assert.equal(objects.has(e.path),false)
})
