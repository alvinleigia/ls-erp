/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto')
const {configure}=require('../scripts/verification-storage.cjs'),client=require('../platform/storage/client.ts'),{privateEvidenceStorage,evidencePath}=require('../platform/verification/evidence-storage.ts')
const good={public:false,file_size_limit:5*1024*1024,allowed_mime_types:['application/pdf','image/jpeg','image/png']}
const {privateDisposalStorage}=require('../platform/verification/disposal-storage.ts'),{createHash}=require('node:crypto')

test('disposal inspection distinguishes authoritative absence from denied, malformed and unavailable storage',async()=>{
 const original=client.storageClient,path=evidencePath('t','c',randomUUID(),'image/png');let response
 client.storageClient=()=>({storage:{async getBucket(){return{data:good}},from(){return{async download(){if(response instanceof Error)throw response;return response}}}}})
 try{
  for(const error of [{statusCode:'404'},{status:404}]){response={error};assert.deepEqual(await privateDisposalStorage.inspect(path),{exists:false})}
  for(const error of [{statusCode:'403'},{statusCode:'500'},{message:'not found'}]){response={error};await assert.rejects(privateDisposalStorage.inspect(path),e=>e.status===503)}
  response=Error('network failure');await assert.rejects(privateDisposalStorage.inspect(path));response={data:new Blob(['original'])};assert.deepEqual(await privateDisposalStorage.inspect(path),{exists:true,bytes:8,sha256:createHash('sha256').update('original').digest('hex')})
  response={data:new Blob([Buffer.alloc(5*1024*1024+1)])};await assert.rejects(privateDisposalStorage.inspect(path),e=>e.status===503)
  client.storageClient=()=>({storage:{async getBucket(){return{data:{...good,public:true}}}}});await assert.rejects(privateDisposalStorage.inspect(path),e=>e.status===503)
 }finally{client.storageClient=original}
})
test('explicit bucket setup refuses public/wrong-size buckets and never silently changes them',async()=>{
 for(const patch of [{public:true},{file_size_limit:10*1024*1024},{allowed_mime_types:['image/png']}])await assert.rejects(configure({async getBucket(){return{data:{...good,...patch}}},async createBucket(){throw Error('must not change')}},true))
 let existing=false;const storage={async getBucket(){return existing?{data:good}:{error:{statusCode:404}}},async createBucket(name,options){assert.equal(name,'tenant-verification');assert.equal(options.public,false);existing=true;return{}}}
 await assert.rejects(configure(storage));assert.equal((await configure(storage,true)).private,true)
})
test('storage adapter uses private immutable uploads and short-lived attachment downloads',async()=>{
 const original=client.storageClient,calls=[],path=evidencePath('t','c',randomUUID(),'image/png')
 client.storageClient=()=>({storage:{async getBucket(){return{data:good}},from(name){assert.equal(name,'tenant-verification');return{async createSignedUploadUrl(key,options){calls.push(['upload',key,options]);return{data:{signedUrl:'https://safe.test/upload'}}},async createSignedUrl(key,ttl,options){calls.push(['download',key,ttl,options]);return{data:{signedUrl:'https://safe.test/download'}}}}}}})
 try{await privateEvidenceStorage.signUpload(path);await privateEvidenceStorage.download(path,'proof.png');assert.deepEqual(calls,[['upload',path,{upsert:false}],['download',path,60,{download:'proof.png'}]])}finally{client.storageClient=original}
})
test('runtime storage operations fail closed if the evidence bucket is public',async()=>{
 const original=client.storageClient;let used=false
 client.storageClient=()=>({storage:{async getBucket(){return{data:{...good,public:true}}},from(){used=true;throw Error('must not use public bucket')}}})
 try{await assert.rejects(privateEvidenceStorage.signUpload(evidencePath('t','c',randomUUID(),'image/png')),e=>e.status===503);assert.equal(used,false)}finally{client.storageClient=original}
})
