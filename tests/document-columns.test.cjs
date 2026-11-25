/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{PDFDocument,PDFPage}=require('pdf-lib')
const {documentLayoutSchema,validateDocumentLayout,resolveDocumentLayout,inlineDocumentWording,editableDocumentLayout,documentFlowNodes}=require('../platform/documents/layout.ts')
const {renderBusinessDocument}=require('../platform/documents/pdf.ts')
const {defaultDocumentAppearance}=require('../platform/documents/appearance.ts')
const p=text=>({type:'paragraph',content:text?[{type:'text',text}]:[]}),field=key=>({type:'paragraph',content:[{type:'documentField',attrs:{key}}]}),section=key=>({type:'documentSection',attrs:{key}}),columns=(...cells)=>({type:'documentColumns',content:cells.map(content=>({type:'documentColumn',content}))})
const catalog={fields:[{key:'customer.name',label:'Customer'},{key:'template.opening',label:'Opening'},{key:'document.title',label:'Title'}],sections:[{key:'people',label:'People',required:true},{key:'payment',label:'Payment',required:true,alternativeFields:['customer.name','template.opening']}]}
const base=body=>({format:1,title:'Shared column document',reference:'QA-COLUMNS',date:'2026-11-25',sourceReference:'QA',company:{name:'QA Business'},issuer:{address:'',contact:'',signatory:''},showSignatory:false,opening:'',terms:'',branding:null,blocks:[],body,appearance:{...defaultDocumentAppearance,fontSize:9,companyHeading:false,spacing:'compact',lineHeight:1.2,spaceAfter:3,footer:'QA protected footer'}})
const textFlow=text=>({type:'paragraph',align:'left',runs:[{text}]})
function capture(t){const calls=[],draw=PDFPage.prototype.drawText;t.mock.method(PDFPage.prototype,'drawText',function(text,options){calls.push({page:this,text,...options});return draw.call(this,text,options)});return calls}

test('columns validate all nested fields/required sections, preserve wording and reject nested/unbounded layouts',()=>{
 const layout={type:'doc',content:[columns([section('people'),field('customer.name')],[field('template.opening')])]}
 assert.doesNotThrow(()=>validateDocumentLayout(layout,catalog))
 const copy=JSON.stringify(layout),expanded=inlineDocumentWording(layout,{opening:'Welcome',terms:''});assert.equal(expanded.content[0].content[1].content[0].content[0].text,'Welcome');assert.equal(JSON.stringify(layout),copy)
 const titled=editableDocumentLayout(layout,catalog);assert.equal(titled.content[0].type,'heading')
 const flow=resolveDocumentLayout(layout,catalog,{'customer.name':'Buyer','template.opening':'Welcome'},[{key:'people',title:'Buyer'},{key:'people',title:'Co-buyer'}]);assert.equal(flow[0].type,'columns');assert.equal(flow[0].columns[0][0].blocks.length,2)
 assert.equal(documentFlowNodes(flow).length,3)
 for(const bad of [columns([]),columns([p('1')],[p('2')],[p('3')],[p('4')]),columns([columns([p('nested')])]),{...columns([p('bad')]),attrs:{style:'position:absolute'}}])assert.equal(documentLayoutSchema.safeParse({type:'doc',content:[bad]}).success,false)
 assert.equal(documentLayoutSchema.safeParse({type:'doc',content:[columns(Array.from({length:118},()=>p('bounded')))]}).success,true)
 assert.equal(documentLayoutSchema.safeParse({type:'doc',content:[columns(Array.from({length:119},()=>p('too many')))]}).success,false)
 for(const bad of [{type:'doc',content:[columns([section('people')],[section('people'),section('payment')])]},{type:'doc',content:[columns([section('people')],[field('unknown')])]},{type:'doc',content:[columns([section('people')],[field('customer.name')])]}])assert.throws(()=>validateDocumentLayout(bad,catalog))
 assert.throws(()=>resolveDocumentLayout(layout,catalog,{'template.opening':'Welcome'},[]),e=>e.status===409)
})

test('two and three columns align at the top, respect bounds and leave following content below the tallest cell',async t=>{
 const calls=capture(t)
 for(const count of [1,2,3]){
  const body=[{type:'columns',columns:Array.from({length:count},(_,index)=>[textFlow(`CELL${count}_${index}`),textFlow(Array(index+1).fill('Detail line').join('\n'))])},textFlow(`AFTER${count}`)]
  const bytes=await renderBusinessDocument(base(body),true);assert.equal((await PDFDocument.load(bytes)).getPageCount(),1)
  const starts=calls.filter(row=>row.text.startsWith(`CELL${count}_`));assert.equal(new Set(starts.map(row=>row.y)).size,1);assert.equal(starts.length,count)
  const after=calls.find(row=>row.text===`AFTER${count}`);assert(after.y<starts[0].y-(count+1)*9)
  starts.forEach((row,index)=>assert(Math.abs(row.x-(42+index*((511-18*(count-1))/count+18)))<.01))
 }
 assert(calls.every(row=>row.y>=34&&row.x>=42&&row.x+row.font.widthOfTextAtSize(row.text,row.size)<=553.1))
})

