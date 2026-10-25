/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict'), fs = require('node:fs'), { Client } = require('pg'), { createHash } = require('node:crypto')
async function main() {
  assert.equal(process.env.R5_HISTORICAL_CONTAINER, '1')
  const url = new URL(process.env.CRM_TEST_DATABASE_URL)
  assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.pathname, '/ls_salon_crm_test')
  const db = new Client({ connectionString: url.toString() }); await db.connect()
  try {
    const tables = (await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' ORDER BY tablename")).rows.map(r => r.tablename)
    const snapshot = async () => Promise.all(tables.map(async table => (await db.query(`SELECT to_jsonb(t) row FROM "${table}" t ORDER BY to_jsonb(t)::text COLLATE "C"`)).rows.map(r => r.row)))
    const before = await snapshot(), name = '20261026000200_office_membership', sql = fs.readFileSync(`prisma/migrations/${name}/migration.sql`, 'utf8')
    await assert.rejects(db.query(sql.replace(/COMMIT;\s*$/, 'SELECT 1/0; COMMIT;')), /division by zero/); await db.query('ROLLBACK')
    assert.deepEqual(await snapshot(), before)
    for (const table of ['BusinessOfficePolicy', 'BusinessOfficeGrant', 'BusinessCompanyGrant']) assert.equal((await db.query('SELECT to_regclass($1) tbl', [`public."${table}"`])).rows[0].tbl, null)
    await db.query(sql); assert.deepEqual(await snapshot(), before)
    const users = (await db.query('SELECT id,"tenantId" FROM "User" WHERE "tenantId" IS NOT NULL ORDER BY id')).rows
    for (const u of users) {
      const offices = (await db.query('SELECT id FROM "BusinessOffice" WHERE "tenantId"=$1 AND "isInitial"', [u.tenantId])).rows
      assert.equal(offices.length, 1)
      assert.deepEqual((await db.query('SELECT "creationOfficeId",version FROM "BusinessOfficePolicy" WHERE "tenantId"=$1 AND "userId"=$2', [u.tenantId, u.id])).rows, [{ creationOfficeId: offices[0].id, version: 1 }])
      assert.deepEqual((await db.query('SELECT "officeId" FROM "BusinessOfficeGrant" WHERE "tenantId"=$1 AND "userId"=$2', [u.tenantId, u.id])).rows, [{ officeId: offices[0].id }])
    }
    assert.equal((await db.query('SELECT count(*)::integer n FROM "BusinessOfficePolicy"')).rows[0].n, users.length)
    assert.equal((await db.query('SELECT count(*)::integer n FROM "BusinessOfficeGrant"')).rows[0].n, users.length)
    assert.equal((await db.query('SELECT count(*)::integer n FROM "BusinessCompanyGrant"')).rows[0].n, 0)
    for (const table of ['BusinessOfficePolicy', 'BusinessOfficeGrant', 'BusinessCompanyGrant']) assert.equal((await db.query('SELECT relrowsecurity AND relforcerowsecurity secure FROM pg_class WHERE relname=$1', [table])).rows[0].secure, true)
    await db.query('GRANT SELECT,INSERT,UPDATE,DELETE ON "BusinessOfficePolicy","BusinessOfficeGrant","BusinessCompanyGrant" TO crm_test_runtime')
    await db.query('INSERT INTO "_prisma_migrations"(id,checksum,migration_name,finished_at) VALUES($1,$2,$1,now())', [name, createHash('sha256').update(sql).digest('hex')])
    console.log(`Office membership migration: rollback verified; ${tables.length} preceding tables unchanged; ${users.length} existing accounts assigned only their initial office; no implicit company/descendant grants.`)
  } finally { await db.end() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
