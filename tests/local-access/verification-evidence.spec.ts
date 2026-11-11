import { test, expect, type BrowserContext, type Download, type Page } from "@playwright/test"
import { randomBytes } from "node:crypto"
import sharp from "sharp"
import { seed, login, json, assignProfiles } from "./fixtures"

function downloadFromAnyPage(context: BrowserContext) {
  return new Promise<Download>((resolve, reject) => {
    const pages = new Set<Page>()
    const cleanup = () => { clearTimeout(timer); context.off("page", attach); for (const page of pages) page.off("download", done) }
    const done = (download: Download) => { cleanup(); resolve(download) }
    const attach = (page: Page) => { pages.add(page); page.on("download", done) }
    const timer = setTimeout(() => { cleanup(); reject(Error("The attachment download did not start.")) }, 20_000)
    context.on("page", attach); for (const page of context.pages()) attach(page)
  })
}

test("customer and business Verification tabs upload private originals above 4.5 MB directly, validate, and download only with evidence permission", async ({ browser }) => {
  test.setTimeout(180_000)
  const f = await seed(), admin = await login(browser, f.origin, f.users.admin.email)
  let collector: Awaited<ReturnType<typeof login>> | undefined
  try {
    const contact = await json(admin.context, "/api/crm/contacts", 201, "POST", { name: "Synthetic KYC browser customer" })
    await admin.page.goto(`/crm/contacts/${contact.id}`)
    await expect(admin.page.getByRole("heading", { name: contact.name, exact: true })).toBeVisible()
    await expect(admin.page.getByRole("tab", { name: "Verification", exact: true })).toHaveCount(0)
    await f.db.query('INSERT INTO "TenantModule"("tenantId",key,allowed,enabled,"updatedAt") VALUES($1,\'customerVerification\',true,true,now())', [f.slug])
    const definition = { format: 1, facts: [], documents: [{ code: "identity", label: "Identity proof", subjects: ["PERSON", "BUSINESS"], roles: ["CUSTOMER", "ADDITIONAL_CUSTOMER"] }], validityDays: null, preventSelfApproval: true }
    const preview = await json(admin.context, "/api/verification/policy/preview", 200, "POST", { version: 0, definition })
    await json(admin.context, "/api/verification/policy", 200, "PUT", { version: 0, definition, previewHash: preview.previewHash })
    const account = await json(admin.context, "/api/crm/accounts", 201, "POST", { name: "Synthetic KYC business" })
    const profile = await json(admin.context, "/api/access/roles", 201, "POST", { name: "Evidence collector", permissions: ["contacts.read", "accounts.read", "customerVerification.read", "customerVerification.create", "verificationUploads.read", "verificationUploads.create", "verificationUploads.cancel"] })
    await assignProfiles(admin.context, f.users.manager.id, [profile.id], { salesRecordScope: "ACCOUNT_ROLE" })
    collector = await login(browser, f.origin, f.users.manager.email)
    for (const context of [admin.context, collector.context]) await context.route("https://verificationtest.supabase.co/**", async route => {
      const source = new URL(route.request().url()), response = await route.fetch({ url: "http://127.0.0.1:3319" + source.pathname + source.search })
      await route.fulfill({ response })
    })
    // Chromium's native attachment transfer can bypass route interception after
    // a redirect. Translate only the external test transport's Location; the
    // real authenticated download route, integrity check and audit still run.
    await admin.context.route("**/api/verification/evidence/*/download", async route => {
      const response = await route.fetch({ maxRedirects: 0 })
      expect(response.status()).toBe(303)
      const location = new URL(response.headers().location)
      expect(location.origin).toBe("https://verificationtest.supabase.co")
      await route.fulfill({ response, headers: { ...response.headers(), location: "http://127.0.0.1:3319" + location.pathname + location.search } })
    })
    const { page, context } = collector
    await page.goto(`/crm/contacts/${contact.id}`)
    await page.getByRole("tab", { name: "Verification", exact: true }).click()
    await page.getByRole("button", { name: "Start verification", exact: true }).click()
    await expect(page.getByLabel("Evidence file (up to 5 MB)")).toBeVisible()
    const bytes = await sharp(randomBytes(1600 * 1000 * 3), { raw: { width: 1600, height: 1000, channels: 3 } }).png().toBuffer()
    expect(bytes.length).toBeGreaterThan(4_500_000); expect(bytes.length).toBeLessThan(5 * 1024 * 1024)
    await page.getByLabel("Evidence file (up to 5 MB)").setInputFiles({ name: "synthetic-proof.png", mimeType: "image/png", buffer: bytes })
    await page.getByRole("button", { name: "Upload evidence", exact: true }).click()
    await expect(page.getByRole("status")).toContainText("Evidence uploaded")
    await expect(page.getByText("Private evidence requires a separate viewing permission.")).toBeVisible()
    await expect(page.getByRole("link", { name: "Download evidence", exact: true })).toHaveCount(0)
    const row = (await f.db.query('SELECT id,state FROM "VerificationEvidence" WHERE "tenantId"=$1', [f.slug])).rows[0]
    expect(row.state).toBe("READY")
    await json(context, `/api/verification/evidence/${row.id}/download`, 403)
    await page.screenshot({ path: "test-results/local-access/verification-collector-desktop.png", fullPage: true })
    await admin.page.goto(`/crm/contacts/${contact.id}`)
    await admin.page.getByRole("tab", { name: "Verification", exact: true }).click()
    await expect(admin.page.getByText("synthetic-proof.png", { exact: true })).toBeVisible()
    const downloaded = downloadFromAnyPage(admin.context)
    await admin.page.getByRole("link", { name: "Download evidence", exact: true }).click()
    expect((await downloaded).suggestedFilename()).toBe("evidence.png")
    await expect.poll(() => new URL(admin.page.url()).pathname).toBe(`/crm/contacts/${contact.id}`)
    await admin.page.setViewportSize({ width: 390, height: 844 })
    await expect(admin.page.getByRole("heading", { name: contact.name, exact: true })).toHaveCount(1)
    await admin.page.getByText("synthetic-proof.png", { exact: true }).scrollIntoViewIfNeeded()
    expect(await admin.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await admin.page.screenshot({ path: "test-results/local-access/verification-reader-mobile.png", animations: "disabled" })
    await page.goto(`/crm/accounts/${account.id}`)
    await page.getByRole("tab", { name: "Verification", exact: true }).click()
    await page.getByRole("button", { name: "Start verification", exact: true }).click()
    await expect(page.getByLabel("Evidence file (up to 5 MB)")).toBeVisible()
    const invalid = Buffer.from("Not a real PNG")
    await page.getByLabel("Evidence file (up to 5 MB)").setInputFiles({ name: "spoofed.png", mimeType: "image/png", buffer: invalid })
    await page.getByRole("button", { name: "Upload evidence", exact: true }).click()
    await expect(page.getByRole("alert").filter({ hasText: "Upload a valid, unencrypted PDF" })).toBeVisible()
    await expect(page.getByRole("status").filter({ hasText: "Validating file" })).toHaveCount(0)
    expect((await f.db.query('SELECT count(*)::int n FROM "VerificationEvidence" WHERE "tenantId"=$1 AND state=\'ABANDONED\'', [f.slug])).rows[0].n).toBe(1)
    await expect(page.getByText("Case started - private review status", { exact: true })).toBeVisible()
    expect((await json(context, `/api/verification/collection?kind=BUSINESS&id=${account.id}`)).reviewStatusAvailable).toBe(false)
  } finally { await collector?.context.close(); await admin.context.close(); await f.db.end() }
})
