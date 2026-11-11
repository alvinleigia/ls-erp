/* eslint-disable @typescript-eslint/no-require-imports */
// Explicit storage configuration only; never reads .env implicitly.
const fs=require('node:fs'),assert=require('node:assert/strict'),{createClient}=require('@supabase/supabase-js')
const bucket='tenant-verification',limit=5*1024*1024,types=['application/pdf','image/jpeg','image/png']
async function configure(storage,create=false){
 let result=await storage.getBucket(bucket)
 if(result.error){
  assert.ok(create&&String(result.error.statusCode)==='404','Verification bucket is unavailable. Review the explicit project before creating it.')
  const made=await storage.createBucket(bucket,{public:false,fileSizeLimit:limit,allowedMimeTypes:types});assert.ok(!made.error,'Unable to create private verification bucket')
  result=await storage.getBucket(bucket)
 }
 assert.ok(!result.error&&result.data,'Unable to inspect verification bucket')
 assert.equal(result.data.public,false,'Verification bucket must be private')
 assert.equal(Number(result.data.file_size_limit),limit,'Verification bucket must enforce the 5 MB limit')
 assert.deepEqual([...(result.data.allowed_mime_types||[])].sort(),[...types].sort(),'Verification bucket MIME configuration differs')
 return {bucket,private:true,fileLimit:limit}
}
async function main(){
 const args=process.argv.slice(2),index=k=>args[args.indexOf(k)+1]
 assert.ok(args.includes('--env')&&args.includes('--project'),'Specify --env and --project explicitly')
 const env=require('dotenv').parse(fs.readFileSync(index('--env'))),url=new URL(env.SUPABASE_URL),project=index('--project');assert.match(project,/^[a-z0-9]{20}$/);assert.equal(url.href,'https://'+project+'.supabase.co/')
 const key=env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY;assert.ok(key,'Missing server storage key')
 const storage=createClient(url.href,key,{auth:{persistSession:false,autoRefreshToken:false}}).storage
 console.log(JSON.stringify(await configure(storage,args.includes('--create'))))
}
module.exports={configure}
if(require.main===module)main().catch(()=>{console.error('Verification storage configuration failed. Review the explicit environment/project and bucket privacy; no existing bucket settings were changed.');process.exitCode=1})
