/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),fs=require('node:fs'),{Client}=require('pg'),{createHash}=require('node:crypto')
async function main(){
 assert.equal(process.env.R5_HISTORICAL_CONTAINER,'1');const url=new URL(process.env.CRM_TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/ls_salon_crm_test')
 const db=new Client({connectionString:url.toString()});await db.connect()
 try{
  const tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' ORDER BY tablename")).rows.map(row=>row.tablename)
  const snapshot=()=>Promise.all(tables.map(async table=>(await db.query(`SELECT to_jsonb(t) row FROM "${table}" t ORDER BY to_jsonb(t)::text COLLATE "C"`)).rows.map(row=>row.row)))
  const before=await snapshot(),name='20261026000600_private_booking_integrity',sql=fs.readFileSync(`prisma/migrations/${name}/migration.sql`,'utf8')
  await assert.rejects(db.query(sql.replace(/COMMIT;\s*$/,'SELECT 1/0; COMMIT;')),/division by zero/);await db.query('ROLLBACK');assert.deepEqual(await snapshot(),before)
  assert.equal((await db.query("SELECT to_regprocedure('app.appointment_conflict_summary(text,jsonb,text[])') f")).rows[0].f,null)
  await db.query(sql);assert.deepEqual(await snapshot(),before)
  const fn=(await db.query("SELECT p.prosecdef,role.rolsuper OR role.rolbypassrls AS owner_can_project FROM pg_proc p JOIN pg_roles role ON role.oid=p.proowner WHERE p.oid='app.appointment_conflict_summary(text,jsonb,text[])'::regprocedure")).rows[0]
  assert.equal(fn.prosecdef,true);assert.equal(fn.owner_can_project,true)
  await db.query('INSERT INTO "_prisma_migrations"(id,checksum,migration_name,finished_at) VALUES($1,$2,$1,now())',[name,createHash('sha256').update(sql).digest('hex')])
  console.log(`Private booking integrity: rollback verified; all ${tables.length} preceding tables preserved exactly, including leave reasons, histories, appointments, permissions and office grants.`)
 }finally{await db.end()}
}
main().catch(error=>{console.error(error.message);process.exitCode=1})
