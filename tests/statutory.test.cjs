/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test'),assert=require('node:assert/strict'),{gstFinancialYear,gstDocumentNumber,statutoryFactsSchema,statutoryReadiness}=require('../platform/tax/localizations/india-statutory.ts')
test('statutory series follow April financial years and stay within 16 characters',()=>{
 assert.equal(gstFinancialYear('2026-03-31'),2025);assert.equal(gstFinancialYear('2026-04-01'),2026)
 assert.equal(gstDocumentNumber('AB12',2026,1),'AB12/2627/000001');assert.equal(gstDocumentNumber('AB12',2026,999999).length,16)
 for(const args of [['ABCDE',2026,1],['A',2026,0],['A',2026,1000000],['A',2026,1.5],['A',1999,1]])assert.throws(()=>gstDocumentNumber(...args))
})
test('facts require explicit domestic, forward-charge, no-QR review and exact line identities',()=>{
 const f={kind:'TAX_INVOICE',issueOn:'2026-10-31',taxPointOn:'2026-10-31',seriesId:'s',seriesVersion:1,signatureMode:'MANUAL',signatory:'Authorized signer',domestic:true,reverseCharge:false,dynamicQrNotRequired:true,complianceBasis:'Reviewed explicit forward-charge and applicability basis.',timingBasis:'Reviewed actual source supply timing and eligibility.',deliveryAddress:'Customer street, Pune 411001',deliveryState:'27',lines:[{lineIndex:0,quantity:'1',unit:'NOS'}]}
 assert(statutoryFactsSchema.safeParse(f).success)
 for(const p of [{reverseCharge:true},{domestic:false},{dynamicQrNotRequired:false},{deliveryState:'25'},{issueOn:'2026-02-30'},{lines:[...f.lines,...f.lines]},{lines:[{lineIndex:0,quantity:'1e3',unit:'NOS'}]}])assert(!statutoryFactsSchema.safeParse({...f,...p}).success)
 const s={status:'POSTED',currency:'INR',version:2,tax:{policy:'REMAINING_BALANCE_V1',taxMinor:0,lines:[{key:'0'}]},accepted:{issuer:{},recipient:{},lines:[]}}
 const e=statutoryReadiness(s,f,f.issueOn);assert(e.some(x=>x.includes('e-invoice')||x.includes('E-invoice')));assert(e.some(x=>x.includes('frozen')))
})
