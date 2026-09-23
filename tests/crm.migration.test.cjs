/* eslint-disable @typescript-eslint/no-require-imports */
// Read-only verification of the configured database after migration deployment.
// Explicit opt-in keeps this separate from tests that use disposable fixtures.
const { before, after, test } = require("node:test")
const assert = require("node:assert/strict")
const { readFileSync } = require("node:fs")
const { createHash } = require("node:crypto")
const { Client } = require("pg")

if (process.env.CRM_VERIFY_CONFIGURED_DATABASE !== "1" || !process.env.DATABASE_URL) {
  throw new Error("Set CRM_VERIFY_CONFIGURED_DATABASE=1 and load DATABASE_URL to run read-only deployment checks.")
}
const db = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 15000 })
const migrationNames = ["20260923090000_crm_foundation", "20260923120000_crm_business_accounts", "20260923160000_crm_sales_pipelines"]
const tables = ["TenantModule", "CrmContact", "CrmEnquiry", "CrmTask", "CrmActivity", "CrmAccount", "CrmAccountContact", "CrmPipeline", "CrmStage", "CrmOpportunity", "CrmOpportunityActivity"]

before(async () => {
  await db.connect()
  await db.query("BEGIN READ ONLY")
  await db.query("SELECT set_config('app.tenant_id','',true), set_config('app.rls_bypass','off',true)")
})
after(async () => {
  try { await db.query("ROLLBACK") } finally { await db.end() }
})

test("the checked-in CRM migrations are applied successfully without failed migrations", async () => {
  for (const migrationName of migrationNames) {
    const applied = await db.query('SELECT checksum, finished_at, rolled_back_at FROM "_prisma_migrations" WHERE migration_name = $1', [migrationName])
    assert.equal(applied.rowCount, 1)
    assert.ok(applied.rows[0].finished_at)
    assert.equal(applied.rows[0].rolled_back_at, null)
    const checksum = createHash("sha256").update(readFileSync(`prisma/migrations/${migrationName}/migration.sql`)).digest("hex")
    assert.equal(applied.rows[0].checksum, checksum)
  }
  const failed = await db.query('SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL')
  assert.equal(failed.rows[0].count, 0)
})

test("all CRM tables force RLS and use tenant checks on reads and writes", async () => {
  const flags = await db.query("SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname = ANY($1::text[])", [tables])
  assert.equal(flags.rowCount, tables.length)
  for (const row of flags.rows) { assert.equal(row.relrowsecurity, true, row.relname); assert.equal(row.relforcerowsecurity, true, row.relname) }
  const policies = await db.query("SELECT tablename, cmd, qual, with_check FROM pg_policies WHERE schemaname='public' AND tablename = ANY($1::text[])", [tables])
  assert.equal(policies.rowCount, tables.length)
  for (const row of policies.rows) {
    assert.equal(row.cmd, "ALL")
    assert.equal(row.qual, 'app.tenant_match("tenantId")')
    assert.equal(row.with_check, 'app.tenant_match("tenantId")')
  }
})

test("tenant-safe relationships are backed by nineteen validated composite foreign keys", async () => {
  const constraints = await db.query("SELECT c.conname, c.convalidated FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid WHERE t.relnamespace='public'::regnamespace AND t.relname=ANY($1::text[]) AND c.contype='f' AND cardinality(c.conkey) IN (2,3) AND cardinality(c.confkey)=cardinality(c.conkey)", [tables])
  assert.equal(constraints.rowCount, 19)
  for (const row of constraints.rows) assert.equal(row.convalidated, true, row.conname)
})

test("the runtime database role has no RLS bypass and unscoped queries return no CRM records", async () => {
  const role = await db.query("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user")
  assert.equal(role.rows[0].rolsuper, false)
  assert.equal(role.rows[0].rolbypassrls, false)
  for (const table of tables) {
    // Identifiers are from the fixed, source-owned allow-list above.
    const count = await db.query(`SELECT count(*)::int AS count FROM "${table}"`)
    assert.equal(count.rows[0].count, 0, table)
  }
})
