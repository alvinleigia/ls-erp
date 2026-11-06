/* eslint-disable @typescript-eslint/no-require-imports */
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Pool}=require('pg'),{PrismaClient}=require('@prisma/client')
const {fixtureUser,fixtureRole,fixtureProfile,resetFixtureRoles}=require('./helpers/access-fixtures.cjs')
const {TenantPgAdapter}=require('../lib/tenant-pg-adapter.ts'),{runWithDatabaseActor}=require('../lib/database-actor.ts')
const {createApplicationCrmService}=require('../application/crm/service.ts'),{applicationSalesOrders}=require('../application/sales-orders/service.ts')
const {createRecordSharingService}=require('../platform/access/sharing-service.ts')
const {emptyCorrespondence}=require('../platform/participants/information.ts'),{emptyQuotationContent}=require('../modules/sales-documents/quotation-validation.ts')
require('../lib/logger.ts').logger.info=()=>{}
const url=new URL(process.env.CRM_TEST_DATABASE_URL||'http://invalid')
if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!='/ls_salon_crm_test')throw Error('Isolated local database only.')
const tenant='addresses_'+randomUUID(),foreignTenant='addresses_'+randomUUID(),pools=[],clients=[]
function client(tenantId,root=false){const u=new URL(url);if(!root){u.username='crm_test_runtime';u.password=''}const pool=new Pool({connectionString:u.toString(),max:4});pools.push(pool);const db=new PrismaClient({adapter:new TenantPgAdapter(pool,{tenantId,bypass:root})});clients.push(db);return db}
const root=client(undefined,true),db=client(tenant),foreignDb=client(foreignTenant),identity=user=>({tenantId:user.tenantId,userId:user.id}),status=code=>e=>e.status===code
let admin,staff,other,foreign,crm,staffCrm,otherCrm,foreignCrm,contact,business,hidden,pipeline,stage
const owner=party=>({kind:party===business?'BUSINESS':'PERSON',id:party.id})
const values=(city='Panaji')=>({...emptyCorrespondence,addressLine1:'Office road',city,country:'India'})
const fields=(name,patch={})=>({name,purposes:['CORRESPONDENCE','BILLING','DELIVERY'],values:values(),defaultCorrespondence:false,defaultBilling:false,defaultDelivery:false,archived:false,...patch})
function editable(row,patch={}){return {...fields(row.name),purposes:row.purposes,values:row.values,defaultCorrespondence:row.defaultCorrespondence,defaultBilling:row.defaultBilling,defaultDelivery:row.defaultDelivery,archived:row.archived,version:row.version,...patch}}
async function deal(p=contact,accountId){return crm.createOpportunity({title:'Address transaction',contactId:p.id,...(accountId?{accountId}:{}),assignedUserId:staff.id,pipelineId:pipeline.id,stageId:stage.id,amount:'100',currency:'INR',expectedCloseOn:'2027-01-01'})}
async function saveInfo(id,records,service=crm){const current=await service.getOpportunityParticipantInformation(id);return service.saveOpportunityParticipantInformation(id,{version:current.version,configurationVersion:current.configuration.version,information:{format:1,records}})}
before(async()=>{
 await root.tenant.createMany({data:[tenant,foreignTenant].map(id=>({id,slug:id,name:id}))})
 const user=(tenantId,role)=>fixtureUser(root,{data:{tenantId,role,name:role,email:randomUUID()+'@example.test'}})
 admin=await user(tenant,'ADMIN');staff=await user(tenant,'STAFF');other=await user(tenant,'STAFF');foreign=await user(foreignTenant,'ADMIN')
 await root.tenantModule.createMany({data:[tenant,foreignTenant].flatMap(tenantId=>['crm','salesDocuments','salesOrders'].map(key=>({tenantId,key,allowed:true,enabled:true})))})
 crm=createApplicationCrmService(db,identity(admin));staffCrm=createApplicationCrmService(db,identity(staff));otherCrm=createApplicationCrmService(db,identity(other));foreignCrm=createApplicationCrmService(foreignDb,identity(foreign))
 contact=await root.crmContact.create({data:{tenantId:tenant,name:'Address buyer',city:'Profile town',country:'India',ownerUserId:staff.id}})
 hidden=await root.crmContact.create({data:{tenantId:tenant,name:'Private buyer',ownerUserId:other.id}})
 business=await root.crmAccount.create({data:{tenantId:tenant,name:'Buying company',ownerUserId:staff.id}})
 pipeline=await root.crmPipeline.create({data:{tenantId:tenant,name:'Generic sales'}});stage=await root.crmStage.create({data:{tenantId:tenant,pipelineId:pipeline.id,name:'Open',position:0,kind:'OPEN',probability:10,color:'#123456'}})
})
after(async()=>{await Promise.all(clients.map(c=>c.$disconnect()));await Promise.all(pools.map(p=>p.end()))})

