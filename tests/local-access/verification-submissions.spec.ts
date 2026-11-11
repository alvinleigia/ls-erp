import { test, expect } from "@playwright/test"
import sharp from "sharp"
import { seed, login, json, assignProfiles } from "./fixtures"

test("private fact submission, independent corrections, approval and revocation retain history in compact customer tabs", async ({ browser }) => {
  test.setTimeout(180_000)
  const f = await seed(), admin = await login(browser, f.origin, f.users.admin.email)
  let collector: Awaited<ReturnType<typeof login>> | undefined, reviewer: Awaited<ReturnType<typeof login>> | undefined
  try {
    await f.db.query('INSERT INTO "TenantModule"("tenantId",key,allowed,enabled,"updatedAt") VALUES($1,\'customerVerification\',true,true,now())', [f.slug])
    const customer = await json(admin.context, "/api/crm/contacts", 201, "POST", { name: "Synthetic private review customer" })
    const definition = { format: 1, facts: [{ code: "legal_name", label: "Verified legal name", type: "TEXT", subjects: ["PERSON"], roles: ["CUSTOMER"] }], documents: [{ code: "identity", label: "Identity evidence", subjects: ["PERSON"], roles: ["CUSTOMER"] }], validityDays: 365, preventSelfApproval: true }
    const preview = await json(admin.context, "/api/verification/policy/preview", 200, "POST", { version: 0, definition })
    await json(admin.context, "/api/verification/policy", 200, "PUT", { version: 0, definition, previewHash: preview.previewHash })
    const collectorProfile = await json(admin.context, "/api/access/roles", 201, "POST", { name: "Private facts collector", permissions: ["contacts.read", "customerVerification.read", "customerVerification.create", "verificationSubmissions.read", "verificationSubmissions.create", "verificationUploads.read", "verificationUploads.create"] })
    const reviewerProfile = await json(admin.context, "/api/access/roles", 201, "POST", { name: "Independent evidence reviewer", permissions: ["contacts.read", "customerVerification.read", "verificationSubmissions.read", "verificationEvidence.read", "verificationReviews.read", "verificationReviews.approve", "verificationReviews.cancel"] })
    await assignProfiles(admin.context, f.users.manager.id, [collectorProfile.id], { salesRecordScope: "ACCOUNT_ROLE" })
    await assignProfiles(admin.context, f.users.staff.id, [reviewerProfile.id], { salesRecordScope: "ACCOUNT_ROLE" })
    collector = await login(browser, f.origin, f.users.manager.email); reviewer = await login(browser, f.origin, f.users.staff.email)
    await collector.context.route("https://verificationtest.supabase.co/**", async route => {
      const source = new URL(route.request().url()), response = await route.fetch({ url: "http://127.0.0.1:3319" + source.pathname + source.search })
      await route.fulfill({ response })
    })
    const { page } = collector
    await page.goto(`/crm/contacts/${customer.id}`); await page.getByRole("tab", { name: "Verification", exact: true }).click()
    await page.getByRole("button", { name: "Start verification", exact: true }).click()
    const bytes = await sharp({ create: { width: 20, height: 20, channels: 3, background: "green" } }).png().toBuffer()
    await page.getByLabel("Evidence file (up to 5 MB)").setInputFiles({ name: "synthetic-private.png", mimeType: "image/png", buffer: bytes })
    await page.getByRole("button", { name: "Upload evidence", exact: true }).click(); await expect(page.getByRole("status").filter({ hasText: "Evidence uploaded" })).toBeVisible()
    await page.getByRole("tab", { name: "Facts and review", exact: true }).click()
    await page.getByLabel("Verified legal name", { exact: true }).fill("Synthetic Legal Buyer")
    // Draft values remain mounted when moving between verification subtabs.
    await page.getByRole("tab", { name: "Evidence", exact: true }).click(); await page.getByRole("tab", { name: "Facts and review", exact: true }).click()
    await expect(page.getByLabel("Verified legal name", { exact: true })).toHaveValue("Synthetic Legal Buyer")
    await page.getByLabel("synthetic-private.png", { exact: true }).check()
    await page.getByRole("button", { name: "Submit for review", exact: true }).click(); await expect(page.getByRole("heading", { name: "Submitted revision 1", exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "Approve verification", exact: true })).toHaveCount(0)
    await expect(page.getByRole("link", { name: "Download selected evidence", exact: true })).toHaveCount(0)
    const r = reviewer.page
    await r.goto(`/crm/contacts/${customer.id}`); await r.getByRole("tab", { name: "Verification", exact: true }).click(); await r.getByRole("tab", { name: "Facts and review", exact: true }).click()
    await expect(r.getByText("Synthetic Legal Buyer", { exact: true })).toBeVisible()
    await expect(r.getByRole("link", { name: "Download selected evidence", exact: true })).toBeVisible()
    await expect(r.getByRole("button", { name: "Approve verification", exact: true })).toBeDisabled()
    await r.getByLabel("Review reason", { exact: true }).fill("Please confirm the legal spelling")
    await r.getByRole("button", { name: "Request corrections", exact: true }).click(); await expect(r.getByText("Review status: Changes required", { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Refresh verification", exact: true }).click(); await expect(page.getByText("Review status: Changes required", { exact: true })).toBeVisible()
    await page.getByText("Prepare a corrected submission", { exact: true }).click()
    await page.getByLabel("Verified legal name", { exact: true }).fill("Synthetic Corrected Buyer")
    await page.getByLabel("Reason for new revision", { exact: true }).fill("Confirmed legal spelling")
    await page.getByRole("button", { name: "Submit for review", exact: true }).click(); await expect(page.getByRole("heading", { name: "Submitted revision 2", exact: true })).toBeVisible()
    await r.getByRole("button", { name: "Refresh verification", exact: true }).click(); await expect(r.getByRole("heading", { name: "Submitted revision 2", exact: true })).toBeVisible()
    await r.getByLabel("I have reviewed the submitted facts and selected evidence.").check()
    await r.getByRole("button", { name: "Approve verification", exact: true }).click(); await expect(r.getByText("Review status: Verified", { exact: true })).toBeVisible()
    await r.getByLabel("Revocation reason", { exact: true }).fill("Synthetic revocation workflow check")
    await r.getByRole("button", { name: "Revoke approval", exact: true }).click(); await expect(r.getByText("Review status: Revoked", { exact: true })).toBeVisible()
    await r.getByText("Recent revision history", { exact: true }).click()
    await expect(r.getByText("Confirmed legal spelling", { exact: false })).toBeVisible()
    await r.screenshot({ path: "test-results/local-access/verification-submissions-desktop.png", fullPage: true, animations: "disabled" })
    await r.setViewportSize({ width: 390, height: 844 }); await r.getByRole("heading", { name: "Submitted revision 2", exact: true }).scrollIntoViewIfNeeded()
    expect(await r.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await r.screenshot({ path: "test-results/local-access/verification-submissions-mobile.png", animations: "disabled" })
    expect((await f.db.query('SELECT count(*)::int n FROM "VerificationSubmission" WHERE "tenantId"=$1', [f.slug])).rows[0].n).toBe(2)
    expect((await f.db.query('SELECT count(*)::int n FROM "VerificationReview" WHERE "tenantId"=$1', [f.slug])).rows[0].n).toBe(3)
    expect((await f.db.query('SELECT count(*)::int n FROM "SalesOrder" WHERE "tenantId"=$1', [f.slug])).rows[0].n).toBe(0)
  } finally { await collector?.context.close(); await reviewer?.context.close(); await admin.context.close(); await f.db.end() }
})
