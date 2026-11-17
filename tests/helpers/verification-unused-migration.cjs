/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),fs=require('node:fs'),{Client}=require('pg'),{createHash}=require('node:crypto')
async function main(){
 assert.equal(process.env.R5_HISTORICAL_CONTAINER,'1');const url=new URL(process.env.CRM_TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/ls_salon_crm_test')
 const db=new Client({connectionString:url.toString()});await db.connect()
 try{
  const tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' ORDER BY tablename")).rows.map(r=>r.tablename)
  const snapshot=()=>Promise.all(tables.map(async table=>(await db.query(`SELECT md5(coalesce(string_agg(to_jsonb(t)::text,'|' ORDER BY to_jsonb(t)::text COLLATE "C"),'')) hash,count(*)::int count FROM "${table}" t`)).rows[0]))
  const functions=async()=>(await db.query("SELECT p.oid,md5(pg_get_functiondef(p.oid)) hash FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app' AND p.prokind='f' ORDER BY p.oid")).rows
  const before=await snapshot(),priorFunctions=await functions(),name='20261117000200_verification_unused_upload_removal',sql=fs.readFileSync(`prisma/migrations/${name}/migration.sql`,'utf8')
  await assert.rejects(db.query(sql.replace(/COMMIT;\s*$/,'SELECT 1/0; COMMIT;')),/division by zero/);await db.query('ROLLBACK');assert.deepEqual(await snapshot(),before);assert.deepEqual(await functions(),priorFunctions)
  assert.equal((await db.query("SELECT to_regprocedure('app.verification_unused_original(text,text)') present")).rows[0].present,null)
  await db.query(sql);assert.deepEqual(await snapshot(),before)
  const after=await functions();for(const prior of priorFunctions)assert.deepEqual(after.find(f=>f.oid===prior.oid),prior)
  assert.equal(after.length,priorFunctions.length+2)
  await db.query('INSERT INTO "_prisma_migrations"(id,checksum,migration_name,finished_at) VALUES($1,$2,$1,now())',[name,createHash('sha256').update(sql).digest('hex')])
  console.log(`Verification unused upload migration: forced rollback, unchanged existing native functions and exact preservation of ${tables.length} existing tables passed.`)
 }finally{await db.end()}
}
main().catch(e=>{console.error(e);process.exitCode=1})
