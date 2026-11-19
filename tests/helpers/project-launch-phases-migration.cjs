/* eslint-disable @typescript-eslint/no-require-imports */
const fs=require('node:fs'),assert=require('node:assert/strict'),{createHash,randomUUID}=require('node:crypto'),{Client}=require('pg')
async function main(){
 assert.equal(process.env.R5_HISTORICAL_CONTAINER,'1')
 const url=new URL(process.env.CRM_TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/ls_salon_crm_test')
 const db=new Client({connectionString:url.toString()});await db.connect()
 try{
  const tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' ORDER BY tablename")).rows.map(row=>row.tablename)
  const snapshot=async(after=false)=>Promise.all(tables.map(async table=>(await db.query(`SELECT md5(coalesce(string_agg(row::text,'' ORDER BY row::text COLLATE "C"),'')) digest FROM (SELECT to_jsonb(t)${after&&table==='RealEstateUnit'?"-'launchPhaseId'":''} row FROM "${table}" t) rows`)).rows[0].digest))
  const before=await snapshot(),name='20261119000200_project_launch_phases',sql=fs.readFileSync(`prisma/migrations/${name}/migration.sql`,'utf8')
  await assert.rejects(db.query(sql.replace(/COMMIT;\s*$/,'SELECT 1/0; COMMIT;')),/division by zero/);await db.query('ROLLBACK');assert.deepEqual(await snapshot(),before)
  await db.query(sql);assert.deepEqual(await snapshot(true),before)
  assert.equal((await db.query('SELECT count(*)::int n FROM "RealEstateLaunchPhase"')).rows[0].n,0)
  assert.equal((await db.query('SELECT count(*)::int n FROM "RealEstateUnit" WHERE "launchPhaseId" IS NOT NULL')).rows[0].n,0)
  await db.query('INSERT INTO "_prisma_migrations"(id,checksum,migration_name,finished_at) VALUES($1,$2,$3,now())',[randomUUID(),createHash('sha256').update(sql).digest('hex'),name])
  console.log(`Project launch phases: forced rollback and all ${tables.length} original tables preserved; existing units remain unphased without changing records, access grants or snapshots.`)
 }finally{await db.end()}
}
main().catch(error=>{console.error(error);process.exitCode=1})
