/* eslint-disable @typescript-eslint/no-require-imports */
const fs=require('node:fs'),assert=require('node:assert/strict'),{createHash,randomUUID}=require('node:crypto'),{Client}=require('pg')
async function main(){
 assert.equal(process.env.R5_HISTORICAL_CONTAINER,'1')
 const url=new URL(process.env.CRM_TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/ls_salon_crm_test')
 const db=new Client({connectionString:url.toString()});await db.connect()
 try{
  // Match hosted Supabase: the security-definer owner bypasses RLS but is not
  // superuser, so it still needs actual table DML privileges. Runtime is separate.
  await db.query('CREATE ROLE project_hierarchy_deriver NOLOGIN NOSUPERUSER BYPASSRLS')
  await db.query('GRANT USAGE,CREATE ON SCHEMA app TO project_hierarchy_deriver')
  await db.query('GRANT USAGE ON SCHEMA public TO project_hierarchy_deriver')
  await db.query('GRANT SELECT ON "RealEstateProjectAncestor" TO project_hierarchy_deriver')
  await db.query('ALTER FUNCTION app.project_hierarchy_links() OWNER TO project_hierarchy_deriver')
  const permitted=async role=>(await db.query(`SELECT has_table_privilege($1,'public."RealEstateProjectAncestor"','INSERT') allowed`,[role])).rows[0].allowed
  assert.equal(await permitted('project_hierarchy_deriver'),false)
  await db.query('SET ROLE project_hierarchy_deriver')
  await assert.rejects(db.query('INSERT INTO "RealEstateProjectAncestor" SELECT * FROM "RealEstateProjectAncestor" WHERE false'),/permission denied/)
  await db.query('RESET ROLE')
  const tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' ORDER BY tablename")).rows.map(r=>r.tablename)
  const snapshot=async()=>Promise.all(tables.map(async table=>(await db.query(`SELECT md5(coalesce(string_agg(row::text,'' ORDER BY row::text COLLATE "C"),'')) digest FROM (SELECT to_jsonb(t) row FROM "${table}" t) rows`)).rows[0].digest))
  const before=await snapshot(),name='20261119000300_project_hierarchy_derivation_grant',sql=fs.readFileSync(`prisma/migrations/${name}/migration.sql`,'utf8')
  await assert.rejects(db.query(sql.replace(/COMMIT;\s*$/,'SELECT 1/0; COMMIT;')),/division by zero/);await db.query('ROLLBACK')
  assert.deepEqual(await snapshot(),before);assert.equal(await permitted('project_hierarchy_deriver'),false)
  await db.query(sql);assert.deepEqual(await snapshot(),before)
  assert.equal(await permitted('project_hierarchy_deriver'),true);assert.equal(await permitted('crm_test_runtime'),false)
  await db.query('SET ROLE project_hierarchy_deriver')
  await db.query('INSERT INTO "RealEstateProjectAncestor" SELECT * FROM "RealEstateProjectAncestor" WHERE false')
  await db.query('RESET ROLE')
  await db.query('INSERT INTO "_prisma_migrations"(id,checksum,migration_name,finished_at) VALUES($1,$2,$3,now())',[randomUUID(),createHash('sha256').update(sql).digest('hex'),name])
  // Leave this real non-superuser owner in place for the following native suites.
  console.log(`Hierarchy derivation grants: reproduced hosted non-superuser failure, verified rollback and ${tables.length} tables unchanged; trigger-only insertion restored, runtime writes still denied.`)
 }finally{await db.end()}
}
main().catch(error=>{console.error(error);process.exitCode=1})
