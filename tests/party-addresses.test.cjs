/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test'),assert=require('node:assert/strict')
const {addressFieldsSchema,addressCreateSchema,addressUpdateSchema}=require('../platform/addresses/contracts.ts')
const {emptyCorrespondence}=require('../platform/participants/information.ts')
const {participantInformationSchema}=require('../platform/participants/validation.ts')
const {withParticipantInformation,initializeParticipantInformation}=require('../platform/participants/source-information.ts')
const {contactInformationDefaults,resolveParticipantAddressSelections}=require('../modules/crm/participant-defaults.ts')
const {participantAddressBlocks,participantDocumentBlocks}=require('../platform/participants/document-blocks.ts')
const person={kind:'PERSON',id:'person'},business={kind:'BUSINESS',id:'business'},values={...emptyCorrespondence,addressLine1:'Home road',city:'Panaji',country:'India'}
const fields=()=>({name:'Home',purposes:['CORRESPONDENCE','BILLING'],values,defaultCorrespondence:true,defaultBilling:true,defaultDelivery:false,archived:false})
test('named address purpose/default and validation rules are explicit and bounded',()=>{
 assert.equal(addressCreateSchema.parse(fields()).values.city,'Panaji')
 assert.equal(addressUpdateSchema.parse({...fields(),version:1}).version,1)
 for(const changes of [{purposes:[]},{purposes:['BILLING','BILLING']},{purposes:['BILLING']},{archived:true},{values:{...values,country:''}},{name:'x'.repeat(101)},{tenantId:'foreign'}])assert.equal(addressCreateSchema.safeParse({...fields(),...changes}).success,false)
 assert.equal(addressFieldsSchema.safeParse({...fields(),archived:true,defaultCorrespondence:false,defaultBilling:false}).success,true)
})
test('contact and business defaults stay independent, scoped and copied by purpose',async()=>{
 const calls=[],tx={crmContact:{findMany:async q=>{calls.push(q);return [{id:person.id,email:'person@example.test',city:'Profile town'}]}},crmAccount:{findMany:async q=>{calls.push(q);return [{id:business.id}]}},partyAddress:{findMany:async()=>[{id:'home',contactId:person.id,version:3,values,defaultCorrespondence:true,defaultBilling:false,defaultDelivery:false},{id:'office',accountId:business.id,version:4,values:{...values,addressLine1:'Business office'},defaultCorrespondence:false,defaultBilling:true,defaultDelivery:true}]}}
 const actor={tenantId:'t',userId:'a',role:'ADMIN'},result=await contactInformationDefaults(tx,actor,[person,business])
 assert.equal(result.records[0].values.addressLine1,'Home road');assert.equal(result.records[0].addressReferences.correspondence.version,3)
 assert.deepEqual(result.records[1].values,emptyCorrespondence);assert.equal(result.records[1].addresses.billing.addressLine1,'Business office');assert.equal(result.records[1].addresses.delivery.addressLine1,'Business office')
 assert.equal(calls.length,2);assert.ok(calls.every(q=>q.where.archived===false))
 assert.deepEqual(await contactInformationDefaults({}, {...actor,permissions:['opportunities.edit']},[person,business]),{format:1,records:[]})
})
test('equal person/business IDs never copy personal correspondence into a buying company',async()=>{
 const tx={crmContact:{findMany:async()=>[{id:'same-id',email:'private@example.test',addressLine1:'Personal address',country:'India'}]},crmAccount:{findMany:async()=>[{id:'same-id'}]},partyAddress:{findMany:async()=>[]}}
 const result=await contactInformationDefaults(tx,{tenantId:'t',userId:'a',role:'ADMIN'},[{kind:'PERSON',id:'same-id'},{kind:'BUSINESS',id:'same-id'}])
 assert.equal(result.records.length,1);assert.equal(result.records[0].party.kind,'PERSON')
})
test('supplemental address snapshots survive seeding and formatting without changing correspondence',()=>{
 const saved={format:1,records:[{party:person,values,addresses:{billing:{...values,city:'Billing town'},delivery:{...values,city:'Site town'}},addressReferences:{billing:{id:'billing',version:2}}}]}
 const snapshot={format:1,participants:[{role:'CUSTOMER',party:{...person,name:'Buyer',email:null,phone:null,sourceVersion:1}}]}
 const accepted=withParticipantInformation(snapshot,saved),copy=initializeParticipantInformation(saved,{format:1,records:[]})
 saved.records[0].addresses.billing.city='Later edit'
 assert.equal(accepted.participants[0].addresses.billing.city,'Billing town');assert.equal(copy.records[0].addresses.billing.city,'Billing town')
 assert.match(JSON.stringify(participantDocumentBlocks(accepted)),/Panaji/);assert.doesNotMatch(JSON.stringify(participantDocumentBlocks(accepted)),/Billing town/)
 assert.match(JSON.stringify(participantAddressBlocks(accepted)),/Billing town/);assert.match(JSON.stringify(participantAddressBlocks(accepted)),/Site town/)
 assert.deepEqual(participantAddressBlocks(snapshot),[])
 assert.equal(participantInformationSchema.safeParse({...saved,records:[{...saved.records[0],addresses:{tax:values}}]}).success,false)
})
test('retained address versions survive directory changes and revocation; manual edits detach only their reference',async()=>{
 const saved={format:1,records:[{party:person,values,addresses:{billing:{...values}},addressReferences:{correspondence:{id:'old',version:1},billing:{id:'billing',version:2}}}]}
 const actor={tenantId:'t',userId:'staff',role:'STAFF',permissions:['opportunities.edit']}
 assert.deepEqual(await resolveParticipantAddressSelections({},actor,saved,saved),saved)
 const input=structuredClone(saved);input.records[0].values.addressLine1='Project-specific address'
 const result=await resolveParticipantAddressSelections({},actor,input,saved)
 assert.equal(result.records[0].addressReferences.correspondence,undefined);assert.equal(result.records[0].addressReferences.billing.id,'billing')
 await assert.rejects(resolveParticipantAddressSelections({},actor,input,undefined),e=>e.status===403)
})
test('new address selection resolves authorized exact owner/purpose/version instead of trusting submitted values',async()=>{
 let query;const actor={tenantId:'t',userId:'a',role:'ADMIN'},tx={$queryRaw:async()=>[],crmContact:{findMany:async()=>[{id:person.id}]},partyAddress:{findFirst:async q=>{query=q;return {id:'home',version:2,values}}}}
 const incoming={format:1,records:[{party:person,values:emptyCorrespondence,addresses:{billing:{...values,city:'Forged'}},addressReferences:{billing:{id:'home',version:2}}}]}
 const result=await resolveParticipantAddressSelections(tx,actor,incoming)
 assert.equal(result.records[0].addresses.billing.city,'Panaji');assert.equal(query.where.contactId,person.id);assert.equal(query.where.accountId,null);assert.equal(query.where.purposes.has,'BILLING');assert.equal(query.where.archived,false)
 incoming.records[0].addressReferences.billing.version=1
 await assert.rejects(resolveParticipantAddressSelections(tx,actor,incoming),e=>e.status===409)
})