test('owner CRUD transfers per-purpose defaults atomically and preserves other defaults',async()=>{
 const o=owner(contact),home=await staffCrm.createPartyAddress(o,fields('Home',{defaultCorrespondence:true,defaultBilling:true}))
 const office=await staffCrm.createPartyAddress(o,fields('Office',{defaultBilling:true,defaultDelivery:true}))
 const saved=await crm.getPartyAddress(o,home.id)
 assert.equal(saved.defaultCorrespondence,true);assert.equal(saved.defaultBilling,false);assert.equal(saved.version,2)
 assert.equal((await crm.listPartyAddresses(o,{purpose:'BILLING',pageSize:1})).total,2)
 assert.equal((await crm.listPartyAddresses(o,{q:'office'})).items[0].id,office.id)
 await assert.rejects(crm.createPartyAddress(o,fields('HOME')),status(409))
 await assert.rejects(crm.updatePartyAddress(o,home.id,editable(home,{values:values('Stale')})),status(409))
 const edited=await crm.updatePartyAddress(o,home.id,editable(saved,{values:values('Changed home')}))
 assert.equal(edited.version,3)
 const events=await root.auditLog.count({where:{tenantId:tenant,entityId:contact.id,event:{startsWith:'crm.contact.address.'}}});assert.ok(events>=4)
})
test('parallel defaults serialize on the owner, leaving one default with no lost versions',async()=>{
 const o=owner(business),results=await Promise.all([crm.createPartyAddress(o,fields('HQ',{defaultBilling:true})),crm.createPartyAddress(o,fields('Branch',{defaultBilling:true}))])
 const rows=(await crm.listPartyAddresses(o,{})).items
 assert.equal(rows.filter(row=>row.defaultBilling).length,1);assert.equal(rows.reduce((sum,row)=>sum+row.version,0),3)
 assert.ok(results.every(row=>rows.some(saved=>saved.id===row.id)))
})
test('canonical owner scope and directory permissions govern children and raw RLS',async()=>{
 const privateAddress=await crm.createPartyAddress(owner(hidden),fields('Hidden home'))
 await assert.rejects(staffCrm.listPartyAddresses(owner(hidden),{}),status(404))
 await assert.rejects(otherCrm.getPartyAddress(owner(contact),privateAddress.id),status(404))
 await assert.rejects(foreignCrm.listPartyAddresses(owner(contact),{}),status(404))
 const sharing=createRecordSharingService(db,identity(admin)),state=await sharing.get('contacts',hidden.id)
 await sharing.save('contacts',hidden.id,{version:state.version,restricted:true,grants:[]})
 assert.equal(await runWithDatabaseActor(staff.id,()=>db.partyAddress.count({where:{id:privateAddress.id}})),0)
 const restricted=await sharing.get('contacts',hidden.id)
 await sharing.save('contacts',hidden.id,{version:restricted.version,restricted:true,grants:[{kind:'USER',id:staff.id,level:'READ'}]})
 assert.equal((await staffCrm.listPartyAddresses(owner(hidden),{})).total,1)
 await assert.rejects(staffCrm.createPartyAddress(owner(hidden),fields('Read is not Edit')),status(404))
 const profile=await fixtureProfile(root,{data:{tenantId:tenant,name:'No directory',nameKey:randomUUID(),permissions:['opportunities.read','opportunities.edit']}})
 await fixtureRole(root,{data:{tenantId:tenant,userId:staff.id,roleId:profile.id}})
 try{await assert.rejects(staffCrm.listPartyAddresses(owner(contact),{}),status(403))}finally{await resetFixtureRoles(root,{where:{tenantId:tenant,userId:staff.id}})}
})
test('archive requires owner Archive authority, detaches defaults, and preserves history',async()=>{
 const o=owner(contact),a=await crm.createPartyAddress(o,fields('Archive me',{defaultDelivery:true}))
 const profile=await fixtureProfile(root,{data:{tenantId:tenant,name:'Directory edit only',nameKey:randomUUID(),permissions:['contacts.read','contacts.edit']}})
 await fixtureRole(root,{data:{tenantId:tenant,userId:staff.id,roleId:profile.id}})
 try{await assert.rejects(staffCrm.updatePartyAddress(o,a.id,editable(a,{archived:true,defaultDelivery:false})),status(403))}finally{await resetFixtureRoles(root,{where:{tenantId:tenant,userId:staff.id}})}
 const archived=await crm.updatePartyAddress(o,a.id,editable(a,{archived:true,defaultDelivery:false}))
 assert.equal((await crm.listPartyAddresses(o,{status:'active'})).items.some(r=>r.id===a.id),false)
 assert.equal((await crm.listPartyAddresses(o,{status:'archived'})).items[0].id,a.id)
 const restored=await crm.updatePartyAddress(o,a.id,editable(archived,{archived:false}));assert.equal(restored.version,3)
 await assert.rejects(root.partyAddress.delete({where:{id:a.id}}))
 await assert.rejects(root.partyAddress.update({where:{id:a.id},data:{contactId:hidden.id,version:{increment:1}}}))
 await assert.rejects(root.partyAddress.update({where:{id:a.id},data:{name:'No version increment'}}))
})
test('new transactions seed defaults once; owner changes and project-specific edits do not synchronize',async()=>{
 const o=owner(contact),address=await crm.createPartyAddress(o,fields('New default',{defaultCorrespondence:true,defaultBilling:true,defaultDelivery:true,values:values('Accepted town')}))
 const a=await deal(),b=await deal(),initial=await crm.getOpportunityParticipantInformation(a.id)
 assert.equal(initial.participants[0].information.city,'Accepted town');assert.equal(initial.participants[0].addresses.billing.city,'Accepted town')
 await crm.updatePartyAddress(o,address.id,editable(address,{values:values('Later directory town')}))
 assert.equal((await crm.getOpportunityParticipantInformation(a.id)).participants[0].information.city,'Accepted town')
 const party={kind:'PERSON',id:contact.id}
 await saveInfo(a.id,[{party,values:values('Project A town'),addresses:{billing:values('Billing A'),delivery:values('Site A')}}])
 assert.equal((await crm.getOpportunityParticipantInformation(b.id)).participants[0].information.city,'Accepted town')
 assert.equal((await crm.getContact(contact.id)).city,'Profile town')
 const later=await deal();assert.equal((await crm.getOpportunityParticipantInformation(later.id)).participants[0].information.city,'Later directory town')
})
test('forged/stale/wrong-purpose/foreign address selections fail; accepted refs survive archive or lost Read',async()=>{
 const o=owner(contact),a=await crm.createPartyAddress(o,fields('Selection')),b=await crm.createPartyAddress(owner(hidden),fields('Private selection')),delivery=await crm.createPartyAddress(o,fields('Delivery only',{purposes:['DELIVERY']})),d=await deal()
 const record=(id,version=1)=>({party:{kind:'PERSON',id:contact.id},values:values('Submitted'),addresses:{billing:values('Forged')},addressReferences:{billing:{id,version}}})
 for(const item of [record(b.id),record(delivery.id),record(a.id,99)])await assert.rejects(saveInfo(d.id,[item]),status(409))
 const accepted=await saveInfo(d.id,[record(a.id)]);assert.equal(accepted.participants[0].addresses.billing.city,'Panaji')
 await crm.updatePartyAddress(o,a.id,editable(a,{archived:true}))
 const row={party:{kind:'PERSON',id:contact.id},values:accepted.participants[0].information,addresses:accepted.participants[0].addresses,addressReferences:accepted.participants[0].addressReferences}
 const profile=await fixtureProfile(root,{data:{tenantId:tenant,name:'Transaction only',nameKey:randomUUID(),permissions:['opportunities.read','opportunities.edit']}})
 await fixtureRole(root,{data:{tenantId:tenant,userId:staff.id,roleId:profile.id}})
 try{
  const retained=await saveInfo(d.id,[row],staffCrm);assert.equal(retained.participants[0].addresses.billing.city,'Panaji');assert.deepEqual(retained.addressBooks,[])
  row.addresses.billing.city='Manual override'
  const manual=await saveInfo(d.id,[row],staffCrm);assert.equal(manual.participants[0].addressReferences.billing,undefined)
  await assert.rejects(saveInfo(d.id,[record(b.id)],staffCrm),status(403))
 }finally{await resetFixtureRoles(root,{where:{tenantId:tenant,userId:staff.id}})}
})
test('quotation and order freeze all address purposes and references independently of current CIF and masters',async()=>{
 const d=await deal(),party={kind:'PERSON',id:contact.id}
 await saveInfo(d.id,[{party,values:values('Correspondence accepted'),addresses:{billing:values('Billing accepted'),delivery:values('Site accepted')}}])
 const content={...structuredClone(emptyQuotationContent),title:'Address test quotation',supplierName:'Generic company',currency:'INR',lines:[{description:'Service',quantity:'1',unit:'hour',rate:'100'}]}
 const quote=await crm.saveQuotation(d.id,{content}),snapshot=(await crm.getQuotation(quote.id)).snapshot
 const orders=applicationSalesOrders(db,identity(admin)),order=await orders.create({quotationId:quote.id,revision:1})
 await saveInfo(d.id,[{party,values:values('Changed'),addresses:{billing:values('Changed'),delivery:values('Changed')}}])
 assert.deepEqual((await crm.getQuotation(quote.id)).snapshot,snapshot)
 const saved=await orders.get(order.id)
 assert.equal(saved.snapshot.participants.participants[0].addresses.billing.city,'Billing accepted');assert.equal(saved.snapshot.participants.participants[0].addresses.delivery.city,'Site accepted')
 assert.equal(saved.snapshot.participants.participants[0].information.city,'Correspondence accepted')
})
test('native owner FK rejects cross-tenant/double owners and active addresses on archived owners',async()=>{
 const foreignContact=await root.crmContact.create({data:{tenantId:foreignTenant,name:'Foreign buyer',ownerUserId:foreign.id}})
 for(const patch of [{contactId:foreignContact.id},{contactId:contact.id,accountId:business.id},{contactId:null,accountId:null}])await assert.rejects(root.partyAddress.create({data:{...fields('Invalid '+randomUUID()),tenantId:tenant,contactId:contact.id,...patch}}))
 const archived=await root.crmContact.create({data:{tenantId:tenant,name:'Archived buyer',ownerUserId:admin.id,archived:true}})
 await assert.rejects(crm.createPartyAddress(owner(archived),fields('No active owner')),status(409))
})

