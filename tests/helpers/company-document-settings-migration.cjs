/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),fs=require('node:fs'),{Client}=require('pg'),{createHash}=require('node:crypto')
async function main(){
 assert.equal(process.env.R5_HISTORICAL_CONTAINER,'1');const url=new URL(process.env.CRM_TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/ls_salon_crm_test')
 const db=new Client({connectionString:url.toString()});await db.connect()
 try{
  const snapshot=async()=> (await db.query('SELECT to_jsonb(c)-\'documentSettings\' row FROM "BusinessCompany" c ORDER BY id')).rows
  const before=await snapshot(),name='20261105000100_company_document_settings',sql=fs.readFileSync(`prisma/migrations/${name}/migration.sql`,'utf8')
  await assert.rejects(db.query(sql.replace(/COMMIT;\s*$/,'SELECT 1/0; COMMIT;')),/division by zero/);await db.query('ROLLBACK');assert.deepEqual(await snapshot(),before)
  await db.query(sql);assert.deepEqual(await snapshot(),before)
  assert.equal((await db.query('SELECT count(*) n FROM "BusinessCompany" WHERE "documentSettings"<>\'{}\'::jsonb')).rows[0].n,'0')
  await db.query('INSERT INTO "_prisma_migrations"(id,checksum,migration_name,finished_at) VALUES($1,$2,$1,now())',[name,createHash('sha256').update(sql).digest('hex')])
  console.log('Company document settings migration: rollback verified; existing companies preserved; no document snapshots rewritten.')
 }finally{await db.end()}
}
main().catch(e=>{console.error(e);process.exitCode=1})
