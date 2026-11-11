/* eslint-disable @typescript-eslint/no-require-imports */
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Pool}=require('pg'),{PrismaClient}=require('@prisma/client'),sharp=require('sharp')
const {TenantPgAdapter}=require('../lib/tenant-pg-adapter.ts'),{runWithDatabaseActor}=require('../lib/database-actor.ts'),{authorizeBusinessOperation}=require('../platform/access/operation.ts')
const {createVerificationConfigurationService}=require('../platform/verification/configuration.ts'),{applicationVerificationCases,applicationVerificationEvidence}=require('../application/verification/service.ts')
const {emptyVerificationPolicy}=require('../platform/verification/contracts.ts'),{createApplicationCrmService}=require('../application/crm/service.ts'),{createAccessRoleService}=require('../platform/access/service.ts'),{createRecordSharingService}=require('../platform/access/sharing-service.ts'),{defaultRecordRules}=require('../platform/access/rules.ts')
require('../lib/logger.ts').logger.info=()=>{}
const url=new URL(process.env.CRM_TEST_DATABASE_URL||'http://invalid');if(!['127.0.0.1','localhost'].includes(url.hostname)||url.pathname!='/ls_salon_crm_test')throw Error('Disposable local database only.')
const tenant='evidence_'+randomUUID(),foreign=tenant+'_other',clients=[],pools=[],objects=new Map(),calls=[]
function client(tenantId,bypass=false){const u=new URL(url);if(!bypass){u.username='crm_test_runtime';u.password=''}const pool=new Pool({connectionString:u.toString(),max:4});pools.push(pool);const db=new PrismaClient({adapter:new TenantPgAdapter(pool,{tenantId,bypass})});clients.push(db);return db}
const root=client(undefined,true),db=client(tenant),other=client(foreign),identity=u=>({tenantId:u.tenantId,userId:u.id}),status=n=>e=>e.status===n
const storage={async signUpload(path){calls.push(['sign',path]);return 'https://test.invalid/'+path},async read(path){calls.push(['read',path]);if(!objects.has(path))throw Object.assign(Error('Storage unavailable'),{status:503});return objects.get(path)},async download(path){calls.push(['download',path]);return 'https://test.invalid/download/'+path},async remove(path){calls.push(['remove',path]);objects.delete(path)}}
const service=(user,transport=storage,database=db)=>applicationVerificationEvidence(database,identity(user),transport),crm=u=>createApplicationCrmService(db,identity(u))
let admin,collector,reader,foreignAdmin,person,business,caseId,businessCase,png,profiles,accepted,acceptedPath,abandoned
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
test('collectors see document choices without policy directory access and cannot download pending files',async()=>{
 const view=await service(collector).view({kind:'PERSON',id:person.id});assert.equal(view.documents[0].code,'identity');assert.equal(view.canReadEvidence,false);assert.equal(view.canUpload,true)
 const {reservation,row}=await stage();assert.equal(row.state,'PENDING');assert.equal((await service(collector).view({kind:'PERSON',id:person.id})).pending.length,1)
 await assert.rejects(service(collector).download(reservation.id),status(403));await assert.rejects(service(reader).download(reservation.id),status(404))
 accepted=reservation.id;acceptedPath=row.path
})
test('finalisation validates original bytes, is idempotent and never marks a customer verified',async()=>{
 const [a,b]=await Promise.all([service(collector).finalize(accepted),service(collector).finalize(accepted)]);assert.equal(a.state,'READY');assert.equal(b.id,a.id)
 const row=await root.verificationEvidence.findUniqueOrThrow({where:{id:a.id}});assert.match(row.sha256,/^[a-f0-9]{64}$/);assert.deepEqual(objects.get(row.path),png)
 assert.equal((await service(collector).view({kind:'PERSON',id:person.id})).status,'IN_PROGRESS')
 assert.equal((await service(collector).view({kind:'PERSON',id:person.id})).evidence.length,0)
 assert.equal((await service(reader).view({kind:'PERSON',id:person.id})).evidence.length,1)
})
test('private evidence Read is separate from collection and downloads verify integrity',async()=>{
 const result=await service(reader).download(accepted);assert.ok(result.url.startsWith('https://test.invalid/download/'))
 await assert.rejects(service(reader).reserve(input()),status(403));await assert.rejects(service(collector).download(accepted),status(403))
 objects.set(acceptedPath,Buffer.from('tampered'));await assert.rejects(service(reader).download(accepted),status(409));objects.set(acceptedPath,png)
})
test('foreign tenants and external identities cannot retrieve, finalise or enumerate private evidence',async()=>{
 const count=calls.length,foreignService=applicationVerificationEvidence(other,identity(foreignAdmin),storage)
 await assert.rejects(foreignService.download(accepted),status(404));await assert.rejects(foreignService.finalize(accepted),status(404));assert.equal(calls.length,count)
 const partner=await root.externalCollaborator.create({data:{tenantId:tenant,name:'Synthetic outside collector',code:'OUTSIDE',supervisorUserId:admin.id}}),user=await root.user.create({data:{tenantId:tenant,role:'STAFF',email:randomUUID()+'@example.test',collaboratorId:partner.id}})
 await grants(user,['contacts.read','accounts.read','customerVerification.read','verificationEvidence.read','verificationUploads.read','verificationUploads.create'])
 await assert.rejects(service(user).download(accepted),status(403));await assert.rejects(service(user).reserve(input()),status(403))
 assert.equal((await runWithDatabaseActor(user.id,()=>db.verificationEvidence.findMany())).length,0)
})
test('download authority is checked again after storage access and every delivered link has an audit entry',async()=>{
 const before=await root.auditLog.count({where:{tenantId:tenant,event:'customerVerification.evidenceDownloaded'}})
 await service(reader).download(accepted)
 assert.equal(await root.auditLog.count({where:{tenantId:tenant,event:'customerVerification.evidenceDownloaded'}}),before+1)
 await assert.rejects(service(reader,{...storage,async read(path){await grants(reader,['contacts.read','accounts.read','customerVerification.read']);return storage.read(path)}}).download(accepted),status(403))
 assert.equal(await root.auditLog.count({where:{tenantId:tenant,event:'customerVerification.evidenceDownloaded'}}),before+1)
 await grants(reader,['contacts.read','accounts.read','customerVerification.read','verificationEvidence.read'])
})
test('native failures are sanitised before reaching the general API logger',async()=>{
 const invalid=new Proxy(db,{get(target,key){if(key==='$transaction')return(fn,options)=>target.$transaction(tx=>fn(new Proxy(tx,{get(t,k){if(k==='verificationEvidence')return new Proxy(t.verificationEvidence,{get(d,p){return p==='create'?(args)=>d.create({...args,data:{...args.data,uploadedByUserId:reader.id}}):Reflect.get(d,p)}});return Reflect.get(t,k)}})),options);return Reflect.get(target,key)}})
 await assert.rejects(service(collector,storage,invalid).reserve(input()),e=>e.status===409&&!/proof\.png|\/cases\/|sha256/.test(e.message))
})
test('spoofed or mismatched files are abandoned and cannot be accepted or downloaded',async()=>{
 const wrong=await stage(collector,{},Buffer.from('not a PNG'));await assert.rejects(service(collector).finalize(wrong.reservation.id),status(400))
 assert.equal((await root.verificationEvidence.findUniqueOrThrow({where:{id:wrong.reservation.id}})).state,'ABANDONED')
 await assert.rejects(service(reader).download(wrong.reservation.id),status(404));abandoned=wrong.row
 const mimetype=await stage(collector,{contentType:'image/jpeg'});await assert.rejects(service(collector).finalize(mimetype.reservation.id),status(400))
})
test('storage failure leaves a resumable pending upload; cancellation never deletes accepted evidence',async()=>{
 const {reservation,row}=await stage();objects.delete(row.path);await assert.rejects(service(collector).finalize(reservation.id),/Storage unavailable/)
 assert.equal((await root.verificationEvidence.findUniqueOrThrow({where:{id:row.id}})).state,'PENDING')
 objects.set(row.path,png);assert.equal((await service(collector).finalize(row.id)).state,'READY')
 await assert.rejects(service(collector).cancel(row.id),status(409))
 const pending=await stage();await service(collector).cancel(pending.row.id);await assert.rejects(service(collector).finalize(pending.row.id),status(409))
})
test('failed signing is retained for expiry cleanup without leaking an upload URL',async()=>{
 await assert.rejects(service(collector,{...storage,async signUpload(){throw Error('Signing unavailable')}}).reserve(input()),/Signing unavailable/)
 const last=await root.verificationEvidence.findFirstOrThrow({where:{tenantId:tenant},orderBy:{createdAt:'desc'}});assert.equal(last.state,'ABANDONED')
})
test('policy changes, archived owners and grant revocation are checked again after upload I/O',async()=>{
 const staged=await stage(),c=createVerificationConfigurationService(db,identity(admin)),current=await c.get(),preview=await c.preview({version:current.version,definition});await c.publish({version:current.version,definition,previewHash:preview.previewHash})
 await assert.rejects(service(collector).finalize(staged.row.id),status(409));await service(collector).cancel(staged.row.id)
 const archived=await stage();await root.crmContact.update({where:{id:person.id},data:{archived:true,version:{increment:1}}});await assert.rejects(service(collector).finalize(archived.row.id),status(409));await root.crmContact.update({where:{id:person.id},data:{archived:false,version:{increment:1}}})
 const revoked=await stage();await assert.rejects(service(collector,{...storage,async read(path){await grants(collector,['contacts.read','accounts.read','customerVerification.read','verificationUploads.read']);return storage.read(path)}}).finalize(revoked.row.id),status(403))
 assert.equal((await root.verificationEvidence.findUniqueOrThrow({where:{id:revoked.row.id}})).state,'PENDING')
 await grants(collector,['contacts.read','accounts.read','customerVerification.read','verificationUploads.read','verificationUploads.create','verificationUploads.cancel'])
})
test('case scope, cross-tenant references and native immutable identity guards reject bypasses',async()=>{
 const sharing=createRecordSharingService(db,identity(admin)),state=await sharing.get('contacts',person.id);await sharing.save('contacts',person.id,{version:state.version,restricted:true,grants:[]})
 await assert.rejects(service(reader).download(accepted),status(404));assert.equal((await direct(reader,tx=>tx.verificationEvidence.findMany())).length,0)
 const s=await sharing.get('contacts',person.id);await sharing.save('contacts',person.id,{version:s.version,restricted:false,grants:[]})
 await assert.rejects(service(collector).reserve(input({caseId:'foreign-case'})),status(404))
 await assert.rejects(root.verificationEvidence.update({where:{id:accepted},data:{path:'public/other.png'}}),/immutable/)
 await assert.rejects(root.verificationEvidence.delete({where:{id:accepted}}),/Retain/)
 await assert.rejects(direct(collector,tx=>tx.verificationEvidence.updateMany({where:{id:accepted},data:{bytes:999}})),/immutable/)
})
test('audit failure rolls finalisation back; no private names, paths or checksums enter general audit',async()=>{
 const staged=await stage(),failing=new Proxy(db,{get(target,key){if(key==='$transaction')return (fn,options)=>target.$transaction(tx=>fn(new Proxy(tx,{get(t,k){if(k==='auditLog')return new Proxy(t.auditLog,{get(a,p){return p==='createMany'?async()=>{throw Error('Audit unavailable')}:Reflect.get(a,p)}});return Reflect.get(t,k)}})),options);return Reflect.get(target,key)}})
 await assert.rejects(service(collector,storage,failing).finalize(staged.row.id),/Audit unavailable/)
 assert.equal((await root.verificationEvidence.findUniqueOrThrow({where:{id:staged.row.id}})).state,'PENDING')
 const events=await root.auditLog.findMany({where:{tenantId:tenant,event:{startsWith:'customerVerification.'}}})
 for(const event of events)assert.equal(/proof\.png|\/cases\/|sha256|image\/png|filename|signedUrl/i.test(JSON.stringify([event.before,event.after,event.metadata])),false)
})
test('expired cleanup is delayed, bounded, retryable and excludes accepted originals',async()=>{
 assert.deepEqual(await service(admin).cleanup(),{cleaned:0});await assert.rejects(service(collector).cleanup(),status(403))
 // Advance only this disposable fixture's deadline; production metadata remains immutable.
 await root.$transaction(async tx=>{await tx.$executeRawUnsafe('ALTER TABLE "VerificationEvidence" DISABLE TRIGGER verification_evidence_write');await tx.verificationEvidence.update({where:{id:abandoned.id},data:{expiresAt:new Date(Date.now()-1_000)}});await tx.$executeRawUnsafe('ALTER TABLE "VerificationEvidence" ENABLE TRIGGER verification_evidence_write')})
 await assert.rejects(service(admin,{...storage,async remove(){const expired=await root.verificationEvidence.findUniqueOrThrow({where:{id:abandoned.id}});assert.equal(expired.state,'ABANDONED');assert.equal(expired.failureCode,'EXPIRED');throw Error('Storage unavailable')}}).cleanup(),/Storage unavailable/)
 assert.equal((await root.verificationEvidence.findUniqueOrThrow({where:{id:abandoned.id}})).cleanedAt,null)
 assert.deepEqual(await service(admin).cleanup(),{cleaned:1});assert.equal(objects.has(abandoned.path),false);assert.ok(objects.has(acceptedPath))
})
test('business evidence uses the same engine and capacity limits include unaccepted reservations',async()=>{
 const staged=await stage(collector,{caseId:businessCase});assert.equal((await service(collector).finalize(staged.row.id)).state,'READY')
 for(let i=1;i<20;i++)await service(collector).reserve(input({caseId:businessCase}))
 await assert.rejects(service(collector).reserve(input({caseId:businessCase})),status(409))
})
