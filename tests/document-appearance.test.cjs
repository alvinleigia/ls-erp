/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{PDFDocument,PDFPage}=require('pdf-lib')
const {documentAppearanceSchema,defaultDocumentAppearance,documentStylePresets}=require('../platform/documents/appearance.ts')
const {documentContentSchema}=require('../platform/documents/validation.ts')
const {resolveDocumentLayout,starterDocumentLayout}=require('../platform/documents/layout.ts')
const {renderBusinessDocument}=require('../platform/documents/pdf.ts')
const {documentHash}=require('../platform/documents/hash.ts')
const {sampleDocument}=require('../modules/sales-orders/document-template-sample.ts')
const {orderAcknowledgement}=require('../modules/sales-orders/document-provider.ts')
const {orderTemplateCatalog}=require('../modules/sales-orders/document-template.ts')
const {paymentReceiptProvider}=require('../modules/receivables/receipt-template.ts')
const {invoiceDocumentProviders}=require('../modules/customer-invoices/document-provider.ts')
const {statutoryTemplateTypes}=require('../platform/tax/localizations/india-statutory-pdf.ts')
const {realEstateOrderDocuments}=require('../modules/real-estate/order-documents.ts')
const appearance=(preset='standard',patch={})=>({...defaultDocumentAppearance,...documentStylePresets[preset],...patch})
const base=()=>({format:1,title:'BOOKING INTIMATION LETTER',reference:'SAMPLE/BOOKING/001',date:'05 Nov 2026',sourceReference:'SAMPLE-ORDER',company:{id:'example',name:'Example Property Company'},issuer:{address:'Example Office, Goa, India',contact:'',signatory:'Authorised signatory'},opening:'Dear Customer,\nWe welcome you and confirm the saved booking described below.',terms:'Example terms for layout review only.',branding:null,blocks:[{title:'Sample Customer',paragraphs:['Primary applicant','Example address, Goa, India','customer@example.test']},{title:'Sample Additional Customer',paragraphs:['Co-applicant','Example correspondence address']},{title:'Unit details',table:{headings:['Detail','Saved value'],widths:[1,2],rows:[['Project','Example Gardens'],['Unit','PLOT-106'],['Area','277 sq m'],['Booking date','05 Nov 2026']]}}]})
function capture(t){const calls=[],draw=PDFPage.prototype.drawText;t.mock.method(PDFPage.prototype,'drawText',function(text,options){calls.push({page:this,text,...options});return draw.call(this,text,options)});return calls}

test('inline wording retains PDF geometry and underline/rules render above protected footers',async t=>{
 const {inlineDocumentWording}=require('../platform/documents/layout.ts'),layout=starterDocumentLayout(orderTemplateCatalog),content={...orderAcknowledgement.defaults,opening:'Welcome customer.\n\nA second paragraph.',terms:'Terms remain literal.'},calls=capture(t)
 const original=sampleDocument({...content,layout},orderTemplateCatalog,{id:'qa',name:'QA Company'})
 await renderBusinessDocument(original,true);const middle=calls.length
 const expanded=sampleDocument({...content,layout:inlineDocumentWording(layout,content)},orderTemplateCatalog,{id:'qa',name:'QA Company'})
 await renderBusinessDocument(expanded,true)
 const geometry=rows=>rows.map(({text,x,y,size})=>({text,x,y,size}));assert.deepEqual(geometry(calls.slice(0,middle)),geometry(calls.slice(middle)))
 const lines=[],draw=PDFPage.prototype.drawLine;t.mock.method(PDFPage.prototype,'drawLine',function(value){lines.push(value);return draw.call(this,value)})
 const styled=structuredClone(expanded);styled.body.unshift({type:'paragraph',align:'left',runs:[{text:'Underlined applicant',underline:true}]},{type:'rule'})
 const bytes=await renderBusinessDocument(styled,true);assert(lines.some(l=>l.thickness===.6&&l.end.x-l.start.x===511))
 const underlined=calls.find(r=>r.text==='Underlined');assert(underlined);assert(lines.some(l=>l.start.x===underlined.x&&l.start.y===underlined.y-2))
 assert(lines.every(l=>l.start.y>34));fs.mkdirSync('tmp/pdfs',{recursive:true});fs.writeFileSync('tmp/pdfs/p13n-formatting.pdf',bytes)
})

