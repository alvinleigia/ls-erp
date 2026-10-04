/* eslint-disable @typescript-eslint/no-require-imports */
// Real application server for isolated access tests. Never uses the hosted DB.
const { spawn } = require("node:child_process")
const { randomBytes } = require("node:crypto")
const fs = require("node:fs")
const { Client } = require("pg")
const dotenv = require("dotenv")

async function main() {
  const url = new URL(process.env.CRM_TEST_DATABASE_URL || "http://invalid")
  if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/ls_salon_crm_test") throw Error("Use a disposable local ls_salon_crm_test database.")
  url.username = "crm_test_runtime"; url.password = ""
  const db = new Client({ connectionString: url.toString() })
  await db.connect()
  try {
    const role = (await db.query("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user")).rows[0]
    if (role.rolsuper || role.rolbypassrls) throw Error("The application test role must enforce RLS.")
    const ready = await db.query("SELECT 1 FROM _prisma_migrations WHERE migration_name='20261004120000_audit_review_indexes' AND finished_at IS NOT NULL AND rolled_back_at IS NULL")
    if (!ready.rowCount) throw Error("Apply the local migrations before running access tests.")
  } finally { await db.end() }
  if (!fs.existsSync(".next/BUILD_ID")) throw Error("Run npm.cmd run build first.")
  // Empty every configured .env key before Next loads dotenv. No hosted service
  // credentials or delivery settings are inherited by this isolated server.
  const env = { ...process.env }
  for (const file of [".env", ".env.local", ".env.production", ".env.production.local"]) {
    if (fs.existsSync(file)) for (const key of Object.keys(dotenv.parse(fs.readFileSync(file)))) env[key] = ""
  }
  Object.assign(env, {
    DATABASE_URL: url.toString(), DIRECT_URL: url.toString(), NODE_ENV: "production",
    AUTH_SECRET: randomBytes(32).toString("hex"), AUTH_TRUST_HOST: "true",
    AUTH_URL: "http://localhost:3108", NEXTAUTH_URL: "http://localhost:3108",
    APP_ROOT_DOMAIN: "localhost", PLATFORM_ADMIN_TENANT_SLUG: "platform",
    RLS_POOL_MAX: "4", SMTP_HOST: "", SMTP_USER: "", SMTP_PASS: "", MAIL_FROM: "",
  })
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3108"], { env, stdio: "inherit", windowsHide: true })
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal))
  child.on("exit", code => { process.exitCode = code ?? 1 })
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
