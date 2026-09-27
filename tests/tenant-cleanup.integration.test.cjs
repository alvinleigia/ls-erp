/* eslint-disable @typescript-eslint/no-require-imports */
const { test, before, after } = require("node:test")
const assert = require("node:assert/strict")
const { readFileSync } = require("node:fs")
const { Client } = require("pg")

const connectionString = process.env.CRM_TEST_DATABASE_URL
if (!connectionString) throw new Error("Use the disposable local CRM test database.")
const url = new URL(connectionString)
if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/ls_salon_crm_test") throw new Error("Refusing to modify a non-local or non-test database.")
const db = new Client({ connectionString })
const migration = readFileSync("prisma/migrations/20260927090000_retire_legacy_default_tenant/migration.sql", "utf8")
async function createTenant(id, slug) {
  await db.query('INSERT INTO "Tenant" (id, name, slug, "updatedAt") VALUES ($1,$2,$3,NOW())', [id, `Cleanup test ${slug}`, slug])
}
before(async () => {
  await db.connect()
  await createTenant("cleanup_platform", "platform")
  await createTenant("cleanup_business", "cleanup-business")
  await db.query('INSERT INTO "User" (id, name, email, "tenantId", "updatedAt") VALUES ($1,$2,$3,$4,NOW())', ["cleanup_admin", "Preserved admin", "cleanup-admin@example.test", "cleanup_platform"])
})
after(async () => { await db.end() })

test("retirement removes only the empty legacy tenant and preserves platform/business records", async () => {
  await createTenant("tenant_default", "default")
  await db.query(migration)
  assert.equal((await db.query('SELECT id FROM "Tenant" WHERE id=$1', ["tenant_default"])).rowCount, 0)
  assert.deepEqual((await db.query('SELECT id FROM "Tenant" ORDER BY id')).rows.map(row => row.id), ["cleanup_business", "cleanup_platform"])
  assert.equal((await db.query('SELECT id FROM "User" WHERE id=$1 AND "tenantId"=$2', ["cleanup_admin", "cleanup_platform"])).rowCount, 1)
})

test("retirement refuses to cascade-delete legacy users and leaves the transaction unchanged", async () => {
  await createTenant("tenant_default", "default")
  await db.query('INSERT INTO "User" (id, name, email, "tenantId", "updatedAt") VALUES ($1,$2,$3,$4,NOW())', ["cleanup_legacy_user", "Legacy user", "cleanup-legacy@example.test", "tenant_default"])
  await db.query("SET ROLE crm_test_runtime")
  await db.query("SELECT set_config('app.tenant_id','cleanup_platform',false), set_config('app.rls_bypass','off',false)")
  await assert.rejects(db.query(migration), /Legacy default tenant still has records in User/)
  await db.query("ROLLBACK")
  await db.query("RESET ROLE")
  assert.equal((await db.query('SELECT id FROM "Tenant" WHERE id=$1', ["tenant_default"])).rowCount, 1)
  assert.equal((await db.query('SELECT id FROM "User" WHERE id=$1', ["cleanup_legacy_user"])).rowCount, 1)
  // Cleanup only this test's fixture in the guarded disposable database.
  await db.query('DELETE FROM "User" WHERE id=$1', ["cleanup_legacy_user"])
  await db.query(migration)
})

test("retirement is repeatable without a legacy tenant and gives a new default-named business no special treatment", async () => {
  await createTenant("cleanup_named_default", "default")
  await db.query(migration)
  await db.query(migration)
  assert.equal((await db.query('SELECT id FROM "Tenant" WHERE id=$1 AND slug=$2', ["cleanup_named_default", "default"])).rowCount, 1)
  assert.equal((await db.query('SELECT id FROM "User" WHERE id=$1', ["cleanup_admin"])).rowCount, 1)
})
