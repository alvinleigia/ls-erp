/* eslint-disable @typescript-eslint/no-require-imports */
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Pool}=require('pg'),{PrismaClient}=require('@prisma/client')
const {fixtureUser,fixtureRole,fixtureProfile,resetFixtureRoles}=require('./helpers/access-fixtures.cjs')
const {materializeRules}=require('./helpers/resource-policy-data.cjs')
const {TenantPgAdapter}=require('../lib/tenant-pg-adapter.ts'),{createApplicationCrmService}=require('../application/crm/service.ts')
const {createRecordSharingService}=require('../platform/access/sharing-service.ts')
const {runWithDatabaseActor}=require('../lib/database-actor.ts')
const {applicationSalesOrders}=require('../application/sales-orders/service.ts')
const {applicationReceivables}=require('../application/receivables/service.ts')
const {applicationParticipantSettings}=require('../application/participants/configuration.ts')
const {emptyCorrespondence}=require('../platform/participants/information.ts')
const {defaultParticipantDefinition}=require('../platform/participants/requirements.ts')
const {emptyQuotationContent}=require('../modules/sales-documents/quotation-validation.ts')
require('../lib/logger.ts').logger.info=()=>{}
const url=new URL(process.env.CRM_TEST_DATABASE_URL||'http://invalid')
if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!='/ls_salon_crm_test')throw Error('Isolated local database only.')
const tenant='participants_'+randomUUID(),foreignTenant='participants_'+randomUUID(),pools=[],clients=[]
function client(tenantId,root=false){const u=new URL(url);if(!root){u.username='crm_test_runtime';u.password=''}const pool=new Pool({connectionString:u.toString(),max:4});pools.push(pool);const db=new PrismaClient({adapter:new TenantPgAdapter(pool,{tenantId,bypass:root})});clients.push(db);return db}
const root=client(undefined,true),db=client(tenant),foreignDb=client(foreignTenant)
const identity=user=>({tenantId:user.tenantId,userId:user.id}),status=code=>error=>error.status===code
let admin,staff,other,foreign,crm,staffCrm,otherCrm,contact,additional,business,pipeline,stage
const service=(user,connection=db)=>createApplicationCrmService(connection,identity(user))
const direct=(user,fn)=>runWithDatabaseActor(user.id,async()=>await fn())
const selection=(person,role='ADDITIONAL_CUSTOMER',kind='PERSON')=>({role,party:{kind,id:person.id}})
const rows=(data)=>data.participants.map(({role,party})=>({role,party:{kind:party.kind,id:party.id}}))
async function deal(){return crm.createOpportunity({title:'Participant acceptance',contactId:contact.id,assignedUserId:staff.id,pipelineId:pipeline.id,stageId:stage.id,amount:'100',currency:'INR',expectedCloseOn:'2027-01-01'})}
async function replace(id,participants,who=crm){const current=await who.getOpportunityParticipants(id);return who.replaceOpportunityParticipants(id,{version:current.version,participants})}
const content=()=>({...structuredClone(emptyQuotationContent),title:'Participant quotation',supplierName:'Generic industries',currency:'INR',lines:[{description:'Shared service',quantity:'1',unit:'hour',rate:'100'}]})
before(async()=>{
 await root.tenant.createMany({data:[tenant,foreignTenant].map(id=>({id,slug:id,name:id}))})
 const user=(tenantId,role)=>fixtureUser(root,{data:{tenantId,role,name:role,email:randomUUID()+'@example.test'}})
 admin=await user(tenant,'ADMIN');staff=await user(tenant,'STAFF');other=await user(tenant,'STAFF');foreign=await user(foreignTenant,'ADMIN')
 await root.tenantModule.createMany({data:[tenant,foreignTenant].flatMap(tenantId=>['crm','salesDocuments','salesOrders','receivables'].map(key=>({tenantId,key,allowed:true,enabled:true})))})
 crm=service(admin);staffCrm=service(staff);otherCrm=service(other)
 contact=await root.crmContact.create({data:{tenantId:tenant,name:'Primary person',ownerUserId:staff.id}})
 additional=await root.crmContact.create({data:{tenantId:tenant,name:'Additional person',email:'family@example.test',ownerUserId:staff.id}})
 business=await root.crmAccount.create({data:{tenantId:tenant,name:'Participating company',email:'private-business@example.test',ownerUserId:staff.id}})
 pipeline=await root.crmPipeline.create({data:{tenantId:tenant,name:'Generic sales'}});stage=await root.crmStage.create({data:{tenantId:tenant,pipelineId:pipeline.id,name:'Open',position:0,kind:'OPEN',probability:10,color:'#123456'}})
})
after(async()=>{await Promise.all(clients.map(c=>c.$disconnect()));await Promise.all(pools.map(p=>p.end()))})

