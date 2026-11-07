/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),{PDFDocument,PDFPage}=require('pdf-lib')
const {starterDocumentLayout,validateDocumentLayout}=require('../platform/documents/layout.ts')
const {quotationLayoutCatalog:catalog}=require('../modules/sales-documents/quotation-layout-catalog.ts')
const {quotationLayoutSample}=require('../modules/sales-documents/quotation-layout-sample.ts')
const {quotationLayoutDocument}=require('../modules/sales-documents/quotation-layout.ts')
const {quotationContentSchema}=require('../modules/sales-documents/quotation-validation.ts')
const {calculateQuotation}=require('../modules/sales-documents/quotation-calculation.ts')
const {buildQuotationPdf}=require('../modules/sales-documents/quotation-pdf.ts')
const {emptyCorrespondence,informationLabels}=require('../platform/participants/information.ts')
const record=snapshot=>({id:'QA-QUOTE',revision:2,revisionCreatedAt:'2026-10-29',snapshot})

function capturePdfText(t){
 const text=[],drawText=PDFPage.prototype.drawText
 t.mock.method(PDFPage.prototype,'drawText',function(value,...args){text.push(value);return drawText.call(this,value,...args)})
 return text
}
function standardSample(){const s=quotationLayoutSample(starterDocumentLayout(catalog));delete s.content.layout;return s}

test('standard and custom PDFs use accepted billing and delivery copies without directory lookups',async t=>{
 const text=capturePdfText(t),snapshot=standardSample(),participant=snapshot.participants.participants[0]
 participant.addresses={billing:{...emptyCorrespondence,addressLine1:'Accepted billing road',city:'Billing town',country:'India'},delivery:{...emptyCorrespondence,addressLine1:'Accepted delivery site',city:'Site town',country:'India'}}
 const before=JSON.stringify(snapshot)
 await buildQuotationPdf(record(snapshot),true)
 for(const value of ['Accepted billing road','Billing town','Accepted delivery site','Site town'])assert(text.join('\n').includes(value),value)
 assert.equal(JSON.stringify(snapshot),before)
 snapshot.content.layout=starterDocumentLayout(catalog)
 snapshot.content.layout.content.push(...['billing-addresses','delivery-addresses'].map(key=>({type:'documentSection',attrs:{key}})))
 const layout=quotationLayoutDocument(record(snapshot))
 assert.match(JSON.stringify(layout.body),/Accepted billing road/);assert.match(JSON.stringify(layout.body),/Accepted delivery site/)
 const bytes=await buildQuotationPdf(record(snapshot),true);assert.equal(Buffer.from(bytes).subarray(0,5).toString(),'%PDF-')
})

test('custom quotation styling is validated and frozen with its accepted revision',async()=>{
 const {defaultDocumentAppearance}=require('../platform/documents/appearance.ts')
 const snapshot=quotationLayoutSample(starterDocumentLayout(catalog));snapshot.content.appearance={...defaultDocumentAppearance,colour:'black',tableStyle:'minimal',referenceLayout:'split',companyHeading:false,footer:'Sample Supplier | example.test'}
 assert(quotationContentSchema.safeParse(snapshot.content).success)
 const before=JSON.stringify(snapshot),payload=quotationLayoutDocument(record(snapshot));assert.deepEqual(payload.appearance,snapshot.content.appearance)
 const bytes=await buildQuotationPdf(record(snapshot),true);assert.equal(Buffer.from(bytes).subarray(0,5).toString(),'%PDF-');assert.equal(JSON.stringify(snapshot),before)
 const standard=structuredClone(snapshot.content);delete standard.layout;assert.equal(quotationContentSchema.safeParse(standard).success,false)
})
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

test('standard quotation PDF prints every saved applicant and transaction correspondence',async t=>{
 const s=standardSample(),text=capturePdfText(t)
 s.customer.email='master-only@example.test';s.customer.phone='+910000000000'
 s.participants.presentation={configurationVersion:1,title:'Customer information (CIF)',labels:informationLabels,roleLabels:{CUSTOMER:'Primary applicant',ADDITIONAL_CUSTOMER:'Co-applicant',REPRESENTATIVE:'Representative'}}
 s.participants.participants.forEach((row,i)=>{row.information={...emptyCorrespondence,email:`accepted-${i}@example.test`,phone:`+91987654321${i}`,addressLine1:`Accepted address ${i}`,addressLine2:`Building ${i}`,city:'Panaji',region:'Goa',postalCode:'403001',country:'India'}})
 const before=JSON.stringify(s),bytes=await buildQuotationPdf(record(s),true),rendered=text.join('\n')
 assert.equal(JSON.stringify(s),before)
 for(const value of ['Sample Customer','Sample Additional Customer','Primary applicant','Co-applicant','Accepted address 0','Accepted address 1','Building 0','Building 1','Panaji, Goa, 403001','India','accepted-0@example.test','accepted-1@example.test','+919876543210','+919876543211','100,000.00'])assert(rendered.includes(value),`Missing printed value: ${value}`)
 assert(!rendered.includes('master-only@example.test'));assert(!rendered.includes('+910000000000'))
 assert((await PDFDocument.load(bytes)).getPageCount()>=1)
 fs.mkdirSync('tmp/pdfs',{recursive:true});fs.writeFileSync('tmp/pdfs/standard-quotation-applicants.pdf',bytes)
})

test('standard quotation PDF supports a business customer and groups its representative roles',async t=>{
 const s=standardSample(),text=capturePdfText(t),party=(id,name,kind='PERSON')=>({id,name,kind,email:null,phone:null,sourceVersion:1})
 const representative=party('representative','QA Joint Representative')
 s.participants={format:1,participants:[{role:'CUSTOMER',party:party('buyer','QA Buying Business','BUSINESS')},{role:'ADDITIONAL_CUSTOMER',party:representative},{role:'REPRESENTATIVE',party:representative},{role:'REPRESENTATIVE',party:party('second','QA Second Representative')}]}
 await buildQuotationPdf(record(s),true)
 const rendered=text.join('\n');for(const name of ['QA Buying Business','QA Joint Representative','QA Second Representative','Main customer','Additional customer, Representative'])assert(rendered.includes(name),`Missing printed value: ${name}`)
 assert.equal(text.filter(value=>value==='QA Joint Representative').length,1)
 assert(!rendered.includes('Co-applicant'))
})

test('standard quotation PDF retains historical customer evidence and rejects malformed participant snapshots',async t=>{
 const s=standardSample(),text=capturePdfText(t);delete s.participants
 s.customer={name:'Historical Buyer',email:'historic@example.test',phone:'+919876543210'}
 await buildQuotationPdf(record(s),true)
 const rendered=text.join('\n');assert(rendered.includes('Prepared for Historical Buyer'));assert(rendered.includes('historic@example.test'));assert(rendered.includes('+919876543210'));assert(!rendered.includes('Sample Additional Customer'))
 s.participants={format:1,participants:[]}
 await assert.rejects(buildQuotationPdf(record(s),true),error=>error.status===409)
})
