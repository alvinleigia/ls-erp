import { test, expect } from "@playwright/test"
import { moduleKeys, moduleSettings, type ModuleFlag } from "../../platform/modules"

test("platform allowances respect dependencies and require confirmation to remove", async ({ page }) => {
  const flags: ModuleFlag[] = moduleKeys.map(key => ({ key, allowed: false, enabled: false }))
  const writes: unknown[] = []
  await page.route("**/api/**", async route => {
    const request = route.request()
    if (request.method() === "PATCH") {
      const data = request.postDataJSON(); writes.push(data)
      const flag = flags.find(row => row.key === data.key)!
      flag.allowed = data.allowed; flag.enabled = data.allowed
    }
    await route.fulfill({ json: { modules: moduleSettings(flags) } })
  })
  await page.goto("/settings/modules?tenant=business")
  await expect(page.getByRole("button", { name: "Allow Real Estate", exact: true })).toBeDisabled()
  await page.getByRole("button", { name: "Allow CRM", exact: true }).click()
  await page.getByRole("button", { name: "Allow Real Estate", exact: true }).click()
  await expect(page.getByRole("button", { name: "Remove allowance CRM", exact: true })).toBeDisabled()
  await page.getByRole("button", { name: "Remove allowance Real Estate", exact: true }).click()
  await expect(page.getByRole("dialog")).toContainText("The tenant administrator cannot enable it again")
  await page.getByRole("button", { name: "Cancel", exact: true }).click()
  expect(writes).toHaveLength(2)
  await page.getByRole("button", { name: "Remove allowance Real Estate", exact: true }).click()
  await page.getByRole("dialog").getByRole("button", { name: "Remove allowance", exact: true }).click()
  await expect(page.getByRole("button", { name: "Allow Real Estate", exact: true })).toBeEnabled()
  expect(writes).toEqual([{ key: "crm", allowed: true }, { key: "realEstate", allowed: true }, { key: "realEstate", allowed: false }])
  await page.screenshot({ path: test.info().outputPath("platform-modules.png"), fullPage: true, animations: "disabled" })
})

test("tenant controls show denied modules without an activation button and preserve allowed toggles", async ({ page }) => {
  const flags: ModuleFlag[] = moduleKeys.map(key => ({ key, allowed: key === "crm", enabled: key === "crm" }))
  const writes: unknown[] = []
  await page.route("**/api/**", async route => {
    if (route.request().method() === "PATCH") {
      const data = route.request().postDataJSON(); writes.push(data)
      flags.find(row => row.key === data.key)!.enabled = data.enabled
      return route.fulfill({ json: flags.find(row => row.key === data.key) })
    }
    await route.fulfill({ json: { canManage: true, modules: moduleSettings(flags) } })
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/settings/modules")
  await expect(page.getByRole("region", { name: "Real Estate", exact: true })).toContainText("Not allowed by platform")
  await expect(page.getByRole("button", { name: "Enable Real Estate", exact: true })).toHaveCount(0)
  await page.getByRole("button", { name: "Disable CRM", exact: true }).click()
  await page.getByRole("button", { name: "Disable module", exact: true }).click()
  await page.getByRole("button", { name: "Enable CRM", exact: true }).click()
  await expect(page.getByRole("button", { name: "Disable CRM", exact: true })).toBeEnabled()
  expect(writes).toEqual([{ key: "crm", enabled: false }, { key: "crm", enabled: true }])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: test.info().outputPath("tenant-modules-mobile.png"), fullPage: true, animations: "disabled" })
})

test("tenant creation exposes module choices and row actions expose the same module controls", async ({ page }) => {
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname
    if (path === "/api/tenants") return route.fulfill({ json: { items: [{ id: "business", name: "Example business", slug: "example", status: "ACTIVE", userCount: 1, createdAt: "2026-09-30T00:00:00Z" }], total: 1, page: 1, totalPages: 1 } })
    if (path.endsWith("/modules")) return route.fulfill({ json: { modules: moduleSettings([]) } })
    return route.fulfill({ json: { items: [] } })
  })
  await page.goto("/settings/tenants")
  await page.getByRole("button", { name: "New tenant", exact: true }).click()
  await expect(page.getByRole("checkbox", { name: "Real Estate", exact: true })).toBeDisabled()
  await page.getByRole("checkbox", { name: "CRM", exact: true }).check()
  await page.getByRole("checkbox", { name: "Sales Documents", exact: true }).check()
  await page.getByRole("checkbox", { name: "Payment Plans", exact: true }).check()
  await expect(page.getByRole("checkbox", { name: "Sales Documents", exact: true })).toBeDisabled()
  await page.screenshot({ path: test.info().outputPath("tenant-create-modules.png"), fullPage: true, animations: "disabled" })
  await page.getByRole("button", { name: "Cancel", exact: true }).click()
  await page.getByRole("button", { name: "Actions for Example business" }).click()
  await page.getByRole("menuitem", { name: "Manage modules" }).click()
  await expect(page.getByRole("dialog")).toContainText("Modules - Example business")
  await expect(page.getByRole("button", { name: "Allow CRM", exact: true })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath("tenant-module-dialog.png"), fullPage: true, animations: "disabled" })
})