test('generic repeatable people and businesses reuse masters across deals, preserving order and version',async()=>{
 const a=await deal(),b=await deal(),input=[selection(additional),selection(business,'REPRESENTATIVE','BUSINESS')]
 const saved=await replace(a.id,input),again=await replace(b.id,input)
 assert.equal(saved.version,2);assert.deepEqual(rows(saved),input);assert.deepEqual(rows(again),input)
 assert.equal(saved.primary[0].party.id,contact.id);assert.equal(saved.participants[0].party.email,'family@example.test');assert.equal(saved.participants[1].party.email,null)
 const ids=(await root.crmOpportunityParticipant.findMany({where:{opportunityId:a.id},orderBy:{position:'asc'}})).map(r=>r.id)
 const reordered=await replace(a.id,[input[1],input[0]])
 assert.deepEqual(rows(reordered),[input[1],input[0]])
 assert.deepEqual((await root.crmOpportunityParticipant.findMany({where:{opportunityId:a.id},orderBy:{position:'asc'}})).map(r=>r.id),ids.reverse())
 const audit=await root.auditLog.findFirst({where:{tenantId:tenant,entityId:a.id,event:'crm.opportunity.participants.updated'},orderBy:{createdAt:'desc'}})
 assert.equal(JSON.stringify(audit.after).includes('family@example.test'),false)
})
test('strict references reject injected facts, duplicate roles, primary duplication and excess rows atomically',async()=>{
 const d=await deal()
 for(const participants of [[{...selection(additional),name:'Injected'}],[selection(additional),selection(additional)],[{...selection(additional),party:{kind:'PERSON',id:additional.id,name:'Injected'}}],Array.from({length:99},(_,i)=>selection({id:String(i)}))])assert.throws(()=>crm.replaceOpportunityParticipants(d.id,{version:1,participants}))
 await assert.rejects(replace(d.id,[selection(contact)]),status(409))
 assert.equal((await crm.getOpportunityParticipants(d.id)).version,1)
 assert.equal(await root.crmOpportunityParticipant.count({where:{opportunityId:d.id}}),0)
})
test('selectors, counts, paging and selected captions use the same readable active population',async()=>{
 const d=await deal(),hidden=await root.crmContact.create({data:{tenantId:tenant,name:'Hidden private',ownerUserId:other.id}})
 const archived=await root.crmContact.create({data:{tenantId:tenant,name:'Archived person',archived:true,ownerUserId:staff.id}})
 const first=await staffCrm.listOpportunityParticipantChoices(d.id,{kind:'PERSON',pageSize:1})
 assert.equal(first.total,2);assert.equal(first.items.length,1);assert.equal(first.totalPages,2)
 const second=await staffCrm.listOpportunityParticipantChoices(d.id,{kind:'PERSON',page:2,pageSize:1});assert.notEqual(first.items[0].id,second.items[0].id)
 for(const item of [hidden,archived]){
  const choices=await staffCrm.listOpportunityParticipantChoices(d.id,{kind:'PERSON',q:item.name,selectedId:item.id})
  assert.equal(choices.total,0);assert.equal(choices.selected,null)
  await assert.rejects(replace(d.id,[selection(item)],staffCrm),status(409))
 }
 await assert.rejects(otherCrm.listOpportunityParticipantChoices(d.id,{kind:'PERSON'}),status(404))
})
test('saved selections survive archive, rename and directory permission loss; refresh is explicit',async()=>{
 const d=await deal(),saved=await replace(d.id,[selection(additional)])
 await root.crmContact.update({where:{id:additional.id},data:{name:'Renamed person',version:{increment:1},archived:true}})
 try{
  const current=await staffCrm.getOpportunityParticipants(d.id)
  assert.equal(current.participants[0].party.name,'Additional person');assert.equal(current.participants[0].available,false)
  await replace(d.id,rows(current),staffCrm)
  await assert.rejects(replace(d.id,[{...selection(additional),refresh:true}],staffCrm),status(409))
  await root.crmContact.update({where:{id:additional.id},data:{archived:false}})
  const refreshed=await replace(d.id,[{...selection(additional),refresh:true}],staffCrm)
  assert.equal(refreshed.participants[0].party.name,'Renamed person');assert.equal(refreshed.participants[0].party.sourceVersion,2)
  const profile=await fixtureProfile(root,{data:{tenantId:tenant,name:'Participant only',nameKey:randomUUID(),permissions:['opportunities.read','opportunities.edit','quotations.read','quotations.create']}})
  await fixtureRole(root,{data:{tenantId:tenant,userId:staff.id,roleId:profile.id}})
  try{
   const denied=await staffCrm.getOpportunityParticipants(d.id);assert.equal(denied.canChoosePerson,false);assert.equal(denied.participants[0].available,false)
   await replace(d.id,rows(denied),staffCrm)
   await assert.rejects(staffCrm.listOpportunityParticipantChoices(d.id,{kind:'PERSON'}),status(403))
   await assert.rejects(replace(d.id,[{...selection(additional),refresh:true}],staffCrm),status(403))
   const quote=await staffCrm.saveQuotation(d.id,{content:content()});assert.equal((await staffCrm.getQuotation(quote.id)).snapshot.participants.participants[1].party.name,'Renamed person')
   assert.equal((await replace(d.id,[],staffCrm)).participants.length,0)
  }finally{await resetFixtureRoles(root,{where:{tenantId:tenant,userId:staff.id}})}
  assert.equal(saved.participants[0].party.name,'Additional person')
 }finally{await root.crmContact.update({where:{id:additional.id},data:{name:'Additional person',archived:false}})}
})
test('revoked master sharing retains accepted evidence without granting directory access or new roles',async()=>{
 const d=await deal(),person=await root.crmContact.create({data:{tenantId:tenant,name:'Accepted private person',ownerUserId:admin.id}})
 const sharing=createRecordSharingService(db,identity(admin))
 let state=await sharing.get('contacts',person.id)
 await sharing.save('contacts',person.id,{version:state.version,restricted:true,grants:[{kind:'USER',id:staff.id,level:'READ'}]})
 await replace(d.id,[selection(person)],staffCrm)
 state=await sharing.get('contacts',person.id)
 await sharing.save('contacts',person.id,{version:state.version,restricted:true,grants:[]})
 const accepted=await staffCrm.getOpportunityParticipants(d.id)
 assert.equal(accepted.participants[0].party.name,'Accepted private person');assert.equal(accepted.participants[0].available,false)
 await replace(d.id,rows(accepted),staffCrm)
 await assert.rejects(staffCrm.getContact(person.id),status(404))
 await assert.rejects(replace(d.id,[selection(person,'REPRESENTATIVE')],staffCrm),status(409))
 const choices=await staffCrm.listOpportunityParticipantChoices(d.id,{kind:'PERSON',q:person.name,selectedId:person.id})
 assert.equal(choices.total,0);assert.equal(choices.selected,null)
 const q=await staffCrm.saveQuotation(d.id,{content:content()})
 assert.equal((await staffCrm.getQuotation(q.id)).snapshot.participants.participants[1].party.name,'Accepted private person')
})
test('fresh Read/Edit, None limits, module/user status and source record privacy stay authoritative',async()=>{
 const d=await deal();await replace(d.id,[selection(additional)])
 await assert.rejects(otherCrm.getOpportunityParticipants(d.id),status(404))
 await assert.rejects(replace(d.id,[],otherCrm),status(404))
 const profile=await fixtureProfile(root,{data:{tenantId:tenant,name:'Participant reader',nameKey:randomUUID(),permissions:['opportunities.read']}})
 await fixtureRole(root,{data:{tenantId:tenant,userId:staff.id,roleId:profile.id}})
 try{
  assert.equal((await staffCrm.getOpportunityParticipants(d.id)).canEdit,false)
  await assert.rejects(replace(d.id,[],staffCrm),status(403))
  await root.tenantUserAccess.update({where:{tenantId_userId:{tenantId:tenant,userId:staff.id}},data:{rules:{...materializeRules('STAFF'),'opportunities.read':'NONE'}}})
  await assert.rejects(staffCrm.getOpportunityParticipants(d.id),status(403))
 }finally{await resetFixtureRoles(root,{where:{tenantId:tenant,userId:staff.id}})}
 const sharing=createRecordSharingService(db,identity(admin)),state=await sharing.get('opportunities',d.id)
 await sharing.save('opportunities',d.id,{version:state.version,restricted:true,grants:[]})
 assert.equal(await direct(other,()=>db.crmOpportunityParticipant.count({where:{opportunityId:d.id}})),0)
 assert.equal(await direct(staff,()=>db.crmOpportunityParticipant.count({where:{opportunityId:d.id}})),1)
 await root.tenantModule.update({where:{tenantId_key:{tenantId:tenant,key:'crm'}},data:{enabled:false}})
 try{await assert.rejects(crm.getOpportunityParticipants(d.id),status(403))}finally{await root.tenantModule.update({where:{tenantId_key:{tenantId:tenant,key:'crm'}},data:{enabled:true}})}
 await root.user.update({where:{id:staff.id},data:{status:'SUSPENDED'}})
 try{await assert.rejects(staffCrm.getOpportunityParticipants(d.id),status(403))}finally{await root.user.update({where:{id:staff.id},data:{status:'ACTIVE'}})}
})
test('native composite FKs, XOR, roles, uniqueness and tenant RLS reject invalid links',async()=>{
 const d=await deal(),saved=await replace(d.id,[selection(additional)])
 const foreignContact=await root.crmContact.create({data:{tenantId:foreignTenant,name:'Foreign person',ownerUserId:foreign.id}})
 await assert.rejects(replace(d.id,[selection(foreignContact)]),status(409))
 const base={tenantId:tenant,opportunityId:d.id,contactId:additional.id,role:'REPRESENTATIVE',position:1,details:{}}
 for(const patch of [{contactId:foreignContact.id},{accountId:business.id},{contactId:null},{role:'CUSTOMER'},{position:98},{role:'ADDITIONAL_CUSTOMER'}])await assert.rejects(root.crmOpportunityParticipant.create({data:{...base,...patch}}))
 assert.equal(await direct(foreign,()=>foreignDb.crmOpportunityParticipant.count({where:{opportunityId:d.id}})),0)
 await assert.rejects(service(foreign,foreignDb).getOpportunityParticipants(d.id),status(404))
 assert.equal(saved.participants.length,1)
 const child=await root.crmOpportunityParticipant.findFirst({where:{opportunityId:d.id}}),another=await deal()
 await assert.rejects(root.crmOpportunityParticipant.update({where:{id:child.id},data:{opportunityId:another.id}}),/immutable/)
})
test('native child evidence inherits office boundaries without new grants',async()=>{
 const company=await root.businessCompany.create({data:{tenantId:tenant,name:'Second company',code:'P2'}})
 const office=await root.businessOffice.create({data:{tenantId:tenant,companyId:company.id,name:'Second office',code:'P2'}})
 const d=await root.crmOpportunity.create({data:{tenantId:tenant,officeId:office.id,title:'Inaccessible office',contactId:contact.id,assignedUserId:admin.id,pipelineId:pipeline.id,stageId:stage.id,amount:100,currency:'INR',probability:10,expectedCloseOn:new Date('2027-01-01')}})
 await root.crmOpportunityParticipant.create({data:{tenantId:tenant,opportunityId:d.id,contactId:additional.id,role:'ADDITIONAL_CUSTOMER',position:0,details:{name:'Saved office person',email:null,phone:null,sourceVersion:1}}})
 await assert.rejects(staffCrm.getOpportunityParticipants(d.id),status(404))
 assert.equal(await direct(staff,()=>db.crmOpportunityParticipant.count({where:{opportunityId:d.id}})),0)
})
test('optimistic source version prevents lost participant edits and preserves atomic audit',async()=>{
 const d=await deal(),input={version:1,participants:[selection(additional)]}
 const results=await Promise.allSettled([crm.replaceOpportunityParticipants(d.id,input),crm.replaceOpportunityParticipants(d.id,{...input,participants:[selection(business,'REPRESENTATIVE','BUSINESS')]})])
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.status,409)
 assert.equal(await root.auditLog.count({where:{entityId:d.id,event:'crm.opportunity.participants.updated'}}),1)
 await assert.rejects(crm.replaceOpportunityParticipants(d.id,input),status(409))
 const broken=new Proxy(db,{get(target,key){if(key==='$transaction')return (fn,options)=>target.$transaction(tx=>fn(new Proxy(tx,{get(t,k){if(k==='auditLog')return new Proxy(t.auditLog,{get(a,m){return m==='createMany'?async()=>{throw Error('Audit unavailable')}:a[m]}});return t[k]}})),options);return target[key]}})
 const before=await crm.getOpportunityParticipants(d.id)
 await assert.rejects(service(admin,broken).replaceOpportunityParticipants(d.id,{version:before.version,participants:[]}),/Audit unavailable/)
 assert.deepEqual(await crm.getOpportunityParticipants(d.id),before)
})
test('a participant save waiting for security administration authorizes after committed revocation',async()=>{
 const d=await deal(),profile=await fixtureProfile(root,{data:{tenantId:tenant,name:'Waiting participant editor',nameKey:randomUUID(),permissions:['opportunities.read','opportunities.edit','contacts.read']}})
 await fixtureRole(root,{data:{tenantId:tenant,userId:staff.id,roleId:profile.id}})
 let locked,release
 const ready=new Promise(resolve=>{locked=resolve}),hold=new Promise(resolve=>{release=resolve})
 const writer=root.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${tenant} FOR UPDATE`
  await tx.tenantAccessRole.update({where:{id:profile.id},data:{permissions:['opportunities.read','opportunities.edit']}})
  locked();await hold
 },{timeout:20000})
 try{
  await ready
  const pending=staffCrm.replaceOpportunityParticipants(d.id,{version:1,participants:[selection(additional)]})
  // Attach rejection handling before releasing the concurrent writer.
  const result=assert.rejects(pending,status(403))
  await new Promise(resolve=>setTimeout(resolve,100));release();await writer;await result
  assert.equal((await crm.getOpportunityParticipants(d.id)).version,1)
  assert.equal(await root.crmOpportunityParticipant.count({where:{opportunityId:d.id}}),0)
 }finally{release();await writer;await resetFixtureRoles(root,{where:{tenantId:tenant,userId:staff.id}})}
})
test('primary edits cannot make accepted participation invalid; financial copies remain frozen',async()=>{
 const d=await deal();await replace(d.id,[selection(additional)])
 const q=await crm.saveQuotation(d.id,{content:content()}),snapshot=(await crm.getQuotation(q.id)).snapshot
 const orders=applicationSalesOrders(db,identity(admin)),order=await orders.create({quotationId:q.id,revision:1})
 await replace(d.id,[])
 await crm.saveQuotation(d.id,{content:content(),version:1},q.id)
 assert.equal((await crm.getQuotation(q.id)).snapshot.participants.participants.length,1)
 assert.deepEqual((await orders.get(order.id)).snapshot,snapshot)
 await replace(d.id,[selection(additional)])
 const current=await crm.getOpportunity(d.id)
 await assert.rejects(crm.updateOpportunity(d.id,{title:current.title,contactId:additional.id,assignedUserId:staff.id,pipelineId:pipeline.id,stageId:stage.id,amount:'100',currency:'INR',expectedCloseOn:'2027-01-01',version:current.version}),status(409))
 assert.equal((await crm.getOpportunity(d.id)).contactId,contact.id)
})
test('maximum 98 additions save/read/snapshot/order within the ordinary transaction budget',async()=>{
 const d=await deal(),people=Array.from({length:98},(_,i)=>({id:randomUUID(),tenantId:tenant,name:`Participant ${i}`,ownerUserId:staff.id}))
 await root.crmOpportunity.update({where:{id:d.id},data:{accountId:business.id}})
 await root.crmContact.createMany({data:people})
 const started=Date.now(),saved=await replace(d.id,people.map(p=>selection(p)))
 assert.equal(saved.participants.length,98);assert.equal((await crm.getOpportunityParticipants(d.id)).participants.length,98)
 const info=await crm.getOpportunityParticipantInformation(d.id)
 const hundred={format:1,records:info.participants.map(row=>({party:{kind:row.party.kind,id:row.party.id},values:{...emptyCorrespondence,email:'correspondence@example.test',city:'Pune'}}))}
 assert.equal(hundred.records.length,100)
 await crm.saveOpportunityParticipantInformation(d.id,{version:info.version,configurationVersion:info.configuration.version,information:hundred})
 const q=await crm.saveQuotation(d.id,{content:content()}),snapshot=(await crm.getQuotation(q.id)).snapshot
 assert.equal(snapshot.participants.participants.length,100)
 assert.equal(snapshot.participants.participants.filter(row=>row.information.city==='Pune').length,100)
 const orders=applicationSalesOrders(db,identity(admin)),order=await orders.create({quotationId:q.id,revision:1})
 assert.deepEqual((await orders.get(order.id)).snapshot.participants,snapshot.participants)
 assert.equal((await orders.list({q:order.id})).total,1)
 await orders.transition(order.id,{action:'confirm',version:1})
 const ledger=applicationReceivables(db,identity(admin))
 await ledger.open(order.id,{dueDates:(await ledger.get(order.id)).plan.lines.map(()=>null)})
 await ledger.record(order.id,{requestKey:randomUUID(),version:1,amount:'10',receivedOn:'2026-01-01',method:'BANK_TRANSFER',reference:randomUUID(),note:''})
 const balances=await ledger.list({q:order.id})
 assert.equal(balances.total,1);assert.deepEqual([balances.summaries[0].total,balances.summaries[0].paid,balances.summaries[0].outstanding],['100','10','90'])
 console.log(`Maximum participant save/read/quotation/order path: ${Date.now()-started}ms`)
})

const settings=(user=admin,connection=db)=>applicationParticipantSettings(connection,identity(user))
async function publish(definition){const current=await settings().get(),data={version:current.version,definition};const preview=await settings().preview(data);return settings().publish({...data,previewHash:preview.previewHash})}
async function infoInput(id,values={}){const view=await crm.getOpportunityParticipantInformation(id);return {version:view.version,configurationVersion:view.configuration.version,information:{format:1,records:[{party:{kind:'PERSON',id:contact.id},values:{...emptyCorrespondence,...values}}]}}}
const brokenAudit=()=>new Proxy(db,{get(target,key){if(key==='$transaction')return (fn,options)=>target.$transaction(tx=>fn(new Proxy(tx,{get(t,k){if(k==='auditLog')return new Proxy(t.auditLog,{get(a,m){return m==='createMany'?async()=>{throw Error('Audit unavailable')}:a[m]}});return t[k]}})),options);return target[key]}})

test('source correspondence is versioned, normalized and separate from the directory and accepted identities',async()=>{
 const d=await deal();await replace(d.id,[selection(additional)])
 const input=await infoInput(d.id,{email:' TRANSACTION@EXAMPLE.TEST ',phone:'+91 (98765) 43210',addressLine1:'Unit 10',city:'Pune',country:'India'})
 const saved=await crm.saveOpportunityParticipantInformation(d.id,input)
 assert.equal(saved.version,input.version+1);assert.equal(saved.participants[0].information.email,'transaction@example.test');assert.equal(saved.participants[0].information.phone,'+919876543210')
 assert.equal(saved.participants[0].party.email,null)
 assert.equal((await root.crmContact.findUnique({where:{id:contact.id}})).email,null)
 await assert.rejects(otherCrm.getOpportunityParticipantInformation(d.id),status(404))
 const bad=await infoInput(d.id);bad.information.records[0].party.id=additional.id+'foreign'
 await assert.rejects(crm.saveOpportunityParticipantInformation(d.id,bad),status(409))
 await assert.rejects(crm.saveOpportunityParticipantInformation(d.id,input),status(409))
 for(const patch of [{email:'typo'},{phone:'9876543210'},{country:'Not a country'}])assert.throws(()=>crm.saveOpportunityParticipantInformation(d.id,{...input,information:{format:1,records:[{party:{kind:'PERSON',id:contact.id},values:{...emptyCorrespondence,...patch}}]}}))
 const log=await root.auditLog.findFirst({where:{entityId:d.id,event:'crm.opportunity.information.updated'}})
 assert.equal(JSON.stringify(log.after).includes('transaction@example.test'),false)
})
test('ordinary source Read/Edit bounds apply without borrowing directory or configuration permissions',async()=>{
 const d=await deal(),profile=await fixtureProfile(root,{data:{tenantId:tenant,name:'Source correspondence editor',nameKey:randomUUID(),permissions:['opportunities.read','opportunities.edit']}})
 await fixtureRole(root,{data:{tenantId:tenant,userId:staff.id,roleId:profile.id}})
 try{
  const view=await staffCrm.getOpportunityParticipantInformation(d.id)
  assert.equal(view.canEdit,true)
  await staffCrm.saveOpportunityParticipantInformation(d.id,{version:view.version,configurationVersion:view.configuration.version,information:{format:1,records:[{party:{kind:'PERSON',id:contact.id},values:{...emptyCorrespondence,city:'Pune'}}]}})
  await assert.rejects(settings(staff).get(),status(403))
  await root.tenantAccessRole.update({where:{id:profile.id},data:{permissions:['opportunities.read']}})
  const read=await staffCrm.getOpportunityParticipantInformation(d.id);assert.equal(read.canEdit,false);assert.equal(read.participants[0].information.city,'Pune')
  await assert.rejects(staffCrm.saveOpportunityParticipantInformation(d.id,{...await infoInput(d.id)}),status(403))
 }finally{await resetFixtureRoles(root,{where:{tenantId:tenant,userId:staff.id}})}
})
test('quotation/order copies freeze correspondence; removing/replacing a participant prunes only that identity',async()=>{
 const d=await deal();await replace(d.id,[selection(additional)])
 const view=await crm.getOpportunityParticipantInformation(d.id)
 await crm.saveOpportunityParticipantInformation(d.id,{version:view.version,configurationVersion:view.configuration.version,information:{format:1,records:view.participants.map(row=>({party:{kind:row.party.kind,id:row.party.id},values:{...emptyCorrespondence,city:row.party.id===contact.id?'Pune':'Mumbai'}}))}})
 const q=await crm.saveQuotation(d.id,{content:content()}),snapshot=(await crm.getQuotation(q.id)).snapshot,orders=applicationSalesOrders(db,identity(admin)),order=await orders.create({quotationId:q.id,revision:1})
 await replace(d.id,[])
 assert.deepEqual((await root.crmOpportunity.findUnique({where:{id:d.id}})).participantInformation.records.map(row=>row.party.id),[contact.id])
 const current=await crm.getOpportunity(d.id)
 await crm.updateOpportunity(d.id,{title:current.title,contactId:additional.id,accountId:'',assignedUserId:staff.id,pipelineId:pipeline.id,stageId:stage.id,amount:'100',currency:'INR',expectedCloseOn:'2027-01-01',version:current.version})
 assert.equal((await root.crmOpportunity.findUnique({where:{id:d.id}})).participantInformation.records.length,0)
 assert.deepEqual((await orders.get(order.id)).snapshot,snapshot)
 assert.equal(snapshot.participants.participants[1].information.city,'Mumbai')
})
test('settings preview/publish requires fresh administration authority and leaves other tenants/profiles untouched',async()=>{
 const before=await settings().get(),definition=defaultParticipantDefinition();definition.required.CUSTOMER=['email'];definition.labels.city='Town'
 assert.equal(before.version,0)
 const profile=await fixtureProfile(root,{data:{tenantId:tenant,name:'Delegated settings reader',nameKey:randomUUID(),permissions:['participantSettings.read','participantSettings.edit']}})
 await fixtureRole(root,{data:{tenantId:tenant,userId:staff.id,roleId:profile.id}})
 try{assert.equal((await settings(staff).get()).canPublish,false);await assert.rejects(settings(staff).preview({version:0,definition}),status(403))}finally{await resetFixtureRoles(root,{where:{tenantId:tenant,userId:staff.id}})}
 const input={version:before.version,definition},preview=await settings().preview(input)
 assert.equal(preview.impact.accessibleDrafts,(await applicationSalesOrders(db,identity(admin)).list({status:'DRAFT'})).total)
 assert(preview.impact.incompleteDrafts>0)
 assert.throws(()=>settings().publish(input))
 const saved=await settings().publish({...input,previewHash:preview.previewHash});assert.equal(saved.version,1)
 assert.equal((await settings(foreign,foreignDb).get()).version,0)
 await assert.rejects(settings().publish({...input,previewHash:preview.previewHash}),status(409))
 const d=await deal(),stale=await infoInput(d.id)
 await publish(defaultParticipantDefinition())
 await assert.rejects(crm.saveOpportunityParticipantInformation(d.id,stale),status(409))
})
test('settings impact uses the administrator canonical office scope and native configuration writes remain administrator-only',async()=>{
 const d=await deal(),q=await crm.saveQuotation(d.id,{content:content()}),snapshot=(await crm.getQuotation(q.id)).snapshot
 const office=await root.businessOffice.findFirst({where:{tenantId:tenant,code:'P2'}})
 const hiddenSource=await root.crmOpportunity.findFirst({where:{tenantId:tenant,officeId:office.id}})
 const header=await root.crmQuotation.create({data:{tenantId:tenant,opportunityId:hiddenSource.id,title:snapshot.content.title,currency:'INR',consideration:'100'}})
 await root.crmQuotationRevision.create({data:{tenantId:tenant,quotationId:header.id,number:1,snapshot}})
 const hidden=await root.salesOrder.create({data:{tenantId:tenant,quotationId:header.id,revision:1,title:snapshot.content.title,customerName:snapshot.customer.name,currency:'INR',consideration:'100',snapshot,createdBy:admin.id}})
 const orders=applicationSalesOrders(db,identity(admin))
 assert.equal((await orders.get(hidden.id)).id,hidden.id)
 await assert.rejects(applicationSalesOrders(db,identity(staff)).get(hidden.id),status(404))
 const current=await settings().get(),definition=defaultParticipantDefinition();definition.required.CUSTOMER=['city']
 const preview=await settings().preview({version:current.version,definition})
 assert.equal(preview.impact.accessibleDrafts,(await orders.list({status:'DRAFT'})).total)
 assert.equal((await direct(staff,()=>db.participantFormConfiguration.updateMany({where:{tenantId:tenant},data:{version:current.version+1,definition}}))).count,0)
 assert.equal((await settings().get()).version,current.version)
 assert.equal(await direct(foreign,()=>foreignDb.participantFormConfiguration.findUnique({where:{tenantId:tenant}})),null)
})
test('publishing rechecks its draft-impact acknowledgement and does not rewrite existing orders',async()=>{
 const definition=defaultParticipantDefinition();definition.required.CUSTOMER=['city']
 const current=await settings().get(),input={version:current.version,definition},preview=await settings().preview(input)
 const d=await deal(),q=await crm.saveQuotation(d.id,{content:content()}),orders=applicationSalesOrders(db,identity(admin)),order=await orders.create({quotationId:q.id,revision:1}),before=await orders.get(order.id)
 await assert.rejects(settings().publish({...input,previewHash:preview.previewHash}),status(409))
 assert.equal((await settings().get()).version,current.version)
 const next=await settings().preview(input);await settings().publish({...input,previewHash:next.previewHash})
 const {confirmationReview:oldReview,...oldRecord}=before,{confirmationReview:newReview,...newRecord}=await orders.get(order.id)
 assert.deepEqual(newRecord,oldRecord);assert.equal(newReview.configurationVersion,oldReview.configurationVersion+1)
 assert.deepEqual(newReview.missing,[{participant:'Primary person',label:'City'}])
 await publish(defaultParticipantDefinition())
})
test('confirmation enforces current requirements on the selected frozen revision and captures immutable applied rules',async()=>{
 const definition=defaultParticipantDefinition();definition.required.CUSTOMER=['city'];definition.labels.city='Town'
 const config=await publish(definition),d=await deal(),q=await crm.saveQuotation(d.id,{content:content()}),orders=applicationSalesOrders(db,identity(admin)),order=await orders.create({quotationId:q.id,revision:1})
 assert.deepEqual((await orders.get(order.id)).confirmationReview,{configurationVersion:config.version,missing:[{participant:'Primary person',label:'Town'}]})
 await assert.rejects(orders.transition(order.id,{action:'confirm',version:1}),e=>e.status===409&&e.message.includes('Primary person: Town'))
 await crm.saveOpportunityParticipantInformation(d.id,await infoInput(d.id,{city:'Pune'}))
 assert.equal((await orders.get(order.id)).confirmationReview.missing.length,1)
 await assert.rejects(orders.transition(order.id,{action:'confirm',version:1}),status(409))
 await orders.transition(order.id,{action:'cancel',version:1,reason:'Correct correspondence'})
 await crm.saveQuotation(d.id,{content:content(),version:1},q.id)
 const replacement=await orders.create({quotationId:q.id,revision:2})
 assert.deepEqual((await orders.get(replacement.id)).confirmationReview.missing,[])
 await orders.transition(replacement.id,{action:'confirm',version:1})
 const accepted=await orders.get(replacement.id)
 assert.equal(accepted.participantAcceptance.configurationVersion,config.version);assert.deepEqual(accepted.participantAcceptance.definition,definition)
 const stricter=defaultParticipantDefinition();stricter.required.CUSTOMER=['phone'];await publish(stricter)
 assert.deepEqual((await orders.get(replacement.id)).participantAcceptance,accepted.participantAcceptance)
 await assert.rejects(root.salesOrder.update({where:{tenantId_id:{tenantId:tenant,id:replacement.id}},data:{participantAcceptance:{},status:'CANCELLED',version:3}}),/immutable/)
 await orders.transition(replacement.id,{action:'cancel',version:2,reason:'Retain acceptance history'})
 assert.deepEqual((await orders.get(replacement.id)).participantAcceptance,accepted.participantAcceptance)
 await publish(defaultParticipantDefinition())
})
test('required role checks cover every co-applicant while preserving one commercial total',async()=>{
 const definition=defaultParticipantDefinition();definition.required.ADDITIONAL_CUSTOMER=['email'];await publish(definition)
 const d=await deal();await replace(d.id,[selection(additional),selection(business,'ADDITIONAL_CUSTOMER','BUSINESS')])
 const q=await crm.saveQuotation(d.id,{content:content()}),orders=applicationSalesOrders(db,identity(admin)),order=await orders.create({quotationId:q.id,revision:1})
 await assert.rejects(orders.transition(order.id,{action:'confirm',version:1}),e=>e.status===409&&e.message.includes('Participating company: Email'))
 await publish(defaultParticipantDefinition())
 await orders.transition(order.id,{action:'confirm',version:1})
 assert.equal(String((await orders.get(order.id)).consideration),'100')
})
test('confirmation waiting for configuration publication applies the newly committed rules',async()=>{
 const d=await deal(),q=await crm.saveQuotation(d.id,{content:content()}),orders=applicationSalesOrders(db,identity(admin)),order=await orders.create({quotationId:q.id,revision:1})
 const current=await settings().get(),definition=defaultParticipantDefinition();definition.required.CUSTOMER=['city']
 let locked,release;const ready=new Promise(resolve=>{locked=resolve}),hold=new Promise(resolve=>{release=resolve})
 const writer=root.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${tenant} FOR UPDATE`
  await tx.participantFormConfiguration.update({where:{tenantId:tenant},data:{version:current.version+1,definition}})
  locked();await hold
 },{timeout:20000})
 try{
  await ready;const result=assert.rejects(orders.transition(order.id,{action:'confirm',version:1}),status(409))
  await new Promise(resolve=>setTimeout(resolve,100));release();await writer;await result
  const saved=await orders.get(order.id);assert.equal(saved.status,'DRAFT');assert.equal(saved.participantAcceptance,null)
 }finally{release();await writer;await publish(defaultParticipantDefinition())}
})
test('mandatory audit failure rolls back information, configuration publication and confirmation proof',async()=>{
 const d=await deal(),input=await infoInput(d.id,{city:'Pune'}),before=await crm.getOpportunityParticipantInformation(d.id),broken=brokenAudit()
 await assert.rejects(service(admin,broken).saveOpportunityParticipantInformation(d.id,input),/Audit unavailable/)
 assert.deepEqual(await crm.getOpportunityParticipantInformation(d.id),before)
 const current=await settings().get(),definition=defaultParticipantDefinition();definition.title='Another caption'
 const proposal={version:current.version,definition},preview=await settings().preview(proposal)
 await assert.rejects(settings(admin,broken).publish({...proposal,previewHash:preview.previewHash}),/Audit unavailable/)
 assert.equal((await settings().get()).version,current.version)
 const q=await crm.saveQuotation(d.id,{content:content()}),orders=applicationSalesOrders(db,identity(admin)),order=await orders.create({quotationId:q.id,revision:1})
 await assert.rejects(applicationSalesOrders(broken,identity(admin)).transition(order.id,{action:'confirm',version:1}),/Audit unavailable/)
 const retained=await orders.get(order.id);assert.equal(retained.status,'DRAFT');assert.equal(retained.participantAcceptance,null)
})
