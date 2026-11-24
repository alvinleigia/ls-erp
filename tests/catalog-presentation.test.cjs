/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test'),assert=require('node:assert/strict'),{catalogPresentation,catalogDocumentDescription}=require('../modules/catalog/presentation.ts'),{quotationContentSchema,emptyQuotationContent}=require('../modules/sales-documents/quotation-validation.ts')
test('long company codes and hierarchy labels fit quotation descriptions without changing complete display labels',async()=>{
 const label='Company/Plot_01 · Plot 01 — '+Array.from({length:15},(_,i)=>`Physical section ${i}`).join(' / '),rows=[{id:'unit',code:'INTERNAL-01',name:'Plot 01',extensionKey:'property'}]
 const display={displayName:label,displayCode:'Company/Plot_01',selectionLabel:label,documentDescription:label}
 const result=await catalogPresentation({}, {}, [{key:'property',presentation:async()=>new Map([['unit',display]])}], rows),saved=result.get('unit')
 assert.equal(saved.selectionLabel,label);assert.equal(saved.displayName,label);assert.ok(saved.documentDescription.length<=300);assert.ok(saved.documentDescription.endsWith('…'))
 assert.ok(quotationContentSchema.safeParse({...structuredClone(emptyQuotationContent),supplierName:'Test',currency:'INR',lines:[{description:saved.documentDescription,quantity:'1',unit:'plot',rate:'100'}]}).success)
})
test('short codes remain unchanged and long descriptions never split a Unicode character',()=>{
 const short='aqua_01 · Plot 01';assert.equal(catalogDocumentDescription(short),short)
 for(const text of ['x'.repeat(300),'x'.repeat(301),'x'.repeat(298)+'😀'.repeat(20)]){const result=catalogDocumentDescription(text);assert.ok(result.length<=300);assert.ok(!/[\ud800-\udbff]$/.test(result.slice(0,-1)));assert.ok(!result.includes('�'))}
})
