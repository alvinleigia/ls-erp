/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs')
const {PDFDocument,PDFPage,PDFName,PDFDict,PDFArray}=require('pdf-lib')
const {documentLayoutSchema,documentLinkSchema,resolveDocumentLayout,validateDocumentLayout,editableDocumentLayout,inlineDocumentWording,documentValueKey}=require('../platform/documents/layout.ts')
const {renderBusinessDocument}=require('../platform/documents/pdf.ts')
const p=(text,attrs)=>({type:'paragraph',...(attrs?{attrs}:{}),content:[{type:'text',text}]})
const li=(...content)=>({type:'listItem',content}),ol=(...items)=>({type:'orderedList',attrs:{start:7,type:null},content:items}),ul=(...items)=>({type:'bulletList',content:items})
const catalog={fields:[{key:'customer.name',label:'Customer'}],sections:[{key:'participants',label:'Customers',required:true}]}
const required={type:'documentSection',attrs:{key:'participants'}},layout=(...content)=>({type:'doc',content:[...content,required]})
const document=body=>({format:1,title:'Standard formatting check',reference:'TEST/001',date:'2026-11-05',sourceReference:'TEST',company:{id:'test',name:'Example Company'},issuer:{address:'',contact:'',signatory:'Test'},branding:null,opening:'',terms:'',blocks:[],body,showSignatory:false})

test('H1–H6 and numeric spacing validate and preserve zero through resolution and inline wording',()=>{
 const {headingFontSize}=require('../platform/documents/typography.ts')
 for(let level=1;level<=6;level++){
  const source=layout({type:'heading',attrs:{level,paragraphSpacing:0,lineSpacing:1.35},content:[{type:'text',text:'Heading '+level}]})
  const expanded=inlineDocumentWording(source,{opening:'',terms:''}),body=resolveDocumentLayout(expanded,catalog,{},[])
  assert.equal(body[0].level,level);assert.equal(body[0].paragraphSpacing,0);assert.equal(body[0].lineSpacing,1.35)
  assert(headingFontSize(9,level)>=8)
 }
 for(const attrs of [{level:0},{level:7},{level:1,lineSpacing:.9},{level:2,lineSpacing:3.01},{level:3,paragraphSpacing:-1},{level:4,paragraphSpacing:49},{level:5,lineSpacing:NaN},{level:6,paragraphSpacing:Infinity}])assert.equal(documentLayoutSchema.safeParse(layout({type:'heading',attrs})).success,false)
 assert.notEqual(documentValueKey({attrs:{paragraphSpacing:0}}),documentValueKey({attrs:{paragraphSpacing:null}}))
})

test('PDF uses exact numeric line height/space after without mutating saved appearance',async t=>{
 const {defaultDocumentAppearance}=require('../platform/documents/appearance.ts'),calls=[],draw=PDFPage.prototype.drawText
 t.mock.method(PDFPage.prototype,'drawText',function(text,opts){calls.push({text,...opts});return draw.call(this,text,opts)})
 const source=layout(p('Alpha\nBeta',{lineSpacing:1.35,paragraphSpacing:0}),p('Gamma',{lineSpacing:1,paragraphSpacing:24}),p('Delta'),...Array.from({length:6},(_,i)=>({type:'heading',attrs:{level:i+1},content:[{type:'text',text:'H'+(i+1)}]})))
 const payload={...document(resolveDocumentLayout(source,catalog,{},[])),title:'TypographyTitle',appearance:{...defaultDocumentAppearance}},before=JSON.stringify(payload)
 const bytes=await renderBusinessDocument(payload,true)
 const find=text=>calls.find(r=>r.text===text)
 assert.equal(find('Alpha').y-find('Beta').y,13.5);assert.equal(find('Beta').y-find('Gamma').y,13.5);assert.equal(find('Gamma').y-find('Delta').y,34)
 assert.equal(find(payload.title).size,20)
 assert.deepEqual(Array.from({length:6},(_,i)=>find('H'+(i+1)).size),[17,13,11,10,9,8])
 assert.equal(JSON.stringify(payload),before);fs.mkdirSync('tmp/pdfs',{recursive:true});fs.writeFileSync('tmp/pdfs/p13s-typography.pdf',bytes)
 calls.length=0;await renderBusinessDocument(payload,true);assert.equal(find(payload.title).size,20)
})

