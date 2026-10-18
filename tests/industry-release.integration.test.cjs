/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { randomBytes, createHash } = require('node:crypto')
const { Client } = require('pg')
const manifest = require('../docs/industry-release-manifest.json')
const { capture, compare, localUrl } = require('../scripts/industry-release.cjs')

test('streamed read-only snapshots detect data loss and preserve real release-migration changes', async () => {
  const connection = new URL(localUrl(process.env.CRM_TEST_DATABASE_URL))
  assert.equal(connection.pathname, '/ls_salon_crm_test')
  const admin = new Client({ connectionString: connection.toString() })
  await admin.connect()
  const name = 'ls_erp_rehearsal_' + randomBytes(6).toString('hex')
  let db
  try {
    await admin.query(`CREATE DATABASE "${name}"`)
    connection.pathname = '/' + name
    db = new Client({ connectionString: connection.toString() }); await db.connect()
    await db.query(`CREATE SCHEMA app; CREATE FUNCTION app.tenant_match(text) RETURNS boolean LANGUAGE sql AS 'SELECT true';
      CREATE TABLE "Tenant" (id text PRIMARY KEY);
      CREATE TABLE "ShiftSchedule" (id text PRIMARY KEY, "tenantId" text REFERENCES "Tenant"(id), "isDefault" boolean);
      CREATE UNIQUE INDEX "ShiftSchedule_default_unique" ON "ShiftSchedule" ("isDefault") WHERE "isDefault"=true;
      CREATE TABLE "Evidence" ("tenantId" text REFERENCES "Tenant"(id), id integer, amount numeric(30,6), snapshot jsonb, PRIMARY KEY ("tenantId",id));
      ALTER TABLE "Evidence" ENABLE ROW LEVEL SECURITY; ALTER TABLE "Evidence" FORCE ROW LEVEL SECURITY;
      CREATE TABLE _prisma_migrations (id text PRIMARY KEY,migration_name text,checksum text,finished_at timestamp,rolled_back_at timestamp);
      CREATE TABLE "VerificationToken" (identifier text NOT NULL, token text NOT NULL UNIQUE, expires timestamp NOT NULL, UNIQUE(identifier,token));
      INSERT INTO "VerificationToken" VALUES ('recipient','private-token','2026-10-20'),('recipient','Z','2026-10-20'),('recipient','_','2026-10-20');
      INSERT INTO "Tenant" VALUES ('a'),('b'); INSERT INTO "ShiftSchedule" VALUES ('schedule','a',true);
      INSERT INTO "Evidence" SELECT CASE WHEN n%2=0 THEN 'a' ELSE 'b' END,n,12345678901234567890.123456,jsonb_build_object('secret','do not serialize raw records','number',n) FROM generate_series(1,1201) n;`)
    for (const m of manifest.migrations.filter(m => m.phase === 'baseline')) await db.query('INSERT INTO _prisma_migrations VALUES ($1,$1,$2,now(),null)', [m.name, m.sha256Lf])
    const before = await capture(connection.toString())
    assert.equal(before.tables.Evidence.partitions['tenant:a'].count, 600)
    assert.equal(before.tables.Evidence.partitions['tenant:b'].count, 601)
    assert.equal(JSON.stringify(before).includes('do not serialize raw records'), false)
    assert.equal(JSON.stringify(before).includes('private-token'), false)
    assert.deepEqual(before.tables.VerificationToken.primaryKey, [])
    assert.deepEqual(before.tables.VerificationToken.uniqueKey.columns, ['token'])
    const orderedTokenIds = ['["Z"]','["_"]','["private-token"]'].join('\n') + '\n'
    assert.equal(before.tables.VerificationToken.partitions.global.ids, createHash('sha256').update(orderedTokenIds).digest('hex'))
    assert.deepEqual(before, await capture(connection.toString()))
    const terminologySql = fs.readFileSync(path.join(__dirname, '../prisma/migrations/20261017120000_tenant_terminology/migration.sql'), 'utf8')
    await db.query('CREATE TABLE "TenantTerminology" (id text PRIMARY KEY)')
    await assert.rejects(db.query(terminologySql), e => e.code === '42P07')
    await db.query('ROLLBACK')
    assert.equal((await db.query(`SELECT to_regclass('public."TenantTerminologyRevision"') AS relation`)).rows[0].relation, null)
    await db.query('DROP TABLE "TenantTerminology"')
    for (const m of manifest.migrations.filter(m => m.phase === 'release')) {
      await db.query(fs.readFileSync(path.join(__dirname, '../prisma/migrations', m.name, 'migration.sql'), 'utf8'))
      await db.query('INSERT INTO _prisma_migrations VALUES ($1,$1,$2,now(),null)', [m.name, m.sha256Lf])
    }
    const after = await capture(connection.toString())
    // Synthetic history and representative tables test the checker, not the
    // actual 103-table client upgrade. The full manifest still demands all tables.
    const fixtureManifest = { ...manifest, baselineTables: Object.keys(before.tables) }
    assert.deepEqual(compare(before, after, fixtureManifest), [])
    assert.ok(compare(before, after, manifest).some(e => e.startsWith('Missing baseline table')))
    await db.query(`UPDATE "VerificationToken" SET token='replacement-token' WHERE token='private-token'`)
    assert.ok(compare(before, await capture(connection.toString()), fixtureManifest).includes('Records changed: VerificationToken'))
    await db.query(`CREATE TABLE "Ambiguous" (value text UNIQUE, required text NOT NULL);
      CREATE UNIQUE INDEX "partial_unique" ON "Ambiguous"(required) WHERE required <> '';
      CREATE UNIQUE INDEX "expression_unique" ON "Ambiguous"(lower(required));
      ALTER TABLE "Ambiguous" ADD CONSTRAINT "deferred_unique" UNIQUE(required) DEFERRABLE INITIALLY DEFERRED;`)
    await assert.rejects(capture(connection.toString()), /without a non-null unique row identity/)
    await db.query('DROP TABLE "Ambiguous"')
    await db.query(`UPDATE "Evidence" SET amount=amount+0.000001 WHERE id=1`)
    assert.ok(compare(before, await capture(connection.toString()), fixtureManifest).includes('Records changed: Evidence'))
    // Even orphan rows inserted with trigger checks suppressed are detected.
    await db.query(`SET session_replication_role=replica; INSERT INTO "Evidence" VALUES ('missing',2000,1,'{}'); SET session_replication_role=origin`)
    assert.equal((await capture(connection.toString())).foreignKeyViolations[0].count, '1')
    const lowRole = name + '_reader'
    await admin.query(`CREATE ROLE "${lowRole}" LOGIN`)
    try {
      const restricted = new URL(connection); restricted.username = lowRole; restricted.password = ''
      await assert.rejects(capture(restricted.toString()), /complete RLS visibility/)
    } finally { await admin.query(`DROP ROLE "${lowRole}"`) }
  } finally {
    await db?.end()
    // Name is generated here, never taken from an environment variable or user.
    await admin.query(`DROP DATABASE IF EXISTS "${name}"`); await admin.end()
  }
})
