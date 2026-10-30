/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test'),assert=require('node:assert/strict'),{sourceTaxPricing,taxPricingApprovalSchema}=require('../platform/tax/source-pricing.ts')
const profile={format:1,name:'QA',scheme:'IN_GST',enabled:true,supplyKind:'SERVICES',treatment:'TAXABLE',classificationKind:'NONE',classificationCode:'',basisReference:'QA only',priceBasis:'INCLUSIVE',zeroRatedMode:'NOT_APPLICABLE',variants:[{key:'INTRA_STATE',components:[{code:'CGST',rateId:'a',name:'A',percent:'9',sourceUpdatedAt:'2026-01-01T00:00:00Z'},{code:'SGST',rateId:'b',name:'B',percent:'9',sourceUpdatedAt:'2026-01-01T00:00:00Z'}]}]}
test('pricing reconciles unchanged gross and allocates source discounts exactly by source order',()=>{
 const source={currency:'INR',consideration:'117.99',discount:'0.01',charges:[],lines:[{amount:'59.00'},{amount:'59.00'}]},saved=[0,1].map(lineIndex=>({lineIndex,variant:'INTRA_STATE',profileSnapshot:profile})),d=sourceTaxPricing(source,saved)
 assert.equal(d.reason,'');assert.equal(d.gross,'117.99');assert.deepEqual(d.agreement.lines.map(l=>l.discountMinor),[1,0]);assert.equal(d.agreement.taxMinor+d.agreement.netMinor,11799);assert.equal(source.discount,'0.01')
 const mismatch=sourceTaxPricing(source,saved.map(l=>({...l,profileSnapshot:{...profile,priceBasis:'EXCLUSIVE'}})));assert(mismatch.reason);assert.notEqual(mismatch.gross,'117.99')
 for(const charges of [[{label:'GST'}],[{label:'Other',value:'0'}]])assert.equal(sourceTaxPricing({...source,charges},saved).agreement,null)
 assert.equal(sourceTaxPricing({...source,currency:'USD'},saved).agreement,null)
})
test('approval accepts only a bound saved review, expected total and explicit reviewed basis',()=>{
 const v={revision:1,reviewId:'r',expectedGross:'118.00',basisReference:'QA reviewed price evidence',reviewed:true};assert(taxPricingApprovalSchema.safeParse(v).success)
 for(const patch of [{reviewed:false},{revision:0},{reviewId:''},{agreement:{}},{expectedGross:'118'},{basisReference:'guess'}])assert(!taxPricingApprovalSchema.safeParse({...v,...patch}).success)
})
