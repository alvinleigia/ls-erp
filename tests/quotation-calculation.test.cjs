/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { calculateQuotation } = require('../modules/sales-documents/quotation-calculation.ts')
const { emptyQuotationContent } = require('../modules/sales-documents/quotation-validation.ts')
const sample = (extra = {}) => ({ ...structuredClone(emptyQuotationContent), supplierName: 'Example Developer', currency: 'INR', lines: [{ description: 'Plot 29', quantity: '247', unit: 'sq. m', rate: '15000' }], ...extra })
module.exports.sample = sample
test('reference plan: area, fixed statutory charges, extras and six instalments reconcile', () => {
 const result = calculateQuotation(sample({ charges: [
  { label: 'Stamp duty', group: 'Statutory', kind: 'FIXED', value: '185300', included: false, basis: 'BASE', due: 'At sale deed' },
  { label: 'Registration', group: 'Statutory', kind: 'FIXED', value: '30000', included: false, basis: 'BASE', due: 'At sale deed' },
  { label: 'Club', kind: 'FIXED', value: '40000', included: false, basis: 'BASE', due: 'At sale deed' },
  { label: 'Handling', kind: 'FIXED', value: '35000', included: false, basis: 'BASE', due: 'At sale deed' },
  { label: 'Maintenance', kind: 'TBD', value: '0', included: false, basis: 'BASE', due: 'Per sq. m / month; rate to be confirmed' },
 ], instalments: [10,10,25,25,20,10].map((percent, i) => ({ label: `Milestone ${i+1}`, percent: String(percent), days: [0,30,90,170,220,300][i], note: '' })) }))
 assert.equal(result.groups[0].amount, '215300.00'); assert.equal(result.base, '3705000.00'); assert.equal(result.extras, '290300.00'); assert.equal(result.totalKnown, '3995300.00'); assert.equal(result.hasPending, true)
 assert.deepEqual(result.instalments.map(row => row.amount), ['370500.00','370500.00','926250.00','926250.00','741000.00','370500.00'])
})
test('included percentage, discount and extra consideration-based charge use exact bases', () => {
 const result = calculateQuotation(sample({ discount: '5000', charges: [
  { label: 'PLC', kind: 'PERCENT', value: '10', included: true, basis: 'BASE', due: '' },
  { label: 'Tax', kind: 'PERCENT', value: '5', included: false, basis: 'CONSIDERATION', due: '' },
 ] }))
 assert.equal(result.consideration, '4070500.00'); assert.equal(result.extras, '203525.00')
})
test('rounding never produces a negative final instalment and supports zero/three-decimal currencies', () => {
 for (const [currency, rate, expected] of [['INR','0.01','0.01'],['JPY','1','1'],['KWD','0.001','0.001']]) {
  const result = calculateQuotation(sample({ currency, lines: [{ description: 'Tiny', quantity: '1', unit: '', rate }], instalments: [20,20,20,20,20].map((p,i) => ({ label: String(i), percent:String(p), days:0,note:'' })) }))
  assert.equal(result.consideration, expected)
  assert.equal(result.instalments.reduce((sum,row) => sum + Number(row.amount),0), Number(expected))
  assert.ok(result.instalments.every(row => Number(row.amount) >= 0))
 }
})
test('invalid totals, circular charges, malformed dates, values and incomplete schedules are rejected', () => {
 assert.throws(() => calculateQuotation(sample({ discount: '999999999999' })), /greater than zero/)
 assert.throws(() => calculateQuotation(sample({ instalments: [{ label:'Test', percent:'99.99',days:0,note:'' }] })), /100%/)
 assert.throws(() => calculateQuotation(sample({ charges: [{label:'Circular',kind:'PERCENT',value:'10',basis:'CONSIDERATION',included:true,due:''}] })))
 assert.throws(() => calculateQuotation(sample({ bookingDate: '2026-02-30' })))
 assert.throws(() => calculateQuotation(sample({ lines:[{description:'Bad',quantity:'-1',unit:'',rate:'1'}] })))
 const { quotationContentSchema } = require('../modules/sales-documents/quotation-validation.ts')
 assert.equal(quotationContentSchema.safeParse(sample({instalments:[{label:'Invalid',percent:'-',days:0,note:''}]})).success,false)
})
test('dates use calendar days from booking without timezone shifts', () => {
 const result = calculateQuotation(sample({ bookingDate:'2026-09-23', instalments:[{label:'30 days',percent:'100',days:30,note:''}] }))
 assert.equal(result.instalments[0].dueDate,'2026-10-23')
})

test('quotation-only totals do not manufacture an instalment schedule',()=>{
 const result=calculateQuotation(sample({instalments:[]})); assert.deepEqual(result.instalments,[]); assert.equal(result.consideration,'3705000.00')
})
