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
    const before = await snapshot(), name = '20261026000100_company_office_structure', sql = fs.readFileSync(`prisma/migrations/${name}/migration.sql`, 'utf8')
    await assert.rejects(db.query(sql.replace(/COMMIT;\s*$/, 'SELECT 1/0; COMMIT;')), /division by zero/); await db.query('ROLLBACK')
    assert.deepEqual(await snapshot(), before)
    assert.equal((await db.query("SELECT to_regclass('public.\"BusinessCompany\"') tbl")).rows[0].tbl, null)
    assert.equal((await db.query("SELECT to_regclass('public.\"BusinessOffice\"') tbl")).rows[0].tbl, null)
    await db.query(sql)
    assert.deepEqual(await snapshot(), before)
    const tenants = (await db.query('SELECT id,name FROM "Tenant" ORDER BY id')).rows
    for (const t of tenants) {
      assert.deepEqual((await db.query('SELECT id,code,name,"parentId",archived,"isInitial",version FROM "BusinessCompany" WHERE "tenantId"=$1', [t.id])).rows,
        [{ id: 'company_' + t.id, code: 'MAIN', name: t.name.slice(0, 160), parentId: null, archived: false, isInitial: true, version: 1 }])
      assert.deepEqual((await db.query('SELECT id,"companyId",code,name,archived,"isInitial",version FROM "BusinessOffice" WHERE "tenantId"=$1', [t.id])).rows,
        [{ id: 'office_' + t.id, companyId: 'company_' + t.id, code: 'MAIN', name: 'Main office', archived: false, isInitial: true, version: 1 }])
    }
    for (const table of ['BusinessCompany', 'BusinessOffice']) assert.equal((await db.query('SELECT relrowsecurity AND relforcerowsecurity secure FROM pg_class WHERE relname=$1', [table])).rows[0].secure, true)
    await db.query('GRANT SELECT,INSERT,UPDATE,DELETE ON "BusinessCompany","BusinessOffice" TO crm_test_runtime')
    await db.query('INSERT INTO "_prisma_migrations"(id,checksum,migration_name,finished_at) VALUES($1,$2,$1,now())', [name, createHash('sha256').update(sql).digest('hex')])
    console.log(`Company/office migration: rollback verified; ${tables.length} existing tables unchanged; ${tenants.length} initial companies/offices created; forced RLS enabled.`)
  } finally { await db.end() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