test('nested lists retain ordered starts, continuation paragraphs and registered dynamic values',()=>{
 const source=layout(ol(li(p('First'),p('Continuation'),ul(li({type:'paragraph',content:[{type:'documentField',attrs:{key:'customer.name'}}]}))),li(p('Second'))))
 const body=resolveDocumentLayout(source,catalog,{'customer.name':'Literal <b>name</b>'},[])
 assert.deepEqual(body.slice(0,4).map(r=>[r.marker,r.indent,r.runs.map(v=>v.text).join('')]),[['7.',1,'First'],[undefined,1,'Continuation'],['•',2,'Literal <b>name</b>'],['8.',1,'Second']])
 const unknown=structuredClone(source);unknown.content[0].content[0].content[2].content[0].content[0].content[0].attrs.key='customer.secret';assert.throws(()=>validateDocumentLayout(unknown,catalog),/unavailable/)
 assert.throws(()=>validateDocumentLayout({...source,content:source.content.slice(0,-1)},catalog),/Customers/)
 assert.equal(documentLayoutSchema.safeParse(layout(ul(li(required)))).success,false)
})

test('document spacing reaches generated paragraphs and tables, with document settings taking precedence over saved block values',async t=>{
 const {defaultDocumentAppearance}=require('../platform/documents/appearance.ts'),calls=[],draw=PDFPage.prototype.drawText
 t.mock.method(PDFPage.prototype,'drawText',function(text,opts){calls.push({text,page:this,...opts});return draw.call(this,text,opts)})
 const payload={...document([
  {type:'paragraph',align:'left',runs:[{text:'EditableAlpha\nEditableBeta'}]},
  {type:'paragraph',align:'left',lineSpacing:2,paragraphSpacing:3,runs:[{text:'OverrideAlpha\nOverrideBeta'}]},
  {type:'paragraph',align:'left',runs:[{text:'AfterOverride'}]},
  {type:'section',blocks:[{key:'terms',title:'Generated terms',paragraphs:['GeneratedAlpha\nGeneratedBeta','GeneratedNext'],table:{headings:['Location'],widths:[1],rows:[['TableAlpha\nTableBeta']]}}]},
 ]),appearance:{...defaultDocumentAppearance,lineHeight:1.5,spaceAfter:10}},before=JSON.stringify(payload)
 const bytes=await renderBusinessDocument(payload,true),find=text=>calls.find(r=>r.text===text)
 assert.equal(find('EditableAlpha').y-find('EditableBeta').y,15)
 assert.equal(find('OverrideAlpha').y-find('OverrideBeta').y,15)
 assert.equal(find('OverrideBeta').y-find('AfterOverride').y,25)
 assert.equal(find('GeneratedAlpha').y-find('GeneratedBeta').y,15)
 assert.equal(find('GeneratedBeta').y-find('GeneratedNext').y,25)
 assert.equal(find('TableAlpha').y-find('TableBeta').y,13.5)
 assert.equal(JSON.stringify(payload),before)
 calls.length=0;payload.appearance.spaceAfter=0;await renderBusinessDocument(payload,true)
 assert.equal(find('GeneratedBeta').y-find('GeneratedNext').y,15)
 fs.mkdirSync('tmp/pdfs',{recursive:true});fs.writeFileSync('tmp/pdfs/p13s-document-spacing.pdf',bytes)
})

test('document spacing in the plain-content path covers terms and keeps the signature above protected footers',async t=>{
 const {defaultDocumentAppearance,documentAppearanceSchema}=require('../platform/documents/appearance.ts'),calls=[],draw=PDFPage.prototype.drawText
 t.mock.method(PDFPage.prototype,'drawText',function(text,opts){calls.push({text,page:this,...opts});return draw.call(this,text,opts)})
 for(const patch of [{lineHeight:0},{lineHeight:3.01},{lineHeight:'1.5'},{spaceAfter:-1},{spaceAfter:49}])assert(!documentAppearanceSchema.safeParse({...defaultDocumentAppearance,...patch}).success)
 const payload={...document(undefined),opening:'PlainAlpha\nPlainBeta',terms:'TermsAlpha\nTermsBeta',showSignatory:true,issuer:{address:'',signatory:'Authorised person',contact:'OfficeAlpha\nOfficeBeta'},blocks:[{title:'Generated details',paragraphs:[Array.from({length:45},(_,i)=>'ROW_'+i).join('\n')]}],appearance:{...defaultDocumentAppearance,lineHeight:1.6,spaceAfter:8,footer:'Protected footer'}}
 const bytes=await renderBusinessDocument(payload,true),find=text=>calls.find(r=>r.text===text)
 assert(Math.abs(find('PlainAlpha').y-find('PlainBeta').y-16)<.001)
 assert(Math.abs(find('TermsAlpha').y-find('TermsBeta').y-16)<.001)
 assert.equal(find('Issued by').page,find('Authorised person').page);assert.equal(find('Authorised person').page,find('OfficeAlpha').page)
 assert(Math.abs(find('OfficeAlpha').y-find('OfficeBeta').y-14.4)<.001)
 assert(calls.every(r=>r.y>=34));assert((await PDFDocument.load(bytes)).getPageCount()>1)
})

