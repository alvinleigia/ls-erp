/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),fs=require('node:fs'),{Client}=require('pg'),{createHash}=require('node:crypto')
async function main(){
 const url=new URL(process.env.CRM_TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/ls_salon_crm_test')
 const db=new Client({connectionString:url.toString()});await db.connect()
 try{
 const tables=['CrmTask','CrmTaskEvent','SalesOrder','OrderReceivable','OrderReceivableLine','OrderReceipt','OrderReceiptAllocation','OrderReceiptReversal','TenantModule','TenantAccessRole']
 const snapshot=async()=>Promise.all(tables.map(async name=>(await db.query(`SELECT to_jsonb(t)-'collectionOrderId' AS row FROM "${name}" t ORDER BY (to_jsonb(t)-'collectionOrderId')::text`)).rows))
 const before=await snapshot(),name='20261023000300_collection_follow_ups',sql=fs.readFileSync(`prisma/migrations/${name}/migration.sql`,'utf8')
 await db.query(sql);assert.deepEqual(await snapshot(),before)
 const rls=(await db.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname='CrmTask'")).rows[0];assert(rls.relrowsecurity&&rls.relforcerowsecurity)
 await db.query('INSERT INTO _prisma_migrations (id,checksum,migration_name,finished_at) VALUES ($1,$2,$1,now())',[name,createHash('sha256').update(sql).digest('hex')])
 assert.equal((await db.query('SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL')).rows[0].count,'106')
 console.log('Collection association preserves activities, financial records and permissions; existing forced RLS retained; 106 migrations.')
 }finally{await db.end()}
}main().catch(e=>{console.error(e.message);process.exitCode=1})
