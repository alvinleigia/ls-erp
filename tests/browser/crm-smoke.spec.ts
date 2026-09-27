import { test, expect } from "@playwright/test"

// Read-only smoke coverage: reusable against a manually selected local/staging business.
test.beforeEach(async ({ request }, info) => {
  const response = await request.get("/api/auth/session")
  expect(response.ok()).toBeTruthy()
  const session = await response.json()
  expect(session?.user?.id, "Login expired or changed. Run browser:save again.").toBe(info.config.metadata.userId)
  expect(session?.user?.tenantId, "The saved session belongs to a different business.").toBe(info.config.metadata.tenantId)
  expect((await request.get("/api/crm/work?pageSize=1")).status(), "Enable CRM for this test business before running CRM browser tests.").toBe(200)
})

for (const route of [
  { path: "/crm/overview", heading: "Activity overview", api: "/api/crm/reports/activities" },
  { path: "/crm/activities", heading: "My Work", api: "/api/crm/work" },
  { path: "/crm/activity-plans", heading: "Activity plans", api: "/api/crm/activity-plans" },
  { path: "/crm/follow-up-rules", heading: "Follow-up rules", api: "/api/crm/follow-up-rules" },
]) {
  test(`authenticated ${route.heading} page loads and captures a screenshot`, async ({ page }, info) => {
    const pageErrors: string[] = []
    page.on("pageerror", error => pageErrors.push(error.message))
    const loaded = page.waitForResponse(response => new URL(response.url()).pathname === route.api && response.request().method() === "GET")
    await page.goto(route.path)
    expect((await loaded).status()).toBe(200)
    await expect(page.getByRole("heading", { name: route.heading, exact: true })).toBeVisible()
    // Next's document-level route announcer also has role="alert".
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0)
    await page.screenshot({ path: info.outputPath("desktop.png"), fullPage: true })
    expect(pageErrors).toEqual([])
  })
}

test("rule form is usable on mobile without saving changes", async ({ page }, info) => {
  const response = await page.request.get("/api/crm/follow-up-rules?pageSize=1")
  test.skip(!(await response.json()).canManage, "Rule configuration requires a manager.")
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/crm/follow-up-rules/new")
  await expect(page.getByRole("heading", { name: "New follow-up rule" })).toBeVisible()
  await expect(page.getByLabel("Rule name", { exact: true })).toBeEnabled()
  await page.getByLabel("Rule name", { exact: true }).fill("Browser smoke preview")
  await page.getByLabel("When completing", { exact: true }).click()
  await page.getByRole("menuitemradio", { name: "TASK", exact: true }).click()
  await expect(page.getByLabel("With outcome", { exact: true })).toHaveText("DONE")
  await page.getByLabel("Type", { exact: true }).click()
  await page.getByRole("menuitemradio", { name: "EMAIL", exact: true }).click()
  await expect(page.getByLabel("Call direction", { exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Save rule" })).toBeEnabled()
  const width = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: window.innerWidth }))
  expect(width.content).toBeLessThanOrEqual(width.viewport)
  await page.screenshot({ path: info.outputPath("mobile-rule-form.png"), fullPage: true })
})

for (const path of ["overview", "accounts", "opportunities", "follow-up-rules"]) {
  test(`mobile ${path} stays within the app shell`, async ({ page }, info) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/crm/${path}`)
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
    await page.waitForLoadState("networkidle")
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await page.screenshot({ path: info.outputPath(`mobile-${path}.png`), fullPage: true })
  })
}
