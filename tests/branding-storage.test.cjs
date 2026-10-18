/* eslint-disable @typescript-eslint/no-require-imports */
const {test,after}=require('node:test'),assert=require('node:assert/strict')
const storage=require('../platform/branding/storage.ts'),originalFetch=global.fetch
after(()=>{global.fetch=originalFetch})
test('server storage accepts only configured origin and immutable tenant asset paths',async()=>{
 delete process.env.SUPABASE_SECRET_KEY;delete process.env.SUPABASE_SERVICE_ROLE_KEY;delete process.env.SUPABASE_URL
 assert.equal(storage.storageReady(),false)
 process.env.SUPABASE_URL='https://brandingtest.supabase.co';process.env.SUPABASE_SECRET_KEY='sb_secret_test_only'
 assert.equal(storage.storageReady(),true)
 const path='tenant_a/11111111-1111-1111-1111-111111111111/document.png',calls=[]
 global.fetch=async(url,options)=>{calls.push({url:String(url),options});return new Response(JSON.stringify({Key:path,Id:'test'}),{status:200,headers:{'content-type':'application/json'}})}
 await storage.uploadLogo(path,Buffer.from('synthetic'),'image/png')
 assert.equal(calls.length,1);assert.ok(calls[0].url.startsWith('https://brandingtest.supabase.co/storage/v1/object/tenant-branding/tenant_a/'))
 assert.equal(new Headers(calls[0].options.headers).get('x-upsert'),'false')
 assert.equal(storage.logoUrl(path),'https://brandingtest.supabase.co/storage/v1/object/public/tenant-branding/'+path)
 assert.throws(()=>storage.logoUrl('../other/path'));await assert.rejects(storage.downloadDocumentLogo('https://attacker.example/logo.png'))
 assert.equal(calls.length,1)
 process.env.SUPABASE_URL='https://attacker.example';assert.equal(storage.storageReady(),false)
})
