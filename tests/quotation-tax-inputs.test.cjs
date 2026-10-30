/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test'),assert=require('node:assert/strict')
const {taxInputSaveSchema:schema,taxInputIllustration,withinTaxDates}=require('../platform/tax/source-inputs.ts')
const profile={format:1,name:'QA synthetic service',scheme:'IN_GST',enabled:true,supplyKind:'SERVICES',treatment:'TAXABLE',classificationKind:'SAC',classificationCode:'998311',basisReference:'QA reviewed basis',priceBasis:'INCLUSIVE',zeroRatedMode:'NOT_APPLICABLE',variants:[{key:'INTER_STATE',components:[{code:'IGST',rateId:'r',name:'QA rate',percent:'18',sourceUpdatedAt:'2026-01-01T00:00:00.000Z'}]}]}
const input={revision:1,mappingVersion:1,issuerId:'i',issuerVersion:1,recipientId:'p',recipientVersion:1,proposedSupplyOn:'2026-01-01',reviewed:true,lines:[{lineIndex:0,profileId:'t',profileVersion:1,variant:'INTER_STATE',placeCountryCode:'IN',placeRegionCode:'29',placeBasis:'QA confirmed delivery location'}]}
test('tax preparation accepts only reviewed references and explicit dated supply evidence',()=>{
 assert(schema.safeParse(input).success)
 for(const patch of [{reviewed:false},{revision:0},{issuerSnapshot:{}},{recipientVersion:0},{proposedSupplyOn:'2026-02-30'},{lines:[]},{lines:[input.lines[0],input.lines[0]]},{lines:[{...input.lines[0],placeCountryCode:'US'}]},{lines:[{...input.lines[0],placeBasis:'guess'}]},{lines:[{...input.lines[0],placeRegionCode:'00'}]}])assert(!schema.safeParse({...input,...patch}).success)
 assert(withinTaxDates('2026-01-01',{effectiveFrom:new Date('2026-01-01'),effectiveTo:new Date('2026-01-01')}));assert(!withinTaxDates('2025-12-31',{effectiveFrom:new Date('2026-01-01'),effectiveTo:null}))
})
test('illustration preserves source values, reports price differences and never interprets commercial charge labels',()=>{
 const source={currency:'INR',consideration:'118.00',discount:'0.00',charges:[],lines:[{amount:'118.00'}]},saved=[{lineIndex:0,variant:'INTER_STATE',profileSnapshot:profile}]
 const r=taxInputIllustration(source,saved);assert.equal(r.calculation.netMinor,10000);assert.equal(r.calculation.grossMinor,11800);assert.equal(r.difference,'0.00')
 const different=taxInputIllustration(source,[{...saved[0],profileSnapshot:{...profile,priceBasis:'EXCLUSIVE'}}]);assert.equal(different.difference,'21.24');assert.equal(source.consideration,'118.00')
 for(const patch of [{discount:'1.00'},{charges:[{label:'GST',value:'18'}]},{charges:[{label:'Other',value:'0'}]}])assert.equal(taxInputIllustration({...source,...patch},saved).calculation,null)
 assert.throws(()=>taxInputIllustration(source,[]));assert.throws(()=>taxInputIllustration(source,[{...saved[0],variant:'INTRA_STATE'}]));assert.equal(profile.variants[0].components[0].percent,'18')
})
