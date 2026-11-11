/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),fs=require('node:fs'),{Client}=require('pg'),{createHash}=require('node:crypto')
async function main(){
 assert.equal(process.env.R5_HISTORICAL_CONTAINER,'1');const url=new URL(process.env.CRM_TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/ls_salon_crm_test')
 const db=new Client({connectionString:url.toString()});await db.connect()
 try{
  const tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' ORDER BY tablename")).rows.map(r=>r.tablename)
  const snapshot=()=>Promise.all(tables.map(async table=>(await db.query(`SELECT md5(coalesce(string_agg(to_jsonb(t)::text,'|' ORDER BY to_jsonb(t)::text COLLATE "C"),'')) hash,count(*)::int count FROM "${table}" t`)).rows[0]))
  const before=await snapshot(),name='20261110000200_customer_verification_foundation',sql=fs.readFileSync(`prisma/migrations/${name}/migration.sql`,'utf8')
  await assert.rejects(db.query(sql.replace(/COMMIT;\s*$/,'SELECT 1/0; COMMIT;')),/division by zero/);await db.query('ROLLBACK');assert.deepEqual(await snapshot(),before)
  assert.equal((await db.query("SELECT to_regclass('public.\"CustomerVerificationCase\"') relation")).rows[0].relation,null)
  await db.query(sql);assert.deepEqual(await snapshot(),before)
  for(const table of ['VerificationPolicyVersion','CustomerVerificationCase'])assert.equal((await db.query(`SELECT count(*)::int n FROM "${table}"`)).rows[0].n,0)
  assert.equal((await db.query('SELECT count(*)::int n FROM "TenantModule" WHERE key=\'customerVerification\'')).rows[0].n,0)
  await db.query('INSERT INTO "_prisma_migrations"(id,checksum,migration_name,finished_at) VALUES($1,$2,$1,now())',[name,createHash('sha256').update(sql).digest('hex')])
  console.log(`Verification foundation migration: forced rollback and exact preservation of ${tables.length} existing tables passed; no activation, profile grants, customer cases or payment changes.`)
 }finally{await db.end()}
}
main().catch(e=>{console.error(e);process.exitCode=1})
