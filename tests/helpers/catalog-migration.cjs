/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { Client } = require('pg')
const { createHash } = require('node:crypto')
async function main() {
  assert.equal(process.env.R5_HISTORICAL_CONTAINER, '1')
  const url = new URL(process.env.CRM_TEST_DATABASE_URL)
  assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.pathname, '/ls_salon_crm_test')
  const db = new Client({ connectionString: url.toString() })
  await db.connect()
  try {
    const before = (await db.query('SELECT id,name,code,version FROM "RealEstateProject" ORDER BY id')).rows
    await db.query(fs.readFileSync('prisma/migrations/20261018130000_sales_catalog/migration.sql', 'utf8'))
    assert.deepEqual((await db.query('SELECT id,name,code,version FROM "RealEstateProject" ORDER BY id')).rows, before)
    assert.equal((await db.query('SELECT count(*)::int n FROM "TenantModule" WHERE key=\'catalog\'')).rows[0].n, 0)
    await db.query('GRANT SELECT,INSERT,UPDATE,DELETE ON "CatalogItem","RealEstateUnit" TO crm_test_runtime')
    // Record only the migrations actually replayed by the isolated runner.
    await db.query('CREATE TABLE _prisma_migrations (id text PRIMARY KEY, checksum text NOT NULL, migration_name text NOT NULL, finished_at timestamptz, rolled_back_at timestamptz)')
    const migrations = [...require('../../docs/industry-release-manifest.json').migrations.map(row=>row.name), '20261018130000_sales_catalog']
    for (const name of migrations) await db.query('INSERT INTO _prisma_migrations (id,checksum,migration_name,finished_at) VALUES ($1,$2,$1,now())',[name,createHash('sha256').update(fs.readFileSync(`prisma/migrations/${name}/migration.sql`)).digest('hex')])
    await db.query('GRANT SELECT ON _prisma_migrations TO crm_test_runtime')
    console.log('Catalog migration preserved existing projects; no tenant automatically enabled.')
  } finally { await db.end() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
