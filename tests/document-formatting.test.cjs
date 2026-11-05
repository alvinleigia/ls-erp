/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs')
const {PDFDocument,PDFPage,PDFName,PDFDict,PDFArray}=require('pdf-lib')
const {documentLayoutSchema,documentLinkSchema,resolveDocumentLayout,validateDocumentLayout,inlineDocumentWording,documentValueKey}=require('../platform/documents/layout.ts')
const {renderBusinessDocument}=require('../platform/documents/pdf.ts')
const p=(text,attrs)=>({type:'paragraph',...(attrs?{attrs}:{}),content:[{type:'text',text}]})
const li=(...content)=>({type:'listItem',content}),ol=(...items)=>({type:'orderedList',attrs:{start:7,type:null},content:items}),ul=(...items)=>({type:'bulletList',content:items})
const catalog={fields:[{key:'customer.name',label:'Customer'}],sections:[{key:'participants',label:'Customers',required:true}]}
const required={type:'documentSection',attrs:{key:'participants'}},layout=(...content)=>({type:'doc',content:[...content,required]})
const document=body=>({format:1,title:'Standard formatting check',reference:'TEST/001',date:'2026-11-05',sourceReference:'TEST',company:{id:'test',name:'Example Company'},issuer:{address:'',contact:'',signatory:'Test'},branding:null,opening:'',terms:'',blocks:[],body,showSignatory:false})

test('nested lists retain ordered starts, continuation paragraphs and registered dynamic values',()=>{
 const source=layout(ol(li(p('First'),p('Continuation'),ul(li({type:'paragraph',content:[{type:'documentField',attrs:{key:'customer.name'}}]}))),li(p('Second'))))
 const body=resolveDocumentLayout(source,catalog,{'customer.name':'Literal <b>name</b>'},[])
 assert.deepEqual(body.slice(0,4).map(r=>[r.marker,r.indent,r.runs.map(v=>v.text).join('')]),[['7.',1,'First'],[undefined,1,'Continuation'],['•',2,'Literal <b>name</b>'],['8.',1,'Second']])
 const unknown=structuredClone(source);unknown.content[0].content[0].content[2].content[0].content[0].content[0].attrs.key='customer.secret';assert.throws(()=>validateDocumentLayout(unknown,catalog),/unavailable/)
 assert.throws(()=>validateDocumentLayout({...source,content:source.content.slice(0,-1)},catalog),/Customers/)
 assert.equal(documentLayoutSchema.safeParse(layout(ul(li(required)))).success,false)
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
