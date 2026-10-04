import { randomUUID } from "node:crypto"
import { Client } from "pg"
import bcrypt from "bcryptjs"
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
  const result = await context.request.fetch(path, { method, ...(data === undefined ? {} : { data }) })
  expect(result.status(), `${method} ${path}: ${await result.text()}`).toBe(status)
  return result.json()
}
