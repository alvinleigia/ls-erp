/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{createHash}=require('node:crypto')
const {PDFDocument,PDFPage,PDFArray,PDFRawStream,PDFName,decodePDFRawStream}=require('pdf-lib')
const {renderBusinessDocument}=require('../platform/documents/pdf.ts'),{letterheadPdf}=require('../platform/documents/letterhead-pdf.ts')
const {defaultDocumentAppearance}=require('../platform/documents/appearance.ts'),{companyDocumentSettingsSchema,resolveCompanyDocumentContent}=require('../platform/companies/document-settings.ts')
const {orderAcknowledgement}=require('../modules/sales-orders/document-provider.ts')
const profile={topMm:65,bottomMm:25},sha=b=>createHash('sha256').update(b).digest('hex')
const source=()=>({format:1,title:'Booking letter',reference:'SO-TEST/BI/001',date:'2026-11-06',sourceReference:'SO-TEST',company:{id:'test',name:'Example Company'},issuer:{address:'Company address, Goa, India',contact:'office@example.test',signatory:'Authorised signatory'},branding:null,appearance:{...defaultDocumentAppearance,letterhead:{...profile},repeatLogo:true,watermark:true,footer:'Company footer | example.test'},opening:'',terms:'',body:[{type:'paragraph',align:'left',runs:[{text:'Dear Example Customer,',bold:true}]},{type:'paragraph',align:'left',runs:[{text:'The accepted booking terms remain unchanged. ',underline:true},{text:'Read conditions',href:'https://example.test/terms'}]},{type:'section',blocks:[{title:'Accepted instalments',table:{headings:['Milestone','Amount','Conditions'],widths:[1,1,2],rows:Array.from({length:65},(_,i)=>['MILESTONE_'+String(i).padStart(3,'0'),'INR 1,000.00',i===23?'Long accepted conditions '.repeat(200):'Accepted conditions'])}}]}],blocks:[]})
function streams(pdf,page){const c=page.node.Contents(),refs=c instanceof PDFArray?c.asArray():c?[c]:[];return refs.map(ref=>{const stream=pdf.context.lookup(ref);assert(stream instanceof PDFRawStream);return Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1')})}

test('company letterhead settings are bounded, opt-in, independent of wording and frozen into new presentation',()=>{
 const blank=companyDocumentSettingsSchema.parse({});assert.equal(blank.letterhead.enabled,false)
 for(const value of [{enabled:true,topMm:10,bottomMm:25},{enabled:true,topMm:50,bottomMm:90},{enabled:true,topMm:50,bottomMm:25,css:'display:none'}])assert.equal(companyDocumentSettingsSchema.safeParse({letterhead:value}).success,false)
 const content=structuredClone(orderAcknowledgement.defaults),original=JSON.stringify(content),settings=companyDocumentSettingsSchema.parse({letterhead:{enabled:true,...profile}}),resolved=resolveCompanyDocumentContent(content,settings)
 assert.deepEqual(resolved.appearance.letterhead,profile);assert.equal(resolved.opening,content.opening);assert.equal(JSON.stringify(content),original)
 settings.letterhead.topMm=70;assert.equal(resolved.appearance.letterhead.topMm,65)
 const disabled=resolveCompanyDocumentContent({...content,appearance:{...defaultDocumentAppearance,letterhead:profile}},blank);assert.equal(disabled.appearance.letterhead,undefined)
})

test('digital and letterhead copies share exact body streams, page breaks, links and archived source bytes',async t=>{
 const labels=[],draw=PDFPage.prototype.drawText;t.mock.method(PDFPage.prototype,'drawText',function(text,options){if(text.includes(' | Page '))labels.push(options.y);return draw.call(this,text,options)})
 const document=source(),logo=await require('sharp')({create:{width:300,height:80,channels:4,background:'#ed8822'}}).png().toBuffer();document.logoDataUrl='data:image/png;base64,'+logo.toString('base64')
 const digital=await renderBusinessDocument(document,true),before=sha(digital),print=await letterheadPdf(digital),a=await PDFDocument.load(digital),b=await PDFDocument.load(print)
 assert(a.getPageCount()>2);assert.equal(a.getPageCount(),b.getPageCount());assert.equal(sha(digital),before)
 assert.equal(b.catalog.has(PDFName.of('ERPCompanyLetterheadVersion')),false)
 let marked=0
 for(let i=0;i<a.getPageCount();i++){
   const original=streams(a,a.getPage(i)),clean=streams(b,b.getPage(i));assert.equal(original.length,clean.length)
   for(let j=0;j<original.length;j++){marked+=(original[j].match(/\/ERPCompanyBranding BMC/g)||[]).length;assert.equal(clean[j],original[j].replace(/\/ERPCompanyBranding BMC\s*\n[\s\S]*?\nEMC\s*\n/g,''));assert(!clean[j].includes('/ERPCompanyBranding'))}
   assert.equal(a.getPage(i).node.Annots()?.size()??0,b.getPage(i).node.Annots()?.size()??0)
 }
 assert(marked>a.getPageCount(),'logos, watermark and footer are separate marked branding')
 assert(labels.every(y=>y>profile.bottomMm*72/25.4),'document references stay above the physical letterhead footer')
 fs.mkdirSync('tmp/pdfs',{recursive:true});fs.writeFileSync('tmp/pdfs/letterhead-digital.pdf',digital);fs.writeFileSync('tmp/pdfs/letterhead-print.pdf',print)
 const direct=await renderBusinessDocument(document,true,'letterhead'),c=await PDFDocument.load(direct);assert.equal(c.getPageCount(),b.getPageCount());for(let i=0;i<c.getPageCount();i++)assert.deepEqual(streams(c,c.getPage(i)),streams(b,b.getPage(i)))
})

test('existing unconfigured PDFs stay digital, unsupported copies fail and insufficient space gives an actionable error',async()=>{
 const old=source();delete old.appearance.letterhead
 const bytes=await renderBusinessDocument(old,true);await assert.rejects(letterheadPdf(bytes),e=>e.status===409);await assert.rejects(renderBusinessDocument(old,true,'letterhead'),e=>e.status===409)
 const tiny=source();tiny.appearance.letterhead.topMm=20;await assert.rejects(renderBusinessDocument(tiny,true),/reserved header space/)
 const signed=await PDFDocument.load(await renderBusinessDocument(source(),true));signed.getForm();const signedBytes=await signed.save();await assert.rejects(letterheadPdf(signedBytes),e=>e.status===409)
})