test('mandatory audit failure rolls back both the new address and default transfer',async()=>{
 const o=owner(contact),before=(await crm.listPartyAddresses(o,{})).items
 const broken=new Proxy(db,{get(target,key){if(key==='$transaction')return (fn,options)=>target.$transaction(tx=>fn(new Proxy(tx,{get(t,k){if(k==='auditLog')return new Proxy(t.auditLog,{get(a,m){return m==='createMany'?async()=>{throw Error('Audit unavailable')}:a[m]}});return t[k]}})),options);return target[key]}})
 const failing=createApplicationCrmService(broken,identity(admin))
 await assert.rejects(failing.createPartyAddress(o,fields('Must roll back',{defaultCorrespondence:true,defaultBilling:true})),/Audit unavailable/)
 assert.deepEqual((await crm.listPartyAddresses(o,{})).items,before)
})

test('business buyers receive only their own defaults, separately from their linked representative',async()=>{
 await crm.linkContactAccount(contact.id,{accountId:business.id})
 const address=await crm.createPartyAddress(owner(business),fields('Business billing default',{purposes:['BILLING','DELIVERY'],defaultBilling:true,defaultDelivery:true,values:values('Business town')}))
 const source=await deal(contact,business.id),info=await crm.getOpportunityParticipantInformation(source.id)
 const buyer=info.participants.find(row=>row.party.id===business.id),person=info.participants.find(row=>row.party.id===contact.id)
 assert.equal(buyer.role,'CUSTOMER');assert.deepEqual(buyer.information,emptyCorrespondence)
 assert.equal(buyer.addresses.billing.city,'Business town');assert.equal(buyer.addresses.delivery.city,'Business town');assert.equal(buyer.addressReferences.billing.id,address.id)
 assert.notEqual(person.information.city,'Business town')
})
