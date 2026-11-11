import { test, expect } from "@playwright/test"
import { seed, login, json, assignProfiles } from "./fixtures"

test("verification stays off by default; administrator previews and publishes generic requirements without approving customers", async ({ browser }) => {
  test.setTimeout(120_000)
  const f = await seed(), admin = await login(browser, f.origin, f.users.admin.email), { page, context } = admin
  try {
    await json(context, "/api/verification/policy", 403)
    await f.db.query('INSERT INTO "TenantModule"("tenantId",key,allowed,enabled,"updatedAt") VALUES($1,\'customerVerification\',true,true,now())', [f.slug])
    await page.goto("/settings/verification")
    await expect(page.getByRole("heading", { name: "Customer verification requirements", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Add fact", exact: true }).click()
    await page.getByLabel("Code", { exact: true }).fill("legal_name")
    await page.getByLabel("Label", { exact: true }).fill("Legal name")
    await page.getByLabel(/Approval validity/).fill("365")
    await page.getByRole("tab", { name: "Required documents (0)", exact: true }).click()
    await page.getByRole("button", { name: "Add document type", exact: true }).click()
    await page.getByLabel("Code", { exact: true }).fill("identity_proof")
    await page.getByLabel("Label", { exact: true }).fill("Accepted identity evidence")
    await page.getByRole("button", { name: "Preview requirements", exact: true }).click()
    await expect(page.getByRole("status")).toContainText("Transaction checkpoints are configured separately")
    await expect(page.getByRole("button", { name: "Publish requirements", exact: true })).toBeEnabled()
    await page.getByLabel("Label", { exact: true }).fill("Accepted identity document")
    await expect(page.getByRole("button", { name: "Publish requirements", exact: true })).toBeDisabled()
    await page.getByRole("button", { name: "Preview requirements", exact: true }).click()
    await page.getByRole("button", { name: "Publish requirements", exact: true }).click()
    await expect(page.getByRole("status")).toContainText("Published verification requirements version 1")
    await expect(page.getByRole("button", { name: "Publish requirements", exact: true })).toBeDisabled()
    await page.getByRole("tab", { name: "Required facts (1)", exact: true }).click()
    await expect(page.getByLabel("Label", { exact: true })).toHaveValue("Legal name")
    await page.screenshot({ path: "test-results/local-access/verification-foundation-desktop.png", fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: "test-results/local-access/verification-foundation-mobile.png", fullPage: true })
    const customer = await json(context, "/api/crm/contacts", 201, "POST", { name: "Verification workflow buyer" })
    const started = await json(context, "/api/verification/cases", 200, "POST", { kind: "PERSON", id: customer.id })
    expect(started.status).toBe("IN_PROGRESS")
    expect((await json(context, "/api/verification/cases", 200, "POST", { kind: "PERSON", id: customer.id })).case.id).toBe(started.case.id)
    expect((await f.db.query('SELECT count(*)::int n FROM "CustomerVerificationCase" WHERE "tenantId"=$1', [f.slug])).rows[0].n).toBe(1)
  } finally { await context.close(); await f.db.end() }
})

test("a policy reader can inspect both tabs but cannot publish or start collection without its separate grant", async ({ browser }) => {
  test.setTimeout(120_000)
  const f = await seed(), admin = await login(browser, f.origin, f.users.admin.email)
  let reader: Awaited<ReturnType<typeof login>> | undefined
  try {
    await f.db.query('INSERT INTO "TenantModule"("tenantId",key,allowed,enabled,"updatedAt") VALUES($1,\'customerVerification\',true,true,now())', [f.slug])
    const profile = await json(admin.context, "/api/access/roles", 201, "POST", { name: "Verification policy reader", permissions: ["verificationPolicies.read"] })
    await assignProfiles(admin.context, f.users.manager.id, [profile.id])
    reader = await login(browser, f.origin, f.users.manager.email)
    await reader.page.goto("/settings/verification")
    await expect(reader.page.getByRole("heading", { name: "Customer verification requirements", exact: true })).toBeVisible()
    await expect(reader.page.getByLabel(/Approval validity/)).toBeDisabled()
    await reader.page.getByRole("tab", { name: "Required documents (0)", exact: true }).click()
    await expect(reader.page.getByRole("button", { name: "Add document type", exact: true })).toBeDisabled()
    await expect(reader.page.getByRole("button", { name: "Publish requirements", exact: true })).toHaveCount(0)
    await json(reader.context, "/api/verification/cases?kind=PERSON&id=not-a-customer", 403)
    await json(reader.context, "/api/verification/policy/preview", 403, "POST", { version: 0, definition: { format: 1, facts: [], documents: [], validityDays: null, preventSelfApproval: true } })
  } finally { await reader?.context.close(); await admin.context.close(); await f.db.end() }
})