test('independent long columns share continuation pages, preserve every row and keep repeated table headers/footer safe',async t=>{
 const calls=capture(t),table={type:'section',blocks:[{title:'Repeated source',table:{headings:['Entry','Value'],widths:[2,1],rows:Array.from({length:85},(_,i)=>[`ROW_${i}`,'100.00'])}}],alignEnd:1}
 const body=[{type:'columns',columns:[[table],[textFlow(Array.from({length:120},(_,i)=>`RIGHT_${i}`).join('\n'))]]},textFlow('AFTER_ALL_COLUMNS')]
 const bytes=await renderBusinessDocument(base(body),true),pdf=await PDFDocument.load(bytes)
 assert(pdf.getPageCount()>2);assert(pdf.getPageCount()<10)
 for(let i=0;i<85;i++)assert.equal(calls.filter(row=>row.text===`ROW_${i}`).length,1)
 for(let i=0;i<120;i++)assert.equal(calls.filter(row=>row.text===`RIGHT_${i}`).length,1)
 const headers=calls.filter(row=>row.text==='Entry');assert(headers.length>2);assert.equal(new Set(headers.map(row=>row.page)).size,headers.length)
 const end=calls.find(row=>row.text==='AFTER_ALL_COLUMNS'),last=calls.find(row=>row.text==='ROW_84');assert.equal(end.page,last.page);assert(end.y<last.y)
 for(const row of calls.filter(row=>/^(ROW_|RIGHT_|100\.00|Entry|Value|AFTER_ALL)/.test(row.text)))assert(row.y>74&&row.x>=42&&row.x+row.font.widthOfTextAtSize(row.text,row.size)<=553.1)
 fs.mkdirSync('tmp/pdfs/columns',{recursive:true});fs.writeFileSync('tmp/pdfs/columns/continuations.pdf',bytes)
})

test('section presentation retains every customer name and financial cell, with bold labels and right-aligned amounts',async t=>{
 const calls=capture(t),body=[{type:'section',hideTitle:true,boldLabels:true,compact:true,blocks:[{title:'Primary Buyer',paragraphs:['Buyer address']},{title:'Additional Buyer',paragraphs:['Additional address']},{title:'Booking details',table:{headings:['Detail','Value'],rows:[['Order','SO-1']],widths:[1,2]}}]},{type:'section',hideTitle:true,alignEnd:1,blocks:[{title:'Allocation',table:{headings:['Purpose','Amount'],rows:[['Booking','100.00'],['PLC','10.00']],widths:[2,1]}}]}]
 const before=JSON.stringify(body);await renderBusinessDocument(base(body),true);assert.equal(JSON.stringify(body),before)
 for(const name of ['Primary Buyer','Additional Buyer'])assert(calls.some(row=>row.text===name))
 assert(!calls.some(row=>row.text==='Booking details'||row.text==='Allocation'));assert(calls.some(row=>row.text==='Order:'&&row.font.name.includes('Bold')))
 for(const value of ['100.00','10.00']){const row=calls.find(row=>row.text===value);assert(Math.abs(row.x+row.font.widthOfTextAtSize(value,row.size)-547)<.01)}
})

test('large summary headings clear their preceding labels even with compact line spacing',async t=>{
 const calls=capture(t),body=[{type:'columns',columns:[[textFlow('Customer')],[textFlow('AMOUNT'),{type:'heading',level:1,align:'right',runs:[{text:'INR 500,000.00'}]}]]}]
 await renderBusinessDocument({...base(body),appearance:{...base(body).appearance,lineHeight:1,spaceAfter:0}},true)
 const label=calls.find(row=>row.text==='AMOUNT'),value=calls.find(row=>row.text==='INR');assert(label.y-value.y>=value.size)
})

test('all document providers accept columns without changing their protected source sections',async()=>{
 const providers=[require('../modules/sales-orders/document-provider.ts').orderAcknowledgement,require('../modules/receivables/receipt-template.ts').paymentReceiptProvider,...require('../modules/customer-invoices/document-provider.ts').invoiceDocumentProviders,...require('../platform/tax/localizations/india-statutory-pdf.ts').statutoryTemplateTypes]
 const {starterDocumentLayout}=require('../platform/documents/layout.ts')
 for(const provider of providers){const layout=starterDocumentLayout(provider.templateCatalog);layout.content=[columns(layout.content)];const content={...provider.defaults,layout};const before=JSON.stringify(content);assert.doesNotThrow(()=>validateDocumentLayout(layout,provider.templateCatalog));const bytes=await renderBusinessDocument(provider.sample(content,provider.templateCatalog,{id:'qa',name:'QA Shared Business'}),true);assert((await PDFDocument.load(bytes)).getPageCount()>=1);assert.equal(JSON.stringify(content),before)}
})