test('zero document space after keeps following headings clear of table borders',async t=>{
 const {defaultDocumentAppearance}=require('../platform/documents/appearance.ts'),calls=[],borders=[],draw=PDFPage.prototype.drawText,rule=PDFPage.prototype.drawLine
 t.mock.method(PDFPage.prototype,'drawText',function(text,opts){calls.push({text,...opts});return draw.call(this,text,opts)})
 t.mock.method(PDFPage.prototype,'drawLine',function(opts){borders.push(opts);return rule.call(this,opts)})
 const payload={...document([{type:'section',blocks:[{title:'Property',table:{headings:['Location'],widths:[1],rows:[['Example City']]}},{title:'Terms and notes',paragraphs:['Following terms remain legible.']}]}]),appearance:{...defaultDocumentAppearance,lineHeight:1.3,spaceAfter:0}}
 const bytes=await renderBusinessDocument(payload,true)
 const heading=calls.find(r=>r.text==='Terms and notes'),lastBorder=borders.at(-1)
 assert(heading.y+heading.size<lastBorder.start.y,'Following heading crosses the table border')
 fs.mkdirSync('tmp/pdfs',{recursive:true});fs.writeFileSync('tmp/pdfs/p13s-zero-table-spacing.pdf',bytes)
})

test('formatting bounds reject deep/oversized lists and arbitrary CSS without changing existing defaults',()=>{
 assert.equal(documentLayoutSchema.safeParse(layout(ul(li(p('a'),ul(li(p('b'),ul(li(p('c'))))))))).success,true)
 assert.equal(documentLayoutSchema.safeParse(layout(ul(li(p('a'),ul(li(p('b'),ul(li(p('c'),ul(li(p('d'))))))))))).success,false)
 assert.equal(documentLayoutSchema.safeParse(layout(ul(...Array.from({length:65},()=>li(p('row')))))).success,false)
 for(const attrs of [{lineSpacing:100},{paragraphSpacing:'300px'},{font:'Arial'},{lineSpacing:'double',css:'display:none'}])assert.equal(documentLayoutSchema.safeParse(layout(p('bad',attrs))).success,false)
 const old=layout(p('Existing')),expanded=inlineDocumentWording(old,{opening:'',terms:''})
 assert.deepEqual(resolveDocumentLayout(old,catalog,{},[]),resolveDocumentLayout(expanded,catalog,{},[]))
 assert.equal(documentValueKey({attrs:{textAlign:null}}),documentValueKey({attrs:{textAlign:null,lineSpacing:null,paragraphSpacing:null}}))
})

test('safe literal links and mutually exclusive script marks resolve, unsafe links fail closed',()=>{
 for(const href of ['https://example.test/path?invoice=1','http://example.test','mailto:office@example.test'])assert.equal(documentLinkSchema.safeParse(href).success,true)
 for(const href of ['javascript:alert(1)','data:text/html,hello','file:///C:/test','//outside.test','https://user:password@example.test','https://example.test/\nrun','mailto:office@example.test?body=secret','https://example.test/with space'])assert.equal(documentLinkSchema.safeParse(href).success,false,href)
 const run={type:'text',text:'Area',marks:[{type:'bold'},{type:'superscript'},{type:'link',attrs:{href:'https://example.test'}}]}
 const body=resolveDocumentLayout(layout({type:'paragraph',content:[run]}),catalog,{},[])
 assert.equal(body[0].runs[0].script,'super');assert.equal(body[0].runs[0].href,'https://example.test')
 for(const marks of [[{type:'superscript'},{type:'subscript'}],[{type:'bold'},{type:'bold'}],[{type:'link',attrs:{href:'https://example.test',onclick:'run'}}]])assert.equal(documentLayoutSchema.safeParse(layout({type:'paragraph',content:[{...run,marks}]})).success,false)
})

