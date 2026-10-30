/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test'),assert=require('node:assert/strict')
const {decimalText,isDirectoryRate,sumRates,percentageMinor,inclusiveTaxMinor,allocateMinor}=require('../platform/tax/arithmetic.ts'),{taxCreateSchema,taxUpdateSchema}=require('../lib/validation.ts')
test('canonical exact directory rates accept 12 places without passing text through binary floats',()=>{
 for(const [input,expected] of [['00018.125000','18.125'],['1e-12','0.000000000001'],['0','0'],[18,'18'],['0.100000000000','0.1']])assert.equal(decimalText(input),expected)
 for(const value of ['0.000000000001','100','0','18.125'])assert(isDirectoryRate(value))
 for(const value of ['', '-1','100.000000000001','NaN','Infinity','1e-13','1e9999'])assert(!isDirectoryRate(value))
 assert.equal(taxCreateSchema.parse({name:'QA rate',percent:'0.123456789012'}).percent,'0.123456789012')
 assert(!taxUpdateSchema.safeParse({percent:'0.1234567890123'}).success)
})
test('minor-unit percentage rounding fixes binary half-cent errors for every industry',()=>{
 assert.equal(percentageMinor(250,'64.6'),162);assert.equal(Math.round(250*64.6/100),161)
 assert.equal(percentageMinor(1,'50'),1);assert.equal(percentageMinor(3,'50'),2)
 assert.equal(sumRates(['0.1','0.2']),'0.3');assert.equal(percentageMinor(10000,sumRates(['0.1','0.2'])),30)
 assert.equal(percentageMinor(1000000000000,'0.000000000001'),0)
 assert.throws(()=>percentageMinor(1.5,'18'));assert.throws(()=>percentageMinor(Number.MAX_SAFE_INTEGER,'101'))
})
test('inclusive extraction preserves the gross price and explicit rounding policy choices',()=>{
 assert.equal(inclusiveTaxMinor(11800,['9','9']),1800)
 assert.equal(inclusiveTaxMinor(118,['18']),18)
 assert.equal(inclusiveTaxMinor(250,['0']),0)
 assert.equal(percentageMinor(1,'50')+percentageMinor(1,'50'),2)
 assert.equal(percentageMinor(1,sumRates(['50','50'])),1) // per-component vs combined
})
test('fractional weights reconcile exactly, including large amounts and stable ties',()=>{
 assert.deepEqual(allocateMinor(1,['9','9']),[1,0]);assert.deepEqual(allocateMinor(3,['0.1','0.2']),[1,2])
 const large=allocateMinor(Number.MAX_SAFE_INTEGER,['0.1','0.2']);assert.equal(large[0]+large[1],Number.MAX_SAFE_INTEGER)
 assert.deepEqual(allocateMinor(0,[]),[]);assert.deepEqual(allocateMinor(0,['0','0']),[0,0]);assert.throws(()=>allocateMinor(1,['0','0']))
 for(let total=0;total<250;total++){const shares=allocateMinor(total,['0.123456789012','0.2','0.076543210988']);assert.equal(shares.reduce((s,n)=>s+n,0),total);assert(shares.every(n=>Number.isInteger(n)&&n>=0))}
})
