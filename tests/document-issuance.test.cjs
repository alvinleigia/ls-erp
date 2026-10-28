/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test'),assert=require('node:assert/strict')
const {documentPrepareSchema,documentPreviewSchema,documentIssueSchema,documentContentSchema}=require('../platform/documents/validation.ts')
const {participantDocumentBlocks}=require('../platform/participants/document-blocks.ts')
const {documentHash}=require('../platform/documents/hash.ts')
const {emptyCorrespondence}=require('../platform/participants/information.ts')
test('closed document inputs require acknowledgement hashes, immutable requests and a replacement reason',()=>{
 assert.deepEqual(documentPrepareSchema.parse({providerKey:'order-acknowledgement'}),{providerKey:'order-acknowledgement',supersedesId:null,reason:''})
 for(const input of [{providerKey:'order-acknowledgement',payload:{}},{providerKey:'order-acknowledgement',supersedesId:'old'},{providerKey:'../unsafe'}])assert.equal(documentPrepareSchema.safeParse(input).success,false)
 const base={providerKey:'order-acknowledgement',previewHash:'a'.repeat(64)}
 assert.equal(documentPreviewSchema.safeParse(base).success,true);assert.equal(documentIssueSchema.safeParse(base).success,false)
 assert.equal(documentIssueSchema.safeParse({...base,requestKey:'7b142ac3-10b0-44c2-b71a-6388f23e10dc'}).success,true)
 assert.equal(documentIssueSchema.safeParse({...base,requestKey:'7b142ac3-10b0-44c2-b71a-6388f23e10dc',amount:'1'}).success,false)
})
test('common document participants are grouped by stable identity, preserve roles and use only accepted correspondence',()=>{
 const party={kind:'PERSON',id:'one',name:'QA Buyer',email:null,phone:null,sourceVersion:1},snapshot={format:1,participants:[{role:'CUSTOMER',party,information:{...emptyCorrespondence,addressLine1:'Accepted address',city:'QA Town'}},{role:'REPRESENTATIVE',party},{role:'ADDITIONAL_CUSTOMER',party:{...party,id:'two',name:'QA Second'}}]}
 const blocks=participantDocumentBlocks(snapshot)
 assert.equal(blocks.length,2);assert.equal(blocks[0].title,'QA Buyer');assert.match(blocks[0].paragraphs[0],/Main customer, Representative/);assert.match(blocks[0].paragraphs[1],/Accepted address/)
 assert.equal(JSON.stringify(blocks).includes('PAN'),false);assert.throws(()=>participantDocumentBlocks(undefined),e=>e.status===409)
})
test('template text is bounded plain data and contains no arbitrary renderer settings',()=>{
 const data={title:'QA Letter',opening:'Plain <b>text</b>',terms:'No automatic policy',address:'',contact:'',signatory:'Authorised signatory',enabled:false,useTenantLogo:false}
 assert.equal(documentContentSchema.parse(data).opening,'Plain <b>text</b>')
 assert.equal(documentContentSchema.safeParse({...data,callback:'execute'}).success,false)
 assert.equal(documentContentSchema.safeParse({...data,terms:'x'.repeat(24001)}).success,false)
 assert.equal(documentHash(data),documentHash(structuredClone(data)));assert.notEqual(documentHash(data),documentHash({...data,title:'Changed'}))
})