test('PDF renders hanging lists, paragraph/line spacing, superscript/subscript and clickable wrapped links',async t=>{
 const calls=[],draw=PDFPage.prototype.drawText;t.mock.method(PDFPage.prototype,'drawText',function(text,opts){calls.push({text,page:this,...opts});return draw.call(this,text,opts)})
 const source=layout(p('Default line\nNext default'),p('Double line\nNext double',{lineSpacing:'double',paragraphSpacing:'relaxed'}),ol(li(p('Wrapped conditions '.repeat(100))),li(p('Next numbered'))),{type:'paragraph',content:[{type:'text',text:'Area m'},{type:'text',text:'2',marks:[{type:'superscript'}]},{type:'text',text:' and H'},{type:'text',text:'2',marks:[{type:'subscript'}]},{type:'text',text:'O'}]},{type:'paragraph',content:[{type:'text',text:'Visit the example website '.repeat(70),marks:[{type:'link',attrs:{href:'https://example.test/path'}}]}]})
 const bytes=await renderBusinessDocument(document(resolveDocumentLayout(source,catalog,{},[])),true),pdf=await PDFDocument.load(bytes)
 assert(pdf.getPageCount()>1)
 const above=calls.find(r=>r.text==='2'&&r.size===7),below=calls.find(r=>r.text==='2'&&r.size===7&&r.y<above.y);assert(above);assert(below);assert(above.y>below.y)
 const first=calls.find(r=>r.text==='Default'),next=calls.find(r=>r.text==='Next'&&r.y<first.y),double=calls.find(r=>r.text==='Double'),nextDouble=calls.find(r=>r.text==='Next'&&r.y<double.y);assert.equal(first.y-next.y,16);assert.equal(double.y-nextDouble.y,20)
 assert(calls.some(r=>r.text==='7.'));assert(calls.some(r=>r.text==='8.'))
 let links=0
 for(const page of pdf.getPages()){const annots=page.node.Annots();assert(!annots||annots instanceof PDFArray);for(let i=0;i<(annots?.size()??0);i++){const annotation=pdf.context.lookup(annots.get(i),PDFDict),action=annotation.lookup(PDFName.of('A'),PDFDict);assert.equal(action.get(PDFName.of('URI')).decodeText(),'https://example.test/path');links++}}
 assert(links>2&&links<70,'one bounded annotation per wrapped link line, not per word')
 for(const row of calls){assert(row.x>=42,'text left of margin');assert(row.y>=34,'text below footer');assert(row.x+row.font.widthOfTextAtSize(row.text,row.size)<=553.01,'text beyond right margin')}
 fs.mkdirSync('tmp/pdfs',{recursive:true});fs.writeFileSync('tmp/pdfs/p13n-standard-formatting.pdf',bytes)
})

