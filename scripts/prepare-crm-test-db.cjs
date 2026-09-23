/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { randomUUID } = require("node:crypto")
const { spawnSync } = require("node:child_process")
const { Client } = require("pg")

async function main() {
  const connectionString = process.env.CRM_TEST_DATABASE_URL
  if (!connectionString) throw new Error("Set CRM_TEST_DATABASE_URL to an empty disposable local database.")
  const url = new URL(connectionString)
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/ls_salon_crm_test") throw new Error("Only a local database named ls_salon_crm_test is permitted.")
  const db = new Client({ connectionString })
  await db.connect()
  try {
    const tables = await db.query("SELECT 1 FROM pg_tables WHERE schemaname = 'public' LIMIT 1")
    if (tables.rowCount) throw new Error("Database is not empty. Refusing to modify it; use a fresh disposable instance.")
    const migrationNames = ["20260923090000_crm_foundation", "20260923120000_crm_business_accounts", "20260923160000_crm_sales_pipelines", "20260924090000_crm_activity_workspace", "20260924120000_crm_activity_plans", "20260924150000_crm_follow_up_rules"]
    const firstPending = process.env.CRM_TEST_FROM_MIGRATION || migrationNames[0]
    if (!migrationNames.includes(firstPending)) throw new Error("Unknown CRM_TEST_FROM_MIGRATION.")
    const basePath = process.env.CRM_TEST_BASE_SQL
    if (basePath) {
      // Optional pre-CRM schema allows verification of the real incremental migration.
      await db.query(fs.readFileSync(basePath, "utf8"))
      if (process.env.CRM_TEST_BASE_DATA_SQL) await db.query(fs.readFileSync(process.env.CRM_TEST_BASE_DATA_SQL, "utf8"))
    } else {
      const output = path.join(os.tmpdir(), `crm-test-schema-${randomUUID()}.sql`)
      try {
        const result = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "diff", "--from-empty", "--to-schema-datamodel", "prisma/schema.prisma", "--script", "--output", output], {
          env: { ...process.env, DATABASE_URL: connectionString, DIRECT_URL: connectionString }, stdio: "inherit",
        })
        if (result.status !== 0) throw new Error("Unable to generate test schema.")
        await db.query(fs.readFileSync(output, "utf8"))
      } finally { if (fs.existsSync(output)) fs.unlinkSync(output) }
    }
    await db.query(fs.readFileSync("prisma/migrations/20260623160000_enable_tenant_rls/migration.sql", "utf8"))
    for (const name of migrationNames) {
      const migration = fs.readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")
      const policyStart = migration.indexOf("-- Match the existing tenant RLS contract.")
      if (policyStart < 0) throw new Error(`Missing tenant policy section: ${name}`)
      await db.query(basePath && name >= firstPending ? migration : `BEGIN;\n${migration.slice(policyStart).replace(/\nCOMMIT;\s*$/, "")}\nCOMMIT;`)
    }
    await db.query("CREATE ROLE crm_test_runtime LOGIN NOSUPERUSER NOBYPASSRLS; GRANT USAGE ON SCHEMA public, app TO crm_test_runtime; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO crm_test_runtime")
    console.log("Prepared disposable CRM test database with tenant RLS and a non-bypass application role.")
  } finally { await db.end() }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
