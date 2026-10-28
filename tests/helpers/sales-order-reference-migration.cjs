/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),fs=require('node:fs'),{Client}=require('pg'),{createHash}=require('node:crypto')
async function main(){
 assert.equal(process.env.R5_HISTORICAL_CONTAINER,'1');const url=new URL(process.env.CRM_TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/ls_salon_crm_test')
 const db=new Client({connectionString:url.toString()});await db.connect()
 try{
  // Seed an actual pre-migration confirmed agreement: preservation of an empty
  // order table would not establish the old-data contract for this migration.
  const source=(await db.query('SELECT id,"tenantId","assignedUserId" FROM "CrmOpportunity" ORDER BY id LIMIT 1')).rows[0];assert.ok(source)
  await db.query(`SELECT set_config('app.tenant_id',$1,false),set_config('app.rls_bypass','on',false)`,[source.tenantId])
  await db.query(`INSERT INTO "CrmQuotation"(id,"tenantId","opportunityId",title,currency,consideration,"updatedAt") VALUES('p4-old-quotation',$1,$2,'Pre-migration agreement','INR',37.5,now())`,[source.tenantId,source.id])
  await db.query(`INSERT INTO "CrmQuotationRevision"("tenantId","quotationId",number,snapshot) VALUES($1,'p4-old-quotation',1,'{"customer":{"name":"Saved old customer"},"calculation":{"consideration":"37.50"},"historicalEvidence":"unchanged"}')`,[source.tenantId])
  await db.query(`INSERT INTO "SalesOrder"("tenantId",id,"quotationId",revision,title,"customerName",currency,consideration,snapshot,"createdBy","updatedAt") SELECT $1,'p4-old-order','p4-old-quotation',1,'Pre-migration agreement','Saved old customer','INR',37.5,snapshot,$2,now() FROM "CrmQuotationRevision" WHERE "tenantId"=$1 AND "quotationId"='p4-old-quotation'`,[source.tenantId,source.assignedUserId])
  await db.query(`UPDATE "SalesOrder" SET status='CONFIRMED',version=2 WHERE "tenantId"=$1 AND id='p4-old-order'`,[source.tenantId])
  await db.query(`INSERT INTO "SalesOrderEvent"("tenantId","orderId",version,status,"actorId","actorName") VALUES($1,'p4-old-order',1,'DRAFT',$2,'Historical actor'),($1,'p4-old-order',2,'CONFIRMED',$2,'Historical actor')`,[source.tenantId,source.assignedUserId])
  const tables=(await db.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' ORDER BY tablename`)).rows.map(x=>x.tablename)
  const snapshot=async()=>Promise.all(tables.map(async table=>{const doc=`to_jsonb(t)${table==='SalesOrder'?"-'reference'-'orderedOn'":''}`;return(await db.query(`SELECT ${doc} row FROM "${table}" t ORDER BY (${doc})::text COLLATE "C"`)).rows.map(x=>x.row)}))
  const before=await snapshot(),policies=(await db.query(`SELECT * FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname`)).rows
  const functions=(await db.query(`SELECT p.oid,pg_get_functiondef(p.oid) body FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app' ORDER BY p.oid`)).rows
  const name='20261028000300_sales_order_references',sql=fs.readFileSync(`prisma/migrations/${name}/migration.sql`,'utf8')
  await assert.rejects(db.query(sql.replace(/COMMIT;\s*$/,'SELECT 1/0; COMMIT;')),/division by zero/);await db.query('ROLLBACK')
  assert.deepEqual(await snapshot(),before)
  assert.equal((await db.query(`SELECT to_regclass('public."SalesOrderSequence"') value`)).rows[0].value,null)
  await db.query(sql);assert.deepEqual(await snapshot(),before)
  await assert.rejects(db.query(`UPDATE "SalesOrder" SET reference='SO-000001',"orderedOn"='2026-01-01' WHERE "tenantId"=$1 AND id='p4-old-order'`,[source.tenantId]),/immutable/)
  await db.query('BEGIN');await db.query(`UPDATE "SalesOrder" SET status='CANCELLED',version=3 WHERE "tenantId"=$1 AND id='p4-old-order'`,[source.tenantId]);await db.query('ROLLBACK')
  assert.deepEqual(await snapshot(),before)
  assert.deepEqual((await db.query(`SELECT * FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname`)).rows,policies)
  for(const prior of functions)assert.equal((await db.query('SELECT pg_get_functiondef($1::oid) body',[prior.oid])).rows[0].body,prior.body)
  assert.equal((await db.query('SELECT count(*)::int n FROM "SalesOrder" WHERE reference IS NOT NULL OR "orderedOn" IS NOT NULL')).rows[0].n,0)
  assert.equal((await db.query('SELECT count(*)::int n FROM "SalesOrderSequence"')).rows[0].n,0)
  assert.equal((await db.query(`SELECT relforcerowsecurity FROM pg_class WHERE oid='public."SalesOrderSequence"'::regclass`)).rows[0].relforcerowsecurity,true)
  for(const action of ['SELECT','INSERT','UPDATE','DELETE'])assert.equal((await db.query(`SELECT has_table_privilege('crm_test_runtime','public."SalesOrderSequence"',$1) allowed`,[action])).rows[0].allowed,false)
  await db.query('INSERT INTO "_prisma_migrations"(id,checksum,migration_name,finished_at) VALUES($1,$2,$1,now())',[name,createHash('sha256').update(sql).digest('hex')])
  console.log(`Order reference migration: forced rollback and exact preservation of ${tables.length} preceding tables/policies/functions; old metadata NULL; no sequence runtime privileges; 135 migrations.`)
 }finally{await db.end()}
}
main().catch(e=>{console.error(e);process.exitCode=1})
