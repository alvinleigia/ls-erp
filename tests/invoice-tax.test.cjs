/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test'),assert=require('node:assert/strict'),{calculateTaxAgreement,addTaxPortions}=require('../platform/tax/agreement.ts'),{allocateInvoiceTax}=require('../platform/tax/invoice-allocation.ts')
const source={orderId:'o',approvalId:'a'},agreement=()=>calculateTaxAgreement({currency:'INR',minorDigits:2,lines:[{key:'0',amountMinor:11800,discountMinor:0,priceBasis:'INCLUSIVE',components:[{code:'CGST',percent:'9'},{code:'SGST',percent:'9'}]}]})
test('partial allocations consume actual remaining net/component balances and the final bill reconciles exactly',()=>{
 const a=agreement(),previous=[];for(const amount of ['0.01','0.01','0.01','49.97','68.00'])previous.push(allocateInvoiceTax(a,source,previous,[{lineIndex:0,amount}]))
 const total=previous.map(p=>p.lines[0]).reduce(addTaxPortions);assert.equal(total.grossMinor,11800);assert.equal(total.netMinor,10000);assert.deepEqual(total.components,[{code:'CGST',amountMinor:900},{code:'SGST',amountMinor:900}]);assert.equal(a.grossMinor,11800)
 assert.throws(()=>allocateInvoiceTax(a,source,previous,[{lineIndex:0,amount:'0.01'}]));assert.throws(()=>allocateInvoiceTax(a,source,[],[{lineIndex:1,amount:'1'}]));assert.throws(()=>allocateInvoiceTax(a,source,[],[{lineIndex:0,amount:'1'},{lineIndex:0,amount:'1'}]))
})
test('removing an actual credited reservation restores exactly those components, without current-rate calculation',()=>{
 const a=agreement(),one=allocateInvoiceTax(a,source,[],[{lineIndex:0,amount:'50'}]),two=allocateInvoiceTax(a,source,[one],[{lineIndex:0,amount:'68'}]),replaced=allocateInvoiceTax(a,source,[two],[{lineIndex:0,amount:'50'}]);assert.deepEqual(replaced,one)
 assert.throws(()=>allocateInvoiceTax(a,source,[{...one,approvalId:'other'}],[{lineIndex:0,amount:'1'}]));assert.throws(()=>allocateInvoiceTax(a,source,[one],[{lineIndex:0,amount:'68.001'}]))
})
