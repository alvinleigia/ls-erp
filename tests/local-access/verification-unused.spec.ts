import { test, expect } from "@playwright/test"
import sharp from "sharp"
import { seed, login, json } from "./fixtures"

test("admin can cancel then remove the last unused upload; saved submissions remain protected", async ({ browser }) => {
  test.setTimeout(150_000)
  const f = await seed(), admin = await login(browser, f.origin, f.users.admin.email)
  try {
    const { page, context } = admin
    await f.db.query('INSERT INTO "TenantModule"("tenantId",key,allowed,enabled,"updatedAt") VALUES($1,\'customerVerification\',true,true,now())', [f.slug])
    const definition = { format: 1, facts: [], documents: [{ code: "identity", label: "Identity proof", subjects: ["PERSON"], roles: ["CUSTOMER"] }], validityDays: null, preventSelfApproval: true }
    const p = await json(context, "/api/verification/policy/preview", 200, "POST", { version: 0, definition })
    await json(context, "/api/verification/policy", 200, "PUT", { version: 0, definition, previewHash: p.previewHash })
    const person = await json(context, "/api/crm/contacts", 201, "POST", { name: "Synthetic unused upload customer" })
    const started = await json(context, "/api/verification/cases", 200, "POST", { kind: "PERSON", id: person.id })
    await context.route("https://verificationtest.supabase.co/**", async route => {
      const u = new URL(route.request().url()), response = await route.fetch({ url: "http://127.0.0.1:3319" + u.pathname + u.search })
      await route.fulfill({ response })
    })
    await page.goto(`/crm/contacts/${person.id}`)
    await page.getByRole("tab", { name: "Verification", exact: true }).click()
    const bytes = await sharp({ create: { width: 20, height: 20, channels: 3, background: "orange" } }).png().toBuffer()
    async function upload() {
      const finalized = page.waitForResponse(r => r.url().endsWith("/finalize") && r.request().method() === "POST")
      await page.getByLabel("Evidence file (up to 5 MB)").setInputFiles({ name: "synthetic-unused.png", mimeType: "image/png", buffer: bytes })
      await page.getByRole("button", { name: "Upload evidence", exact: true }).click()
      expect((await finalized).status()).toBe(200)
      await expect(page.getByRole("button", { name: "Upload evidence", exact: true })).toBeDisabled()
    }
    await upload()
    const original = (await f.db.query('SELECT id FROM "VerificationEvidence" WHERE "tenantId"=$1', [f.slug])).rows[0]
    await page.getByRole("button", { name: "Manage uploaded files", exact: true }).click()
    await page.getByRole("button", { name: "Remove unused upload", exact: true }).click()
    const confirm = page.getByRole("button", { name: "Confirm unused upload removal", exact: true })
    await expect(confirm).toBeDisabled()
    await page.getByRole("button", { name: "Keep file", exact: true }).click()
    expect((await f.db.query('SELECT count(*)::int n FROM "VerificationDisposal" WHERE "tenantId"=$1', [f.slug])).rows[0].n).toBe(0)
    await page.getByRole("button", { name: "Remove unused upload", exact: true }).click()
    await page.getByLabel("Disposal reason", { exact: true }).fill("Replace accidentally uploaded uncropped synthetic image")
    await expect(confirm).toBeDisabled()
    await page.getByLabel("I reviewed this unused upload and permanent removal.", { exact: true }).check()
    await expect(confirm).toBeEnabled()
    await confirm.scrollIntoViewIfNeeded()
    await page.screenshot({ path: "test-results/local-access/verification-unused-confirm-desktop.png", fullPage: true, animations: "disabled" })
    await page.setViewportSize({ width: 390, height: 844 })
    await confirm.scrollIntoViewIfNeeded()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: "test-results/local-access/verification-unused-confirm-mobile.png", fullPage: true, animations: "disabled" })
    await confirm.click()
    await expect(page.getByRole("status").filter({ hasText: "Unused upload removed." })).toHaveText("Unused upload removed. The audit history was retained.")
    await page.getByRole("tab", { name: "Evidence", exact: true }).click()
    await expect(page.getByRole("link", { name: "Download evidence", exact: true })).toHaveCount(0)
    await json(context, `/api/verification/evidence/${original.id}/download`, 404)
    expect((await f.db.query('SELECT kind,state,"policyVersion","retainedEvidenceId" FROM "VerificationDisposal" WHERE "tenantId"=$1', [f.slug])).rows).toEqual([{ kind: "UNSUBMITTED", state: "COMPLETED", policyVersion: null, retainedEvidenceId: null }])
    expect((await json(context, "/api/verification/retention")).version).toBe(0)
    // A replacement can be uploaded, but saving it in a review submission protects it immediately.
    await upload()
    const replacement = (await f.db.query('SELECT id FROM "VerificationEvidence" WHERE "tenantId"=$1 AND state=\'READY\'', [f.slug])).rows[0]
    await json(context, "/api/verification/submissions", 200, "POST", { caseId: started.case.id, version: 0, policyVersion: 1, role: "CUSTOMER", facts: [], evidenceIds: [replacement.id] })
    await page.getByRole("button", { name: "Refresh verification", exact: true }).click()
    await page.getByRole("button", { name: "Manage uploaded files", exact: true }).click()
    await expect(page.getByRole("button", { name: "Remove unused upload", exact: true })).toHaveCount(0)
    await json(context, "/api/verification/disposals/preview", 409, "POST", { evidenceId: replacement.id, kind: "UNSUBMITTED" })
  } finally { await admin.context.close(); await f.db.end() }
})
