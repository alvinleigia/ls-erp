// Loaded only by the loopback-DB-guarded local server, never product code.
const url=new URL(process.env.CRM_TEST_DATABASE_URL||'http://invalid')
if(!['127.0.0.1','localhost'].includes(url.hostname)||url.pathname!='/ls_salon_crm_test'||process.env.P5_DOCUMENT_STORAGE_TEST!=='1')throw Error('Disposable local document transport only.')
const original=global.fetch,objects=new Map(),origin='https://documentstest.supabase.co'
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}})
global.fetch=async(input,init={})=>{
 const value=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url)
 if(value.origin!==origin)return original(input,init)
 const method=init.method||'GET',prefix='/storage/v1/object/',path=decodeURIComponent(value.pathname.slice(prefix.length))
 if(!value.pathname.startsWith(prefix))return reply({message:'Unsupported local storage path'},400)
 if(method==='POST'&&path.startsWith('sign/tenant-documents/')){const key=path.slice('sign/tenant-documents/'.length);return objects.has(key)?reply({signedURL:`/object/sign/tenant-documents/${key}?token=local-test`}):reply({message:'Missing object'},404)}
 if(method==='DELETE'&&path==='tenant-documents'){for(const key of JSON.parse(init.body).prefixes)objects.delete(key);return reply([])}
 if(method==='POST'&&path.startsWith('tenant-documents/')){const key=path.slice('tenant-documents/'.length);if(objects.has(key))return reply({message:'Already exists'},409);objects.set(key,Buffer.from(await new Response(init.body).arrayBuffer()));return reply({Key:key})}
 return reply({message:'Unsupported local storage operation'},400)
}
