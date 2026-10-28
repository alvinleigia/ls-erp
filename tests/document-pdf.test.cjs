/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{PDFDocument}=require('pdf-lib')
const {renderBusinessDocument}=require('../platform/documents/pdf.ts')
const basic=()=>({format:1,title:'QA Shared Agreement',reference:'SO-000001/ACK/001',date:'2026-10-28',sourceReference:'SO-000001',company:{id:'qa',name:'QA Shared Industries'},issuer:{address:'QA office',contact:'qa@example.test',signatory:'Authorised signatory'},opening:'Accepted business facts',terms:'Plain reviewed terms.',branding:null,blocks:[{title:'Accepted customers',paragraphs:['QA Buyer','QA Co-applicant']}]})
test('shared PDF preview and issued bytes are valid without an industry module',async()=>{
 const value=basic(),draft=await renderBusinessDocument(value,true),issued=await renderBusinessDocument(value,false)
 assert.equal(Buffer.from(issued).subarray(0,5).toString(),'%PDF-');assert.equal((await PDFDocument.load(issued)).getPageCount(),1);assert.notDeepEqual(draft,issued)
 fs.mkdirSync('tmp/pdfs',{recursive:true});fs.writeFileSync('tmp/pdfs/p5-generic-issued.pdf',issued);fs.writeFileSync('tmp/pdfs/p5-generic-preview.pdf',draft)
})
test('long tables and one oversized cell paginate within the reusable renderer',async()=>{
 const value=basic();value.blocks=[{title:'Large customer set',table:{headings:['Customer','Accepted address'],widths:[1,3],rows:Array.from({length:100},(_,i)=>[`QA Customer ${i+1}`,i===20?'Long token '+('x'.repeat(4500)):'QA address '.repeat(15)])}}]
 const bytes=await renderBusinessDocument(value),pdf=await PDFDocument.load(bytes);assert(pdf.getPageCount()>4);assert(pdf.getPageCount()<100);fs.writeFileSync('tmp/pdfs/p5-large-participants.pdf',bytes)
})
test('unsupported font characters fail explicitly instead of dropping source characters',async()=>{
 const value=basic();value.opening='QA \u{1F680}';await assert.rejects(renderBusinessDocument(value),e=>e.status===400)
})
