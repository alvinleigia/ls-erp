/* eslint-disable @typescript-eslint/no-require-imports */
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Pool}=require('pg'),{PrismaClient}=require('@prisma/client'),sharp=require('sharp')
const {TenantPgAdapter}=require('../lib/tenant-pg-adapter.ts'),{runWithDatabaseActor}=require('../lib/database-actor.ts'),{authorizeBusinessOperation}=require('../platform/access/operation.ts')
const {createVerificationConfigurationService}=require('../platform/verification/configuration.ts'),{applicationVerificationCases,applicationVerificationEvidence,applicationVerificationSubmissions}=require('../application/verification/service.ts')
const {emptyVerificationPolicy}=require('../platform/verification/contracts.ts'),{privateFactsValid,verificationSubmissionSchema,verificationReviewSchema}=require('../platform/verification/submission-contracts.ts')
const {createApplicationCrmService}=require('../application/crm/service.ts'),{createAccessRoleService}=require('../platform/access/service.ts'),{createRecordSharingService}=require('../platform/access/sharing-service.ts'),{defaultRecordRules}=require('../platform/access/rules.ts')
require('../lib/logger.ts').logger.info=()=>{}
const url=new URL(process.env.CRM_TEST_DATABASE_URL||'http://invalid');if(!['127.0.0.1','localhost'].includes(url.hostname)||url.pathname!='/ls_salon_crm_test')throw Error('Disposable local database only.')
const tenant='submission_'+randomUUID(),foreign=tenant+'_foreign',clients=[],pools=[],objects=new Map()
function client(tenantId,bypass=false){const u=new URL(url);if(!bypass){u.username='crm_test_runtime';u.password=''}const pool=new Pool({connectionString:u.toString(),max:4});pools.push(pool);const db=new PrismaClient({adapter:new TenantPgAdapter(pool,{tenantId,bypass})});clients.push(db);return db}
const root=client(undefined,true),db=client(tenant),other=client(foreign),identity=u=>({tenantId:u.tenantId,userId:u.id}),status=n=>e=>e.status===n
const storage={async signUpload(){return'https://test.invalid'},async read(p){return objects.get(p)},async download(){return'https://test.invalid/download'},async remove(p){objects.delete(p)}}
const svc=u=>applicationVerificationSubmissions(db,identity(u)),cases=u=>applicationVerificationCases(db,identity(u)),crm=u=>createApplicationCrmService(db,identity(u)),subject=c=>({kind:'PERSON',id:c.id})
const fact=(code,type)=>({code,label:code,type,subjects:['PERSON','BUSINESS'],roles:['CUSTOMER','ADDITIONAL_CUSTOMER']}),definition={...emptyVerificationPolicy(),validityDays:365,facts:[fact('legal_name','TEXT'),fact('birth_date','DATE'),fact('email','EMAIL'),fact('country','COUNTRY')],documents:[{code:'identity',label:'Identity evidence',subjects:['PERSON','BUSINESS'],roles:['CUSTOMER','ADDITIONAL_CUSTOMER']}]}
const values=[{code:'legal_name',value:'Private Legal Person'},{code:'birth_date',value:'1990-02-28'},{code:'email',value:'private-person@example.test'},{code:'country',value:'India'}]
const collectorPermissions=['contacts.read','accounts.read','customerVerification.read','verificationUploads.read','verificationUploads.create','verificationSubmissions.read','verificationSubmissions.create']
const reviewerPermissions=['contacts.read','accounts.read','customerVerification.read','verificationSubmissions.read','verificationEvidence.read','verificationReviews.read','verificationReviews.approve','verificationReviews.cancel']
let admin,collector,reviewer,reader,foreignAdmin,person,second,business,caseId,fileId,profiles,first
async function grant(u,permissions,rules={}){const p=await profiles.save({name:randomUUID(),permissions:[...new Set(permissions)]}),a=await profiles.assignment(u.id);await profiles.assign(u.id,{version:a.accessPolicy.version,roleIds:[p.id],rules:{...defaultRecordRules(),'contacts.read':'ALL','accounts.read':'ALL',...rules}});return p}
async function publish(patch={}){const c=createVerificationConfigurationService(db,identity(admin)),current=await c.get(),data={version:current.version,definition:{...definition,...patch}},preview=await c.preview(data);return c.publish({...data,previewHash:preview.previewHash})}
async function upload(user,caseId){const png=await sharp({create:{width:10,height:10,channels:3,background:'blue'}}).png().toBuffer(),s=applicationVerificationEvidence(db,identity(user),storage),r=await s.reserve({caseId,documentCode:'identity',filename:'private-proof.png',bytes:png.length,contentType:'image/png'}),row=await root.verificationEvidence.findUniqueOrThrow({where:{id:r.id}});objects.set(row.path,png);await s.finalize(r.id);return r.id}
const input=(patch={})=>({caseId,version:0,policyVersion:1,role:'CUSTOMER',facts:values,evidenceIds:[fileId],...patch})
const review=(submissionId,patch={})=>({submissionId,version:1,reviewVersion:0,decision:'APPROVED',reviewed:true,...patch})
const direct=(u,work)=>runWithDatabaseActor(u.id,()=>db.$transaction(async tx=>{await authorizeBusinessOperation(tx,identity(u),'customerVerification.read');return work(tx)}))
before(async()=>{
 await root.tenant.createMany({data:[tenant,foreign].map(id=>({id,name:id,slug:id}))})
 for(const t of [tenant,foreign])await root.tenantModule.createMany({data:['crm','customerVerification'].map(key=>({tenantId:t,key,allowed:true,enabled:true}))})
 admin=await root.user.create({data:{tenantId:tenant,role:'ADMIN',email:randomUUID()+'@example.test'}});collector=await root.user.create({data:{tenantId:tenant,role:'STAFF',email:randomUUID()+'@example.test'}});reviewer=await root.user.create({data:{tenantId:tenant,role:'MANAGER',email:randomUUID()+'@example.test'}});reader=await root.user.create({data:{tenantId:tenant,role:'STAFF',email:randomUUID()+'@example.test'}});foreignAdmin=await root.user.create({data:{tenantId:foreign,role:'ADMIN',email:randomUUID()+'@example.test'}})
 profiles=createAccessRoleService(db,identity(admin));await grant(collector,collectorPermissions);await grant(reviewer,reviewerPermissions);await grant(reader,['contacts.read','customerVerification.read'])
 person=await crm(admin).createContact({name:'Submission person'});second=await crm(admin).createContact({name:'Separate applicant'});business=await crm(admin).createAccount({name:'Verification business'})
 await publish();caseId=(await cases(admin).start(subject(person))).case.id;fileId=await upload(collector,caseId)
})
after(async()=>{await Promise.all(clients.map(c=>c.$disconnect()));await Promise.all(pools.map(p=>p.end()))})

