import { defaultRecordRules, type RecordRules } from "@/platform/access/rules"

import { randomUUID } from "node:crypto"
import { Client } from "pg"
import bcrypt from "bcryptjs"
import { grantPgFixtureUsers } from "../helpers/access-fixtures.cjs"

import { expect, type Browser, type Page, type BrowserContext } from "@playwright/test"

export const password = "IsolatedAccessTest!2026"
export const moduleKeys = ["crm", "realEstate", "salesDocuments", "paymentPlans", "inventory", "services", "appointments", "leaves", "shifts"]
export async function seed() {
  const url = new URL(process.env.CRM_TEST_DATABASE_URL || "http://invalid")
  if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/ls_salon_crm_test") throw Error("Local disposable database only.")
  const db = new Client({ connectionString: url.toString() })
  await db.connect()
  const slug = `access-${randomUUID().slice(0, 8)}`, otherSlug = `${slug}-other`
  const users = Object.fromEntries(["admin", "manager", "staff", "other", "platform"].map(key => [key, { id: `${slug}_${key}`, email: `${key}@${slug}.test` }]))
  try {
    await db.query("BEGIN")
    const hash = await bcrypt.hash(password, 10)
    for (const tenant of [slug, otherSlug]) {
      await db.query('INSERT INTO "Tenant" (id,name,slug,"updatedAt") VALUES ($1,$1,$1,now())', [tenant])
      await db.query('INSERT INTO "AppSetting" (id,"tenantId","timeZone",locale,currency,"dateFormat","updatedAt") VALUES ($1,$1,\'Asia/Kolkata\',\'en-IN\',\'INR\',\'dd/MM/yyyy\',now())', [tenant])
      for (const key of moduleKeys) await db.query('INSERT INTO "TenantModule" ("tenantId",key,allowed,enabled,"updatedAt") VALUES ($1,$2,true,true,now())', [tenant, key])
    }
    await db.query('INSERT INTO "Tenant" (id,name,slug,"updatedAt") VALUES ($1,\'Local platform\',\'platform\',now()) ON CONFLICT (slug) DO NOTHING', [`${slug}_platform`])
    const platformId = (await db.query('SELECT id FROM "Tenant" WHERE slug=\'platform\'')).rows[0].id
    for (const [key, user] of Object.entries(users)) await db.query('INSERT INTO "User" (id,name,email,role,"tenantId","passwordHash","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,now())', [user.id, `Access ${key}`, user.email, ["admin", "other", "platform"].includes(key) ? "ADMIN" : key.toUpperCase(), key === "platform" ? platformId : key === "other" ? otherSlug : slug, hash])
    await grantPgFixtureUsers(db, [slug, otherSlug])
    await db.query("COMMIT")
    return { db, slug, otherSlug, users, origin: `http://${slug}.localhost:3108` }
  } catch (error) { await db.query("ROLLBACK"); await db.end(); throw error }
}
export async function login(browser: Browser, origin: string, email: string, timezoneId?: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: origin, timezoneId })
  const page = await context.newPage()
  await page.goto("/auth/signin")
  await page.getByLabel("Email", { exact: true }).fill(email)
  await page.getByLabel("Password", { exact: true }).fill(password)
  await page.getByRole("button", { name: "Sign in", exact: true }).click()
  await expect(page).toHaveURL(/\/(dashboard|settings\/tenants)$/)
  const session = await context.request.get("/api/auth/session")
  expect((await session.json()).user?.email).toBe(email)
  return { context, page }
}
export async function json(context: BrowserContext, path: string, status = 200, method = "GET", data?: unknown) {
  // Each API fixture creation captures its explicit persisted office. Actual UI
  // forms independently capture at mount and have stale-context browser tests.
  let headers: Record<string, string> = {}
  if (method === "POST" && (/^\/api\/(?:crm\/(?:enquiries|opportunities|work|enquiry-imports)|real-estate\/projects|leaves\/requests)(?:\?|$)/.test(path) || /^\/api\/crm\/activity-plans\/[^/]+\/apply$/.test(path))) {
    const response = await context.request.get("/api/workspace/office")
    if (response.ok()) {
      const office = await response.json()
      if (office.creationOffice) headers = { "x-office-id": office.creationOffice.id, "x-office-version": String(office.version) }
    }
  }
  const result = await context.request.fetch(path, { method, headers, ...(data === undefined ? {} : { data }) })
  expect(result.status(), `${method} ${path}: ${await result.text()}`).toBe(status)
  return result.json()
}
export async function assignProfiles(context: BrowserContext, userId: string, roleIds: string[], scopes: { rules?: RecordRules; salesRecordScope?: string; projectRecordScope?: string } = {}, status = 200) {
  const current = await json(context, `/api/access/users/${userId}`)
  return json(context, `/api/access/users/${userId}`, status, "PATCH", { roleIds, version: current.accessPolicy.version, rules: scopes.rules ?? scopeFixture(current.accessPolicy.rules, scopes) })
}

function scopeFixture(base: RecordRules, scopes: {salesRecordScope?: string; projectRecordScope?: string}) { const rules = {...base}; for(const key of Object.keys(defaultRecordRules()) as (keyof RecordRules)[]) {const resource = key.split(".")[0]; const scope = resource === "projects" || resource === "projectMembers" ? scopes.projectRecordScope : ["enquiries","opportunities","activities","contacts","accounts","quotations","salesOrders","receivables","orderPayments","unitReservations","assignmentTargets"].includes(resource) ? scopes.salesRecordScope : undefined; if(scope) rules[key] = (scope === "ACCOUNT_ROLE" ? "ALL" : scope === "OWN" && ["contacts","accounts","activities"].includes(resource) ? "RELATED" : scope) as NonNullable<RecordRules[typeof key]>; } return rules }
