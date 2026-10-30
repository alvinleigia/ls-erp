/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test'),assert=require('node:assert/strict')
const {validGstin,gstinCheckDigit}=require('../platform/tax/localizations/india.ts')
const {registrationCreateSchema,taxProfileBodySchema,taxProfilePublishSchema}=require('../platform/tax/contracts.ts')
const base={name:'Reviewed supply',scheme:'IN_GST',enabled:false,supplyKind:'SERVICES',treatment:'NON_GST',classificationKind:'NONE',classificationCode:'',basisReference:'QA reviewed basis',priceBasis:'EXCLUSIVE',zeroRatedMode:'NOT_APPLICABLE',variants:[]}
test('regular GSTIN checks normalize input and reject structural and checksum mistakes',()=>{
 assert(validGstin('27AAPFU0939F1ZV'));assert(!validGstin('27AAPFU0939F1ZO'));assert(!validGstin('00AAPFU0939F1ZV'));assert.equal(gstinCheckDigit('27AAPFU0939F1Z'),'V')
 const r={companyId:'c',scheme:'IN_GST',registrationNumber:' 27aapfu0939f1zv ',label:'QA',legalName:'QA Company',addressLine1:'QA address',city:'Pune',postalCode:'411001',category:'REGULAR',effectiveFrom:'2026-01-01',effectiveTo:null,reviewed:true}
 assert.equal(registrationCreateSchema.parse(r).registrationNumber,'27AAPFU0939F1ZV');assert(!registrationCreateSchema.safeParse({...r,effectiveTo:'2025-12-31'}).success);assert(!registrationCreateSchema.safeParse({...r,reviewed:false}).success)
})
test('profile treatments are explicit, reviewed and independent of business naming',()=>{
 for(const name of ['Property supply','Brokerage service','Manufacturing'])assert(taxProfileBodySchema.safeParse({...base,name}).success)
 assert(!taxProfileBodySchema.safeParse({...base,basisReference:''}).success)
 assert(!taxProfileBodySchema.safeParse({...base,treatment:'TAXABLE'}).success)
 assert(!taxProfilePublishSchema.safeParse({companyId:'c',code:'QA',version:0,reviewed:false,body:base}).success)
 assert(taxProfileBodySchema.safeParse({...base,treatment:'ZERO_RATED',zeroRatedMode:'WITHOUT_PAYMENT'}).success)
 const charged={...base,treatment:'TAXABLE',variants:[{key:'INTRA_STATE',components:[{code:'CGST',rateId:'a'},{code:'SGST',rateId:'b'}]}]}
 assert(taxProfileBodySchema.safeParse(charged).success)
 assert(!taxProfileBodySchema.safeParse({...charged,variants:[...charged.variants,...charged.variants]}).success)
 assert(!taxProfileBodySchema.safeParse({...charged,variants:[{key:'INTRA_STATE',components:[{code:'CGST',rateId:'a'},{code:'IGST',rateId:'b'}]}]}).success)
 assert(!taxProfileBodySchema.safeParse({...base,variants:charged.variants}).success)
})
