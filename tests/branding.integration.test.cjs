/* eslint-disable @typescript-eslint/no-require-imports */
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{Pool}=require('pg'),{PrismaClient}=require('@prisma/client'),sharp=require('sharp')
const {TenantPgAdapter}=require('../lib/tenant-pg-adapter.ts')
const url=new URL(process.env.CRM_TEST_DATABASE_URL||'http://invalid');assert.ok(['localhost','127.0.0.1'].includes(url.hostname));assert.equal(url.pathname,'/ls_salon_crm_test')
// Deterministic external-storage boundary; authorization and database use real RLS.
const files=new Map(),storagePath=path.resolve(__dirname,'../platform/branding/storage.ts')
require.cache[storagePath]={id:storagePath,filename:storagePath,loaded:true,exports:{storageReady:()=>true,logoUrl:p=>'https://storage.example/'+p,uploadLogo:async(p,b)=>{assert.ok(!files.has(p));files.set(p,b)},removeUncommittedLogos:async paths=>paths.forEach(p=>files.delete(p)),downloadDocumentLogo:async p=>{assert.ok(files.has(p));return files.get(p)}}}
require('../lib/logger.ts').logger.info=()=>{}
const {saveBranding,readBranding}=require('../platform/branding/service.ts'),{readDocumentBranding}=require('../platform/branding/read.ts')
const pools=[],clients=[]
function client(tenantId,root=false){const u=new URL(url);if(!root){u.username='crm_test_runtime';u.password=''}const p=new Pool({connectionString:u.toString(),max:3});pools.push(p);const c=new PrismaClient({adapter:new TenantPgAdapter(p,{tenantId,bypass:root})});clients.push(c);return c}
const root=client(undefined,true),a=client('branding_a'),b=client('branding_b'),unscoped=client(),actor={tenantId:'branding_a',userId:'branding_a_admin',role:'ADMIN'}
let logo
before(async()=>{
 for(const id of ['branding_a','branding_b']){
 await root.tenant.create({data:{id,slug:id,name:id}})
 await root.appSetting.create({data:{tenantId:id}})
 await root.user.create({data:{id:id+'_admin',tenantId:id,email:id+'@example.test',name:'Admin',role:'ADMIN'}})
 }
 logo=await sharp({create:{width:1200,height:400,channels:4,background:{r:30,g:80,b:150,alpha:.5}}}).png().toBuffer()
})
after(async()=>{await Promise.all(clients.map(c=>c.$disconnect()));await Promise.all(pools.map(p=>p.end()))})
test('save stores only paths/metadata, audits and isolates tenant branding',async()=>{
 const saved=await saveBranding(a,actor,{name:'QA Brand',version:0},logo)
 assert.equal(saved.version,1);assert.equal(saved.branding.name,'QA Brand');assert.ok(saved.branding.logo.document.path.startsWith('branding_a/'))
 assert.ok(saved.branding.logo.document.bytes<=512*1024);assert.equal(JSON.stringify(saved).includes('base64'),false)
 assert.equal((await readBranding(b,{...actor,tenantId:'branding_b'})).version,0)
 assert.equal((await unscoped.appSetting.findMany({where:{tenantId:'branding_a'}})).length,0)
 assert.equal(await a.auditLog.count({where:{tenantId:'branding_a',event:'branding.updated'}}),1)
})
test('staff, managers and restricted administrators cannot change branding',async()=>{
 for(const denied of [{...actor,role:'STAFF'},{...actor,role:'MANAGER'},{...actor,permissions:['businessSettings.read']}])await assert.rejects(saveBranding(a,denied,{name:'Denied',version:1}),e=>e.status===403)
 assert.equal((await readBranding(a,actor)).branding.name,'QA Brand')
})
test('fresh database authorization overrides stale administrator session',async()=>{
 await root.user.update({where:{id:actor.userId},data:{role:'STAFF'}})
 try{await assert.rejects(saveBranding(a,actor,{name:'Denied',version:1}),e=>e.status===403)}finally{await root.user.update({where:{id:actor.userId},data:{role:'ADMIN'}})}
})
test('concurrent saves admit one revision and remove uncommitted conflict uploads',async()=>{
 const before=files.size
 const outcomes=await Promise.allSettled([saveBranding(a,actor,{name:'First',version:1},logo),saveBranding(a,actor,{name:'Second',version:1},logo)])
 assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert.equal(outcomes.find(r=>r.status==='rejected').reason.status,409)
 assert.equal(files.size,before+2)
})
test('replacement and removal preserve immutable document asset references',async()=>{
 const old=await readDocumentBranding(a,'branding_a'),oldBytes=files.get(old.logo.path)
 await saveBranding(a,actor,{name:'Replacement',version:2},logo)
 assert.notEqual((await readDocumentBranding(a,'branding_a')).logo.path,old.logo.path)
 await saveBranding(a,actor,{name:'',version:3,removeLogo:'true'})
 assert.equal((await readDocumentBranding(a,'branding_a')).logo,null);assert.equal((await readDocumentBranding(a,'branding_a')).name,'branding_a');assert.deepEqual(files.get(old.logo.path),oldBytes)
})
