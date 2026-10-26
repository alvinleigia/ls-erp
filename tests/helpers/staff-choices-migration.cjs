/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),fs=require('node:fs'),{Client}=require('pg'),{createHash}=require('node:crypto')
async function main(){
 assert.equal(process.env.R5_HISTORICAL_CONTAINER,'1');const url=new URL(process.env.CRM_TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/ls_salon_crm_test')
 const db=new Client({connectionString:url.toString()});await db.connect()
 try{
  const tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' ORDER BY tablename")).rows.map(r=>r.tablename)
  const capture=()=>Promise.all(tables.map(async table=>(await db.query(`SELECT to_jsonb(t) row FROM "${table}" t ORDER BY to_jsonb(t)::text COLLATE "C"`)).rows.map(r=>r.row)))
  const policies=async()=>(await db.query("SELECT * FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname")).rows
  const functions=async()=>(await db.query("SELECT p.oid,pg_get_functiondef(p.oid) definition,p.proacl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app' ORDER BY p.oid")).rows
  const before=await capture(),oldPolicies=await policies(),oldFunctions=await functions(),name='20261026001500_workforce_staff_choices',sql=fs.readFileSync(`prisma/migrations/${name}/migration.sql`,'utf8')
  await assert.rejects(db.query(sql.replace(/COMMIT;\s*$/,'SELECT 1/0;COMMIT;')),/division by zero/);await db.query('ROLLBACK');assert.deepEqual(await capture(),before);assert.deepEqual(await policies(),oldPolicies);assert.deepEqual(await functions(),oldFunctions)
  await db.query(sql);assert.deepEqual(await capture(),before);assert.deepEqual(await policies(),oldPolicies)
  const current=await functions();for(const fn of oldFunctions)assert.deepEqual(current.find(row=>row.oid===fn.oid),fn)
  await db.query('INSERT INTO "_prisma_migrations"(id,checksum,migration_name,finished_at) VALUES($1,$2,$1,now())',[name,createHash('sha256').update(sql).digest('hex')])
  console.log(`Workforce staff choices: forced rollback verified; all ${tables.length} prior tables, policies, functions and grants preserved exactly. No existing source or history changed.`)
 }finally{await db.end()}
}
main().catch(e=>{console.error(e);process.exitCode=1})
