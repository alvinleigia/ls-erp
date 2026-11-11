/* eslint-disable @typescript-eslint/no-require-imports */
// Disposable browser-test transport. Never loaded by application/runtime code.
const assert=require('node:assert/strict'),http=require('node:http')
const database=new URL(process.env.CRM_TEST_DATABASE_URL||'http://invalid')
assert.ok(['127.0.0.1','localhost'].includes(database.hostname)&&database.pathname==='/ls_salon_crm_test'&&process.env.P13S_VERIFICATION_STORAGE_TEST==='1'&&!process.env.VERCEL)
const objects=new Map(),original=global.fetch,origin='https://verificationtest.supabase.co',port=3319
const server=http.createServer(async(req,res)=>{
 res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Methods','GET,PUT,POST,DELETE,OPTIONS');res.setHeader('Access-Control-Allow-Headers','*')
 const reply=(value,status=200)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value))}
 if(req.method==='OPTIONS'){res.statusCode=204;return res.end()}
 const u=new URL(req.url,'http://127.0.0.1'),pathname=decodeURIComponent(u.pathname),prefix='/storage/v1/object/',path=pathname.slice(prefix.length)
 if(req.method==='GET'&&pathname==='/storage/v1/bucket/tenant-verification')return reply({id:'tenant-verification',public:false,file_size_limit:5242880,allowed_mime_types:['application/pdf','image/jpeg','image/png']})
 if(!pathname.startsWith(prefix))return reply({message:'Unknown test transport'},400)
 // The combined acceptance flow uses real document rendering/archiving alongside
 // verification uploads. Both buckets remain separate and private in this transport.
 if(req.method==='POST'&&path.startsWith('tenant-documents/')){
  const key='documents/'+path.slice('tenant-documents/'.length),chunks=[];let size=0
  for await(const b of req){size+=b.length;if(size>10485760)return reply({message:'Too large'},413);chunks.push(b)}
  if(objects.has(key))return reply({message:'Exists'},409)
  objects.set(key,{bytes:Buffer.concat(chunks),type:'application/pdf'});return reply({Key:key})
 }
 if(req.method==='POST'&&path.startsWith('sign/tenant-documents/'))return reply({signedURL:'/object/'+path+'?token=isolated-document'})
 if(req.method==='GET'&&/^(?:authenticated\/|sign\/)?tenant-documents\//.test(path)){
  const item=objects.get('documents/'+path.replace(/^(?:authenticated\/|sign\/)?tenant-documents\//,''));if(!item)return reply({message:'Missing'},404)
  res.setHeader('Content-Type','application/pdf');return res.end(item.bytes)
 }
 if(req.method==='DELETE'&&path==='tenant-documents'){
  const chunks=[];for await(const b of req)chunks.push(b);for(const key of JSON.parse(Buffer.concat(chunks).toString()).prefixes)objects.delete('documents/'+key);return reply([])
 }
 if(req.method==='POST'&&path.startsWith('upload/sign/tenant-verification/'))return reply({url:'/object/'+path+'?token=isolated-test'})
 if(req.method==='PUT'&&path.startsWith('upload/sign/tenant-verification/')){
  const key=path.slice('upload/sign/tenant-verification/'.length),chunks=[];let size=0
  for await(const bytes of req){size+=bytes.length;if(size>5242880)return reply({message:'Too large'},413);chunks.push(bytes)}
  if(objects.has(key))return reply({message:'Exists'},409)
  objects.set(key,{bytes:Buffer.concat(chunks),type:req.headers['content-type']});return reply({Key:key})
 }
 if(req.method==='POST'&&path.startsWith('sign/tenant-verification/'))return reply({signedURL:'/object/'+path+'?token=isolated-download'})
 if(req.method==='GET'){
  const key=path.replace(/^(?:authenticated\/|sign\/)?tenant-verification\//,''),item=objects.get(key)
  if(!item)return reply({message:'Missing'},404)
  res.setHeader('Content-Type',item.type);if(path.startsWith('sign/'))res.setHeader('Content-Disposition','attachment; filename="evidence.png"');return res.end(item.bytes)
 }
 if(req.method==='DELETE'&&path==='tenant-verification'){
  const chunks=[];for await(const bytes of req)chunks.push(bytes);for(const key of JSON.parse(Buffer.concat(chunks).toString()).prefixes)objects.delete(key);return reply([])
 }
 reply({message:'Unknown test operation'},400)
})
server.on('error',()=>{console.error('Isolated verification transport could not start.');process.exit(1)})
server.listen(port,'127.0.0.1')
global.fetch=(input,init)=>{
 const u=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url)
 return u.origin===origin?original('http://127.0.0.1:'+port+u.pathname+u.search,init):original(input,init)
}
