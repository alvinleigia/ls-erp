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
const migrationNames = ["20260923090000_crm_foundation", "20260923120000_crm_business_accounts", "20260923160000_crm_sales_pipelines", "20260924090000_crm_activity_workspace", "20260924120000_crm_activity_plans", "20260924150000_crm_follow_up_rules", "20260927090000_retire_legacy_default_tenant", "20260928120000_crm_lead_intake", "20260928160000_real_estate_projects", "20260928190000_real_estate_sales", "20260928220000_crm_lost_reasons", "20260928230000_crm_activity_types", "20260929090000_real_estate_choices", "20260929120000_crm_custom_fields", "20260929160000_crm_sales_teams", "20260929180000_crm_quotations", "20260929200000_optional_sales_documents", "20260929210000_crm_conversion_default", "20260930090000_module_allowances", "20260930120000_tenant_access_roles"]
const tables = ["TenantModule", "CrmContact", "CrmEnquiry", "CrmTask", "CrmActivity", "CrmAccount", "CrmAccountContact", "CrmPipeline", "CrmStage", "CrmOpportunity", "CrmOpportunityActivity", "CrmTaskEvent", "CrmActivityPlan", "CrmPlanLaunch", "CrmFollowUpRule", "CrmLeadSource", "CrmLostReason", "CrmActivityType", "RealEstateProject", "RealEstateProjectMember", "RealEstateEnquiryContext", "RealEstateOpportunityContext", "TenantAccessRole", "TenantRoleAssignment"]

before(async () => {
  await db.connect()
  await db.query("BEGIN READ ONLY")
  await db.query("SELECT set_config('app.tenant_id','',true), set_config('app.rls_bypass','off',true)")
})
after(async () => {
  try { await db.query("ROLLBACK") } finally { await db.end() }
})

test("the checked-in CRM and tenant-retirement migrations are applied successfully without failed migrations", async () => {
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

test("tenant-safe relationships are backed by validated composite foreign keys", async () => {
  const constraints = await db.query("SELECT c.conname, c.convalidated FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid WHERE t.relnamespace='public'::regnamespace AND t.relname=ANY($1::text[]) AND c.contype='f' AND cardinality(c.conkey) IN (2,3) AND cardinality(c.confkey)=cardinality(c.conkey)", [tables])
  assert.equal(constraints.rowCount, 60)
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
