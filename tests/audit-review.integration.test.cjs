/* eslint-disable @typescript-eslint/no-require-imports */
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{randomUUID}=require('node:crypto')
const {AsyncLocalStorage}=require('node:async_hooks'),{Client,Pool}=require('pg'),{PrismaClient}=require('@prisma/client')
const raw=process.env.CRM_TEST_DATABASE_URL,url=new URL(raw||'http://invalid')
if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!='/ls_salon_crm_test')throw Error('Disposable local database only.')
const root=new Client({connectionString:raw});url.username='crm_test_runtime';url.password=''
process.env.DATABASE_URL=url.toString();process.env.RLS_POOL_MAX='2'
const sessions=new AsyncLocalStorage(),authPath=path.resolve(__dirname,'../auth.ts')
require.cache[authPath]={id:authPath,filename:authPath,loaded:true,exports:{auth:async()=>sessions.getStore()||null}}
require('../lib/logger.ts').logger.info=()=>{};require('../lib/logger.ts').logger.error=()=>{}
const {prisma}=require('../lib/prisma.ts'),{createAuditReportService}=require('../platform/audit/service.ts'),{TenantPgAdapter}=require('../lib/tenant-pg-adapter.ts')
const a=`audit_${randomUUID()}`,b=`audit_${randomUUID()}`,roleId=randomUUID(),queries=[]
const pool=new Pool({connectionString:url.toString(),max:2}),db=new PrismaClient({adapter:new TenantPgAdapter(pool,{tenantId:a,bypass:false}),log:[{emit:'event',level:'query'}]});db.$on('query',e=>queries.push(e.query))
const service=createAuditReportService(db,{tenantId:a,userId:a+'_admin'})
const call=(role='ADMIN',query='',id,tenant=a)=>sessions.run({user:{id:tenant+'_'+role.toLowerCase(),tenantId:tenant,role}},()=>require(`../app/api/reports/audit-logs/${id?'[id]/':''}route.ts`).GET(new Request(`http://${tenant}.localhost/api/reports/audit-logs${id?'/'+id:''}${query}`,{headers:{host:`${tenant}.localhost`}}),{params:Promise.resolve({id})}))
const permissions=p=>root.query('UPDATE "TenantAccessRole" SET permissions=$1 WHERE id=$2',[p,roleId])
const modules=(key,on)=>root.query('UPDATE "TenantModule" SET enabled=$1 WHERE "tenantId"=$2 AND key=$3',[on,a,key])
async function body(response,status=200){const json=await response.json();assert.equal(response.status,status,JSON.stringify(json));assert.equal(response.headers.get('cache-control'),'no-store');return json}
async function entry(id,event,type='Test',extra={}){
 await root.query('INSERT INTO "AuditLog" (id,"tenantId",event,"entityType","entityId","actorUserId","createdAt",before,after,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[id,a,event,type,extra.entityId||'record',extra.actorUserId||a+'_manager',extra.createdAt||'2030-10-07T12:00:00Z',extra.before||null,extra.after||{status:'UPDATED'},extra.metadata||null])
}
before(async()=>{
 await root.connect()
 for(const tenant of [a,b]){
  await root.query('INSERT INTO "Tenant" (id,name,slug,"updatedAt") VALUES ($1,$1,$1,now())',[tenant])
  for(const role of ['ADMIN','MANAGER','STAFF'])await root.query('INSERT INTO "User" (id,name,email,role,"tenantId","updatedAt") VALUES ($1,$2,$3,$4,$5,now())',[tenant+'_'+role.toLowerCase(),role,randomUUID()+'@example.test',role,tenant])
  for(const key of ['crm','realEstate','salesDocuments','paymentPlans','inventory'])await root.query('INSERT INTO "TenantModule" ("tenantId",key,allowed,enabled,"updatedAt") VALUES ($1,$2,true,true,now())',[tenant,key])
 }
 await root.query(`INSERT INTO "TenantAccessRole" (id,"tenantId",name,"nameKey",permissions,"updatedAt") VALUES ($1,$2,'Audit reviewer','audit reviewer',$3,now())`,[roleId,a,['auditLogs.read','inventoryProducts.read']])
 await root.query('INSERT INTO "TenantRoleAssignment" ("tenantId","userId","roleId","updatedAt") VALUES ($1,$2,$3,now())',[a,a+'_manager',roleId])
 await entry(a+'_product','inventory.inventoryProducts.edit','InventoryProduct',{before:{name:'Before',unchanged:'keep',version:1,credentials:{api_key:'old-secret',password:'old-password'},status:'DRAFT'},after:{name:'After',version:2,status:'ACTIVE',credentials:{api_key:'new-secret',password:'new-password'}},metadata:{nested:[{access_token:'token-secret'}]}})
 await entry(a+'_security','access.role.updated','TenantAccessRole',{after:{crmRecordScope:'OWN'}})
 await entry(a+'_module','module.updated','TenantModule')
 await entry(a+'_managerflag','crm.team.manager.updated','CrmSalesTeam')
 await entry(a+'_crm','crm.enquiry.updated','CrmEnquiry')
 await entry(a+'_quote','crm.quotation.updated','CrmQuotation')
 await entry(a+'_unknown','unclassified.updated')
})
after(async()=>{await db.$disconnect();await pool.end();await prisma.$disconnect();await global.prismaPool?.end();await root.end()})
test('lists omit payloads and details show recorded field changes with nested credentials redacted',async()=>{
 const response=await body(await call())
 assert.equal(response.canReviewSecurity,true);assert.equal(response.total,7)
 for(const row of response.items){assert.equal(row.before,undefined);assert.equal(row.after,undefined);assert.equal(row.metadata,undefined);assert.equal(row.actorName,'MANAGER')}
 const detail=await body(await call('ADMIN','',a+'_product'))
 assert.deepEqual(detail.changes.map(c=>c.field),['name','status'])
 assert.deepEqual(detail.changes.find(c=>c.field==='name'),{field:'name',before:'Before',after:'After'})
 assert.equal(detail.before.credentials,'[redacted]');assert.equal(detail.metadata.nested[0].access_token,'[redacted]')
 assert.equal(JSON.stringify(detail).includes('token-secret'),false)
 const stored=(await root.query('SELECT metadata FROM "AuditLog" WHERE id=$1',[a+'_product'])).rows[0];assert.equal(stored.metadata.nested[0].access_token,'token-secret')
})
test('manager report permissions never expose security, unrecognized or CRM historical snapshots',async()=>{
 for(const scope of ['ACCOUNT_ROLE','OWN','MANAGED_TEAMS','ALL']){
  await root.query('UPDATE "TenantAccessRole" SET "crmRecordScope"=$1 WHERE id=$2',[scope,roleId])
  const rows=await body(await call('MANAGER','?pageSize=1'));assert.equal(rows.total,1);assert.equal(rows.canReviewSecurity,false);assert.equal(rows.items[0].id,a+'_product')
  for(const key of ['security','module','managerflag','crm','unknown'])await body(await call('MANAGER','',a+'_'+key),404)
 }
 assert.equal((await body(await call('MANAGER','?category=security'))).total,0)
 await body(await call('MANAGER','',a+'_product'))
 await body(await call('STAFF'),403)
})
test('module revocation, current role and permission changes immediately guard detail reads',async()=>{
 await modules('inventory',false)
 assert.equal((await body(await call('MANAGER'))).total,0);await body(await call('MANAGER','',a+'_product'),404);await body(await call('ADMIN','',a+'_product'),404)
 await modules('inventory',true)
 await permissions(['auditLogs.read']);await body(await call('MANAGER','',a+'_product'),404)
 await permissions([]);await body(await call('MANAGER'),403)
 await permissions(['auditLogs.read','inventoryProducts.read'])
 await root.query(`UPDATE "User" SET role='STAFF' WHERE id=$1`,[a+'_manager']);await body(await call('MANAGER','',a+'_product'),403)
 await root.query(`UPDATE "User" SET role='MANAGER' WHERE id=$1`,[a+'_manager'])
 await modules('crm',false);await body(await call('ADMIN','',a+'_crm'),404);await body(await call('ADMIN','',a+'_quote'),404)
 await body(await call('ADMIN','',a+'_managerflag'));await body(await call('ADMIN','',a+'_module'))
 await modules('crm',true);await modules('salesDocuments',false);await body(await call('ADMIN','',a+'_quote'),404);await modules('salesDocuments',true)
})
test('tenant isolation, exact actor/target filters and stable tied-date pagination hold',async()=>{
 await body(await call('ADMIN','',a+'_product',b),404)
 assert.equal((await body(await call('ADMIN','',undefined,b))).total,0)
 const security=await body(await call('ADMIN','?category=security'));assert.equal(security.total,3)
 const q='?entityType=InventoryProduct&entityId=record&actorUserId='+encodeURIComponent(a+'_manager')+'&dateFrom=2030-10-07&dateTo=2030-10-07'
 const filtered=await body(await call('ADMIN',q));assert.equal(filtered.total,1)
 assert.equal((await body(await call('ADMIN',q+'&q=absent'))).total,0)
 const first=await body(await call('ADMIN','?pageSize=2')),second=await body(await call('ADMIN','?pageSize=2&page=2'))
 assert.equal(new Set([...first.items,...second.items].map(r=>r.id)).size,4)
})
test('invalid dates, reversed periods and oversized selectors return validation errors',async()=>{
 for(const q of ['?dateFrom=2030-02-30','?dateFrom=2030-10-09&dateTo=2030-10-01','?pageSize=101','?page=100001','?category=anything','?actorUserId='+ 'x'.repeat(101),'?sort=before'])await body(await call('ADMIN',q),400)
})
test('direct service rejects suspended tenants and normalized platform-tenant configuration',async()=>{
 await root.query(`UPDATE "Tenant" SET status='SUSPENDED' WHERE id=$1`,[a])
 try {await assert.rejects(service.list({}),e=>e.status===403)} finally {await root.query(`UPDATE "Tenant" SET status='ACTIVE' WHERE id=$1`,[a])}
 const previous=process.env.PLATFORM_ADMIN_TENANT_SLUG
 process.env.PLATFORM_ADMIN_TENANT_SLUG='  '+a.toUpperCase()+'  '
 try {await assert.rejects(service.list({}),e=>e.status===403)} finally {if(previous===undefined)delete process.env.PLATFORM_ADMIN_TENANT_SLUG;else process.env.PLATFORM_ADMIN_TENANT_SLUG=previous}
})
test('ten thousand audit rows use bounded queries and indexed chronological and record lookups',async()=>{
 await root.query(`INSERT INTO "AuditLog" (id,"tenantId",event,"entityType","entityId","actorUserId","createdAt",after) SELECT $1 || n,$2,'scale.updated','Scale',CASE WHEN n%100=0 THEN 'target' ELSE 'other' END,$3,'2030-01-01'::timestamp + n*interval '1 minute','{"large":"snapshot"}'::jsonb FROM generate_series(1,10000) n`,[a+'_scale_',a,a+'_admin'])
 await root.query('ANALYZE "AuditLog"');queries.length=0
 const result=await service.list({entityType:'Scale',pageSize:5})
 assert.equal(result.total,10000);assert.equal(result.items.length,5);assert.ok(queries.length<=8,`queries: ${queries.length}`)
 assert.ok(queries.filter(q=>q.includes('SELECT')&&q.includes('"AuditLog"')).every(q=>!q.includes('"before"')&&!q.includes('"after"')))
 const plan=await root.query('EXPLAIN (FORMAT JSON) SELECT id FROM "AuditLog" WHERE "tenantId"=$1 AND "entityType"=$2 AND "entityId"=$3 ORDER BY "createdAt" DESC,id DESC LIMIT 5',[a,'Scale','target'])
 assert.match(JSON.stringify(plan.rows),/AuditLog_tenantId_entityType_entityId_createdAt_id_idx/)
 console.log(`Audit scale: 10,000 rows, ${queries.length} statements, five summaries, no snapshots`)
})
