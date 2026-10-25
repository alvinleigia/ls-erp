/* eslint-disable @typescript-eslint/no-explicit-any -- HTTP fixture payloads span independently validated module contracts. */
// Opt-in hosted tests. Business writes use public APIs on newly created QA tenants.
// This file never invokes local database fixture/seed/reset helpers.
import fs from "node:fs"
import { randomUUID } from "node:crypto"
import { parse } from "dotenv"
import { Client } from "pg"
import { expect, request, type Browser, type BrowserContext, type Page } from "@playwright/test"
import { allPermissions } from "../../platform/access/catalog"
import { defaultRecordRules, supportedScopes } from "../../platform/access/rules"

const root = "https://ls-erp-staging.vercel.app", project = "prj_zZjjsQX2pp1qVz7vE2FrmZWU8rM0", team = "team_Me0kX6NgE1RN4MNKRXXCfrsZ"
const privateDir = "tmp/r9-staging", manifest = `${privateDir}/fixtures.json`
const env = parse(fs.readFileSync(".env.new-vercel-staging"))
export const password = randomUUID() + "Qa!9"
export const moduleKeys = ["catalog", "crm", "realEstate", "salesDocuments", "paymentPlans", "salesOrders", "receivables", "inventory", "services", "appointments", "leaves", "shifts"]
function guard() {
  expect(process.env.RUN_STAGING_ACCESS_WRITES).toBe("1")
  expect(new URL(env.NEXTAUTH_URL).origin).toBe(root)
  expect(new URL(env.SUPABASE_URL).hostname).toBe("oyhsrcmjhwxhvepdbcdc.supabase.co")
  expect(JSON.parse(fs.readFileSync(`${privateDir}/reopened.json`, "utf8")).stagingAliasesVerified).toBe(true)
}
async function vercel(path: string, method = "GET", body?: unknown) {
  const auth = JSON.parse(fs.readFileSync(`${process.env.APPDATA}/com.vercel.cli/Data/auth.json`, "utf8"))
  const r = await fetch(`https://api.vercel.com${path}${path.includes("?") ? "&" : "?"}teamId=${team}`, { method, headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  if (!r.ok) throw new Error(`Staging Vercel operation failed (${r.status})`)
  return r.json()
}
export async function json(c: BrowserContext | Awaited<ReturnType<typeof request.newContext>>, path: string, status = 200, method = "GET", data?: unknown): Promise<any> {
  const api = "request" in c ? c.request : c
  const r = await api.fetch(path, { method, ...(data === undefined ? {} : { data }) })
  expect(r.status(), `${method} ${path}: ${(await r.text()).slice(0, 2000)}`).toBe(status)
  return r.json()
}
async function authenticate(c: Awaited<ReturnType<typeof request.newContext>>, origin: string, email: string, secret: string) {
  const csrf = await json(c, "/api/auth/csrf")
  await c.post("/api/auth/callback/credentials", { form: { csrfToken: csrf.csrfToken, email, password: secret, callbackUrl: origin + "/dashboard" } })
  const session = await json(c, "/api/auth/session")
  expect(session.user?.email).toBe(email)
  return session
}
export async function platformContext() {
  guard(); const c = await request.newContext({ baseURL: root })
  await authenticate(c, root, env.PLATFORM_ADMIN_EMAIL, env.PLATFORM_ADMIN_PASSWORD)
  return c
}
export async function seed() {
  guard(); const platform = await platformContext(), run = randomUUID().slice(0, 8), tenants: any[] = []
  try {
    const d = JSON.parse(fs.readFileSync(`${privateDir}/deployment.json`, "utf8"))
    const deployment = await vercel(`/v13/deployments/${d.id}`)
    expect(deployment.projectId).toBe(project); expect(deployment.readyState).toBe("READY")
    expect((await vercel("/v4/aliases/ls-erp-staging.vercel.app")).deployment.id).toBe(d.id)
    for (const letter of ["a", "b"]) {
      const slug = `qa-r9-${run}-${letter}`, host = `ls-erp-staging-r9-${run}-${letter}.vercel.app`
      const input = { name: `QA R9 ${run} ${letter}`, slug, customDomain: host, adminName: letter === "a" ? "Access admin" : "Access other", adminEmail: `qa-r9-${run}-${letter}@example.test`, adminPassword: password, modules: moduleKeys }
      const result = await json(platform, "/api/tenants", 201, "POST", input)
      const t = { id: result.tenant.id, slug, origin: `https://${host}`, admin: result.admin, input }
      tenants.push(t)
      const saved = fs.existsSync(manifest) ? JSON.parse(fs.readFileSync(manifest, "utf8")) : []
      saved.push({ ...t, password, createdAt: new Date().toISOString(), project })
      fs.writeFileSync(manifest, JSON.stringify(saved, null, 2), { mode: 0o600 })
      await vercel(`/v10/projects/${project}/domains`, "POST", { name: host })
      await vercel(`/v2/deployments/${d.id}/aliases`, "POST", { alias: host })
      expect((await vercel(`/v4/aliases/${host}`)).projectId).toBe(project)
    }
    const [a, b] = tenants, c = await request.newContext({ baseURL: a.origin })
    try {
      await authenticate(c, a.origin, a.input.adminEmail, password)
      const profile = await json(c, "/api/access/roles", 201, "POST", { name: "QA explicit permissions", permissions: allPermissions })
      const users: Record<string, any> = { admin: a.admin, other: b.admin }
      for (const role of ["MANAGER", "STAFF"]) {
        const key = role.toLowerCase(), rules = defaultRecordRules()
        if (role === "MANAGER") for (const permission of allPermissions) if (supportedScopes(permission.split(".")[0] as any).includes("ALL")) rules[permission] = "ALL"
        users[key] = (await json(c, "/api/users", 200, "POST", { name: `Access ${key}`, email: `qa-r9-${run}-${key}@example.test`, role, password, accessRoleIds: [profile.id], recordRules: rules })).user
      }
      await json(c, "/api/settings", 200, "PATCH", { locale: "en-IN", currency: "INR", timeZone: "Asia/Kolkata", dateFormat: "dd/MM/yyyy", emailNotificationsEnabled: false })
      let dbClient: Client | undefined
      const db = { query: async (sql: string, params?: any[]) => {
        if (!/^SELECT\s/i.test(sql) || /\bFOR\s+UPDATE\b/i.test(sql)) throw Error("Hosted verification adapter accepts reads only.")
        if (!dbClient) { const u = new URL(env.DATABASE_URL); expect(decodeURIComponent(u.username)).toBe("prisma_app.oyhsrcmjhwxhvepdbcdc"); u.search = ""; dbClient = new Client({ connectionString: u.toString(), ssl: { rejectUnauthorized: true, ca: fs.readFileSync("tmp/industry-release/supabase-prod-ca.crt", "utf8") }, connectionTimeoutMillis: 15000 }); await dbClient.connect(); await dbClient.query("BEGIN READ ONLY"); await dbClient.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.actor_id',$2,true),set_config('app.rls_bypass','off',true)", [a.id, a.admin.id]) }
        return dbClient.query(sql, params)
      }, end: async () => { if (dbClient) { await dbClient.query("ROLLBACK"); await dbClient.end() } } }
      return { db, slug: a.id, otherSlug: b.id, origin: a.origin, otherOrigin: b.origin, users, password, profileId: profile.id }
    } finally { await c.dispose() }
  } finally { await platform.dispose() }
}
export async function login(browser: Browser, origin: string, email: string, timezoneId?: string): Promise<{ context: BrowserContext; page: Page }> {
  guard(); expect(origin).toMatch(/^https:\/\/ls-erp-staging-r9-[a-f0-9]{8}-[ab]\.vercel\.app$/)
  const entries = JSON.parse(fs.readFileSync(manifest, "utf8")), t = entries.find((v: any) => v.origin === origin)
  expect(t).toBeTruthy()
  const context = await browser.newContext({ baseURL: origin, timezoneId }), page = await context.newPage()
  const recordFailure = (failure: object) => fs.appendFileSync(`${privateDir}/browser-errors.jsonl`, JSON.stringify({ at: new Date().toISOString(), origin, ...failure }) + "\n", { mode: 0o600 })
  page.on("pageerror", error => recordFailure({ kind: "pageerror", message: error.message }))
  page.on("response", response => { if (response.url().startsWith(origin + "/api/") && response.status() >= 500) recordFailure({ kind: "server", path: new URL(response.url()).pathname, status: response.status() }) })
  const csrf = await json(context, "/api/auth/csrf")
  await context.request.post("/api/auth/callback/credentials", { form: { csrfToken: csrf.csrfToken, email, password: t.password, callbackUrl: origin + "/dashboard" } })
  const session = await json(context, "/api/auth/session"); expect(session.user?.email).toBe(email); expect(session.user.tenantId).toBe(t.id)
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" }); await expect(page.locator("main h1")).toBeVisible()
  return { context, page }
}
