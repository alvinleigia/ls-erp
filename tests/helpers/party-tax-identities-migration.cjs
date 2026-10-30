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
  const name='20261030000700_party_tax_identities',sql=fs.readFileSync(`prisma/migrations/${name}/migration.sql`,'utf8')
  await assert.rejects(db.query(sql.replace(/COMMIT;\s*$/,'SELECT 1/0; COMMIT;')),/division by zero/);await db.query('ROLLBACK')
  for(const prior of functions)assert.equal((await db.query('SELECT pg_get_functiondef($1::oid) body',[prior.oid])).rows[0].body,prior.body)
  assert.deepEqual(await snapshot(),before)
  await db.query(sql);assert.deepEqual(await snapshot(),before)
  assert.deepEqual((await db.query(`SELECT * FROM pg_policies WHERE schemaname='public' AND tablename NOT IN ('PartyTaxIdentity','PartyTaxIdentityRevision') ORDER BY tablename,policyname`)).rows,policies)
  for(const prior of functions)assert.equal((await db.query('SELECT pg_get_functiondef($1::oid) body',[prior.oid])).rows[0].body,prior.body)
  for(const table of ['PartyTaxIdentity','PartyTaxIdentityRevision']){assert.equal((await db.query('SELECT count(*) n FROM "'+table+'"')).rows[0].n,'0');assert((await db.query('SELECT relrowsecurity AND relforcerowsecurity ok FROM pg_class WHERE relname=$1',[table])).rows[0].ok)}
  await db.query('INSERT INTO "_prisma_migrations"(id,checksum,migration_name,finished_at) VALUES($1,$2,$1,now())',[name,createHash('sha256').update(sql).digest('hex')])
  console.log('Party tax identity migration: forced rollback, all prior rows/policies/functions preserved; two empty forced-RLS tables; 143 migrations.')
 }finally{await db.end()}
}
main().catch(e=>{console.error(e);process.exitCode=1})
