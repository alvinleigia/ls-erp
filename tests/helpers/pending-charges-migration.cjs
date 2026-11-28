/* eslint-disable @typescript-eslint/no-require-imports */
const fs=require('node:fs'),assert=require('node:assert/strict'),{createHash,randomUUID}=require('node:crypto'),{Client}=require('pg')
async function main(){
 assert.equal(process.env.R5_HISTORICAL_CONTAINER,'1');const url=new URL(process.env.CRM_TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/ls_salon_crm_test')
 const db=new Client({connectionString:url.toString()});await db.connect()
 try{
  const tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' ORDER BY tablename")).rows.map(r=>r.tablename)
  const snapshot=()=>Promise.all(tables.map(async table=>(await db.query(`SELECT md5(coalesce(string_agg(row::text,'' ORDER BY row::text COLLATE "C"),'')) digest FROM (SELECT to_jsonb(t) row FROM "${table}" t) rows`)).rows[0].digest))
  const before=await snapshot(),policies=(await db.query('SELECT * FROM pg_policies ORDER BY schemaname,tablename,policyname')).rows
  const name='20261128000100_pending_receivable_charges',sql=fs.readFileSync(`prisma/migrations/${name}/migration.sql`,'utf8')
  await assert.rejects(db.query(sql.replace(/COMMIT;\s*$/,'SELECT 1/0; COMMIT;')),/division by zero/);await db.query('ROLLBACK');assert.deepEqual(await snapshot(),before)
  assert.equal((await db.query(`SELECT to_regclass('public."OrderReceivableCharge"') t`)).rows[0].t,null)
  await db.query(sql);assert.deepEqual(await snapshot(),before)
  assert.deepEqual((await db.query(`SELECT * FROM pg_policies WHERE tablename<>'OrderReceivableCharge' ORDER BY schemaname,tablename,policyname`)).rows,policies)
  const guard=(await db.query(`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname='OrderReceivableCharge'`)).rows[0];assert(guard.relrowsecurity&&guard.relforcerowsecurity)
  assert((await db.query(`SELECT has_table_privilege('crm_test_runtime','"OrderReceivableCharge"','INSERT') allowed`)).rows[0].allowed)
  await db.query('INSERT INTO "_prisma_migrations"(id,checksum,migration_name,finished_at) VALUES($1,$2,$3,now())',[randomUUID(),createHash('sha256').update(sql).digest('hex'),name])
  console.log(`Pending charges migration: rollback, ${tables.length} existing tables and policies preserved; forced RLS and inherited runtime grants checked.`)
 }finally{await db.end()}
}main().catch(e=>{console.error(e.message);process.exitCode=1})
