/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{createRequire}=require('node:module'),{Pool}=require('pg'),{PrismaPg}=require('@prisma/adapter-pg')
const root=path.resolve(__dirname,'..')
function trace(name){const file=path.join(root,'.next/server',name);return JSON.parse(fs.readFileSync(file)).files.map(f=>path.resolve(path.dirname(file),f))}
test('routing proxy trace excludes the database and credential providers',()=>{
 const files=trace('middleware.js.nft.json')
 assert.ok(files.length)
 assert.equal(files.some(f=>/node_modules[\\/](?:@prisma|\.prisma|bcryptjs|pg)[\\/]/.test(f)),false)
 const bytes=files.reduce((sum,file)=>sum+fs.statSync(file).size,0)
 assert.ok(bytes<8*1024*1024,`Proxy grew to ${bytes} bytes`)
 console.log(`Proxy dependency trace: ${(bytes/1048576).toFixed(2)} MiB, no Prisma/pg/bcrypt.`)
})
test('the packaged Prisma files execute PostgreSQL queries without borrowing the development dependency tree',async()=>{
 const url=new URL(process.env.CRM_TEST_DATABASE_URL||'http://invalid')
 assert.ok(['127.0.0.1','localhost'].includes(url.hostname));assert.equal(url.pathname,'/ls_salon_crm_test')
 const files=trace('app/api/crm/accounts/route.js.nft.json')
 assert.equal(files.some(f=>/query_engine_bg\.|query_compiler_bg\.(?:cockroachdb|mysql|sqlite|sqlserver)\./.test(f)),false)
 const prismaFiles=files.filter(f=>/node_modules[\\/](?:@prisma[\\/]client|\.prisma[\\/]client)[\\/]/.test(f))
 assert.ok(prismaFiles.some(f=>f.endsWith('query_compiler_bg.wasm')))
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ls-erp-prisma-bundle-')),pool=new Pool({connectionString:url.toString(),max:1})
 let client
 try{
  for(const file of prismaFiles){const relative=path.relative(root,file);assert.ok(!relative.startsWith('..')&&!path.isAbsolute(relative));const destination=path.join(directory,relative);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(file,destination)}
  const isolated=createRequire(path.join(directory,'verify.cjs'))
  const entry=isolated.resolve('@prisma/client');assert.ok(entry.startsWith(directory+path.sep))
  const {PrismaClient}=isolated('@prisma/client');client=new PrismaClient({adapter:new PrismaPg(pool)})
  const [count,probe]=await client.$transaction([client.tenant.count(),client.$queryRawUnsafe('SELECT 1::int AS result')])
  assert.ok(count>0);assert.equal(probe[0].result,1)
  console.log(`Packaged Prisma: ${prismaFiles.length} traced files; actual model query and raw SQL passed.`)
 }finally{
  await client?.$disconnect();await pool.end()
  const resolved=fs.realpathSync(directory),temp=fs.realpathSync(os.tmpdir())
  assert.equal(path.dirname(resolved).toLowerCase(),temp.toLowerCase());assert.ok(path.basename(resolved).startsWith('ls-erp-prisma-bundle-'))
  fs.rmSync(resolved,{recursive:true,force:true})
 }
})
test('PDF output retains the required invoice font',()=>{
 const files=trace('app/api/crm/quotations/[id]/pdf/route.js.nft.json')
 assert.ok(files.some(f=>f.endsWith(path.join('public','assets','fonts','NotoSans-Regular.ttf'))))
})
