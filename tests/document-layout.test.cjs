/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),{PDFDocument}=require('pdf-lib')
const {documentLayoutSchema,starterDocumentLayout,validateDocumentLayout,resolveDocumentLayout}=require('../platform/documents/layout.ts')
const {orderTemplateCatalog}=require('../modules/sales-orders/document-template.ts')
const {sampleDocument}=require('../modules/sales-orders/document-template-sample.ts')
const {renderBusinessDocument}=require('../platform/documents/pdf.ts')
const {orderAcknowledgement}=require('../modules/sales-orders/document-provider.ts')
const catalog=orderTemplateCatalog,content={...orderAcknowledgement.defaults,title:'QA Editable Booking',opening:'Accepted opening.',terms:'Approved sample terms.'}
const field=key=>({type:'documentField',attrs:{key}}),paragraph=(...content)=>({type:'paragraph',content})
test('starter contains each required source section once; unknown/duplicate/deleted sections fail closed',()=>{
 const layout=starterDocumentLayout(catalog);assert.deepEqual(validateDocumentLayout(layout,catalog),layout)
 const bad=[{...layout,content:layout.content.filter(n=>n.attrs?.key!=='participants')},{...layout,content:[...layout.content,{type:'documentSection',attrs:{key:'participants'}}]},{...layout,content:[...layout.content,{type:'documentSection',attrs:{key:'real-estate-secret'}}]}]
 for(const value of bad)assert.throws(()=>validateDocumentLayout(value,catalog),e=>e.status===400)
})
test('only registered scalar fields are resolved; values remain literal and are never expressions or paths',()=>{
 const layout=starterDocumentLayout(catalog);layout.content.unshift(paragraph({type:'text',text:'Dear ',marks:[{type:'bold'}]},field('customer.name')))
 const result=resolveDocumentLayout(layout,catalog,{'customer.name':'<b>{{order.total}}</b>','template.opening':'Opening','template.terms':''},[])
 assert.equal(result[0].runs[0].bold,true);assert.equal(result[0].runs[1].text,'<b>{{order.total}}</b>')
 for(const key of ['__proto__','constructor','customer.password','realEstate.kyc'])assert.throws(()=>resolveDocumentLayout({...layout,content:[paragraph(field(key)),...layout.content]},catalog,{},[]))
 assert.throws(()=>resolveDocumentLayout(layout,catalog,{},[]),e=>e.status===409)
})
test('HTML, links, scripts, formulas, unsupported styles and unbounded documents are rejected',()=>{
 for(const node of [{type:'script',text:'alert(1)'},{type:'paragraph',attrs:{onclick:'run'}},{type:'paragraph',content:[{type:'text',text:'Link',marks:[{type:'link',attrs:{href:'javascript:run'}}]}]},{type:'documentField',attrs:{key:'customer.name',formula:'execute'}}])assert.equal(documentLayoutSchema.safeParse({type:'doc',content:[node]}).success,false)
 assert.equal(documentLayoutSchema.safeParse({type:'doc',content:Array.from({length:121},()=>paragraph())}).success,false)
 assert.equal(documentLayoutSchema.safeParse({type:'doc',content:[paragraph({type:'text',text:'x'.repeat(24001)})]}).success,false)
})
test('reordering preserves all accepted repeated participants, schedules and pending notices without recalculation',()=>{
 const layout=starterDocumentLayout(catalog);layout.content.reverse()
 const blocks=[{key:'participants',title:'QA First',paragraphs:['Primary']},{key:'participants',title:'QA Second',paragraphs:['Additional']},{key:'payment-schedule',title:'Saved schedule',table:{headings:['Amount'],widths:[1],rows:[['123.45']]}},{key:'pending-charges',title:'Pending',paragraphs:['Unconfirmed']}]
 const body=resolveDocumentLayout(layout,catalog,{'template.opening':'','template.terms':''},blocks),resolved=body.filter(n=>n.type==='section').flatMap(n=>n.blocks)
 assert.equal(resolved.length,4);assert.deepEqual(resolved.find(n=>n.key==='payment-schedule').table.rows,[['123.45']]);assert.equal(resolved.filter(n=>n.key==='participants').length,2)
 assert.throws(()=>resolveDocumentLayout(layout,catalog,{'template.opening':'','template.terms':''},[{key:'hidden',title:'Hidden'}]),/Unregistered/)
})
test('sample previews use explicit example facts and resolve every registered field without live records',()=>{
 const layout=starterDocumentLayout(catalog);layout.content.unshift(paragraph(...catalog.fields.map(f=>field(f.key))))
 const payload=sampleDocument({...content,layout},catalog,{id:'qa',name:'QA Company'})
 assert.match(payload.body[0].runs.map(x=>x.text).join(' '),/Sample Customer/);assert.equal(payload.body.some(n=>n.type==='section'&&n.blocks.some(b=>b.key==='payment-schedule'&&b.table.rows.length===2)),true)
})
test('rich layout PDF supports marked dynamic values, alignment, Unicode and explicit page breaks',async()=>{
 const layout=starterDocumentLayout(catalog);layout.content.unshift({type:'heading',attrs:{level:2,textAlign:'center'},content:[{type:'text',text:'QA Welcome',marks:[{type:'italic'}]}]},paragraph({type:'text',text:'Dear ',marks:[{type:'bold'}]},{...field('customer.name'),marks:[{type:'bold'},{type:'italic'}]},{type:'hardBreak'},{type:'text',text:'INR ₹100,000.00 accepted.'}),{type:'documentPageBreak'})
 const payload=sampleDocument({...content,layout},catalog,{id:'qa',name:'QA Shared Company'}),bytes=await renderBusinessDocument(payload,true),pdf=await PDFDocument.load(bytes)
 assert(pdf.getPageCount()>=2);fs.mkdirSync('tmp/pdfs',{recursive:true});fs.writeFileSync('tmp/pdfs/p8-layout-preview.pdf',bytes)
})
