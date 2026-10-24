/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),fs=require('node:fs'),{Client}=require('pg'),{createHash}=require('node:crypto')
async function main(){
 assert.equal(process.env.R5_HISTORICAL_CONTAINER,'1');const url=new URL(process.env.CRM_TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/ls_salon_crm_test')
 const db=new Client({connectionString:url.toString()});await db.connect()
 try{
  const tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' ORDER BY tablename")).rows.map(r=>r.tablename),snapshots=new Map()
  for(const table of tables)snapshots.set(table,(await db.query(`SELECT to_jsonb(t) row FROM "${table}" t ORDER BY to_jsonb(t)::text COLLATE "C"`)).rows.map(r=>r.row))
  const name='20261025000400_record_sharing',sql=fs.readFileSync(`prisma/migrations/${name}/migration.sql`,'utf8')
  await assert.rejects(db.query(sql.replace(/COMMIT;\s*$/, 'SELECT 1/0; COMMIT;')), /division by zero/);await db.query('ROLLBACK')
  for(const table of tables)assert.deepEqual((await db.query(`SELECT to_jsonb(t) row FROM "${table}" t ORDER BY to_jsonb(t)::text COLLATE "C"`)).rows.map(r=>r.row),snapshots.get(table),`${table}: rollback`)
  await db.query(sql)
  for(const table of tables){const rows=(await db.query(`SELECT to_jsonb(t)-'sharingPolicyId' row FROM "${table}" t ORDER BY (to_jsonb(t)-'sharingPolicyId')::text COLLATE "C"`)).rows.map(r=>r.row);assert.deepEqual(rows,snapshots.get(table),table)}
  assert.equal((await db.query('SELECT count(*)::int n FROM "RecordSharingPolicy"')).rows[0].n,0)
  assert.equal((await db.query('SELECT count(*)::int n FROM "RecordSharingGrant"')).rows[0].n,0)
  for(const name of ['RecordSharingPolicy','RecordSharingGrant'])assert.equal((await db.query('SELECT relrowsecurity AND relforcerowsecurity secure FROM pg_class WHERE relname=$1',[name])).rows[0].secure,true)
  await db.query('GRANT SELECT,INSERT,UPDATE,DELETE ON "RecordSharingPolicy","RecordSharingGrant" TO crm_test_runtime')
  await db.query('GRANT SELECT,INSERT,UPDATE,DELETE ON "CatalogReservationAvailability" TO crm_test_runtime')
  assert.equal((await db.query('SELECT count(*)::int n FROM "CatalogReservationAvailability"')).rows[0].n,(await db.query('SELECT count(*)::int n FROM "UnitReservation" WHERE status IN (\'HELD\',\'ALLOCATED\')')).rows[0].n)
  await db.query('INSERT INTO "_prisma_migrations"(id,checksum,migration_name,finished_at) VALUES($1,$2,$1,now())',[name,createHash('sha256').update(sql).digest('hex')])
  console.log(`Record sharing migration: rollback verified; ${tables.length} tables, grants, owners and memberships preserved; no record automatically restricted or shared; forced RLS retained.`)
 }finally{await db.end()}
}
main().catch(e=>{console.error(e);process.exitCode=1})
