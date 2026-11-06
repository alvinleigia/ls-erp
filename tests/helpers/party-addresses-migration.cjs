/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),fs=require('node:fs'),{Client}=require('pg'),{createHash}=require('node:crypto')
async function main(){
 assert.equal(process.env.R5_HISTORICAL_CONTAINER,'1');const url=new URL(process.env.CRM_TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/ls_salon_crm_test')
 const db=new Client({connectionString:url.toString()});await db.connect()
 try{
  const tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' ORDER BY tablename")).rows.map(row=>row.tablename)
  const snapshot=async()=>Promise.all(tables.map(async table=>(await db.query(`SELECT md5(coalesce(string_agg(to_jsonb(t)::text,'|' ORDER BY to_jsonb(t)::text COLLATE "C"),'')) hash,count(*)::int count FROM "${table}" t`)).rows[0]))
  const before=await snapshot(),policies=(await db.query("SELECT * FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname")).rows
  const functions=(await db.query("SELECT p.oid,pg_get_functiondef(p.oid) body FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app' ORDER BY p.oid")).rows
  const name='20261106000100_party_address_book',sql=fs.readFileSync(`prisma/migrations/${name}/migration.sql`,'utf8')
  await assert.rejects(db.query(sql.replace(/COMMIT;\s*$/,'SELECT 1/0; COMMIT;')),/division by zero/);await db.query('ROLLBACK')
  assert.deepEqual(await snapshot(),before)
  assert.equal((await db.query(`SELECT to_regclass('public."PartyAddress"') value`)).rows[0].value,null)
  assert.equal((await db.query("SELECT to_regprocedure('app.party_address_write()') value")).rows[0].value,null)
  await db.query(sql);assert.deepEqual(await snapshot(),before)
  assert.deepEqual((await db.query("SELECT * FROM pg_policies WHERE schemaname='public' AND tablename<>'PartyAddress' ORDER BY tablename,policyname")).rows,policies)
  for(const prior of functions)assert.equal((await db.query('SELECT pg_get_functiondef($1::oid) body',[prior.oid])).rows[0].body,prior.body)
  assert.equal((await db.query('SELECT count(*)::int n FROM "PartyAddress"')).rows[0].n,0)
  assert.equal((await db.query(`SELECT relrowsecurity AND relforcerowsecurity secured FROM pg_class WHERE oid='public."PartyAddress"'::regclass`)).rows[0].secured,true)
  await db.query('INSERT INTO "_prisma_migrations"(id,checksum,migration_name,finished_at) VALUES($1,$2,$1,now())',[name,createHash('sha256').update(sql).digest('hex')])
  console.log(`Address book migration: forced rollback and exact preservation of ${tables.length} tables, prior policies/functions verified; empty address book with forced RLS.`)
 }finally{await db.end()}
}
main().catch(e=>{console.error(e);process.exitCode=1})