test('column continuations retain the same body and page count when printing on letterhead',async t=>{
 const calls=capture(t),profile={topMm:60,bottomMm:25},document=base([{type:'columns',columns:[[textFlow(Array.from({length:100},(_,i)=>`LEFT_${i}`).join('\n'))],[textFlow(Array.from({length:130},(_,i)=>`RIGHT_${i}`).join('\n'))]]},textFlow('FINAL_BODY')])
 document.appearance={...document.appearance,letterhead:profile,repeatLogo:true,companyHeading:false}
 document.logoDataUrl='data:image/png;base64,'+(await require('sharp')({create:{width:250,height:70,channels:4,background:'#ef8623'}}).png().toBuffer()).toString('base64')
 const digital=await renderBusinessDocument(document,true),middle=calls.length,print=await renderBusinessDocument(document,true,'letterhead')
 assert.equal((await PDFDocument.load(digital)).getPageCount(),(await PDFDocument.load(print)).getPageCount())
 const positions=rows=>rows.map(({text,x,y,size})=>({text,x,y,size}));assert.deepEqual(positions(calls.slice(0,middle)),positions(calls.slice(middle)))
 const body=calls.slice(0,middle).filter(row=>/^(LEFT_|RIGHT_|FINAL_BODY)/.test(row.text));assert(body.every(row=>row.y<842-profile.topMm*72/25.4+1&&row.y>profile.bottomMm*72/25.4+16))
 fs.writeFileSync('tmp/pdfs/columns/letterhead-digital.pdf',digital);fs.writeFileSync('tmp/pdfs/columns/letterhead-print.pdf',print)
})

test('quotation columns use the same renderer without changing accepted prices, applicants or schedule',async()=>{
 const {quotationLayoutCatalog}=require('../modules/sales-documents/quotation-layout-catalog.ts'),{quotationLayoutSample}=require('../modules/sales-documents/quotation-layout-sample.ts'),{starterDocumentLayout}=require('../platform/documents/layout.ts'),{buildQuotationPdf}=require('../modules/sales-documents/quotation-pdf.ts'),{calculateQuotation}=require('../modules/sales-documents/quotation-calculation.ts')
 const layout=starterDocumentLayout(quotationLayoutCatalog);layout.content=[columns([field('customer.name')],[p('Supplier details')]),...layout.content]
 const snapshot=quotationLayoutSample(layout),before=JSON.stringify(snapshot),calculation=calculateQuotation(snapshot.content)
 const bytes=await buildQuotationPdf({id:'QA-COLUMN-QUOTE',revision:1,revisionCreatedAt:'2026-11-25',snapshot},true)
 assert((await PDFDocument.load(bytes)).getPageCount()>=1);assert.equal(JSON.stringify(snapshot),before);assert.deepEqual(calculateQuotation(snapshot.content),calculation)
})

test('table header emphasis is opt-in, uses bold width metrics and leaves data rows regular',async t=>{
 const calls=capture(t),layout={type:'doc',content:[{type:'documentSection',attrs:{key:'people',boldHeader:true}},{type:'documentSection',attrs:{key:'payment'}}]}
 const flow=resolveDocumentLayout(layout,catalog,{},[{key:'people',title:'Details',table:{headings:['Wide heading WWWWWWWWWWWWWWWWWWWWWW','Amount'],widths:[1,1],rows:Array.from({length:45},(_,i)=>[`LINE_${i}`,'100.00'])}}]);assert.equal(flow[0].boldHeader,true)
 const bytes=await renderBusinessDocument(base(flow),true);assert((await PDFDocument.load(bytes)).getPageCount()>1)
 const headers=calls.filter(row=>row.text==='Amount');assert(headers.length>1);assert(headers.every(row=>row.font.name.includes('Bold')))
 assert(calls.filter(row=>row.text==='100.00').every(row=>!row.font.name.includes('Bold')))
 assert(calls.filter(row=>row.font.name.includes('Bold')).every(row=>row.x+row.font.widthOfTextAtSize(row.text,row.size)<=553.1))
 const before=calls.length;await renderBusinessDocument(base([{type:'section',blocks:[{title:'Details',table:{headings:['Normal header'],widths:[1],rows:[['Normal value']]}}]}]),true)
 assert(calls.slice(before).filter(row=>row.text==='Normal header').every(row=>!row.font.name.includes('Bold')))
})
