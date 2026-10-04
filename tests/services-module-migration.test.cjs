/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { Client } = require('pg')
const { randomUUID } = require('node:crypto')

test('Services upgrade preserves legacy access and explicit decisions; future tenants are denied', async () => {
  const url = new URL(process.env.CRM_TEST_DATABASE_URL || 'http://invalid')
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/ls_salon_crm_test') throw Error('Local disposable database only.')
  const db = new Client({ connectionString: url.toString() })
  await db.connect()
  try {
    await db.query('BEGIN')
    const schema = `services_${randomUUID().replaceAll('-', '')}`
    await db.query(`CREATE SCHEMA ${schema} AUTHORIZATION crm_test_runtime; SET LOCAL search_path TO ${schema}; SET LOCAL ROLE crm_test_runtime;
      CREATE TABLE "Tenant" (id text PRIMARY KEY);
      CREATE TABLE "TenantModule" ("tenantId" text REFERENCES "Tenant"(id), key text, allowed boolean NOT NULL DEFAULT false, enabled boolean NOT NULL DEFAULT false, "updatedAt" timestamp, PRIMARY KEY ("tenantId",key), CHECK(NOT enabled OR allowed));
      INSERT INTO "Tenant" VALUES ('legacy'),('disabled'),('revoked');
      INSERT INTO "TenantModule" VALUES ('disabled','services',true,false,now()),('revoked','services',false,false,now());
      ALTER TABLE "TenantModule" ENABLE ROW LEVEL SECURITY; ALTER TABLE "TenantModule" FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON "TenantModule" USING (app.tenant_match("tenantId")) WITH CHECK (app.tenant_match("tenantId"));`)
    assert.equal((await db.query('SELECT * FROM "TenantModule"')).rowCount, 0)
    const migration = fs.readFileSync('prisma/migrations/20261003100000_services_module/migration.sql', 'utf8').replace(/^BEGIN;/, '').replace(/COMMIT;\s*$/, '')
    await db.query(migration); await db.query(migration)
    const rows = (await db.query('SELECT "tenantId",allowed,enabled FROM "TenantModule" ORDER BY "tenantId"')).rows
    assert.deepEqual(rows, [{tenantId:'disabled',allowed:true,enabled:false},{tenantId:'legacy',allowed:true,enabled:true},{tenantId:'revoked',allowed:false,enabled:false}])
    await db.query(`INSERT INTO "Tenant" VALUES ('new'); INSERT INTO "TenantModule" ("tenantId",key) VALUES ('new','services')`)
    const fresh = (await db.query(`SELECT * FROM "TenantModule" WHERE "tenantId"='new'`)).rows[0]
    assert.equal(fresh.allowed, false); assert.equal(fresh.enabled, false)
    await db.query(`SET LOCAL app.rls_bypass='off'; SET LOCAL app.tenant_id='legacy'`)
    assert.equal((await db.query('SELECT * FROM "TenantModule"')).rowCount, 1)
  } finally { await db.query('ROLLBACK'); await db.end() }
})
