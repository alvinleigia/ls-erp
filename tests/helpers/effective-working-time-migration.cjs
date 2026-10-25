/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),fs=require('node:fs'),{Client}=require('pg'),{createHash}=require('node:crypto')
async function main(){
 assert.equal(process.env.R5_HISTORICAL_CONTAINER,'1');const url=new URL(process.env.CRM_TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/ls_salon_crm_test')
 const db=new Client({connectionString:url.toString()});await db.connect()
 try{
  const tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' ORDER BY tablename")).rows.map(row=>row.tablename)
  const snapshot=()=>Promise.all(tables.map(async table=>(await db.query(`SELECT to_jsonb(t) row FROM "${table}" t ORDER BY to_jsonb(t)::text COLLATE "C"`)).rows.map(row=>row.row)))
  const policies=async()=>(await db.query("SELECT * FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname")).rows
  const sources=async()=>(await db.query("SELECT pg_get_functiondef('app.standard_working_time(text,text[],date,date)'::regprocedure) standard,pg_get_functiondef('app.history_flexible_slots(text,date)'::regprocedure) flexible")).rows
  const before=await snapshot(),beforePolicies=await policies(),beforeSources=await sources(),name='20261026001100_private_effective_working_time',sql=fs.readFileSync(`prisma/migrations/${name}/migration.sql`,'utf8')
  await assert.rejects(db.query(sql.replace(/COMMIT;\s*$/,'SELECT 1/0; COMMIT;')),/division by zero/);await db.query('ROLLBACK')
  assert.deepEqual(await snapshot(),before);assert.deepEqual(await policies(),beforePolicies);assert.deepEqual(await sources(),beforeSources)
  assert.equal((await db.query("SELECT to_regprocedure('app.effective_working_time(text,text[],date,date)') f")).rows[0].f,null)
  await db.query(sql);assert.deepEqual(await snapshot(),before);assert.deepEqual(await policies(),beforePolicies);assert.deepEqual(await sources(),beforeSources)
  const fn=(await db.query("SELECT p.prosecdef,role.rolsuper OR role.rolbypassrls AS owner_can_project FROM pg_proc p JOIN pg_roles role ON role.oid=p.proowner WHERE p.oid='app.effective_working_time(text,text[],date,date)'::regprocedure")).rows[0]
  assert.equal(fn.prosecdef,true);assert.equal(fn.owner_can_project,true)
  await db.query('INSERT INTO "_prisma_migrations"(id,checksum,migration_name,finished_at) VALUES($1,$2,$1,now())',[name,createHash('sha256').update(sql).digest('hex')])
  console.log(`Effective working time: rollback verified; all ${tables.length} preceding tables, policies and canonical source functions preserved exactly; no grants or frozen evidence changed.`)
 }finally{await db.end()}
}
main().catch(error=>{console.error(error.message);process.exitCode=1})
