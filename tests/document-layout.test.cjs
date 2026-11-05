/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),{PDFDocument}=require('pdf-lib')
const {documentLayoutSchema,starterDocumentLayout,validateDocumentLayout,resolveDocumentLayout}=require('../platform/documents/layout.ts')
const {orderTemplateCatalog,orderTemplateValues}=require('../modules/sales-orders/document-template.ts')
const {sampleDocument}=require('../modules/sales-orders/document-template-sample.ts')
const {renderBusinessDocument}=require('../platform/documents/pdf.ts')
const {orderAcknowledgement}=require('../modules/sales-orders/document-provider.ts')
const catalog=orderTemplateCatalog,content={...orderAcknowledgement.defaults,title:'QA Editable Booking',opening:'Accepted opening.',terms:'Approved sample terms.'}
const field=key=>({type:'documentField',attrs:{key}}),paragraph=(...content)=>({type:'paragraph',content})

test('inline wording expands literal text without changing source values, marks, alignment or repeated records',()=>{
 const {inlineDocumentWording,documentValueKey}=require('../platform/documents/layout.ts')
 const layout=starterDocumentLayout(catalog),before=JSON.stringify(layout),words={opening:'Dear Sample,\n\nWelcome <b>literally</b>.',terms:'Terms\nLine 2'}
 layout.content[0]={type:'paragraph',attrs:{textAlign:'right'},content:[{type:'text',text:'Prefix '},{...field('template.opening'),marks:[{type:'bold'},{type:'underline'}]},{type:'text',text:' suffix'}]}
 const original=JSON.stringify(layout),expanded=inlineDocumentWording(layout,words),values={'template.opening':words.opening,'template.terms':words.terms},blocks=[{key:'participants',title:'First'},{key:'participants',title:'Second'}]
 assert.deepEqual(resolveDocumentLayout(expanded,catalog,values,blocks),resolveDocumentLayout(layout,catalog,values,blocks))
 assert.equal(JSON.stringify(layout),original);assert.notEqual(original,before)
 assert.equal(expanded.content[0].content[1].text,words.opening);assert.equal(expanded.content[0].content[1].marks[1].type,'underline')
 assert.equal(documentValueKey({a:1,b:{y:2,x:3}}),documentValueKey({b:{x:3,y:2},a:1}))
 assert.notEqual(documentValueKey([1,2]),documentValueKey([2,1]))
 const empty=inlineDocumentWording(starterDocumentLayout(catalog),{opening:'',terms:''});assert.equal(empty.content[0].content,undefined)
})

test('underline and separators are bounded shared document nodes, not arbitrary HTML or styling',()=>{
 const layout=starterDocumentLayout(catalog);layout.content.unshift(paragraph({...field('customer.name'),marks:[{type:'underline'}]}),{type:'horizontalRule'})
 const body=resolveDocumentLayout(layout,catalog,{'customer.name':'Example','template.opening':'','template.terms':''},[])
 assert.equal(body[0].runs[0].underline,true);assert.equal(body[1].type,'rule')
 for(const bad of [{type:'horizontalRule',attrs:{style:'position:fixed'}},{type:'paragraph',content:[{type:'text',text:'Bad',marks:[{type:'fontSize',attrs:{size:100}}]}]}])assert.equal(documentLayoutSchema.safeParse({type:'doc',content:[bad]}).success,false)
})

test('individual property fields replace their section only as a complete, registered set',()=>{
 const {realEstateOrderDocuments}=require('../modules/real-estate/order-documents.ts'),{propertyDocumentFields}=require('../modules/real-estate/document-fields.ts')
 for(const provider of realEstateOrderDocuments(async()=>({}))){
  const catalog=provider.templateCatalog,old=starterDocumentLayout(catalog),before=JSON.stringify(old)
  assert.deepEqual(validateDocumentLayout(old,catalog),old)
  const scalar={...old,content:old.content.filter(n=>n.attrs?.key!=='property-units')}
  assert.throws(()=>validateDocumentLayout(scalar,catalog),/Property units/)
  scalar.content.push(...propertyDocumentFields.map(f=>paragraph({type:'text',text:f.label+': ',marks:[{type:'bold'}]},field(f.key))))
  assert.deepEqual(validateDocumentLayout(scalar,catalog),scalar)
  assert.throws(()=>validateDocumentLayout({...scalar,content:scalar.content.slice(0,-1)},catalog),/Property units/)
  const sample=provider.sample({...provider.defaults,layout:scalar},catalog,{id:'qa',name:'QA Company'})
  const text=sample.body.filter(n=>'runs' in n).flatMap(n=>n.runs).map(r=>r.text).join(' ')
  assert.match(text,/Example Gardens/);assert.match(text,/SAMPLE-PLOT-106/);assert.match(text,/250/);assert.match(text,/sq m/)
  assert.equal(JSON.stringify(old),before)
 }
})

