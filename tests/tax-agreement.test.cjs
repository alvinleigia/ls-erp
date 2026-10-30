/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test'),assert=require('node:assert/strict')
const {calculateTaxAgreement:calculate,allocateTaxPortion:portion,addTaxPortions:add,moneyMinor,moneyText}=require('../platform/tax/agreement.ts')
const {calculateProfilePreview:preview}=require('../platform/tax/agreement-preview.ts')
const components=[{code:'SGST',percent:'9'},{code:'CGST',percent:'9'}]
const input=(line={})=>({currency:'INR',minorDigits:2,lines:[{key:'a',amountMinor:10000,discountMinor:0,priceBasis:'EXCLUSIVE',components,...line}]})
const saved=(patch={})=>({format:1,name:'QA synthetic service',scheme:'IN_GST',enabled:true,supplyKind:'SERVICES',treatment:'TAXABLE',classificationKind:'SAC',classificationCode:'998311',basisReference:'QA synthetic configuration',priceBasis:'EXCLUSIVE',zeroRatedMode:'NOT_APPLICABLE',variants:[{key:'INTRA_STATE',components:components.map(c=>({...c,rateId:c.code,name:'QA '+c.code,sourceUpdatedAt:'2026-01-01T00:00:00.000Z'}))}],...patch})
const query=(patch={})=>({version:1,currency:'INR',amount:'100.00',discount:'0',variant:'INTRA_STATE',firstPortion:null,...patch})
test('exclusive components use exact discounted line value and retain an explicit calculation policy',()=>{
 const r=calculate(input({discountMinor:1000}));assert.equal(r.format,1);assert.equal(r.rounding,'LINE_EXACT_V1');assert.equal(r.netMinor,9000);assert.equal(r.taxMinor,1620);assert.equal(r.grossMinor,10620);assert.equal(r.discountMinor,1000)
 assert.deepEqual(r.lines[0].components,[{code:'CGST',percent:'9',amountMinor:810},{code:'SGST',percent:'9',amountMinor:810}])
})
test('inclusive net extraction and component remainders preserve the exact discounted gross',()=>{
 const r=calculate(input({priceBasis:'INCLUSIVE'}));assert.equal(r.netMinor,8475);assert.equal(r.taxMinor,1525);assert.equal(r.grossMinor,10000);assert.deepEqual(r.lines[0].components.map(c=>c.amountMinor),[763,762])
 const discounted=calculate(input({amountMinor:12800,discountMinor:1000,priceBasis:'INCLUSIVE'}));assert.equal(discounted.netMinor,10000);assert.equal(discounted.taxMinor,1800);assert.equal(discounted.grossMinor,11800)
})
test('component input order cannot move a rounding cent to another tax code',()=>{
 const a=calculate(input({amountMinor:1,priceBasis:'INCLUSIVE',components:[{code:'B',percent:'100'},{code:'A',percent:'100'}]})),b=calculate(input({amountMinor:1,priceBasis:'INCLUSIVE',components:[{code:'A',percent:'100'},{code:'B',percent:'100'}]}));assert.deepEqual(a,b)
 assert.deepEqual(calculate(input({components:[{code:'A',percent:'0000.010000'}]})).lines[0].components,[{code:'A',percent:'0.01',amountMinor:1}])
})
test('mixed price bases, uncharged lines and full discounts reconcile without inventing a statutory treatment',()=>{
 const r=calculate({currency:'JPY',minorDigits:0,lines:[input().lines[0],{...input().lines[0],key:'b',priceBasis:'INCLUSIVE',amountMinor:11800},{...input().lines[0],key:'c',amountMinor:10,discountMinor:10},{...input().lines[0],key:'d',amountMinor:7,components:[]}]});assert.equal(r.netMinor,20007);assert.equal(r.taxMinor,3600);assert.equal(r.grossMinor,23607);assert.equal(r.lines[2].grossMinor,0);assert.deepEqual(r.lines[3].components,[])
 const zero=calculate(input({amountMinor:0})).lines[0];assert.equal(portion(zero,undefined,0).grossMinor,0)
})
test('duplicate keys/codes, invalid rates, negative/unsafe values and unsupported fields fail',()=>{
 for(const patch of [{amountMinor:-1},{amountMinor:1.1},{amountMinor:Number.MAX_SAFE_INTEGER+1},{discountMinor:10001},{priceBasis:'GUESS'},{components:[{code:'a',percent:'9'}]},{components:[{code:'A',percent:'100.1'}]},{components:[{code:'A',percent:'0.1234567890123'}]},{components:[{code:'A',percent:'9'},{code:'A',percent:'9'}]},{taxTreatment:'automatic'}])assert.throws(()=>calculate(input(patch)))
 assert.throws(()=>calculate({...input(),lines:[input().lines[0],input().lines[0]]}));assert.throws(()=>calculate({...input(),minorDigits:7}));assert.throws(()=>calculate(input({amountMinor:Number.MAX_SAFE_INTEGER,components:[{code:'A',percent:'100'}]})),/limit/)
 assert.throws(()=>calculate({...input(),lines:[{...input().lines[0],amountMinor:Number.MAX_SAFE_INTEGER,components:[]},{...input().lines[0],key:'b',components:[]}]}),/limit/)
})
test('currency conversion rejects meaningful excess precision and preserves exact large minor units',()=>{
 for(const [s,d,n,text]of [['1',0,1,'1'],['001.000',0,1,'1'],['12.3400',2,1234,'12.34'],['0.001',3,1,'0.001'],['0.000001',6,1,'0.000001'],['90071992547409.91',2,Number.MAX_SAFE_INTEGER,'90071992547409.91']]){assert.equal(moneyMinor(s,d),n);assert.equal(moneyText(n,d),text)}
 for(const s of ['-1','1e2','NaN','Infinity','1,000',''])assert.throws(()=>moneyMinor(s,2));assert.throws(()=>moneyMinor('1.001',2),/not rounded/);assert.throws(()=>moneyMinor('90071992547409.92',2),/limit/);assert.throws(()=>moneyText(1,-1));assert.throws(()=>moneyText(-1,2))
})
test('calculated lines retain no mutable references to input rates',()=>{
 const d=input(),r=calculate(d);d.lines[0].components[0].percent='10';assert.equal(r.lines[0].components.find(c=>c.code==='SGST').percent,'9');components[0].percent='9'
})
test('one-cent portions stay non-negative when independent cumulative rounding would fail',()=>{
 const r=calculate(input({amountMinor:3,priceBasis:'INCLUSIVE',components:[{code:'B',percent:'100'},{code:'A',percent:'100'}]})).lines[0];assert.equal(r.netMinor,1);assert.equal(r.taxMinor,2)
 const a=portion(r,undefined,1),b=portion(r,a,1),ab=add(a,b),c=portion(r,ab,1),total=add(ab,c)
 assert.deepEqual([a.netMinor,b.netMinor,c.netMinor],[1,0,0]);assert.equal(total.netMinor,r.netMinor);assert.equal(total.taxMinor,r.taxMinor);assert.deepEqual(total.components,r.components.map(c=>({code:c.code,amountMinor:c.amountMinor})));assert.throws(()=>portion(r,total,1),/remaining/)
})
test('hundreds of deterministic split sequences conserve each frozen component and final cents',()=>{
 let state=413;const random=n=>{state=(state*1664525+1013904223)>>>0;return state%n}
 for(let i=0;i<300;i++){
  const r=calculate(input({amountMinor:1+random(100000),discountMinor:0,priceBasis:random(2)?'INCLUSIVE':'EXCLUSIVE',components:[{code:'A',percent:['0','0.1','9','18.125'][random(4)]},{code:'B',percent:['0.01','9','12.345678901234'][random(3)]}]})).lines[0];let prior
  for(let j=0;j<12;j++){const left=r.grossMinor-(prior?.grossMinor||0),next=portion(r,prior,j===11?left:random(left+1));assert(next.netMinor>=0&&next.taxMinor>=0);assert.equal(next.netMinor+next.taxMinor,next.grossMinor);prior=prior?add(prior,next):next}
  assert.equal(prior.netMinor,r.netMinor);assert.equal(prior.taxMinor,r.taxMinor);assert.equal(prior.grossMinor,r.grossMinor);assert.deepEqual(prior.components,r.components.map(c=>({code:c.code,amountMinor:c.amountMinor})))
 }
})
test('prior allocation identity, component limits, totals and the frozen policy are checked',()=>{
 const r=calculate(input()).lines[0],a=portion(r,undefined,100)
 for(const patch of [{key:'other'},{grossMinor:101},{netMinor:r.netMinor+1},{taxMinor:10},{components:[]},{components:[a.components[0],a.components[0]]},{components:[{code:'OTHER',amountMinor:0},a.components[1]]},{components:[{...a.components[0],amountMinor:100000},a.components[1]]}])assert.throws(()=>portion(r,{...a,...patch},1))
 for(const patch of [{grossMinor:r.grossMinor+1},{netMinor:0},{taxMinor:0},{components:[...r.components].reverse()}])assert.throws(()=>portion({...r,...patch},undefined,1),/policy/)
 assert.throws(()=>add(a,{...a,key:'other'}));assert.throws(()=>add(a,{...a,taxMinor:0}));assert.throws(()=>portion(r,undefined,-1))
})
test('saved profile preview derives rates/basis from the reviewed version and reconciles a partial illustration',()=>{
 const r=preview(saved(),query({discount:'10',firstPortion:'50'}));assert.equal(r.display.total.net,'90.00');assert.equal(r.display.total.tax,'16.20');assert.equal(r.display.total.gross,'106.20');assert.equal(r.first.grossMinor+r.remaining.grossMinor,10620);assert.equal(r.first.netMinor+r.remaining.netMinor,9000)
 assert.equal(preview(saved({priceBasis:'INCLUSIVE'}),query()).display.total.gross,'100.00')
})
test('preview cannot invent a jurisdiction, inject rates or silently round currency inputs',()=>{
 for(const patch of [{variant:'INTER_STATE'},{variant:'NONE'},{currency:'XYZ'},{version:0},{rates:[18]},{amount:'0.001'},{discount:'101'},{firstPortion:'9999'}])assert.throws(()=>preview(saved(),query(patch)))
 assert.throws(()=>preview(saved({format:2}),query()));assert.throws(()=>preview(saved({treatment:'NON_GST'}),query()))
 const r=preview(saved({treatment:'NON_GST',classificationKind:'NONE',classificationCode:'',variants:[]}),query({variant:'NONE',currency:'JPY',amount:'101',discount:'1',firstPortion:'40'}));assert.equal(r.display.total.gross,'100');assert.equal(r.display.total.tax,'0');assert.equal(r.display.remaining.gross,'60')
})
