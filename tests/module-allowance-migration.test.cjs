/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { Client } = require('pg')
const { randomUUID } = require('node:crypto')

test('allowance migration preserves existing choices under forced RLS and defaults new tenants to denied', async () => {
  const url = new URL(process.env.CRM_TEST_DATABASE_URL || 'http://invalid')
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/ls_salon_crm_test') throw Error('Local disposable database only.')
  const db = new Client({ connectionString: url.toString() })
  await db.connect()
  try {
    await db.query('BEGIN')
    const schema = `allowance_${randomUUID().replaceAll('-', '')}`
    await db.query(`CREATE SCHEMA ${schema} AUTHORIZATION crm_test_runtime; SET LOCAL search_path TO ${schema}; SET LOCAL ROLE crm_test_runtime;
      CREATE TABLE "Tenant" (id text PRIMARY KEY);
      CREATE TABLE "TenantModule" ("tenantId" text REFERENCES "Tenant"(id), key text, enabled boolean NOT NULL DEFAULT false, "updatedAt" timestamp, PRIMARY KEY ("tenantId",key));
      INSERT INTO "Tenant" VALUES ('legacy'),('disabled'),('empty');
      INSERT INTO "TenantModule" VALUES ('legacy','crm',true,now()),('disabled','crm',false,now());
      ALTER TABLE "TenantModule" ENABLE ROW LEVEL SECURITY;
      ALTER TABLE "TenantModule" FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON "TenantModule" USING (app.tenant_match("tenantId")) WITH CHECK (app.tenant_match("tenantId"));`)
    assert.equal((await db.query('SELECT * FROM "TenantModule"')).rowCount, 0)
    const migration = fs.readFileSync('prisma/migrations/20260930090000_module_allowances/migration.sql', 'utf8').replace(/^BEGIN;/, '').replace(/COMMIT;\s*$/, '')
    await db.query(migration)
    const rows = (await db.query('SELECT * FROM "TenantModule"')).rows
    assert.equal(rows.length, 12)
    assert.ok(rows.every(row => row.allowed))
    assert.deepEqual(rows.filter(row => row.enabled).map(row => [row.tenantId, row.key]), [['legacy', 'crm']])
    await db.query(`INSERT INTO "Tenant" VALUES ('new'); INSERT INTO "TenantModule" ("tenantId",key) VALUES ('new','crm')`)
    const fresh = (await db.query(`SELECT * FROM "TenantModule" WHERE "tenantId"='new'`)).rows[0]
    assert.equal(fresh.allowed, false); assert.equal(fresh.enabled, false)
    await db.query('SAVEPOINT invalid_flag')
    await assert.rejects(db.query(`UPDATE "TenantModule" SET enabled=true WHERE "tenantId"='new'`), error => error.code === '23514')
    await db.query('ROLLBACK TO SAVEPOINT invalid_flag')
    await db.query(`SET LOCAL app.rls_bypass='off'; SET LOCAL app.tenant_id='legacy'`)
    assert.equal((await db.query('SELECT * FROM "TenantModule"')).rowCount, 4)
  } finally { await db.query('ROLLBACK'); await db.end() }
})
