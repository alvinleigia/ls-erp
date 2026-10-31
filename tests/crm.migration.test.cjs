/* eslint-disable @typescript-eslint/no-require-imports */
// Read-only verification of the configured database after migration deployment.
// Explicit opt-in keeps this separate from tests that use disposable fixtures.
const { before, after, test } = require("node:test")
const assert = require("node:assert/strict")
const { Client } = require("pg")

if (process.env.CRM_VERIFY_CONFIGURED_DATABASE !== "1" || !process.env.DATABASE_URL) {
  throw new Error("Set CRM_VERIFY_CONFIGURED_DATABASE=1 and load DATABASE_URL to run read-only deployment checks.")
}
const db = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 15000 })
const { manifest, historyProblems } = require("../scripts/p13-release-readiness.cjs")
const tables = ["TenantModule", "CrmContact", "CrmEnquiry", "CrmTask", "CrmActivity", "CrmAccount", "CrmAccountContact", "CrmPipeline", "CrmStage", "CrmOpportunity", "CrmOpportunityActivity", "CrmTaskEvent", "CrmActivityPlan", "CrmPlanLaunch", "CrmFollowUpRule", "CrmLeadSource", "CrmLostReason", "CrmActivityType", "RealEstateProject", "RealEstateProjectMember", "RealEstateEnquiryContext", "RealEstateOpportunityContext", "TenantAccessRole", "TenantRoleAssignment"]

before(async () => {
  await db.connect()
  await db.query("BEGIN READ ONLY")
  await db.query("SELECT set_config('app.tenant_id','',true), set_config('app.rls_bypass','off',true)")
})
after(async () => {
  try { await db.query("ROLLBACK") } finally { await db.end() }
})

test("the checked-in CRM, ERP access and audit migrations are applied successfully without failed migrations", async () => {
  const applied = await db.query('SELECT migration_name name, checksum, finished_at IS NOT NULL finished, rolled_back_at IS NOT NULL "rolledBack" FROM "_prisma_migrations" ORDER BY migration_name,id')
  assert.deepEqual(historyProblems(applied.rows), [])
  assert.equal(new Set(applied.rows.filter(r => r.finished && !r.rolledBack).map(r => r.name)).size, manifest.migrations.length)
})

test("all CRM tables force RLS and use tenant checks on reads and writes", async () => {
  const flags = await db.query("SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname = ANY($1::text[])", [tables])
  assert.equal(flags.rowCount, tables.length)
  for (const row of flags.rows) { assert.equal(row.relrowsecurity, true, row.relname); assert.equal(row.relforcerowsecurity, true, row.relname) }
  const policies = await db.query("SELECT tablename, cmd, qual, with_check FROM pg_policies WHERE schemaname='public' AND tablename = ANY($1::text[]) AND policyname='tenant_isolation'", [tables])
  assert.equal(policies.rowCount, tables.length)
  for (const row of policies.rows) {
    assert.equal(row.cmd, "ALL")
    assert.equal(row.qual, 'app.tenant_match("tenantId")')
    assert.equal(row.with_check, 'app.tenant_match("tenantId")')
  }
})

test("tenant-safe relationships are backed by validated composite foreign keys", async () => {
  const constraints = await db.query("SELECT c.conname, c.convalidated FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid WHERE t.relnamespace='public'::regnamespace AND t.relname=ANY($1::text[]) AND c.contype='f' AND cardinality(c.conkey) IN (2,3) AND cardinality(c.confkey)=cardinality(c.conkey)", [tables])
  assert.ok(constraints.rowCount >= 60, "Previously reviewed tenant-safe composite relationships remain")
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

test("activity rollout bridges are enabled and run with caller permissions", async () => {
  const triggers = await db.query("SELECT t.tgname, t.tgenabled, p.prosecdef FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgrelid IN ('public.\"CrmTask\"'::regclass, 'public.\"CrmEnquiry\"'::regclass) AND t.tgname=ANY($1::text[])", [["crm_task_legacy_bridge", "crm_inherit_enquiry_assignment"]])
  assert.equal(triggers.rowCount, 2)
  for (const trigger of triggers.rows) { assert.equal(trigger.tgenabled, "O"); assert.equal(trigger.prosecdef, false) }
})

test("the legacy default tenant is absent and the active platform tenant remains", async () => {
  assert.equal((await db.query('SELECT id FROM "Tenant" WHERE id=$1', ["tenant_default"])).rowCount, 0)
  const platform = await db.query('SELECT id FROM "Tenant" WHERE slug=$1 AND status=$2', [(process.env.PLATFORM_ADMIN_TENANT_SLUG || "platform").trim().toLowerCase(), "ACTIVE"])
  assert.equal(platform.rowCount, 1)
})


test("conversion defaults and module allowances have their database guards", async () => {
  const checks = await db.query("SELECT conname, convalidated FROM pg_constraint WHERE conname = ANY($1::text[])", [["CrmStage_conversion_default_open_check", "TenantModule_enabled_requires_allowance", "TenantAccessRole_valid"]])
  assert.equal(checks.rowCount, 3)
  for (const row of checks.rows) assert.equal(row.convalidated, true, row.conname)
  const index = await db.query("SELECT indisunique, indisvalid, pg_get_expr(indpred, indrelid) AS predicate FROM pg_index WHERE indexrelid='public.\"CrmStage_one_conversion_default\"'::regclass")
  assert.equal(index.rows[0].indisunique, true)
  assert.equal(index.rows[0].indisvalid, true)
  assert.match(index.rows[0].predicate, /isConversionDefault/)
})

test("resource/action policies and shared team managers retain safe database defaults", async () => {
  const columns = await db.query("SELECT table_name, column_name, column_default, is_nullable FROM information_schema.columns WHERE table_schema='public' AND ((table_name='TenantUserAccess' AND column_name='rules') OR (table_name='BusinessTeamMember' AND column_name='isManager')) ORDER BY table_name")
  assert.equal(columns.rowCount, 2)
  assert.equal(columns.rows[0].column_default, "false")
  assert.equal(columns.rows[1].column_default, "'{}'::jsonb")
  for (const column of columns.rows) assert.equal(column.is_nullable, "NO")
  const constraint = await db.query("SELECT convalidated FROM pg_constraint WHERE conrelid='public.\"TenantUserAccess\"'::regclass AND conname='TenantUserAccess_valid'")
  assert.equal(constraint.rowCount, 1); assert.equal(constraint.rows[0].convalidated, true)
})


test("audit history indexes are ready for tenant, actor and record queries", async () => {
  const indexes = await db.query("SELECT c.relname, i.indisvalid, i.indisready FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='public.\"AuditLog\"'::regclass AND c.relname=ANY($1::text[])", [["AuditLog_tenantId_createdAt_id_idx", "AuditLog_tenantId_actorUserId_createdAt_id_idx", "AuditLog_tenantId_entityType_entityId_createdAt_id_idx"]])
  assert.equal(indexes.rowCount, 3)
  for (const index of indexes.rows) {
    assert.equal(index.indisvalid, true, index.relname)
    assert.equal(index.indisready, true, index.relname)
  }
})
