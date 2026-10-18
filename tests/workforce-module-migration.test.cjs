/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { Client } = require('pg')
const { randomUUID } = require('node:crypto')

test('Workforce upgrade preserves legacy access and explicit decisions; future tenants are denied', async () => {
  const url = new URL(process.env.CRM_TEST_DATABASE_URL || 'http://invalid')
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/ls_salon_crm_test') throw Error('Local disposable database only.')
  const db = new Client({ connectionString: url.toString() })
  await db.connect()
  try {
    await db.query('BEGIN')
    const schema = `workforce_${randomUUID().replaceAll('-', '')}`
    await db.query(`CREATE SCHEMA ${schema} AUTHORIZATION crm_test_runtime; SET LOCAL search_path TO ${schema}; SET LOCAL ROLE crm_test_runtime;
      CREATE TABLE "Tenant" (id text PRIMARY KEY);
      CREATE TABLE "TenantModule" ("tenantId" text REFERENCES "Tenant"(id), key text, allowed boolean NOT NULL DEFAULT false, enabled boolean NOT NULL DEFAULT false, "updatedAt" timestamp, PRIMARY KEY ("tenantId",key), CHECK(NOT enabled OR allowed));
      INSERT INTO "Tenant" VALUES ('legacy'),('disabled'),('revoked');
      INSERT INTO "TenantModule" VALUES ('disabled','leaves',true,false,now()),('revoked','leaves',false,false,now());
      ALTER TABLE "TenantModule" ENABLE ROW LEVEL SECURITY; ALTER TABLE "TenantModule" FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON "TenantModule" USING (app.tenant_match("tenantId")) WITH CHECK (app.tenant_match("tenantId"));`)
    assert.equal((await db.query('SELECT * FROM "TenantModule"')).rowCount, 0)
    const migration = fs.readFileSync('prisma/migrations/20261004100000_workforce_modules/migration.sql', 'utf8').replace(/^BEGIN;/, '').replace(/COMMIT;\s*$/, '')
    await db.query(migration); await db.query(migration)
    const rows = (await db.query('SELECT "tenantId",allowed,enabled FROM "TenantModule" WHERE key=\'leaves\' ORDER BY "tenantId"')).rows
    assert.deepEqual(rows, [{tenantId:'disabled',allowed:true,enabled:false},{tenantId:'legacy',allowed:true,enabled:true},{tenantId:'revoked',allowed:false,enabled:false}])
    assert.equal((await db.query(`SELECT * FROM "TenantModule" WHERE key='shifts' AND allowed AND enabled`)).rowCount, 3)
    await db.query(`INSERT INTO "Tenant" VALUES ('new'); INSERT INTO "TenantModule" ("tenantId",key) VALUES ('new','leaves')`)
    const fresh = (await db.query(`SELECT * FROM "TenantModule" WHERE "tenantId"='new'`)).rows[0]
    assert.equal(fresh.allowed, false); assert.equal(fresh.enabled, false)
    await db.query(`SET LOCAL app.rls_bypass='off'; SET LOCAL app.tenant_id='legacy'`)
    assert.equal((await db.query('SELECT * FROM "TenantModule"')).rowCount, 2)
  } finally { await db.query('ROLLBACK'); await db.end() }
})


test('tenant default schedule index preserves rows and permits separate tenant defaults', async () => {
  const url = new URL(process.env.CRM_TEST_DATABASE_URL || 'http://invalid')
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/ls_salon_crm_test') throw Error('Local disposable database only.')
  const db = new Client({ connectionString: url.toString() })
  await db.connect()
  try {
    await db.query('BEGIN')
    const schema = `schedule_${randomUUID().replaceAll('-', '')}`
    await db.query(`CREATE SCHEMA ${schema}; SET LOCAL search_path TO ${schema};
      CREATE TABLE "ShiftSchedule" (id text PRIMARY KEY, "tenantId" text, "isDefault" boolean, name text);
      CREATE UNIQUE INDEX "ShiftSchedule_default_unique" ON "ShiftSchedule" ("isDefault") WHERE "isDefault"=true;
      INSERT INTO "ShiftSchedule" VALUES ('a-default','a',true,'Original'),('a-other','a',false,'Other'),('b-other','b',false,'Other tenant');`)
    const before = (await db.query('SELECT * FROM "ShiftSchedule" ORDER BY id')).rows
    await db.query('SAVEPOINT duplicate')
    await assert.rejects(db.query(`INSERT INTO "ShiftSchedule" VALUES ('b-default','b',true,'Blocked before migration')`), e=>e.code==='23505')
    await db.query('ROLLBACK TO SAVEPOINT duplicate')
    const migration = fs.readFileSync('prisma/migrations/20261016170000_tenant_default_shift_schedule/migration.sql','utf8').replace(/^BEGIN;/,'').replace(/COMMIT;\s*$/,'')
    await db.query(migration)
    assert.deepEqual((await db.query('SELECT * FROM "ShiftSchedule" ORDER BY id')).rows,before)
    await db.query(`INSERT INTO "ShiftSchedule" VALUES ('b-default','b',true,'Allowed after migration')`)
    await db.query('SAVEPOINT duplicate_after')
    await assert.rejects(db.query(`INSERT INTO "ShiftSchedule" VALUES ('a-duplicate','a',true,'Still blocked')`), e=>e.code==='23505')
    await db.query('ROLLBACK TO SAVEPOINT duplicate_after')
    assert.equal((await db.query('SELECT * FROM "ShiftSchedule" WHERE "isDefault"=true')).rowCount,2)
  } finally { await db.query('ROLLBACK'); await db.end() }
})
