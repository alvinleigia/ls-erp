import { test, expect } from "@playwright/test"
import sharp from "sharp"
import { seed, login, json } from "./fixtures"

test("administrator removes only an exact unsubmitted duplicate without changing retention", async ({ browser }) => {
  test.setTimeout(120_000)
  const f = await seed(), admin = await login(browser, f.origin, f.users.admin.email)
  try {
    const { page, context } = admin
    await f.db.query('INSERT INTO "TenantModule"("tenantId",key,allowed,enabled,"updatedAt") VALUES($1,\'customerVerification\',true,true,now())', [f.slug])
    const definition = { format: 1, facts: [], documents: [{ code: "identity", label: "Identity proof", subjects: ["PERSON"], roles: ["CUSTOMER"] }], validityDays: null, preventSelfApproval: true }
    const p = await json(context, "/api/verification/policy/preview", 200, "POST", { version: 0, definition })
    await json(context, "/api/verification/policy", 200, "PUT", { version: 0, definition, previewHash: p.previewHash })
    const person = await json(context, "/api/crm/contacts", 201, "POST", { name: "Synthetic duplicate upload customer" })
    await json(context, "/api/verification/cases", 200, "POST", { kind: "PERSON", id: person.id })
    await context.route("https://verificationtest.supabase.co/**", async route => { const u = new URL(route.request().url()), response = await route.fetch({ url: "http://127.0.0.1:3319" + u.pathname + u.search }); await route.fulfill({ response }) })
    await page.goto(`/crm/contacts/${person.id}`); await page.getByRole("tab", { name: "Verification", exact: true }).click()
    const bytes = await sharp({ create: { width: 10, height: 10, channels: 3, background: "orange" } }).png().toBuffer()
    for (let i = 0; i < 2; i++) {
      const finalized = page.waitForResponse(r => r.url().endsWith("/finalize") && r.request().method() === "POST")
      await page.getByLabel("Evidence file (up to 5 MB)").setInputFiles({ name: "duplicate-identity.png", mimeType: "image/png", buffer: bytes })
      await page.getByRole("button", { name: "Upload evidence", exact: true }).click()
      expect((await finalized).status()).toBe(200)
      await expect(page.getByRole("button", { name: "Upload evidence", exact: true })).toBeDisabled()
      if (i === 0) {
        await page.getByRole("button", { name: "Manage duplicate uploads and retention", exact: true }).click()
        await expect(page.getByText("No eligible originals or disposal requests.", { exact: true })).toBeVisible()
        await page.getByRole("tab", { name: "Evidence", exact: true }).click()
      }
    }
    await expect(page.getByRole("link", { name: "Download evidence", exact: true })).toHaveCount(2)
    await page.getByRole("button", { name: "Manage duplicate uploads and retention", exact: true }).click()
    await expect(page.getByRole("button", { name: "Remove duplicate", exact: true })).toHaveCount(1)
    await page.getByRole("button", { name: "Remove duplicate", exact: true }).click()
    await expect(page.getByText("Older original to keep", { exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "Confirm duplicate removal", exact: true })).toBeDisabled()
    await page.getByRole("button", { name: "Keep file", exact: true }).click()
    await expect(page.getByRole("button", { name: "Remove duplicate", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Remove duplicate", exact: true }).click()
    await page.getByLabel("Disposal reason", { exact: true }).fill("Accidentally uploaded the same test file twice")
    await page.getByLabel("I reviewed the duplicate, the original to keep and permanent removal.", { exact: true }).check()
    await expect(page.getByRole("button", { name: "Confirm duplicate removal", exact: true })).toBeEnabled()
    await page.getByRole("button", { name: "Confirm duplicate removal", exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: "test-results/local-access/verification-duplicate-confirm-desktop.png", fullPage: true, animations: "disabled" })
    await page.setViewportSize({ width: 390, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.getByRole("button", { name: "Confirm duplicate removal", exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: "test-results/local-access/verification-duplicate-confirm-mobile.png", fullPage: true, animations: "disabled" })
    await page.getByRole("button", { name: "Confirm duplicate removal", exact: true }).click()
    await expect(page.getByRole("status").filter({ hasText: "Duplicate removed." })).toHaveText("Duplicate removed. The older original was preserved.")
    await expect(page.getByRole("button", { name: "Remove duplicate", exact: true })).toHaveCount(0)
    await page.getByRole("tab", { name: "Evidence", exact: true }).click()
    await expect(page.getByRole("link", { name: "Download evidence", exact: true })).toHaveCount(1)
    const rows = (await f.db.query('SELECT state, bytes FROM "VerificationEvidence" WHERE "tenantId"=$1 ORDER BY "createdAt",id COLLATE "C"', [f.slug])).rows
    expect(rows).toEqual([{ state: "READY", bytes: bytes.length }, { state: "DISPOSED", bytes: 0 }])
    expect((await json(context, "/api/verification/retention", 200)).version).toBe(0)
  } finally { await admin.context.close(); await f.db.end() }
})

test("administrator previews and confirms disposal; quarantine can be cancelled before removal and completed originals stay unavailable", async ({ browser }) => {
  test.setTimeout(120_000)
  const f = await seed(), admin = await login(browser, f.origin, f.users.admin.email)
  try {
    await f.db.query('INSERT INTO "TenantModule"("tenantId",key,allowed,enabled,"updatedAt") VALUES($1,\'customerVerification\',true,true,now())', [f.slug])
    const { page, context } = admin, definition = { format: 1, facts: [], documents: [{ code: "identity", label: "Identity proof", subjects: ["PERSON"], roles: ["CUSTOMER"] }], validityDays: null, preventSelfApproval: true }
    const p = await json(context, "/api/verification/policy/preview", 200, "POST", { version: 0, definition })
    await json(context, "/api/verification/policy", 200, "PUT", { version: 0, definition, previewHash: p.previewHash })
    const retention = { version: 0, retainDays: 30 }, rp = await json(context, "/api/verification/retention/preview", 200, "POST", retention)
    await json(context, "/api/verification/retention", 200, "PUT", { ...retention, previewHash: rp.previewHash })
    const person = await json(context, "/api/crm/contacts", 201, "POST", { name: "Synthetic disposal customer" })
    await json(context, "/api/verification/cases", 200, "POST", { kind: "PERSON", id: person.id })
    await context.route("https://verificationtest.supabase.co/**", async route => { const u = new URL(route.request().url()), response = await route.fetch({ url: "http://127.0.0.1:3319" + u.pathname + u.search }); await route.fulfill({ response }) })
    await page.goto(`/crm/contacts/${person.id}`); await page.getByRole("tab", { name: "Verification", exact: true }).click()
    const bytes = await sharp({ create: { width: 10, height: 10, channels: 3, background: "orange" } }).png().toBuffer()
    await page.getByLabel("Evidence file (up to 5 MB)").setInputFiles({ name: "disposal-original.png", mimeType: "image/png", buffer: bytes }); await page.getByRole("button", { name: "Upload evidence", exact: true }).click()
    await expect(page.getByRole("status")).toContainText("Evidence uploaded")
    // Age only this synthetic file in the disposable loopback test database.
    await f.db.query('BEGIN')
    try { await f.db.query('ALTER TABLE "VerificationEvidence" DISABLE TRIGGER verification_evidence_write'); await f.db.query('UPDATE "VerificationEvidence" SET "readyAt"="readyAt"-interval \'100 days\' WHERE "tenantId"=$1', [f.slug]); await f.db.query('ALTER TABLE "VerificationEvidence" ENABLE TRIGGER verification_evidence_write'); await f.db.query('COMMIT') } catch (e) { await f.db.query('ROLLBACK'); throw e }
    const e = (await f.db.query('SELECT id FROM "VerificationEvidence" WHERE "tenantId"=$1', [f.slug])).rows[0]
    await page.getByRole("tab", { name: "Retention and holds", exact: true }).click()
    await page.getByRole("button", { name: "Review disposal", exact: true }).click(); await expect(page.getByRole("button", { name: "Confirm file disposal", exact: true })).toBeDisabled()
    await page.getByLabel("Disposal reason", { exact: true }).fill("Synthetic file no longer needed")
    await page.getByLabel("I reviewed the file, retention period and permanent removal.", { exact: true }).check()
    await page.screenshot({ path: "test-results/local-access/verification-disposal-confirm.png", fullPage: true })
    await page.getByRole("button", { name: "Keep file", exact: true }).click()
    // A persisted pending request is visible after refresh and remains cancellable.
    const preview = await json(context, "/api/verification/disposals/preview", 200, "POST", { evidenceId: e.id })
    await json(context, "/api/verification/disposals", 200, "POST", { evidenceId: e.id, requestKey: crypto.randomUUID(), previewHash: preview.previewHash, reason: "Synthetic pending disposal", reviewed: true })
    await page.getByRole("button", { name: "Refresh retention review", exact: true }).click(); await page.getByText("Disposal requests and history", { exact: true }).click()
    await expect(page.getByText(/Quarantined.*not started/)).toBeVisible()
    await page.getByRole("button", { name: "Cancel pending disposal", exact: true }).click()
    await expect(page.getByRole("button", { name: "Review disposal", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Review disposal", exact: true }).click(); await page.getByLabel("Disposal reason", { exact: true }).fill("Synthetic confirmed disposal")
    await page.getByLabel("I reviewed the file, retention period and permanent removal.", { exact: true }).check(); await page.getByRole("button", { name: "Confirm file disposal", exact: true }).click()
    await expect(page.getByText("Original disposed", { exact: true })).toBeVisible(); await expect(page.getByRole("button", { name: "Review disposal", exact: true })).toHaveCount(0)
    await page.screenshot({ path: "test-results/local-access/verification-disposal-desktop.png", fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 }); await expect(page.getByText("Original disposed", { exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: "test-results/local-access/verification-disposal-mobile.png", fullPage: true })
    await json(context, `/api/verification/evidence/${e.id}/download`, 404)
    const saved = (await f.db.query('SELECT state,bytes,filename,sha256 FROM "VerificationEvidence" WHERE id=$1', [e.id])).rows[0]
    expect(saved).toMatchObject({ state: "DISPOSED", bytes: 0, filename: "Disposed original", sha256: null })
  } finally { await admin.context.close(); await f.db.end() }
})
