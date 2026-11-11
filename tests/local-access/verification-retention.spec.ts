import { test, expect } from "@playwright/test"
import sharp from "sharp"
import { seed, login, json, assignProfiles } from "./fixtures"

test("administrators review retention without deletion; delegated custodians see private hold history without evidence or release authority", async ({ browser }) => {
  test.setTimeout(120_000)
  const f = await seed(), admin = await login(browser, f.origin, f.users.admin.email)
  let custodian: Awaited<ReturnType<typeof login>> | undefined
  try {
    await f.db.query('INSERT INTO "TenantModule"("tenantId",key,allowed,enabled,"updatedAt") VALUES($1,\'customerVerification\',true,true,now())', [f.slug])
    const { page, context } = admin
    await page.goto("/settings/verification"); await page.getByRole("tab", { name: "Retention", exact: true }).click()
    await expect(page.getByLabel("Retain unreferenced accepted evidence (days)")).toHaveValue("")
    await page.getByLabel("Retain unreferenced accepted evidence (days)").fill("30")
    await page.getByRole("button", { name: "Preview retention settings", exact: true }).click(); await page.getByRole("button", { name: "Publish retention settings", exact: true }).click()
    await expect(page.getByRole("status")).toContainText("Published retention settings version 1. No files were deleted.")
    await page.screenshot({ path: "test-results/local-access/verification-retention-settings.png", fullPage: true })
    const definition = { format: 1, facts: [], documents: [{ code: "identity", label: "Identity proof", subjects: ["PERSON"], roles: ["CUSTOMER"] }], validityDays: null, preventSelfApproval: true }, preview = await json(context, "/api/verification/policy/preview", 200, "POST", { version: 0, definition })
    await json(context, "/api/verification/policy", 200, "PUT", { version: 0, definition, previewHash: preview.previewHash })
    const person = await json(context, "/api/crm/contacts", 201, "POST", { name: "Synthetic retained customer" }), c = await json(context, "/api/verification/cases", 200, "POST", { kind: "PERSON", id: person.id })
    await context.route("https://verificationtest.supabase.co/**", async route => {
      const source = new URL(route.request().url()), response = await route.fetch({ url: "http://127.0.0.1:3319" + source.pathname + source.search }); await route.fulfill({ response })
    })
    await page.goto(`/crm/contacts/${person.id}`); await page.getByRole("tab", { name: "Verification", exact: true }).click()
    const bytes = await sharp({ create: { width: 10, height: 10, channels: 3, background: "orange" } }).png().toBuffer()
    await page.getByLabel("Evidence file (up to 5 MB)").setInputFiles({ name: "retained-original.png", mimeType: "image/png", buffer: bytes }); await page.getByRole("button", { name: "Upload evidence", exact: true }).click()
    await expect(page.getByRole("status")).toContainText("Evidence uploaded")
    await page.getByRole("tab", { name: "Retention and holds", exact: true }).click(); await expect(page.getByText("Retention period running", { exact: true })).toBeVisible()
    await page.getByLabel("Hold reason", { exact: true }).fill("Private case preservation instruction"); await page.getByRole("button", { name: "Place preservation hold", exact: true }).click()
    await expect(page.getByRole("heading", { name: "Preservation hold active", exact: true })).toBeVisible(); await expect(page.getByText("Retained: preservation hold", { exact: true })).toBeVisible()
    await page.getByText("Preservation hold history", { exact: true }).click(); await expect(page.getByText("Private case preservation instruction", { exact: true })).toBeVisible()
    await page.screenshot({ path: "test-results/local-access/verification-retention-desktop.png", fullPage: true })
    await page.getByLabel("Release reason", { exact: true }).fill("Preservation instruction resolved")
    await page.getByRole("tab", { name: "Evidence", exact: true }).click(); await page.getByRole("tab", { name: "Retention and holds", exact: true }).click(); await expect(page.getByLabel("Release reason", { exact: true })).toHaveValue("Preservation instruction resolved")
    const role = await json(context, "/api/access/roles", 201, "POST", { name: "Preservation custodian", permissions: ["contacts.read", "customerVerification.read", "verificationHolds.read", "verificationHolds.create"] })
    await assignProfiles(context, f.users.manager.id, [role.id], { salesRecordScope: "ACCOUNT_ROLE" }); custodian = await login(browser, f.origin, f.users.manager.email)
    await custodian.page.goto(`/crm/contacts/${person.id}`); await custodian.page.getByRole("tab", { name: "Verification", exact: true }).click(); await custodian.page.getByRole("tab", { name: "Retention and holds", exact: true }).click()
    await expect(custodian.page.getByRole("heading", { name: "Preservation hold active", exact: true })).toBeVisible(); await expect(custodian.page.getByRole("button", { name: "Release preservation hold", exact: true })).toHaveCount(0)
    await expect(custodian.page.getByText("retained-original.png", { exact: true })).toHaveCount(0)
    await json(custodian.context, "/api/verification/holds", 403, "POST", { caseId: c.case.id, version: 1, action: "RELEASE", reason: "Attempt without the separate release grant" })
    await json(custodian.context, "/api/verification/retention", 403)
    await page.getByRole("button", { name: "Release preservation hold", exact: true }).click(); await page.getByRole("button", { name: "Confirm hold release", exact: true }).click()
    await expect(page.getByRole("heading", { name: "No active preservation hold", exact: true })).toBeVisible(); await expect(page.getByText("Retention period running", { exact: true })).toBeVisible()
    await page.setViewportSize({ width: 390, height: 844 }); await page.getByRole("tab", { name: "Evidence", exact: true }).click()
    await page.getByRole("tab", { name: "Retention and holds", exact: true }).scrollIntoViewIfNeeded(); await page.getByRole("tab", { name: "Retention and holds", exact: true }).click()
    await expect(page.getByRole("heading", { name: "No active preservation hold", exact: true })).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: "test-results/local-access/verification-retention-mobile.png", fullPage: true })
    expect((await f.db.query('SELECT count(*)::int n FROM "VerificationEvidence" WHERE "tenantId"=$1 AND state=\'READY\' AND "cleanedAt" IS NULL', [f.slug])).rows[0].n).toBe(1)
    expect((await f.db.query('SELECT count(*)::int n FROM "VerificationHoldEvent" WHERE "tenantId"=$1', [f.slug])).rows[0].n).toBe(2)
  } finally { await custodian?.context.close(); await admin.context.close(); await f.db.end() }
})
