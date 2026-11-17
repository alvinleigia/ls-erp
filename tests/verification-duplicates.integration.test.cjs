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
const tenant='duplicates_'+randomUUID(),foreign=tenant+'_other',clients=[],pools=[],objects=new Map(),calls=[]
function client(tenantId,bypass=false){const u=new URL(url);if(!bypass){u.username='crm_test_runtime';u.password=''}const pool=new Pool({connectionString:u.toString(),max:4});pools.push(pool);const db=new PrismaClient({adapter:new TenantPgAdapter(pool,{tenantId,bypass})});clients.push(db);return db}
const root=client(undefined,true),db=client(tenant),other=client(foreign),identity=u=>({tenantId:u.tenantId,userId:u.id}),status=n=>e=>e.status===n
const storage={async signUpload(path){calls.push(['sign',path]);return 'https://test.invalid/'+path},async read(path){calls.push(['read',path]);if(!objects.has(path))throw Object.assign(Error('Storage unavailable'),{status:503});return objects.get(path)},async download(path){calls.push(['download',path]);return 'https://test.invalid/download/'+path},async remove(path){calls.push(['remove',path]);objects.delete(path)}}
const service=(user,transport=storage,database=db)=>applicationVerificationEvidence(database,identity(user),transport),crm=u=>createApplicationCrmService(db,identity(u))
let admin,collector,reader,foreignAdmin,person,business,caseId,png,profiles
const definition={...emptyVerificationPolicy(),documents:[{code:'identity',label:'Identity proof',subjects:['PERSON','BUSINESS'],roles:['CUSTOMER','ADDITIONAL_CUSTOMER']},{code:'address',label:'Address proof',subjects:['PERSON'],roles:['ADDITIONAL_CUSTOMER']}]}
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

async function fixture(){
 const p=await crm(admin).createContact({name:'Synthetic duplicate customer'});
 caseId=(await applicationVerificationCases(db,identity(admin)).start({kind:'PERSON',id:p.id})).case.id;
 return p;
}
async function ready(extra={},bytes=png){const s=await stage(collector,extra,bytes);await service(collector).finalize(s.row.id);return root.verificationEvidence.findUniqueOrThrow({where:{id:s.row.id}})}
async function request(e,s=disposal()){const p=await s.preview({evidenceId:e.id,kind:'DUPLICATE'}),input={evidenceId:e.id,kind:'DUPLICATE',requestKey:randomUUID(),previewHash:p.previewHash,reason:'Accidental duplicate upload',reviewed:true};return {row:await s.request(input),input,preview:p}}
async function mature(id){await root.$transaction(async tx=>{await tx.$executeRawUnsafe('ALTER TABLE "VerificationDisposal" DISABLE TRIGGER verification_disposal_write');await tx.$executeRawUnsafe('ALTER TABLE "VerificationDisposal" DISABLE TRIGGER verification_disposal_after');await tx.$executeRaw`UPDATE "VerificationDisposal" SET "retryAfter"=clock_timestamp()-interval '1 second' WHERE id=${id}`;await tx.$executeRawUnsafe('ALTER TABLE "VerificationDisposal" ENABLE TRIGGER verification_disposal_write');await tx.$executeRawUnsafe('ALTER TABLE "VerificationDisposal" ENABLE TRIGGER verification_disposal_after')})}
const execute=(r,s=disposal())=>s.act({id:r.id,version:r.version,action:'execute'})

test('exact duplicate removal works without a retention policy, preserves the older original and records immutable history',async()=>{
 const p=await fixture(),keep=await ready(),duplicate=await ready();
 assert.equal((await retention().settings()).version,0);await assert.rejects(disposal().preview({evidenceId:duplicate.id}),status(409));
 const view=await retention().view({kind:'PERSON',id:p.id});assert.equal(view.decisions.find(e=>e.id===duplicate.id).duplicateOfId,keep.id);assert.equal(view.decisions.find(e=>e.id===keep.id).duplicateOfId,null);
 const r=await request(duplicate);assert.equal(r.preview.retained.id,keep.id);assert.equal(r.preview.policyVersion,null);assert.deepEqual(await disposal().request(r.input),r.row);
 await assert.rejects(disposal().request({...r.input,kind:'RETENTION'}),status(409));
 await execute(r.row);assert.equal(objects.has(keep.path),true);assert.equal(objects.has(duplicate.path),false);
 assert.equal((await root.verificationEvidence.findUniqueOrThrow({where:{id:keep.id}})).state,'READY');assert.equal((await root.verificationEvidence.findUniqueOrThrow({where:{id:duplicate.id}})).state,'DISPOSED');
 const saved=await root.verificationDisposal.findUniqueOrThrow({where:{id:r.row.id}});assert.equal(saved.kind,'DUPLICATE');assert.equal(saved.retainedEvidenceId,keep.id);assert.equal(saved.policyVersion,null);
 assert.equal((await root.verificationDisposalEvent.findMany({where:{disposalId:r.row.id},orderBy:{version:'asc'}})).map(e=>e.state).join(','),'PENDING,DELETING,COMPLETED');assert.equal((await retention().settings()).version,0);
 const audit=JSON.stringify(await root.auditLog.findMany({where:{tenantId:tenant,event:'customerVerification.disposalChanged'}}));assert.equal(audit.includes('Accidental duplicate upload'),false);assert.equal(audit.includes('proof.png'),false);
 await assert.rejects(root.verificationDisposal.update({where:{id:saved.id},data:{retainedEvidenceId:duplicate.id,version:4}}));
})