test('property scalar values preserve accepted evidence and never select the first of multiple units',()=>{
 const {propertyDocumentValues}=require('../modules/real-estate/document-fields.ts')
 const unit={ref:{code:'P-106',name:'Accepted unit'},property:{project:{name:'Phase A',location:'',parent:{name:'Accepted Gardens',location:'Accepted Goa'}},area:'250.25',areaUnit:'SQ_M'}}
 const before=JSON.stringify(unit),values=propertyDocumentValues([unit])
 assert.deepEqual(values,{'property.project-name':'Accepted Gardens / Phase A','property.unit-code':'P-106','property.unit-name':'Accepted unit','property.area':'250.25','property.area-unit':'sq m','property.location':'Accepted Goa'})
 assert.equal(JSON.stringify(unit),before);assert.deepEqual(propertyDocumentValues([]),{});assert.deepEqual(propertyDocumentValues([unit,unit]),{})
 const {realEstateOrderDocuments}=require('../modules/real-estate/order-documents.ts'),catalog=realEstateOrderDocuments(async()=>({}))[0].templateCatalog,layout=starterDocumentLayout(catalog)
 layout.content.unshift(paragraph(field('property.project-name')))
 assert.throws(()=>resolveDocumentLayout(layout,catalog,propertyDocumentValues([unit,unit]),[]),e=>e.status===409&&/exactly one saved property unit/.test(e.message))
 const absent=propertyDocumentValues([{...unit,property:{...unit.property,area:null}}]);assert.equal(absent['property.area'],'Not supplied');assert.equal(absent['property.area-unit'],'')
})
test('booking, order and issue dates resolve independently from the accepted source',()=>{
 const context={date:'2026-11-05',company:{name:'Example Company'},order:{reference:'SO-000001',currency:'INR',orderedOn:new Date('2026-10-05T00:00:00Z')},snapshot:{dateFormat:'dd/MM/yyyy',timeZone:'America/Los_Angeles',customer:{name:'Example Applicant'},content:{bookingDate:'2026-09-25',bank:{}},calculation:{consideration:'100',extras:'0',totalKnown:'100'}}}
 const before=JSON.stringify(context),values=orderTemplateValues(context,content,'SO-000001/BI/001')
 assert.equal(values['order.booking-date'],'25/09/2026');assert.equal(values['order.date'],'05/10/2026');assert.equal(values['document.date'],'05/11/2026')
 const layout=starterDocumentLayout(catalog);layout.content.unshift(paragraph({type:'text',text:'Booking date: '},field('order.booking-date')))
 const body=resolveDocumentLayout(layout,catalog,values,[]);assert.equal(body[0].runs.map(run=>run.text).join(''),'Booking date: 25/09/2026')
 assert.equal(JSON.stringify(context),before)
})
test('a missing booking date is explicit and never replaced with the order date',()=>{
 const context={date:'2026-11-05',company:{name:'Example Company'},order:{reference:'SO-1',currency:'INR',orderedOn:new Date('2026-10-05T00:00:00Z')},snapshot:{dateFormat:'MM/dd/yyyy',customer:{name:'Example Applicant'},content:{bookingDate:'',bank:{}},calculation:{consideration:'100',extras:'0',totalKnown:'100'}}}
 const values=orderTemplateValues(context,content,'SO-1/BI/001');assert.equal(values['order.booking-date'],'Not supplied');assert.equal(values['order.date'],'10/05/2026')
})
test('the booking starter uses the booking field and sample previews distinguish it from order date',()=>{
 const {realEstateOrderDocuments}=require('../modules/real-estate/order-documents.ts'),provider=realEstateOrderDocuments(async()=>({})).find(p=>p.key==='real-estate.booking-intimation')
 const layout=starterDocumentLayout(provider.templateCatalog),row=layout.content.find(n=>n.content?.some(r=>r.type==='text'&&r.text==='Booking date: '))
 assert.equal(row.content.find(r=>r.type==='documentField').attrs.key,'order.booking-date')
 const sample=sampleDocument({...provider.defaults,layout},provider.templateCatalog,{id:'example',name:'Example Company'}),date=sample.body.find(n=>n.type==='paragraph'&&n.runs.some(r=>r.text==='Booking date: '))
 assert.equal(date.runs.map(r=>r.text).join(''),'Booking date: 25/12/2025');assert.equal(sample.date,'2026-01-01')
})
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