test('typed private facts match native validation for unknown/duplicate/missing fields and invalid formats',async()=>{
 const malformed=[values.slice(1),[...values,values[0]],values.map(f=>f.code==='birth_date'?{...f,value:'2025-02-30'}:f),values.map(f=>f.code==='country'?{...f,value:'Unknownland'}:f),values.map(f=>f.code==='email'?{...f,value:'invalid@'}:f),values.map(f=>f.code==='legal_name'?{...f,code:'unexpected'}:f),values.map(f=>({...f,extra:true}))]
 for(const facts of [values,...malformed]){const [r]=await root.$queryRaw`SELECT app.verification_facts_valid(${JSON.stringify(definition)}::jsonb,'PERSON','CUSTOMER',${JSON.stringify(facts)}::jsonb) valid`;assert.equal(r.valid,verificationSubmissionSchema.safeParse(input({facts})).success&&privateFactsValid(definition,'PERSON','CUSTOMER',facts))}
 await assert.rejects(svc(collector).submit(input({facts:malformed[2]})),status(400));assert.equal(await root.verificationSubmission.count({where:{tenantId:tenant}}),0)
 assert.equal(verificationReviewSchema.safeParse(review('id',{reviewed:false})).success,false)
})
test('ordinary case readers cannot read facts, private history, evidence, or submit; manager role grants no implicit review',async()=>{
 await assert.rejects(svc(reader).view(subject(person)),status(403));await assert.rejects(svc(reader).submit(input()),status(403))
 assert.equal((await direct(reader,tx=>tx.verificationSubmission.findMany())).length,0)
 await assert.rejects(svc(collector).review(review('missing')),status(403))
})
test('collector without evidence download permission freezes typed facts and own accepted evidence',async()=>{
 const view=await svc(collector).view(subject(person));assert.equal(view.evidence[0].id,fileId);assert.equal(view.canReadEvidence,false)
 await assert.rejects(svc(collector).submit(input({evidenceIds:[]})),status(400))
 first=await svc(collector).submit(input());assert.equal(first.status,'UNDER_REVIEW')
 const read=await svc(reviewer).view(subject(person));assert.deepEqual(read.submission.facts,values);assert.deepEqual(read.submission.evidenceIds,[fileId]);assert.equal(read.status,'UNDER_REVIEW')
 assert.equal((await cases(admin).get(subject(person))).status,'UNDER_REVIEW')
 await assert.rejects(svc(collector).submit(input()),status(409))
})
test('submission facts and file selections are immutable; files cannot be added in a later transaction',async()=>{
 await assert.rejects(root.verificationSubmission.update({where:{id:first.id},data:{facts:[]}}),/immutable/);await assert.rejects(root.verificationSubmission.delete({where:{id:first.id}}),/immutable/)
 const extra=await upload(collector,caseId)
 await assert.rejects(direct(collector,tx=>tx.verificationSubmissionEvidence.create({data:{tenantId:tenant,caseId,submissionId:first.id,evidenceId:extra}})),/while submitting/)
 await assert.rejects(root.verificationSubmissionEvidence.deleteMany({where:{submissionId:first.id}}),/immutable/)
})
test('native deferred guard rejects omitted evidence and composite references reject another case',async()=>{
 const secondCase=(await cases(admin).start(subject(second))).case.id,secondFile=await upload(collector,secondCase)
 const data={id:randomUUID(),tenantId:tenant,caseId:secondCase,number:1,policyVersion:1,role:'CUSTOMER',facts:values,submittedByUserId:collector.id}
 await assert.rejects(direct(collector,tx=>tx.verificationSubmission.create({data})),/required evidence/)
 await assert.rejects(direct(collector,async tx=>{await tx.verificationSubmission.create({data});await tx.verificationSubmissionEvidence.create({data:{tenantId:tenant,caseId:secondCase,submissionId:data.id,evidenceId:fileId}})}),/accepted accessible evidence|foreign key/)
 assert.equal(await root.verificationSubmission.count({where:{caseId:secondCase}}),0);assert.ok(secondFile)
})
test('self-approval is denied to submitter even with all grants and to a separate evidence uploader, including administrators',async()=>{
 await grant(collector,[...collectorPermissions,...reviewerPermissions]);await assert.rejects(svc(collector).review(review(first.id)),status(403));await grant(collector,collectorPermissions)
 const owned=(await cases(admin).start({kind:'BUSINESS',id:business.id})).case.id,adminFile=await upload(admin,owned)
 const s=await svc(admin).submit(input({caseId:owned,evidenceIds:[adminFile]}));await assert.rejects(svc(admin).review(review(s.id)),status(403))
 await assert.rejects(direct(admin,tx=>tx.verificationReview.create({data:{id:randomUUID(),tenantId:tenant,submissionId:s.id,number:1,decision:'APPROVED',reviewedByUserId:admin.id}})),/different reviewer/)
 const secondCase=(await cases(admin).get(subject(second))).case.id,otherFile=await upload(admin,secondCase)
 await grant(collector,[...collectorPermissions,'verificationEvidence.read']);const other=await svc(collector).submit(input({caseId:secondCase,evidenceIds:[otherFile]}));await assert.rejects(svc(admin).review(review(other.id)),status(403));await grant(collector,collectorPermissions)
})
test('independent review requests corrections; a new reasoned revision is mandatory and concurrent submissions accept exactly one',async()=>{
 await svc(reviewer).review(review(first.id,{decision:'CHANGES_REQUIRED',reason:'Correct the private fact'}));assert.equal((await svc(reviewer).view(subject(person))).status,'CHANGES_REQUIRED')
 await assert.rejects(svc(reviewer).review(review(first.id)),status(409))
 await assert.rejects(svc(collector).submit(input({version:1})),/Explain why/)
 const results=await Promise.allSettled([1,2].map(()=>svc(collector).submit(input({version:1,reason:'Corrected facts'}))))
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.status,409)
 const view=await svc(reviewer).view(subject(person));assert.equal(view.submission.number,2);assert.equal(view.status,'UNDER_REVIEW');assert.equal(view.history.length,2)
 await assert.rejects(svc(reviewer).review(review(first.id,{version:2})),status(409))
})
test('concurrent independent approval creates one immutable decision, with server-controlled expiry',async()=>{
 const view=await svc(reviewer).view(subject(person)),data=review(view.submission.id,{version:2}),results=await Promise.allSettled([1,2].map(()=>svc(reviewer).review(data)))
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.status,409)
 const verified=await svc(reviewer).view(subject(person));assert.equal(verified.status,'VERIFIED')
 const row=await root.verificationReview.findFirstOrThrow({where:{submissionId:view.submission.id}});assert.equal(row.validUntil-row.reviewedAt,365*86400_000)
 await assert.rejects(root.verificationReview.update({where:{id:row.id},data:{decision:'REVOKED'}}),/immutable/);await assert.rejects(root.verificationReview.delete({where:{id:row.id}}),/immutable/)
})
test('approval revocation requires its separate grant and reason; the earlier decision is retained and never revived',async()=>{
 const v=await svc(reviewer).view(subject(person)),data=review(v.submission.id,{version:2,reviewVersion:1,decision:'REVOKED',reason:'Evidence requires a fresh review'})
 await grant(reviewer,reviewerPermissions.filter(p=>p!=='verificationReviews.cancel'));await assert.rejects(svc(reviewer).review(data),status(403));await grant(reviewer,reviewerPermissions)
 await assert.rejects(svc(reviewer).review({...data,reason:undefined}),/Provide a reason/);await svc(reviewer).review(data)
 assert.equal((await cases(admin).get(subject(person))).status,'REVOKED');assert.equal(await root.verificationReview.count({where:{submissionId:v.submission.id}}),2)
 await assert.rejects(svc(reviewer).review({...data,reviewVersion:2,decision:'APPROVED'}),status(409))
})
test('policy changes require fresh submission and do not rewrite old facts or allow approval under outdated requirements',async()=>{
 const pending=await svc(collector).submit(input({version:2,reason:'Updated evidence review'}));await publish({validityDays:30})
 await assert.rejects(svc(reviewer).review(review(pending.id,{version:3})),status(409))
 const old=await svc(reviewer).view(subject(person));assert.equal(old.revisionPolicy.version,1);assert.equal(old.policy.version,2)
 await svc(collector).submit(input({version:3,policyVersion:2,reason:'Reviewed current requirements'}));const latest=await svc(reviewer).view(subject(person));await svc(reviewer).review(review(latest.submission.id,{version:4}))
 await publish();assert.equal((await cases(admin).get(subject(person))).status,'REVIEW_REQUIRED')
 const retained=await root.verificationSubmission.findUniqueOrThrow({where:{id:first.id}});assert.deepEqual(retained.facts,values);assert.equal(retained.policyVersion,1)
})
test('source Restricted sharing, module disablement and revoked grants apply to private reads and reviews',async()=>{
 await grant(reviewer,reviewerPermissions,{'contacts.read':'OWN'});await assert.rejects(svc(reviewer).view(subject(person)),status(404));assert.equal((await direct(reviewer,tx=>tx.verificationSubmission.findMany())).filter(s=>s.caseId===caseId).length,0)
 const sharing=createRecordSharingService(db,identity(admin)),s=await sharing.get('contacts',person.id);await sharing.save('contacts',person.id,{version:s.version,restricted:true,grants:[{kind:'USER',id:reviewer.id,level:'READ'}]});assert.equal((await svc(reviewer).view(subject(person))).submission.number,4)
 const changed=await sharing.get('contacts',person.id);await sharing.save('contacts',person.id,{version:changed.version,restricted:true,grants:[]});await assert.rejects(svc(reviewer).view(subject(person)),status(404))
 await root.tenantModule.update({where:{tenantId_key:{tenantId:tenant,key:'customerVerification'}},data:{enabled:false}});await assert.rejects(svc(admin).view(subject(person)),status(403));await root.tenantModule.update({where:{tenantId_key:{tenantId:tenant,key:'customerVerification'}},data:{enabled:true}})
 await grant(collector,collectorPermissions.filter(p=>!p.startsWith('verificationSubmissions')));await assert.rejects(svc(collector).view(subject(second)),status(403))
})
test('foreign and external logins cannot enumerate or review private submissions',async()=>{
 await assert.rejects(applicationVerificationSubmissions(other,identity(foreignAdmin)).review(review(first.id)),status(404))
 const partner=await root.externalCollaborator.create({data:{tenantId:tenant,name:'Outside actor',code:'PRIVATE',supervisorUserId:admin.id}}),u=await root.user.create({data:{tenantId:tenant,role:'STAFF',email:randomUUID()+'@example.test',collaboratorId:partner.id}});await grant(u,[...collectorPermissions,...reviewerPermissions])
 await assert.rejects(svc(u).view(subject(second)),status(403));assert.equal((await runWithDatabaseActor(u.id,()=>db.verificationSubmission.findMany())).length,0)
})
test('general audit metadata contains only identifiers, counts and states, never private facts or correction/review reasons',async()=>{
 const events=await root.auditLog.findMany({where:{tenantId:tenant,event:{in:['customerVerification.submitted','customerVerification.reviewed']}}});assert.ok(events.length>=10)
 for(const e of events)assert.equal(/Private Legal|private-person|1990-02|India|Corrected facts|Correct the private|private-proof|sha256|\/cases\//.test(JSON.stringify([e.before,e.after,e.metadata])),false)
})

test('audit failure rolls back both submissions and independent decisions',async()=>{
 const fresh=await crm(admin).createContact({name:'Audit rollback subject'}),freshCase=(await cases(admin).start(subject(fresh))).case.id,freshFile=await upload(admin,freshCase)
 const failing=new Proxy(db,{get(target,key){if(key==='$transaction')return(fn,options)=>target.$transaction(tx=>fn(new Proxy(tx,{get(t,k){if(k==='auditLog')return new Proxy(t.auditLog,{get(a,p){return p==='createMany'?async()=>{throw Error('Audit unavailable')}:Reflect.get(a,p)}});return Reflect.get(t,k)}})),options);return Reflect.get(target,key)}})
 await assert.rejects(applicationVerificationSubmissions(failing,identity(admin)).submit(input({caseId:freshCase,evidenceIds:[freshFile],policyVersion:3})),/Audit unavailable/)
 assert.equal(await root.verificationSubmission.count({where:{caseId:freshCase}}),0)
 const row=await svc(admin).submit(input({caseId:freshCase,evidenceIds:[freshFile],policyVersion:3}));await grant(reviewer,reviewerPermissions)
 await assert.rejects(applicationVerificationSubmissions(failing,identity(reviewer)).review(review(row.id)),/Audit unavailable/)
 assert.equal(await root.verificationReview.count({where:{submissionId:row.id}}),0)
})

test('native rejected private rows are sanitised before the general API logger receives them',async()=>{
 const fresh=await crm(admin).createContact({name:'Native error subject'}),freshCase=(await cases(admin).start(subject(fresh))).case.id,freshFile=await upload(admin,freshCase)
 const failing=new Proxy(db,{get(target,key){if(key==='$transaction')return(fn,options)=>target.$transaction(tx=>fn(new Proxy(tx,{get(t,k){if(k==='verificationSubmission')return new Proxy(t.verificationSubmission,{get(a,p){return p==='create'?(args)=>a.create({...args,data:{...args.data,policyVersion:999}}):Reflect.get(a,p)}});return Reflect.get(t,k)}})),options);return Reflect.get(target,key)}})
 await assert.rejects(applicationVerificationSubmissions(failing,identity(admin)).submit(input({caseId:freshCase,evidenceIds:[freshFile],policyVersion:3})),e=>e.status===409&&!/Private Legal|private-person|1990|India|facts/.test(e.message))
 assert.equal(await root.verificationSubmission.count({where:{caseId:freshCase}}),0)
})