test('presentation is bounded data and does not introduce arbitrary URLs, fonts, code or hidden text colours',()=>{
 assert.deepEqual(documentAppearanceSchema.parse(defaultDocumentAppearance),defaultDocumentAppearance)
 for(const patch of [{fontSize:1},{fontSize:40},{titleSize:50},{margins:-5},{colour:'#ffffff'},{fontUrl:'https://outside.test/font'},{footer:'a\nb\nc\nd'},{footer:'x'.repeat(301)},{watermark:'https://outside.test/image'},{css:'position:fixed'}])assert.equal(documentAppearanceSchema.safeParse(appearance('letter',patch)).success,false)
 const original=orderAcknowledgement.defaults,parsed=documentContentSchema.parse(original)
 assert.equal(Object.hasOwn(parsed,'appearance'),false)
 const styled=documentContentSchema.parse({...original,appearance:appearance('letter')})
 assert.notEqual(documentHash(original),documentHash(styled));assert.equal(styled.title,original.title)
})

test('company document samples carry presentation for generic orders, receipts, invoices, credits and statutory types',()=>{
 const providers=[orderAcknowledgement,paymentReceiptProvider,...invoiceDocumentProviders,...statutoryTemplateTypes]
 for(const provider of providers){const content={...provider.defaults,appearance:appearance('compact')},payload=provider.sample(content,provider.templateCatalog,{id:'example',name:'Example Business'});assert.deepEqual(payload.appearance,content.appearance);assert(payload.body.length);assert.equal(payload.company.id,'example')}
})

test('compact sections retain every applicant title and accepted cell without changing required source sections',async t=>{
 const layout=starterDocumentLayout(orderTemplateCatalog);layout.content=layout.content.map(node=>node.type==='documentSection'?{...node,attrs:{...node.attrs,compact:true}}:node)
 const source=[{key:'participants',title:'Primary Example',paragraphs:['Primary applicant']},{key:'participants',title:'Additional Example',paragraphs:['Co-applicant']},{key:'payment-schedule',title:'Accepted schedule',table:{headings:['Milestone','Amount','Due'],widths:[2,1,1],rows:[['Booking','INR 10,000.00','On booking']]}},{key:'pending-charges',title:'Pending charges',paragraphs:['To be confirmed']}]
 const before=JSON.stringify(source),body=resolveDocumentLayout(layout,orderTemplateCatalog,{'template.opening':'Opening','template.terms':'Terms'},source)
 const text=capture(t);await renderBusinessDocument({...base(),body,blocks:source,appearance:appearance('letter')},true)
 const printed=text.map(row=>row.text).join('\n');for(const value of ['Primary Example','Additional Example','Milestone: Booking','Amount: INR 10,000.00','Due: On booking','To be confirmed'])assert(printed.includes(value),value)
 assert.equal(JSON.stringify(source),before)
 assert.throws(()=>resolveDocumentLayout({...layout,content:layout.content.filter(node=>node.attrs?.key!=='participants')},orderTemplateCatalog,{},source))
})

test('unconfigured and explicit standard presentation produce identical text geometry',async t=>{
 const calls=capture(t);await renderBusinessDocument(base(),true);const middle=calls.length;await renderBusinessDocument({...base(),appearance:appearance()},true)
 const geometry=rows=>rows.map(({text,x,y,size})=>({text,x,y,size}))
 assert.deepEqual(geometry(calls.slice(0,middle)),geometry(calls.slice(middle)))
})

test('blank lines in wording use the same paragraph rhythm as editor paragraphs',async t=>{
 const calls=capture(t),runs=text=>({type:'paragraph',align:'left',runs:[{text}]})
 const common={...base(),blocks:[],showSignatory:false,appearance:appearance('letter')}
 await renderBusinessDocument({...common,body:[runs('FIRST\n\nSECOND')]},true);const middle=calls.length
 await renderBusinessDocument({...common,body:[runs('FIRST'),runs('SECOND')]},true)
 const gap=rows=>rows.find(r=>r.text==='FIRST').y-rows.find(r=>r.text==='SECOND').y
 assert.equal(gap(calls.slice(0,middle)),gap(calls.slice(middle)));assert(gap(calls.slice(middle))>16)
})

test('sign-off keeps company, signature caption and contact together above the footer',async t=>{
 const calls=capture(t),document={...base(),appearance:appearance('letter',{footer:'Example footer'}),issuer:{address:'',contact:'office@example.test',signatory:'Authorised signatory'},body:[{type:'paragraph',align:'left',runs:[{text:Array.from({length:48},(_,i)=>'LINE_'+i).join('\n')}]}]}
 await renderBusinessDocument(document,true)
 const issued=calls.find(r=>r.text==='Issued by'),name=calls.find(r=>r.text===document.company.name),caption=calls.find(r=>r.text==='Authorised signatory'),contact=calls.find(r=>r.text==='office@example.test')
 assert.equal(issued.page,name.page);assert.equal(name.page,caption.page);assert.equal(caption.page,contact.page);assert(issued.size<name.size);assert(name.y-caption.y>=25);assert(contact.y>70)
})

