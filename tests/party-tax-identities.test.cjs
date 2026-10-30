/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test'),assert=require('node:assert/strict')
const {partyTaxCreateSchema:create,partyTaxUpdateSchema:update,partyTaxOwnerSchema:owner,partyTaxQuerySchema:query}=require('../platform/tax/party/contracts.ts')
const body={scheme:'IN_GST',status:'REGISTERED',registrationNumber:'27AAPFU0939F1ZV',regionCode:'27',category:'REGULAR',legalName:'QA customer',addressLine1:'',addressLine2:'',city:'',postalCode:'',effectiveFrom:'2026-01-01',effectiveTo:null,archived:false,reviewed:true}
test('recipient identity has explicit reviewed status, native owner and strict localized registration facts',()=>{
 assert.equal(create.parse({...body,registrationNumber:body.registrationNumber.toLowerCase()}).registrationNumber,body.registrationNumber)
 for(const patch of [{reviewed:false},{status:'NOT_ASSESSED'},{scheme:'OTHER'},{registrationNumber:'27AAPFU0939F1ZO'},{regionCode:'29'},{category:'NOT_APPLICABLE'},{postalCode:'123'},{effectiveTo:'2025-12-31'},{archived:true},{effectiveFrom:'2026-02-30'},{tenantId:'forged'}])assert.equal(create.safeParse({...body,...patch}).success,false,JSON.stringify(patch))
 assert(create.safeParse({...body,status:'UNREGISTERED',registrationNumber:'',category:'NOT_APPLICABLE',regionCode:''}).success)
 assert(!create.safeParse({...body,status:'UNREGISTERED'}).success)
 assert(!owner.safeParse({kind:'PERSON',id:'',tenantId:'x'}).success)
 assert(!owner.safeParse({kind:'SUPPLIER',id:'x'}).success)
})
test('review updates cannot move ownership or change registration identity; lists and history are bounded',()=>{
 const {scheme,status,registrationNumber,...fields}=body;void scheme;void status;void registrationNumber
 assert(update.safeParse({...fields,version:1}).success)
 for(const patch of [{version:0},{contactId:'x'},{registrationNumber:body.registrationNumber},{status:'UNREGISTERED'}])assert(!update.safeParse({...fields,version:1,...patch}).success)
 assert.equal(query.parse({}).pageSize,10);for(const q of [{page:0},{pageSize:51},{status:'unknown'}])assert(!query.safeParse(q).success)
})
