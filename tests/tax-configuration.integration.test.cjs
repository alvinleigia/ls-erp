/* eslint-disable @typescript-eslint/no-require-imports */
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Pool}=require('pg'),{PrismaClient}=require('@prisma/client')
const {TenantPgAdapter}=require('../lib/tenant-pg-adapter.ts'),{runWithDatabaseActor}=require('../lib/database-actor.ts'),{fixtureUser}=require('./helpers/access-fixtures.cjs'),{createTaxConfigurationService}=require('../platform/tax/service.ts'),{gstinCheckDigit}=require('../platform/tax/localizations/india.ts')
require('../lib/logger.ts').logger.info=()=>{}
const url=new URL(process.env.CRM_TEST_DATABASE_URL||'http://invalid');if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!='/ls_salon_crm_test')throw Error('Disposable localhost database only.')
const tenant='tax_'+randomUUID(),other='tax_'+randomUUID(),pools=[],clients=[]
function client(tenantId,bypass=false){const u=new URL(url);if(!bypass){u.username='crm_test_runtime';u.password=''}const pool=new Pool({connectionString:u.toString(),max:5});pools.push(pool);const c=new PrismaClient({adapter:new TenantPgAdapter(pool,{tenantId,bypass})});clients.push(c);return c}
const root=client(undefined,true),db=client(tenant),foreignDb=client(other),status=n=>e=>e.status===n
let admin,staff,manager,foreign,company,second,office,rates,s,foreignService
const identity=u=>({tenantId:u.tenantId,userId:u.id}),service=(u,connection=db)=>createTaxConfigurationService(connection,identity(u))
const body=(extra={})=>({name:'QA Shared service',scheme:'IN_GST',enabled:true,supplyKind:'SERVICES',treatment:'TAXABLE',classificationKind:'SAC',classificationCode:'998311',basisReference:'QA synthetic test treatment',priceBasis:'EXCLUSIVE',zeroRatedMode:'NOT_APPLICABLE',variants:[{key:'INTRA_STATE',components:[{code:'CGST',rateId:rates[0].id},{code:'SGST',rateId:rates[1].id}]},{key:'INTER_STATE',components:[{code:'IGST',rateId:rates[2].id}]}],...extra})
const publish=(extra={})=>s.publishProfile({companyId:company.id,code:'QA-'+randomUUID().slice(0,8),version:0,reviewed:true,body:body(),...extra})
const regInput=(extra={})=>({companyId:company.id,scheme:'IN_GST',registrationNumber:'27ABCDE1234F1Z'+gstinCheckDigit('27ABCDE1234F1Z'),label:'QA synthetic registration',legalName:'QA Shared Industries',addressLine1:'QA synthetic street',addressLine2:'',city:'Pune',postalCode:'411001',category:'REGULAR',eInvoicePolicy:'UNASSESSED',effectiveFrom:'2026-01-01',effectiveTo:null,archived:false,reviewed:true,...extra})
const updateReg=(r,extra={})=>{const {companyId,scheme,registrationNumber,...d}=regInput();void companyId;void scheme;void registrationNumber;return {...d,version:r.version,...extra}}
before(async()=>{
 await root.tenant.createMany({data:[tenant,other].map(id=>({id,slug:id,name:'QA tax configuration'}))})
 const user=(tenantId,role)=>fixtureUser(root,{data:{tenantId,role,name:'QA '+role,email:randomUUID()+'@example.test'}})
 admin=await user(tenant,'ADMIN');staff=await user(tenant,'STAFF');manager=await user(tenant,'MANAGER');foreign=await user(other,'ADMIN')
 company=await root.businessCompany.findFirstOrThrow({where:{tenantId:tenant}});second=await root.businessCompany.create({data:{tenantId:tenant,name:'QA Second company',code:'QA-SECOND'}});office=await root.businessOffice.findFirstOrThrow({where:{tenantId:tenant,companyId:company.id}})
 rates=await Promise.all([9,9,18].map((percent,i)=>root.tax.create({data:{tenantId:tenant,name:'QA synthetic component '+i,percent}})))
 s=service(admin);foreignService=service(foreign,foreignDb)
})
after(async()=>{await Promise.all(clients.map(c=>c.$disconnect()));await Promise.all(pools.map(p=>p.end()))})
test('registration review, immutable identity, optimistic versions and same-company office bindings',async()=>{
 const r=await s.createRegistration(regInput());assert.equal(r.regionCode,'27');assert.equal(r.eInvoicePolicy,'UNASSESSED');assert.equal((await s.getRegistration(r.id)).history.length,1)
 await s.mapOffice(office.id,{version:0,registrationId:r.id});await assert.rejects(s.updateRegistration(r.id,updateReg(r,{archived:true})),status(409));await assert.rejects(s.mapOffice(office.id,{version:0,registrationId:null}),status(409))
 const otherReg=await s.createRegistration(regInput({companyId:second.id,registrationNumber:'29ABCDE1234F1Z'+gstinCheckDigit('29ABCDE1234F1Z')}));await assert.rejects(s.mapOffice(office.id,{version:1,registrationId:otherReg.id}),status(400))
 await s.mapOffice(office.id,{version:1,registrationId:null});const edited=await s.updateRegistration(r.id,updateReg(r,{legalName:'QA Reviewed legal name'}));assert.equal(edited.version,2);await assert.rejects(s.updateRegistration(r.id,updateReg(r)),status(409))
 await assert.rejects(root.companyTaxRegistration.update({where:{tenantId_id:{tenantId:tenant,id:r.id}},data:{registrationNumber:otherReg.registrationNumber,version:{increment:1}}}),/identity|immutable/i)
 await assert.rejects(root.companyTaxRegistrationRevision.update({where:{tenantId_registrationId_version:{tenantId:tenant,registrationId:r.id,version:1}},data:{actorId:staff.id}}),/immutable/i)
 const archived=await s.updateRegistration(r.id,updateReg(edited,{archived:true}));assert(archived.archived);assert.equal((await s.getRegistration(r.id)).history.length,3)
 await assert.rejects(s.mapOffice(office.id,{version:2,registrationId:r.id}),status(400))
})
test('profile versions freeze exact current source rates; later source changes are visible without rewriting history',async()=>{
 const p=await publish(),first=await s.getProfile(p.id);assert.equal(first.version,1);assert(!first.current.sourceRatesChanged);assert.equal(first.current.snapshot.variants[0].components[0].percent,'18')
 const original=first.current.snapshot;await root.tax.update({where:{id:rates[2].id},data:{percent:20}});assert((await s.getProfile(p.id)).current.sourceRatesChanged);assert.deepEqual((await s.getProfile(p.id)).current.snapshot,original)
 const next=await publish({id:p.id,code:p.code,version:1,body:body({name:'QA reviewed updated supply'})});assert.equal(next.version,2);assert.equal((await s.getProfile(p.id)).history.length,2);assert.equal((await s.getProfile(p.id)).current.snapshot.variants[0].components[0].percent,'20')
 await assert.rejects(publish({id:p.id,code:p.code,version:1}),status(409));await assert.rejects(root.tax.delete({where:{id:rates[2].id}}),e=>e.code==='P2003')
 await root.tax.update({where:{id:rates[2].id},data:{isActive:false}});await assert.rejects(publish(),status(400));await publish({id:p.id,code:p.code,version:2,body:body({enabled:false})});await root.tax.update({where:{id:rates[2].id},data:{isActive:true,percent:18}})
 await assert.rejects(root.companyTaxProfileVersion.update({where:{tenantId_profileId_version:{tenantId:tenant,profileId:p.id,version:1}},data:{actorId:staff.id}}),/immutable/i)
})
test('missing, foreign and inconsistent rates reject atomically; business-specific labels never imply treatment',async()=>{
 const foreignRate=await root.tax.create({data:{tenantId:other,name:'QA foreign rate',percent:18}})
 await assert.rejects(publish({body:body({variants:[{key:'INTER_STATE',components:[{code:'IGST',rateId:foreignRate.id}]}]})}),status(400))
 for(const b of [body({variants:[{key:'INTER_STATE',components:[{code:'IGST',rateId:'missing'}]}]}),body({variants:[{key:'INTRA_STATE',components:[{code:'CGST',rateId:rates[0].id},{code:'SGST',rateId:rates[2].id}]}]})])await assert.rejects(publish({body:b}),status(400))
 const none=body({name:'QA Property sale outside GST - explicit reviewed basis',supplyKind:'OTHER',treatment:'NON_GST',classificationKind:'NONE',classificationCode:'',variants:[]});const p=await publish({body:none});assert.equal((await s.getProfile(p.id)).current.snapshot.treatment,'NON_GST')
 await assert.rejects(foreignService.getProfile(p.id),status(404));assert.equal((await foreignService.listProfiles({companyId:company.id})).total,0)
})
test('configuration pages remain bounded; history paging never substitutes the current version',async()=>{
 const p=await publish();for(let version=1;version<12;version++)await publish({id:p.id,code:p.code,version,body:body({name:'QA reviewed version '+(version+1)})})
 const first=await s.getProfile(p.id),secondPage=await s.getProfile(p.id,2);assert.equal(first.history.length,10);assert.equal(secondPage.history.length,2);assert.equal(secondPage.current.version,12);assert.equal(secondPage.history[1].version,1);assert.equal(secondPage.pagination.total,12)
 const page=await s.listProfiles({companyId:company.id,page:1,pageSize:1,status:'all'});assert.equal(page.items.length,1);assert(page.total>=1)
 const [valid]=await root.$queryRaw`SELECT app.tax_gstin_valid('27AAPFU0939F1ZV') ok,app.tax_gstin_valid('27AAPFU0939F1ZO') bad`;assert(valid.ok);assert(!valid.bad)
 const companyRow=await root.businessCompany.findUnique({where:{tenantId_id:{tenantId:tenant,id:second.id}}});await root.businessCompany.update({where:{tenantId_id:{tenantId:tenant,id:second.id}},data:{archived:true,version:{increment:1}}})
 await assert.rejects(publish({companyId:second.id}),status(404));await root.businessCompany.update({where:{tenantId_id:{tenantId:tenant,id:second.id}},data:{archived:companyRow.archived,version:{increment:1}}})
})
test('staff and managers cannot administer tax configuration even with broad custom permissions; native RLS agrees',async()=>{
 for(const user of [staff,manager]){await assert.rejects(service(user).listProfiles({}),status(403));await assert.rejects(service(user).publishProfile({companyId:company.id,code:'DENIED',version:0,reviewed:true,body:body()}),status(403));await runWithDatabaseActor(user.id,async()=>{assert.equal(await db.companyTaxProfile.count(),0);await assert.rejects(db.companyTaxProfile.create({data:{tenantId:tenant,companyId:company.id,name:'Denied',code:'DENIED',scheme:'IN_GST'}}))})}
 assert.equal(await foreignDb.companyTaxProfile.count(),0)
})
test('native current-head proofs prevent history omission and forged rate evidence',async()=>{
 const p=await publish();await assert.rejects(root.companyTaxProfile.update({where:{tenantId_id:{tenantId:tenant,id:p.id}},data:{name:'Missing history',version:{increment:1}}}),/immutable reviewed history/i)
 const current=await s.getProfile(p.id),snapshot=structuredClone(current.current.snapshot);snapshot.variants[0].components[0].percent='99'
 await assert.rejects(root.$transaction(async tx=>{await tx.companyTaxProfile.update({where:{tenantId_id:{tenantId:tenant,id:p.id}},data:{version:{increment:1}}});await tx.companyTaxProfileVersion.create({data:{tenantId:tenant,profileId:p.id,version:2,snapshot,actorId:admin.id}})}),/reviewed rate facts/i)
 assert.equal((await s.getProfile(p.id)).version,1)
})
test('native proofs validate intermediate reviews as well as the final transaction head',async()=>{
 const p=await publish(),snapshot=(await s.getProfile(p.id)).current.snapshot
 async function append(tx,version,history=true,components=true){
  await tx.companyTaxProfile.update({where:{tenantId_id:{tenantId:tenant,id:p.id}},data:{version:{increment:1}}})
  if(history)await tx.companyTaxProfileVersion.create({data:{tenantId:tenant,profileId:p.id,version,snapshot,actorId:admin.id}})
  if(components)for(const v of snapshot.variants)for(const c of v.components)await tx.companyTaxProfileRate.create({data:{tenantId:tenant,profileId:p.id,profileVersion:version,variantKey:v.key,componentCode:c.code,taxId:c.rateId,name:c.name,percent:c.percent,sourceUpdatedAt:new Date(c.sourceUpdatedAt)}})
 }
 await assert.rejects(root.$transaction(async tx=>{await append(tx,2,false,false);await append(tx,3)}),/Every tax profile update requires immutable reviewed history/)
 await assert.rejects(root.$transaction(async tx=>{await append(tx,2,true,false);await append(tx,3)}),/Every tax profile version must retain complete reviewed rate facts/)
 assert.equal((await s.getProfile(p.id)).version,1)
 await root.$transaction(async tx=>{await append(tx,2);await append(tx,3)})
 assert.equal((await s.getProfile(p.id)).history.length,3)
 const reg=await root.companyTaxRegistration.findFirstOrThrow({where:{tenantId:tenant}})
 await assert.rejects(root.$transaction(async tx=>{
  for(let i=0;i<2;i++)await tx.companyTaxRegistration.update({where:{tenantId_id:{tenantId:tenant,id:reg.id}},data:{version:{increment:1}}})
  const [r]=await tx.$queryRaw`SELECT app.tax_registration_snapshot(r) snapshot FROM "CompanyTaxRegistration" r WHERE "tenantId"=${tenant} AND id=${reg.id}`
  await tx.companyTaxRegistrationRevision.create({data:{tenantId:tenant,registrationId:reg.id,version:reg.version+2,snapshot:r.snapshot,actorId:admin.id}})
 }),/Every registration update requires immutable reviewed history/)
 assert.equal((await s.getRegistration(reg.id)).version,reg.version)
})
test('concurrent reviews admit one expected-version winner and strict audit failure rolls back every config row',async()=>{
 const p=await publish(),result=await Promise.allSettled([publish({id:p.id,code:p.code,version:1}),publish({id:p.id,code:p.code,version:1})]);assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal((await s.getProfile(p.id)).version,2)
 const before=await root.companyTaxProfile.count({where:{tenantId:tenant}}),broken=new Proxy(db,{get(target,key){if(key==='$transaction')return (fn,opts)=>target.$transaction(tx=>fn(new Proxy(tx,{get(t,k){if(k==='auditLog')return {createMany(){throw Error('QA audit unavailable')}};return Reflect.get(t,k)}})),opts);return Reflect.get(target,key)}})
 await assert.rejects(service(admin,broken).publishProfile({companyId:company.id,code:'AUDIT-FAIL',version:0,reviewed:true,body:body()}),/QA audit unavailable/);assert.equal(await root.companyTaxProfile.count({where:{tenantId:tenant}}),before)
})
