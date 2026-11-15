import fs from "node:fs"
import { parse } from "dotenv"
import { test, expect } from "@playwright/test"
import { stagingFixture } from "../helpers/p13s-staging"

test("verification activation uses platform allowance and tenant controls without publishing requirements or granting reviewers", async ({ browser }, info) => {
  test.setTimeout(300_000)
  const f = await stagingFixture(browser, ["crm"])
  const platform = await browser.newContext({ baseURL: "https://ls-erp-staging.vercel.app" })
  try {
    const env = parse(fs.readFileSync(".env.new-vercel-staging"))
    const csrf = await (await platform.request.get("/api/auth/csrf")).json()
    await platform.request.post("/api/auth/callback/credentials", { form: { csrfToken: csrf.csrfToken, email: env.PLATFORM_ADMIN_EMAIL, password: env.PLATFORM_ADMIN_PASSWORD, callbackUrl: "https://ls-erp-staging.vercel.app/settings/tenants" } })
    const session = await (await platform.request.get("/api/auth/session")).json()
    expect(session.user?.email).toBe(env.PLATFORM_ADMIN_EMAIL)

    const initial = await (await f.admin.context.request.get("/api/modules")).json()
    expect(initial.modules.find((m: { key: string }) => m.key === "customerVerification")).toMatchObject({ allowed: false, enabled: false })
    expect((await f.admin.context.request.get("/api/verification/policy")).status()).toBe(403)
    expect((await f.operator.context.request.patch("/api/modules", { data: { key: "customerVerification", enabled: true } })).status()).toBe(403)

    const tenantPage = f.admin.page
    await tenantPage.goto("/settings/modules")
    const tenantCard = tenantPage.getByRole("region", { name: "Customer Verification", exact: true })
    await expect(tenantCard).toContainText("Not allowed by platform")
    await expect(tenantCard.getByRole("button", { name: /^(Enable|Disable) Customer Verification$/ })).toHaveCount(0)

    const platformPage = await platform.newPage()
    await platformPage.goto("/settings/tenants")
    await platformPage.getByPlaceholder("Search name, slug, organization or domain", { exact: true }).fill(f.receipt.slug)
    await platformPage.getByRole("button", { name: `Actions for P13S Synthetic Acceptance ${f.receipt.slug}`, exact: true }).click()
    await platformPage.getByRole("menuitem", { name: "Manage modules", exact: true }).click()
    const dialog = platformPage.getByRole("dialog")
    await dialog.getByRole("button", { name: "Allow Customer Verification", exact: true }).click()
    await expect(dialog.getByRole("button", { name: "Remove allowance Customer Verification", exact: true })).toBeVisible()
    await dialog.screenshot({ path: info.outputPath("verification-platform-allowance.png") })

    await tenantPage.reload()
    await expect(tenantPage.getByRole("link", { name: "Open Customer Verification", exact: true })).toHaveAttribute("href", "/settings/verification")
    await tenantPage.getByRole("button", { name: "Disable Customer Verification", exact: true }).click()
    await expect(tenantPage.getByRole("dialog")).toContainText("Required transaction checkpoints still apply")
    await tenantPage.getByRole("button", { name: "Cancel", exact: true }).click()
    await expect(tenantPage.getByRole("button", { name: "Disable Customer Verification", exact: true })).toBeVisible()
    await tenantPage.getByRole("button", { name: "Disable Customer Verification", exact: true }).click()
    await tenantPage.getByRole("button", { name: "Disable module", exact: true }).click()
    await expect(tenantPage.getByRole("button", { name: "Enable Customer Verification", exact: true })).toBeVisible()
    expect((await f.admin.context.request.get("/api/verification/policy")).status()).toBe(403)
    await tenantPage.getByRole("button", { name: "Enable Customer Verification", exact: true }).click()
    await expect(tenantPage.getByRole("button", { name: "Disable Customer Verification", exact: true })).toBeVisible()
    await tenantPage.setViewportSize({ width: 390, height: 844 })
    expect(await tenantPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await tenantCard.screenshot({ path: info.outputPath("verification-tenant-mobile.png") })

    await tenantPage.getByRole("link", { name: "Open Customer Verification", exact: true }).click()
    await expect(tenantPage).toHaveURL(/\/settings\/verification$/)
    await expect(tenantPage.getByRole("heading", { name: "Customer verification requirements", exact: true })).toBeVisible()
    const requirements = await (await f.admin.context.request.get("/api/verification/policy")).json()
    expect(requirements).toMatchObject({ version: 0, definition: { facts: [], documents: [] } })
    const checkpoints = await (await f.admin.context.request.get("/api/verification/checkpoints")).json()
    expect(checkpoints).toMatchObject({ version: 0, definition: { checkpoints: { ORDER_CONFIRMATION: "OFF", UNIT_ALLOCATION: "OFF", ORDER_DOCUMENT: "OFF" } } })
    expect((await f.operator.context.request.get("/api/verification/policy")).status()).toBe(403)
    expect((await f.reviewer.context.request.get("/api/verification/policy")).status()).toBe(403)

    await dialog.getByRole("button", { name: "Remove allowance Customer Verification", exact: true }).click()
    await expect(platformPage.getByRole("alertdialog").or(platformPage.getByRole("dialog")).filter({ hasText: "Remove allowance for Customer Verification?" })).toBeVisible()
    await platformPage.getByRole("button", { name: "Remove allowance", exact: true }).click()
    await expect(dialog.getByRole("button", { name: "Allow Customer Verification", exact: true })).toBeVisible()
    const final = await (await f.admin.context.request.get("/api/modules")).json()
    expect(final.modules.find((m: { key: string }) => m.key === "customerVerification")).toMatchObject({ allowed: false, enabled: false })
    expect(final.modules.filter((m: { key: string }) => m.key !== "customerVerification")).toEqual(initial.modules.filter((m: { key: string }) => m.key !== "customerVerification"))
    expect((await f.admin.context.request.get("/api/verification/policy")).status()).toBe(403)
    fs.writeFileSync(`tmp/p13s-staging/${f.receipt.slug}-activation.json`, JSON.stringify({ at: new Date().toISOString(), tenantId: f.receipt.tenantId, deployment: f.receipt.deployment, source: f.receipt.source, uiActivationVerified: true, defaultRequirementsUnpublished: true, checkpointsOff: true, noAutomaticKycGrants: true, endedDisabled: true, productionWrites: false }, null, 2))
  } finally { await platform.close(); await f.close() }
})