test('inline titles use the same normal/H1-H6 formatting, render once and preserve old layouts',async t=>{
 const {defaultDocumentAppearance}=require('../platform/documents/appearance.ts'),calls=[],draw=PDFPage.prototype.drawText
 t.mock.method(PDFPage.prototype,'drawText',function(text,opts){calls.push({text,...opts});return draw.call(this,text,opts)})
 const titleCatalog={...catalog,fields:[...catalog.fields,{key:'document.title',label:'Document title'}]}
 const stored=layout(p('Body text')),before=JSON.stringify(stored)
 const editable=editableDocumentLayout(stored,titleCatalog,'center')
 assert.equal(JSON.stringify(stored),before,'opening the editor never rewrites a stored layout')
 assert.equal(editable.content[0].attrs.level,1)
 assert.deepEqual(editableDocumentLayout(editable,titleCatalog),editable,'never inject a duplicate title')
 for(const level of [0,1,2,3,4,5,6]){
  const title={...editable.content[0],type:level?'heading':'paragraph',attrs:{textAlign:'center',paragraphSpacing:0,lineSpacing:1.4,...(level?{level}:{})}}
  const body=resolveDocumentLayout({...editable,content:[title,...editable.content.slice(1)]},titleCatalog,{'document.title':'InlineTitle'},[])
  assert.equal(body[0].documentTitle,true)
  calls.length=0
  const payload={...document(body),title:'InlineTitle',appearance:{...defaultDocumentAppearance,lineHeight:1.4,spaceAfter:5}}
  const bytes=await renderBusinessDocument(payload,true),pdf=await PDFDocument.load(bytes)
  assert.equal(pdf.getTitle(),'InlineTitle');assert.equal(calls.filter(row=>row.text==='InlineTitle').length,1)
  const rendered=calls.find(row=>row.text==='InlineTitle');assert.equal(rendered.size,[10,17,13,11,10,9,8][level]);assert(rendered.x>42)
  assert(rendered.y>calls.find(row=>row.text==='TEST/001 | 2026-11-05').y,'leading title stays above protected reference/date')
  if(level===2)fs.writeFileSync('tmp/pdfs/p13s-inline-title.pdf',bytes)
 }
 const moved={...editable,content:[editable.content[1],editable.content[0],...editable.content.slice(2)]}
 calls.length=0
 await renderBusinessDocument({...document(resolveDocumentLayout(moved,titleCatalog,{'document.title':'MovedTitle'},[])),title:'MovedTitle'},true)
 assert.equal(calls.filter(row=>row.text==='MovedTitle').length,1);assert(calls.find(row=>row.text==='Body').y>calls.find(row=>row.text==='MovedTitle').y,'moved title respects body order')
 calls.length=0
 await renderBusinessDocument(document(resolveDocumentLayout(stored,titleCatalog,{},[])),true)
 assert.equal(calls.find(row=>row.text==='Standard formatting check').size,20,'unchanged historical layouts retain automatic title geometry')
 assert.throws(()=>resolveDocumentLayout(editable,titleCatalog,{},[]),/no unambiguous accepted value/)
 const quoted={...titleCatalog,fields:[...catalog.fields,{key:'quote.title',label:'Document title'}]}
 assert.equal(resolveDocumentLayout(editableDocumentLayout(stored,quoted),quoted,{'quote.title':'QuotationTitle'},[])[0].documentTitle,true)
 const oldInline=layout({type:'paragraph',content:[{type:'documentField',attrs:{key:'quote.title'}}]})
 assert.equal(resolveDocumentLayout(oldInline,quoted,{'quote.title':'OldQuotationTitle'},[])[0].documentTitle,undefined,'old inline field usage never changes historical header rendering')
 const reused=editableDocumentLayout(oldInline,quoted)
 assert.equal(reused.content.length,oldInline.content.length,'reuse an existing title field when opening its editing draft')
 assert.equal(reused.content[0].content[0].attrs.documentTitle,true)
 assert.throws(()=>validateDocumentLayout(layout({type:'paragraph',content:[{type:'documentField',attrs:{key:'customer.name',documentTitle:true}}]}),titleCatalog),/Only the document title/)

})

test('document spacing distinguishes line breaks, new paragraphs and deliberately blank paragraphs',async t=>{
 const {defaultDocumentAppearance}=require('../platform/documents/appearance.ts'),calls=[],draw=PDFPage.prototype.drawText
 t.mock.method(PDFPage.prototype,'drawText',function(text,opts){calls.push({text,...opts});return draw.call(this,text,opts)})
 const source=layout(p('LineOne\nLineTwo'),p('ParagraphTwo'),{type:'paragraph'},p('AfterBlank'),p('HardOne\n\nHardThree'))
 const payload={...document(resolveDocumentLayout(source,catalog,{},[])),appearance:{...defaultDocumentAppearance,lineHeight:1.5,spaceAfter:8}},before=JSON.stringify(source)
 const bytes=await renderBusinessDocument(payload,true),find=text=>calls.find(row=>row.text===text)
 assert.equal(find('LineOne').y-find('LineTwo').y,15,'Shift+Enter adds one line height')
 assert.equal(find('LineTwo').y-find('ParagraphTwo').y,23,'Enter adds line height and space after')
 assert.equal(find('ParagraphTwo').y-find('AfterBlank').y,46,'a blank paragraph still consumes one line plus paragraph spacing')
 assert.equal(find('HardOne').y-find('HardThree').y,30,'two line breaks use two line heights, not paragraph spacing')
 assert.equal(JSON.stringify(source),before)
 calls.length=0;delete payload.appearance.lineHeight;payload.appearance.spaceAfter=0;await renderBusinessDocument(payload,true)
 assert.equal(find('ParagraphTwo').y-find('AfterBlank').y,32,'blank paragraphs stay visible with zero space after and default leading')
 fs.writeFileSync('tmp/pdfs/p13s-simple-spacing.pdf',bytes)
})
