/* eslint-disable @typescript-eslint/no-require-imports */
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Pool}=require('pg'),{PrismaClient}=require('@prisma/client')
const {TenantPgAdapter}=require('../lib/tenant-pg-adapter.ts'),{runWithDatabaseActor}=require('../lib/database-actor.ts'),{fixtureUser}=require('./helpers/access-fixtures.cjs'),{createCrmService}=require('../modules/crm/service.ts'),{gstinCheckDigit}=require('../platform/tax/localizations/india.ts')
require('../lib/logger.ts').logger.info=()=>{}
const url=new URL(process.env.CRM_TEST_DATABASE_URL||'http://invalid');if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!='/ls_salon_crm_test')throw Error('Disposable localhost database only.')
const tenant='party_tax_'+randomUUID(),other='party_tax_'+randomUUID(),pools=[],clients=[]
function client(tenantId,bypass=false){const u=new URL(url);if(!bypass){u.username='crm_test_runtime';u.password=''}const pool=new Pool({connectionString:u.toString(),max:5});pools.push(pool);const c=new PrismaClient({adapter:new TenantPgAdapter(pool,{tenantId,bypass})});clients.push(c);return c}
const root=client(undefined,true),db=client(tenant),foreignDb=client(other),status=n=>e=>e.status===n
let admin,staff,foreign,s,ss,foreignService
const service=(u,c=db)=>createCrmService(c,{tenantId:u.tenantId,userId:u.id})
const input=(extra={})=>({scheme:'IN_GST',status:'REGISTERED',registrationNumber:'27AAPFU0939F1ZV',regionCode:'27',category:'REGULAR',legalName:'QA recipient',addressLine1:'QA street',addressLine2:'',city:'Pune',postalCode:'411001',effectiveFrom:'2026-01-01',effectiveTo:null,archived:false,reviewed:true,...extra})
const unregistered=()=>input({status:'UNREGISTERED',registrationNumber:'',regionCode:'',category:'NOT_APPLICABLE'})
function update(r,extra={}){const keys=['legalName','addressLine1','addressLine2','city','postalCode','regionCode','category','archived'];return {...Object.fromEntries(keys.map(k=>[k,r[k]])),effectiveFrom:r.effectiveFrom.toISOString().slice(0,10),effectiveTo:r.effectiveTo?.toISOString().slice(0,10)||null,version:r.version,reviewed:true,...extra}}
async function person(user=admin,t=tenant){const row=await root.crmContact.create({data:{tenantId:t,name:'QA person '+randomUUID(),ownerUserId:user.id}});return {kind:'PERSON',id:row.id}}
async function business(){const row=await root.crmAccount.create({data:{tenantId:tenant,name:'QA business '+randomUUID(),ownerUserId:admin.id}});return {kind:'BUSINESS',id:row.id}}
before(async()=>{
 await root.tenant.createMany({data:[tenant,other].map(id=>({id,slug:id,name:'QA party tax'}))})
 for(const tenantId of [tenant,other])await root.tenantModule.upsert({where:{tenantId_key:{tenantId,key:'crm'}},create:{tenantId,key:'crm',allowed:true,enabled:true},update:{allowed:true,enabled:true}})
 const user=(tenantId,role)=>fixtureUser(root,{data:{tenantId,role,name:'QA '+role,email:randomUUID()+'@example.test'}})
 admin=await user(tenant,'ADMIN');staff=await user(tenant,'STAFF');foreign=await user(other,'ADMIN');s=service(admin);ss=service(staff);foreignService=service(foreign,foreignDb)
})
after(async()=>{await Promise.all(clients.map(c=>c.$disconnect()));await Promise.all(pools.map(p=>p.end()))})
test('shared person/business identities retain reviewed history without modifying owner versions',async()=>{
 for(const o of [await person(),await business()]){
  assert.equal((await s.listPartyTaxIdentities(o,{})).assessment,'NOT_ASSESSED')
  const r=await s.createPartyTaxIdentity(o,input()),next=await s.updatePartyTaxIdentity(o,r.id,update(r,{legalName:'QA revised'})),d=await s.getPartyTaxIdentity(o,r.id)
  assert.equal(next.version,2);assert.equal(d.history.length,2);assert.equal(d.history[1].snapshot.legalName,'QA recipient');assert.equal(d.history[0].snapshot.legalName,'QA revised');assert.equal(d.history[0].actorId,admin.id)
  assert.equal((await (o.kind==='PERSON'?root.crmContact:root.crmAccount).findUnique({where:{id:o.id}})).version,1)
  await assert.rejects(foreignService.getPartyTaxIdentity(o,r.id),status(404))
 }
})
test('multiple GSTINs and the same registration on separate parties are independent; absence is never unregistered',async()=>{
 const a=await person(),b=await person(),n='29AAPFU0939F1Z'+gstinCheckDigit('29AAPFU0939F1Z')
 await s.createPartyTaxIdentity(a,input());await s.createPartyTaxIdentity(a,input({registrationNumber:n,regionCode:'29'}));await s.createPartyTaxIdentity(b,input());assert.equal((await s.listPartyTaxIdentities(a,{pageSize:1})).total,2)
 const u=await person(),r=await s.createPartyTaxIdentity(u,unregistered());assert.equal((await s.listPartyTaxIdentities(u,{})).assessment,'UNREGISTERED');await s.updatePartyTaxIdentity(u,r.id,update(r,{archived:true}));assert.equal((await s.listPartyTaxIdentities(u,{})).assessment,'NOT_ASSESSED')
})
test('duplicates, conflicting assertions, restoration and archived owners are explicit',async()=>{
 const o=await person(),r=await s.createPartyTaxIdentity(o,input());await assert.rejects(s.createPartyTaxIdentity(o,input()),status(409));await assert.rejects(s.createPartyTaxIdentity(o,unregistered()),status(409))
 const archived=await s.updatePartyTaxIdentity(o,r.id,update(r,{archived:true}));await assert.rejects(s.createPartyTaxIdentity(o,input()),status(409));const u=await s.createPartyTaxIdentity(o,unregistered());await assert.rejects(s.updatePartyTaxIdentity(o,r.id,update(archived,{archived:false})),status(409));await s.updatePartyTaxIdentity(o,u.id,update(u,{archived:true}));const restored=await s.updatePartyTaxIdentity(o,r.id,update(archived,{archived:false}));assert.equal(restored.version,3)
 await root.crmContact.update({where:{id:o.id},data:{archived:true,version:{increment:1}}});await assert.rejects(s.updatePartyTaxIdentity(o,r.id,update(restored)),status(409));assert.equal((await s.updatePartyTaxIdentity(o,r.id,update(restored,{archived:true}))).archived,true)
})
test('concurrent status changes and edits have one winner, stale drafts never overwrite',async()=>{
 const o=await person(),results=await Promise.allSettled([s.createPartyTaxIdentity(o,input()),s.createPartyTaxIdentity(o,unregistered())]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await s.listPartyTaxIdentities(o,{})).total,1)
 const r=results.find(r=>r.status==='fulfilled').value,edits=await Promise.allSettled([s.updatePartyTaxIdentity(o,r.id,update(r,{legalName:'QA a'})),s.updatePartyTaxIdentity(o,r.id,update(r,{legalName:'QA b'}))]);assert.equal(edits.filter(r=>r.status==='fulfilled').length,1);assert.equal(edits.find(r=>r.status==='rejected').reason.status,409)
})
test('native concurrent inserts serialize conflicting status even without the service mutex',async()=>{
 const o=await person()
 async function insert(body){const {reviewed,...data}=body;void reviewed;return root.$transaction(async tx=>{const r=await tx.partyTaxIdentity.create({data:{...data,tenantId:tenant,contactId:o.id,countryCode:'IN',effectiveFrom:new Date(data.effectiveFrom+'T00:00:00Z'),effectiveTo:null}});await tx.$executeRaw`INSERT INTO "PartyTaxIdentityRevision"(id,"tenantId","identityId",version,snapshot,"actorId") SELECT ${randomUUID()},"tenantId",id,version,app.party_tax_snapshot(p),${admin.id} FROM "PartyTaxIdentity" p WHERE id=${r.id}`;return r})}
 const results=await Promise.allSettled([insert(input()),insert(unregistered())]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await s.listPartyTaxIdentities(o,{})).total,1)
 const foreignOwner=await person(foreign,other),{reviewed,...data}=input();void reviewed
 await assert.rejects(root.$transaction(tx=>tx.partyTaxIdentity.create({data:{...data,tenantId:tenant,contactId:foreignOwner.id,countryCode:'IN',effectiveFrom:new Date('2026-01-01'),effectiveTo:null}})))
})
test('native roots cannot move, change identity, omit intermediate proof or rewrite/delete history',async()=>{
 const o=await person(),r=await s.createPartyTaxIdentity(o,input()),d=await s.getPartyTaxIdentity(o,r.id)
 for(const data of [{contactId:(await person()).id,version:2},{registrationNumber:'',version:2},{status:'UNREGISTERED',version:2},{legalName:'No version'},{version:2}])await assert.rejects(root.partyTaxIdentity.update({where:{id:r.id},data}))
 await assert.rejects(root.partyTaxIdentity.delete({where:{id:r.id}}));await assert.rejects(root.partyTaxIdentityRevision.update({where:{id:d.history[0].id},data:{snapshot:{}}}));await assert.rejects(root.partyTaxIdentityRevision.delete({where:{id:d.history[0].id}}))
 await assert.rejects(root.$transaction(async tx=>{await tx.partyTaxIdentity.update({where:{id:r.id},data:{version:2}});await tx.partyTaxIdentity.update({where:{id:r.id},data:{version:3}});await tx.$executeRaw`INSERT INTO "PartyTaxIdentityRevision"(id,"tenantId","identityId",version,snapshot,"actorId") SELECT ${randomUUID()},"tenantId",id,version,app.party_tax_snapshot(p),${admin.id} FROM "PartyTaxIdentity" p WHERE id=${r.id}`}),/Every tax identity version/)
 await assert.rejects(root.partyTaxIdentityRevision.create({data:{tenantId:tenant,identityId:r.id,version:2,snapshot:{},actorId:admin.id}}));assert.equal((await s.getPartyTaxIdentity(o,r.id)).version,1)
})
test('contact/business source action limits and native Restricted privacy are inherited',async()=>{
 const own=await person(staff),hidden=await person(),r=await s.createPartyTaxIdentity(hidden,input());const policy=await root.recordSharingPolicy.create({data:{tenantId:tenant,resource:'contacts',recordId:hidden.id,restricted:true}});await root.crmContact.update({where:{id:hidden.id},data:{sharingPolicyId:policy.id}})
 await assert.rejects(ss.listPartyTaxIdentities(hidden,{}),status(404));await runWithDatabaseActor(staff.id,async()=>assert.equal(await db.partyTaxIdentity.count({where:{id:r.id}}),0))
 const grant=await root.recordSharingGrant.create({data:{tenantId:tenant,policyId:policy.id,userId:staff.id,level:'READ'}});assert.equal((await ss.getPartyTaxIdentity(hidden,r.id)).canEdit,false);await runWithDatabaseActor(staff.id,async()=>assert.equal(await db.partyTaxIdentity.count({where:{id:r.id}}),1));await assert.rejects(ss.updatePartyTaxIdentity(hidden,r.id,update(r)),status(404));await root.recordSharingGrant.delete({where:{id:grant.id}})
 const ownR=await ss.createPartyTaxIdentity(own,input());const access=await root.tenantUserAccess.findUniqueOrThrow({where:{tenantId_userId:{tenantId:tenant,userId:staff.id}}}),rules={...access.rules,'contacts.archive':'NONE'};await root.tenantUserAccess.update({where:{tenantId_userId:{tenantId:tenant,userId:staff.id}},data:{rules,version:{increment:1}}})
 await assert.rejects(ss.updatePartyTaxIdentity(own,ownR.id,update(ownR,{archived:true})),status(403));await root.tenantUserAccess.update({where:{tenantId_userId:{tenantId:tenant,userId:staff.id}},data:{rules:{...rules,'contacts.edit':'NONE'},version:{increment:1}}});assert.equal((await ss.listPartyTaxIdentities(own,{})).canEdit,false);await assert.rejects(ss.updatePartyTaxIdentity(own,ownR.id,update(ownR)),status(403))
 await root.tenantUserAccess.update({where:{tenantId_userId:{tenantId:tenant,userId:staff.id}},data:{rules:{...rules,'contacts.read':'NONE'},version:{increment:1}}});await assert.rejects(ss.listPartyTaxIdentities(own,{}),status(403));await root.tenantUserAccess.update({where:{tenantId_userId:{tenantId:tenant,userId:staff.id}},data:{rules:access.rules,version:{increment:1}}})
 const foreignOwner=await person(foreign,other);await assert.rejects(s.createPartyTaxIdentity(foreignOwner,input()),status(404));assert.equal(await foreignDb.partyTaxIdentity.count(),0)
})
test('review history is paginated and failed audit rolls back root and revision atomically',async()=>{
 const o=await person();let r=await s.createPartyTaxIdentity(o,input());for(let i=1;i<12;i++)r=await s.updatePartyTaxIdentity(o,r.id,update(r,{legalName:'QA version '+(i+1)}));const d=await s.getPartyTaxIdentity(o,r.id,2);assert.equal(d.history.length,2);assert.equal(d.version,12);assert.equal(d.history[1].version,1)
 await root.$executeRawUnsafe(`CREATE FUNCTION public.qa_party_tax_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event LIKE 'crm.contact.taxIdentity.%' AND NEW."tenantId"='${tenant}' THEN RAISE EXCEPTION 'QA audit failure';END IF;RETURN NEW;END $$`)
 await root.$executeRawUnsafe('CREATE TRIGGER qa_party_tax_audit_fail BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION public.qa_party_tax_audit_fail()')
 try{await assert.rejects(s.updatePartyTaxIdentity(o,r.id,update(r,{legalName:'Must roll back'})),/QA audit failure/);assert.equal((await s.getPartyTaxIdentity(o,r.id)).version,12)}finally{await root.$executeRawUnsafe('DROP TRIGGER qa_party_tax_audit_fail ON "AuditLog"');await root.$executeRawUnsafe('DROP FUNCTION public.qa_party_tax_audit_fail()')}
})
