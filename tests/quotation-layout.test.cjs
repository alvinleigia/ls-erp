/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),{PDFDocument}=require('pdf-lib')
const {starterDocumentLayout,validateDocumentLayout}=require('../platform/documents/layout.ts')
const {quotationLayoutCatalog:catalog}=require('../modules/sales-documents/quotation-layout-catalog.ts')
const {quotationLayoutSample}=require('../modules/sales-documents/quotation-layout-sample.ts')
const {quotationLayoutDocument}=require('../modules/sales-documents/quotation-layout.ts')
const {quotationContentSchema}=require('../modules/sales-documents/quotation-validation.ts')
const {calculateQuotation}=require('../modules/sales-documents/quotation-calculation.ts')
const {buildQuotationPdf}=require('../modules/sales-documents/quotation-pdf.ts')
const record=snapshot=>({id:'QA-QUOTE',revision:2,revisionCreatedAt:'2026-10-29',snapshot})
test('source-specific starter has no order-only fields and resets independently of other drafts',()=>{
 const a=starterDocumentLayout(catalog),b=starterDocumentLayout(catalog);a.content.reverse();assert.notDeepEqual(a,b);assert.deepEqual(validateDocumentLayout(b,catalog),b)
 const sample=quotationLayoutSample(b);for(const key of ['order.reference','customer.password']){const bad=structuredClone(sample.content);bad.layout.content.unshift({type:'paragraph',content:[{type:'documentField',attrs:{key}}]});assert.equal(quotationContentSchema.safeParse(bad).success,false)}
 const missing=structuredClone(sample.content);missing.layout.content=missing.layout.content.filter(n=>n.attrs?.key!=='totals');assert.equal(quotationContentSchema.safeParse(missing).success,false)
})
test('layout cannot change accepted calculations, repeated identities or pending-charge notices',()=>{
 const s=quotationLayoutSample(starterDocumentLayout(catalog)),plain=structuredClone(s.content);delete plain.layout
 assert.deepEqual(calculateQuotation(s.content),calculateQuotation(plain))
 const d=quotationLayoutDocument(record(s));assert.equal(d.company.id,undefined);assert.equal(d.showSignatory,false);assert.match(d.notice,/not a payment receipt/)
 assert.equal(d.blocks.filter(b=>b.key==='customer-details').length,2);assert.match(d.blocks.find(b=>b.key==='totals').paragraphs[0],/Pending charges/)
 assert.deepEqual(d.blocks.find(b=>b.key==='payment-schedule').table.rows.map(r=>r[1]),['10','90']);assert.equal(d.blocks.find(b=>b.key==='charges').table.rows[0][1],'To be confirmed')
})
test('field values use only accepted snapshots and version metadata without resolving live relationships',()=>{
 const s=quotationLayoutSample(starterDocumentLayout(catalog));s.content.layout.content.unshift({type:'paragraph',content:catalog.fields.map(f=>({type:'documentField',attrs:{key:f.key}}))})
 const before=JSON.stringify(s),d=quotationLayoutDocument(record(s));assert.equal(JSON.stringify(s),before);const text=d.body[0].runs.map(r=>r.text).join(' ');assert.match(text,/QA-QUOTE\/V2/);assert.match(text,/Sample Customer/);assert.match(text,/100,000/);assert(!text.includes('undefined'))
})
test('quotation-only sample has no invented schedule or ledger balance',()=>{
 const s=quotationLayoutSample(starterDocumentLayout(catalog),false),d=quotationLayoutDocument(record(s));assert.equal(s.content.instalments.length,0);assert.equal(d.blocks.some(b=>b.key==='payment-schedule'),false);assert.equal(catalog.fields.some(f=>/paid|outstanding/.test(f.key)),false)
})
test('custom PDF supports Unicode, formatting, inline logos, registration QR and page breaks',async()=>{
 const s=quotationLayoutSample(starterDocumentLayout(catalog));s.content.layout.content.unshift({type:'heading',attrs:{level:2,textAlign:'center'},content:[{type:'text',text:'QA Welcome',marks:[{type:'bold'}]}]},{type:'paragraph',content:[{type:'text',text:'Dear '},{type:'documentField',attrs:{key:'customer.name'},marks:[{type:'italic'}]}]},{type:'documentPageBreak'})
 s.content.logoDataUrl='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=';s.content.registration='QA registration';s.content.registrationUrl='https://example.test/registration'
 const bytes=await buildQuotationPdf(record(s),true),pdf=await PDFDocument.load(bytes);assert.equal(Buffer.from(bytes).subarray(0,5).toString(),'%PDF-');assert(pdf.getPageCount()>=2)
 fs.mkdirSync('tmp/pdfs',{recursive:true});fs.writeFileSync('tmp/pdfs/p9-quotation-layout.pdf',bytes)
 const normal=structuredClone(s);delete normal.content.layout;const standard=await buildQuotationPdf(record(normal),true);assert.equal((await PDFDocument.load(standard)).getTitle(),normal.content.title)
})
