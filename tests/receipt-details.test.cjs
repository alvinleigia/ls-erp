/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test'),assert=require('node:assert/strict')
const {realEstateReceiptDetails}=require('../modules/real-estate/receipt-details.ts'),{createPaymentReceiptProvider}=require('../modules/receivables/receipt-template.ts'),{starterDocumentLayout}=require('../platform/documents/layout.ts')
const project={id:'project',name:'Accepted project',code:'PRJ',location:'Goa',version:1,parent:null}
const unit={itemId:'unit',kind:'UNIT',code:'INTERNAL',name:'Accepted unit',documentEvidence:{key:'realEstate',value:{format:1,tenantId:'tenant',itemId:'unit',project,unitNumber:'106',companyCode:'CUSTOM-106',floor:null,category:'Plot',area:'333.56',areaUnit:'SQ_M'}}}
test('receipt property details use accepted source evidence, preserve custom codes and remain empty for generic sales',()=>{
 const context={order:{tenantId:'tenant'},snapshot:{items:[unit]}},before=JSON.stringify(context),result=realEstateReceiptDetails.read(context)
 assert.match(result.rows[0].label,/Plot 106/);assert.match(result.rows[0].value,/Accepted project.*333.56 sq m/);assert.equal(result.values['property.unit-code'],'CUSTOM-106');assert.equal(result.values['property.unit-number'],'106');assert.equal(JSON.stringify(context),before)
 assert.deepEqual(realEstateReceiptDetails.read({order:{tenantId:'tenant'},snapshot:{}}),{values:{},rows:[]})
 assert.deepEqual(realEstateReceiptDetails.read({order:{tenantId:'foreign'},snapshot:{items:[unit]}}),{values:{},rows:[]})
 const many=realEstateReceiptDetails.read({order:{tenantId:'tenant'},snapshot:{items:[unit,{...unit,itemId:'unit2',documentEvidence:{...unit.documentEvidence,value:{...unit.documentEvidence.value,itemId:'unit2',unitNumber:'107'}}}]}})
 assert.equal(many.rows.length,2);assert.deepEqual(many.values,{})
})
test('receipt preview includes realistic amounts, specific purpose and separate instalment and booking balances',()=>{
 const provider=createPaymentReceiptProvider(realEstateReceiptDetails),content={...provider.defaults,enabled:true,layout:starterDocumentLayout(provider.templateCatalog)},sample=provider.sample(content,provider.templateCatalog,{id:'company',name:'Example business'})
 const payment=sample.blocks.find(b=>b.key==='payment'),allocation=sample.blocks.find(b=>b.key==='allocations');assert(payment.table.rows.some(r=>r[0]==='Total outstanding as of issue'&&r[1]==='INR 4,600,000.00'));assert.deepEqual(allocation.table.rows[0],['Booking instalment','INR 551,100.00','INR 500,000.00','INR 51,100.00'])
 assert(!JSON.stringify(sample).includes('Interest amount'));assert(sample.blocks.find(b=>b.key==='references').table.rows.some(r=>r.includes('250 sq m')))
})

test('formatted receipt fields can replace the payment section only when every financial fact and status notice is retained',()=>{
 const {validateDocumentLayout}=require('../platform/documents/layout.ts'),provider=createPaymentReceiptProvider(realEstateReceiptDetails),catalog=provider.templateCatalog,required=catalog.sections.find(section=>section.key==='payment').alternativeFields
 const layout=starterDocumentLayout(catalog);layout.content=layout.content.filter(node=>node.type!=='documentSection'||node.attrs.key!=='payment')
 layout.content.push(...required.map(key=>({type:'paragraph',content:[{type:'text',text:catalog.fields.find(field=>field.key===key).label+': ',marks:[{type:'bold'}]},{type:'documentField',attrs:{key}}]})))
 assert.doesNotThrow(()=>validateDocumentLayout(layout,catalog))
 const sample=provider.sample({...provider.defaults,layout},catalog,{id:'company',name:'Example business'});assert(sample.body.some(node=>'runs' in node&&node.runs.some(run=>run.text.includes('Later corrections or refunds'))))
 for(const key of required){const incomplete=structuredClone(layout);incomplete.content=incomplete.content.filter(node=>!node.content?.some(field=>field.type==='documentField'&&field.attrs.key===key));assert.throws(()=>validateDocumentLayout(incomplete,catalog),/Restore required sections/)}
})
