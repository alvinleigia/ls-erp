/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test'),assert=require('node:assert/strict')
const {assetReferences,verifyReferences,reference}=require('../scripts/document-recovery.cjs')
const logo={path:'tenant_a/logo/document.png',bytes:20},pdf={path:'tenant_a/orders/order_a/document_a/file.pdf',bytes:100,sha256:'a'.repeat(64)}
const receipt={...pdf,path:'tenant_a/receipts/payment_a/document_a/file.pdf'}
const manifest=()=>({buckets:[{bucket:'tenant-branding',public:true,files:[{...logo,sha256:'b'.repeat(64)}]},{bucket:'tenant-documents',public:false,files:[pdf,receipt]}]})
const mock=present=>({query:async q=>({rows:q.includes('pg_roles')?[{complete:true}]:q.includes('to_regclass')?[{present}]:q.includes('FROM "AppSetting"')?[{tenantId:'tenant_a',branding:{logo:{document:logo,sidebar:logo}}}]:q.includes('FROM "AppointmentOrder"')?[{tenantId:'tenant_a',id:'appointment',b:{logo}}]:q.includes('FROM "CrmQuotationRevision"')?[{tenantId:'tenant_a',quotationId:'quote',number:1,snapshot:{branding:{logo}},archive:null}]:q.includes('FROM "SalesOrderDocument"')?[{tenantId:'tenant_a',id:'document',snapshot:{payload:{branding:{logo}}},archive:pdf}]:q.includes('FROM "OrderReceiptDocument"')?[{tenantId:'tenant_a',id:'receipt',snapshot:{payload:{branding:{logo}}},archive:receipt}]:assert.fail('Unexpected recovery read')})})
test('an RLS-filtered runtime connection cannot certify an incomplete recovery inventory',async()=>{
 let calls=0
 await assert.rejects(assetReferences({query:async()=>{calls++;return{rows:[{complete:false}]}}}),/complete database visibility/)
 assert.equal(calls,1)
})
test('recovery scans current and historical logos, quotations and immutable order PDF versions',async()=>{
 const refs=await assetReferences(mock(true));assert.equal(refs.length,8);assert.equal(refs.filter(r=>r.source.startsWith('order-document')).length,2);assert.equal(refs.filter(r=>r.source.startsWith('payment-receipt')).length,2)
 assert.deepEqual(verifyReferences(refs,manifest()),{references:8,uniqueReferencedObjects:3,verified:true})
 const baseline=await assetReferences(mock(false));assert.equal(baseline.length,4);assert(baseline.every(r=>!r.source.startsWith('order-document')))
})
test('missing, modified or public PDFs fail reference reconciliation',async()=>{
 const refs=await assetReferences(mock(true))
 for(const edit of [m=>m.buckets.pop(),m=>{m.buckets[1].public=true},m=>{m.buckets[1].files=[]},m=>{m.buckets[1].files[0]={...pdf,bytes:101}},m=>{m.buckets[1].files[0]={...pdf,sha256:'c'.repeat(64)}},m=>m.buckets[1].files.push(pdf)]){const m=manifest();edit(m);assert.throws(()=>verifyReferences(refs,m))}
})
test('malformed and cross-tenant saved references are never silently omitted',()=>{
 for(const asset of [{...pdf,path:'tenant_b/file.pdf'},{...pdf,path:'tenant_a/../file.pdf'},{...pdf,bytes:0},{...pdf,sha256:'bad'},{}])assert.throws(()=>reference('tenant_a','order-pdf','tenant-documents',asset))
 assert.equal(reference('tenant_a','optional-logo','tenant-branding',null),null)
})
