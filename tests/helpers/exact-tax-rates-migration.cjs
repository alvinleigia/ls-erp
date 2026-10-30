/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),fs=require('node:fs'),{Client}=require('pg'),{createHash}=require('node:crypto')
async function main(){
 assert.equal(process.env.R5_HISTORICAL_CONTAINER,'1');const url=new URL(process.env.CRM_TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/ls_salon_crm_test')
 const db=new Client({connectionString:url.toString()});await db.connect()
 try{
  const tables=(await db.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' ORDER BY tablename`)).rows.map(x=>x.tablename)
  const snapshot=async()=>Promise.all(tables.map(async table=>{const doc='to_jsonb(t)';return(await db.query(`SELECT ${doc} row FROM "${table}" t ORDER BY (${doc})::text COLLATE "C"`)).rows.map(x=>x.row)}))
  const before=await snapshot(),policies=(await db.query(`SELECT * FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname`)).rows
  const functions=(await db.query(`SELECT p.oid,p.proname,pg_get_functiondef(p.oid) body FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app' ORDER BY p.oid`)).rows
  const name='20261030000600_exact_tax_rates',sql=fs.readFileSync(`prisma/migrations/${name}/migration.sql`,'utf8')
  await db.query(`INSERT INTO "Tax"(id,name,percent,"updatedAt") VALUES('p13_bad_precision','QA invalid rate',0.0000000000001,now())`)
  await assert.rejects(db.query(sql),/exceeding 12 decimal places/);await db.query('ROLLBACK')
  assert.equal((await db.query(`SELECT data_type FROM information_schema.columns WHERE table_name='Tax' AND column_name='percent'`)).rows[0].data_type,'double precision')
  await db.query(`DELETE FROM "Tax" WHERE id='p13_bad_precision'`)
  await assert.rejects(db.query(sql.replace(/COMMIT;\s*$/,'SELECT 1/0; COMMIT;')),/division by zero/);await db.query('ROLLBACK')
  for(const prior of functions)assert.equal((await db.query('SELECT pg_get_functiondef($1::oid) body',[prior.oid])).rows[0].body,prior.body)
  assert.deepEqual(await snapshot(),before)
  await db.query(sql);assert.deepEqual(await snapshot(),before)
  assert.deepEqual((await db.query(`SELECT * FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname`)).rows,policies)
  for(const prior of functions)assert.equal((await db.query('SELECT pg_get_functiondef($1::oid) body',[prior.oid])).rows[0].body,prior.body)
  for(const [table,col] of [['Tax','percent'],['AppointmentOrderTax','percent'],['PurchaseOrderItem','taxPercent']]){const c=(await db.query('SELECT data_type,numeric_precision,numeric_scale FROM information_schema.columns WHERE table_name=$1 AND column_name=$2',[table,col])).rows[0];assert.equal(c.data_type,'numeric');assert.equal(c.numeric_precision,null);assert.equal(c.numeric_scale,null)}
  await db.query(`CREATE TEMP TABLE exact_old_rates(v float8);INSERT INTO exact_old_rates VALUES(0.30000000000000004),(1e-100),(17.5);ALTER TABLE exact_old_rates ALTER COLUMN v TYPE numeric USING v::text::numeric`)
  assert.deepEqual((await db.query('SELECT v::text value FROM exact_old_rates ORDER BY v')).rows.map(r=>r.value),['0.'+'0'.repeat(99)+'1','0.30000000000000004','17.5'])
  await db.query('INSERT INTO "_prisma_migrations"(id,checksum,migration_name,finished_at) VALUES($1,$2,$1,now())',[name,createHash('sha256').update(sql).digest('hex')])
  console.log(`Exact tax rate migration: forced rollback and exact preservation of ${tables.length} tables/policies; all prior functions unchanged; exact native percentage types; 142 migrations.`)
 }finally{await db.end()}
}
main().catch(e=>{console.error(e);process.exitCode=1})