test('same filename or size alone is insufficient; originals and different customer/categories cannot be removed',async()=>{
 await fixture();const keep=await ready();await assert.rejects(disposal().preview({evidenceId:keep.id,kind:'DUPLICATE'}),status(409));
 const otherBytes=await sharp({create:{width:10,height:10,channels:3,background:'blue'}}).png().toBuffer(),different=await ready({bytes:otherBytes.length},otherBytes);
 await assert.rejects(disposal().preview({evidenceId:different.id,kind:'DUPLICATE'}),status(409));
 await fixture();const foreignCase=await ready();await assert.rejects(disposal().preview({evidenceId:foreignCase.id,kind:'DUPLICATE'}),status(409));
 const differentCategory=await ready({documentCode:'address'});await assert.rejects(disposal().preview({evidenceId:differentCategory.id,kind:'DUPLICATE'}),status(409));
})

test('submission references and preservation holds block duplicate removal, including a hold arriving after preview',async()=>{
 const p=await fixture(),keep=await ready(),e=await ready(),preview=await disposal().preview({evidenceId:e.id,kind:'DUPLICATE'});
 await retention().hold({caseId,version:0,action:'PLACE',reason:'Preserve customer evidence'});
 await assert.rejects(disposal().request({evidenceId:e.id,kind:'DUPLICATE',requestKey:randomUUID(),previewHash:preview.previewHash,reason:'Accidental duplicate upload',reviewed:true}),status(409));
 await retention().hold({caseId,version:1,action:'RELEASE',reason:'Preservation resolved'});
 const view=await submissions(admin).view({kind:'PERSON',id:p.id});await submissions(admin).submit({caseId,version:0,policyVersion:view.policy.version,role:'CUSTOMER',facts:[],evidenceIds:[e.id]});
 await assert.rejects(disposal().preview({evidenceId:e.id,kind:'DUPLICATE'}),status(409));assert.ok(objects.has(e.path)&&objects.has(keep.path));
})

test('an already submitted keeper can be retained while an unreferenced duplicate is removed',async()=>{
 const p=await fixture(),keep=await ready(),e=await ready(),view=await submissions(admin).view({kind:'PERSON',id:p.id});await submissions(admin).submit({caseId,version:0,policyVersion:view.policy.version,role:'CUSTOMER',facts:[],evidenceIds:[keep.id]});
 const r=await request(e);await execute(r.row);assert.ok(objects.has(keep.path));assert.equal(await root.verificationSubmissionEvidence.count({where:{evidenceId:keep.id}}),1);
})

test('keeper cannot be disposed during a pending duplicate request; cancellation restores both files',async()=>{
 await fixture();const keep=await ready(),e=await ready(),r=await request(e);await publish(1);await age(keep);
 await assert.rejects(disposal().preview({evidenceId:keep.id}),status(409));
 await assert.rejects(runWithDatabaseActor(admin.id,()=>db.verificationDisposal.create({data:{id:randomUUID(),tenantId:tenant,caseId,evidenceId:keep.id,policyVersion:1,previewHash:'a'.repeat(64),reason:'Cannot erase retained keeper',createdByUserId:admin.id,actorUserId:admin.id}})));
 await disposal().act({id:r.row.id,version:1,action:'cancel'});assert.ok(objects.has(keep.path)&&objects.has(e.path));assert.ok(await disposal().preview({evidenceId:keep.id}));
})

test('multiple duplicate removals never erase the last original and concurrent requests for one duplicate have one winner',async()=>{
 await fixture();const keep=await ready(),one=await ready(),two=await ready();
 const requests=await Promise.allSettled([request(one),request(one)]);assert.equal(requests.filter(r=>r.status==='fulfilled').length,1);
 const a=requests.find(r=>r.status==='fulfilled').value,b=await request(two);await execute(a.row);await execute(b.row);assert.ok(objects.has(keep.path));
 await assert.rejects(disposal().preview({evidenceId:keep.id,kind:'DUPLICATE'}),status(409));
})

