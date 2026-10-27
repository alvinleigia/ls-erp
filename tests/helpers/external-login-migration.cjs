/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),fs=require('node:fs'),{Client}=require('pg'),{createHash}=require('node:crypto')
async function main(){
 assert.equal(process.env.R5_HISTORICAL_CONTAINER,'1');const url=new URL(process.env.CRM_TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/ls_salon_crm_test')
 const db=new Client({connectionString:url.toString()});await db.connect()
 try{
  const tables=(await db.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' ORDER BY tablename`)).rows.map(x=>x.tablename)
  const snapshot=async()=>Promise.all(tables.map(async table=>(await db.query(`SELECT to_jsonb(t)${table==='User'?"-'collaboratorId'":''} row FROM "${table}" t ORDER BY to_jsonb(t)::text COLLATE "C"`)).rows.map(x=>x.row)))
  const before=await snapshot(),policies=(await db.query(`SELECT * FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname`)).rows
  const functions=(await db.query(`SELECT p.oid,pg_get_functiondef(p.oid) body,p.proname name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app' ORDER BY p.oid`)).rows
  const name='20261027000200_external_login_identity',sql=fs.readFileSync(`prisma/migrations/${name}/migration.sql`,'utf8')
  await assert.rejects(db.query(sql.replace(/COMMIT;\s*$/,'SELECT 1/0; COMMIT;')),/division by zero/);await db.query('ROLLBACK')
  assert.deepEqual(await snapshot(),before);assert.deepEqual((await db.query(`SELECT * FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname`)).rows,policies)
  await db.query(sql);assert.deepEqual(await snapshot(),before)
  assert.equal((await db.query(`SELECT count(*)::int n FROM "User" WHERE "collaboratorId" IS NOT NULL`)).rows[0].n,0)
  for(const prior of functions){const body=(await db.query('SELECT pg_get_functiondef($1::oid) body',[prior.oid])).rows[0].body;assert.equal(body.replace(/ AND (u|person)\."collaboratorId" IS NULL/g,'').replace(/ AND \((caller|u)\."collaboratorId" IS NULL OR capability\.permission='appointments\.read'\)/g,'').replace(/\r\n/g,'\n'),prior.body.replace(/\r\n/g,'\n'),prior.name)}
  const after=(await db.query(`SELECT * FROM pg_policies WHERE schemaname='public' AND policyname NOT LIKE 'external_%' ORDER BY tablename,policyname`)).rows
  assert.deepEqual(after,policies)
  await db.query('GRANT EXECUTE ON FUNCTION app.external_business_actor() TO crm_test_runtime')
  await db.query('INSERT INTO "_prisma_migrations"(id,checksum,migration_name,finished_at) VALUES($1,$2,$1,now())',[name,createHash('sha256').update(sql).digest('hex')])
  console.log(`External login migration: rollback verified; ${tables.length} preceding tables, existing policy definitions and internal capability semantics preserved; no accounts converted; 131 migrations.`)
 }finally{await db.end()}
}
main().catch(e=>{console.error(e);process.exitCode=1})