test('letter and compact themes paginate long tables with repeated branding, protected footers and no lost rows',async t=>{
 const calls=capture(t),imageCalls=[],drawImage=PDFPage.prototype.drawImage;t.mock.method(PDFPage.prototype,'drawImage',function(image,options){imageCalls.push(options);return drawImage.call(this,image,options)})
 const logo=await require('sharp')({create:{width:400,height:120,channels:4,background:'#e58524'}}).png().toBuffer()
 fs.mkdirSync('tmp/pdfs/p13l',{recursive:true})
 for(const preset of ['letter','compact']){
  const document={...base(),logoDataUrl:'data:image/png;base64,'+logo.toString('base64'),appearance:appearance(preset,{repeatLogo:true,watermark:true,logoAlign:'right',logoSize:'small',footer:'Example Business | +91 0000000000 | office@example.test\nExample layout, no actual booking or payment.'})}
  document.blocks.push({title:'Accepted instalments',table:{headings:['Milestone','Amount','Due / conditions'],widths:[1.5,1,2],rows:Array.from({length:75},(_,i)=>['ROW_'+String(i).padStart(3,'0'),'INR 1,000.00','Accepted conditions '.repeat(i===20?150:2)])}})
  const start=calls.length,imageStart=imageCalls.length,bytes=await renderBusinessDocument(document,true),pdf=await PDFDocument.load(bytes),printed=calls.slice(start)
  assert(pdf.getPageCount()>1&&pdf.getPageCount()<30);assert(bytes.length<500000)
  assert.equal(imageCalls.length-imageStart,pdf.getPageCount()*2)
  for(let i=0;i<75;i++)assert.equal(printed.filter(row=>row.text==='ROW_'+String(i).padStart(3,'0')).length,1)
  assert.equal(printed.filter(row=>row.text.startsWith('Example Business |')).length,pdf.getPageCount())
  for(const row of printed){assert(row.y>=33,'Text below footer');assert(row.x>=31,'Text left of margin');assert(row.x+row.font.widthOfTextAtSize(row.text,row.size)<=564.01,'Text crosses right margin')}
  fs.writeFileSync(`tmp/pdfs/p13l/${preset}-pagination.pdf`,bytes)
 }
})

test('styled letter sample needs no industry-specific renderer and retains validated Unicode',async()=>{
 const payload=sampleDocument({...orderAcknowledgement.defaults,title:'Example Company Letter',opening:'Accepted value: INR ₹100,000.00.',appearance:appearance('letter',{footer:'Example Business | example.test'})},orderTemplateCatalog,{id:'example',name:'Example Business'})
 const bytes=await renderBusinessDocument(payload,true);assert.equal(Buffer.from(bytes).subarray(0,5).toString(),'%PDF-')
 fs.mkdirSync('tmp/pdfs/p13l',{recursive:true});fs.writeFileSync('tmp/pdfs/p13l/shared-letter-sample.pdf',bytes)
})

test('booking intimation has a concise starter while customer/property identity and allotment requirements stay enforced',()=>{
 const {validateDocumentLayout}=require('../platform/documents/layout.ts'),[booking,allotment]=realEstateOrderDocuments(()=>{throw Error('Sample must not read a ledger')})
 const catalog=booking.templateCatalog,layout=starterDocumentLayout(catalog),sections=layout.content.filter(n=>n.type==='documentSection').map(n=>n.attrs.key)
 assert.deepEqual(sections,['participants','property-units'])
 const previous=starterDocumentLayout({...catalog,starter:undefined});assert.deepEqual(validateDocumentLayout(previous,catalog),previous)
 for(const key of sections)assert.throws(()=>validateDocumentLayout({...layout,content:layout.content.filter(n=>n.attrs?.key!==key)},catalog))
 for(const key of ['payment-schedule','commercial-lines','financial-position','receivable-schedule'])assert.equal(allotment.templateCatalog.sections.find(s=>s.key===key).required,true)
 const sample=booking.sample({...booking.defaults,appearance:appearance('letter')},catalog,{id:'example',name:'Example Business'})
 assert(!sample.body.some(n=>n.type==='section'&&n.blocks.some(b=>b.key==='payment-schedule')))
  assert.equal(sample.blocks.filter(block=>block.key==='participants').length,2)
  assert(sample.blocks.find(block=>block.key==='participants').paragraphs.some(p=>p.includes('Example address')))
  assert(sample.blocks.find(block=>block.key==='property-units').table.rows.some(row=>row.includes('SAMPLE-PLOT-106')))
})
