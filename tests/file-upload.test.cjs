/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test'),assert=require('node:assert/strict'),{uploadFileWithProgress}=require('../components/uploads/upload-file.ts')
test('upload progress follows transmitted bytes and only a successful response completes the transfer',async()=>{
 const prior=global.XMLHttpRequest,instances=[]
 class Request{constructor(){instances.push(this);this.upload={};this.headers={}}open(method,url){this.method=method;this.url=url}setRequestHeader(k,v){this.headers[k]=v}send(file){this.body=file}}
 global.XMLHttpRequest=Request
 try{
  const file=new File(['exact selected bytes'],'test.png',{type:'image/png'}),progress=[]
  const work=uploadFileWithProgress('https://example.test/signed-upload',file,{'Content-Type':file.type,'x-upsert':'false'},v=>progress.push(v)),xhr=instances.at(-1)
  assert.equal(xhr.method,'PUT');assert.equal(xhr.body,file);assert.equal(xhr.headers['x-upsert'],'false');assert.deepEqual(progress,[0])
  xhr.upload.onprogress({lengthComputable:true,loaded:25,total:100});xhr.upload.onprogress({lengthComputable:true,loaded:50,total:100});xhr.upload.onprogress({lengthComputable:false,loaded:70,total:0})
  assert.deepEqual(progress,[0,25,50]);xhr.status=200;xhr.onload();await work;assert.deepEqual(progress,[0,25,50,100])
 }finally{global.XMLHttpRequest=prior}
})
test('failed storage responses, network errors and cancelled transfers never report success',async()=>{
 const prior=global.XMLHttpRequest,instances=[]
 class Request{constructor(){instances.push(this);this.upload={}}open(){}setRequestHeader(){}send(){}}
 global.XMLHttpRequest=Request
 try{for(const failure of ['response','onerror','onabort','ontimeout']){
  const progress=[],work=uploadFileWithProgress('https://example.test/private-token',new File(['bytes'],'test.png'),{},v=>progress.push(v)),xhr=instances.at(-1)
  if(failure==='response'){xhr.status=403;xhr.onload()}else xhr[failure]()
  await assert.rejects(work,error=>/upload failed/.test(error.message)&&!error.message.includes('private-token'));assert.deepEqual(progress,[0])
 }}finally{global.XMLHttpRequest=prior}
})