test('native writes cannot forge a keeper or remove submitted evidence; non-admin and foreign tenant are denied',async()=>{
 const person=await fixture(),keep=await ready(),e=await ready(),p=await disposal().preview({evidenceId:e.id,kind:'DUPLICATE'});
 const raw={id:randomUUID(),tenantId:tenant,caseId,evidenceId:e.id,kind:'DUPLICATE',retainedEvidenceId:e.id,previewHash:p.previewHash,reason:'Forged removal denied',createdByUserId:admin.id,actorUserId:admin.id};
 await assert.rejects(runWithDatabaseActor(admin.id,()=>db.verificationDisposal.create({data:raw})));
 await assert.rejects(disposal(reader).preview({evidenceId:e.id,kind:'DUPLICATE'}),status(403));await assert.rejects(disposal(collector).preview({evidenceId:e.id,kind:'DUPLICATE'}),status(403));
 await assert.rejects(applicationVerificationDisposal(other,identity(foreignAdmin),disposeStorage).preview({evidenceId:e.id,kind:'DUPLICATE'}),status(404));assert.ok(objects.has(keep.path));
 const view=await submissions(admin).view({kind:'PERSON',id:person.id});await submissions(admin).submit({caseId,version:0,policyVersion:view.policy.version,role:'CUSTOMER',facts:[],evidenceIds:[e.id]});
 await assert.rejects(runWithDatabaseActor(admin.id,()=>db.verificationDisposal.create({data:{...raw,retainedEvidenceId:keep.id}})));
})

test('competing retention and duplicate requests serialize and cannot remove the keeper together',async()=>{
 await fixture();const keep=await ready(),e=await ready();await age(keep);const retentionPreview=await disposal().preview({evidenceId:keep.id}),duplicatePreview=await disposal().preview({evidenceId:e.id,kind:'DUPLICATE'});
 const requests=await Promise.allSettled([
  disposal().request({evidenceId:keep.id,requestKey:randomUUID(),previewHash:retentionPreview.previewHash,reason:'Synthetic expired original removal',reviewed:true}),
  disposal().request({evidenceId:e.id,kind:'DUPLICATE',requestKey:randomUUID(),previewHash:duplicatePreview.previewHash,reason:'Synthetic duplicate removal',reviewed:true})
 ]);
 assert.equal(requests.filter(r=>r.status==='fulfilled').length,1);const winner=requests.find(r=>r.status==='fulfilled').value;await disposal().act({id:winner.id,version:winner.version,action:'cancel'});assert.ok(objects.has(keep.path)&&objects.has(e.path));
})

test('missing or corrupt retained bytes stop removal before any destructive storage call',async()=>{
 await fixture();const keep=await ready(),e=await ready(),r=await request(e),before=calls.filter(c=>c[0]==='dispose').length;
 objects.delete(keep.path);await assert.rejects(execute(r.row),status(409));assert.ok(objects.has(e.path));assert.equal(calls.filter(c=>c[0]==='dispose').length,before);
 objects.set(keep.path,Buffer.from('Corrupt keeper'));await assert.rejects(execute(r.row),status(409));assert.equal((await root.verificationDisposal.findUniqueOrThrow({where:{id:r.row.id}})).state,'PENDING');objects.set(keep.path,png);await execute(r.row);
})

test('a hold arriving during keeper inspection blocks removal and leaves the request cancellable',async()=>{
 await fixture();const keep=await ready(),e=await ready(),r=await request(e);const transport={...disposeStorage,async inspect(path){const v=await disposeStorage.inspect(path);if(path===keep.path)await retention().hold({caseId,version:0,action:'PLACE',reason:'Hold arrived during inspection'});return v}};
 await assert.rejects(execute(r.row,disposal(admin,transport)),status(409));assert.ok(objects.has(e.path));await disposal().act({id:r.row.id,version:1,action:'cancel'});
})

test('uncertain duplicate removal reconciles its exact tombstone and keeps the original available',async()=>{
 await fixture();const keep=await ready(),e=await ready(),r=await request(e),transport={...disposeStorage,async remove(path){objects.delete(path);throw Error('Synthetic lost acknowledgement')}};
 await assert.rejects(execute(r.row,disposal(admin,transport)),status(503));const d=await root.verificationDisposal.findUniqueOrThrow({where:{id:r.row.id}});assert.equal(d.state,'DELETING');assert.ok(objects.has(keep.path));
 await assert.rejects(disposal().act({id:d.id,version:d.version,action:'cancel'}),status(409));await mature(d.id);await disposal().act({id:d.id,version:d.version,action:'reconcile'});assert.equal((await root.verificationEvidence.findUniqueOrThrow({where:{id:e.id}})).state,'DISPOSED');assert.ok(objects.has(keep.path));
})
