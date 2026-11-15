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
  await page.getByRole("dialog").getByRole("tab", { name: "Modules", exact: true }).click()
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

test("platform module cards stay aligned inside the mobile dialog across every group", async ({ page }) => {
  const writes: string[] = []
  const displayed = new Set<string>()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.route("**/api/**", async route => {
    if (route.request().method() !== "GET") writes.push(route.request().method())
    const path = new URL(route.request().url()).pathname
    if (path === "/api/tenants") return route.fulfill({ json: { items: [{ id: "business", name: "Example business", slug: "example", status: "ACTIVE", userCount: 1, createdAt: "2026-09-30T00:00:00Z" }], total: 1, page: 1, totalPages: 1 } })
    if (path.endsWith("/modules")) return route.fulfill({ json: { modules: moduleSettings([]) } })
    return route.fulfill({ json: { items: [] } })
  })
  await page.goto("/settings/tenants")
  await page.getByRole("button", { name: "Actions for Example business" }).click()
  await page.getByRole("menuitem", { name: "Manage modules" }).click()
  const dialog = page.getByRole("dialog")
  for (const name of ["CRM and sales", "Billing", "Operations", "Workforce"]) {
    await dialog.getByRole("tab", { name, exact: true }).click()
    await expect(dialog.getByRole("tabpanel").locator("section[aria-label]").first()).toBeVisible()
    for (const name of await dialog.getByRole("tabpanel").locator("section[aria-label]").evaluateAll(cards => cards.map(card => card.getAttribute("aria-label")!))) displayed.add(name)
    const layout = await dialog.evaluate(element => {
      const dialog = element.getBoundingClientRect()
      const cards = Array.from(element.querySelectorAll('[role="tabpanel"]:not([hidden]) section[aria-label]')).map(card => card.getBoundingClientRect())
      return { dialogWidth: dialog.width, widths: cards.map(card => card.width), contained: cards.every(card => card.left >= dialog.left && card.right <= dialog.right) }
    })
    expect(layout.dialogWidth).toBeLessThanOrEqual(390)
    expect(layout.contained).toBe(true)
    expect(Math.max(...layout.widths) - Math.min(...layout.widths)).toBeLessThan(1)
  }
  expect([...displayed].sort()).toEqual(moduleSettings([]).map(module => module.name).sort())
  expect(writes).toEqual([])
  await dialog.screenshot({ path: test.info().outputPath("platform-module-dialog-mobile.png"), animations: "disabled" })
})

test("Customer Verification is available in platform settings with CRM dependency and removal warning", async ({ page }) => {
  const flags: ModuleFlag[] = moduleKeys.map(key => ({ key, allowed: false, enabled: false }))
  const writes: unknown[] = []
  await page.route("**/api/**", async route => {
    if (route.request().method() === "PATCH") {
      const input = route.request().postDataJSON(); writes.push(input)
      const flag = flags.find(row => row.key === input.key)!
      flag.allowed = input.allowed; flag.enabled = input.allowed
    }
    await route.fulfill({ json: { modules: moduleSettings(flags) } })
  })
  await page.goto("/settings/modules?tenant=business")
  await expect(page.getByRole("button", { name: "Allow Customer Verification", exact: true })).toBeDisabled()
  await page.getByRole("button", { name: "Allow CRM", exact: true }).click()
  await page.getByRole("button", { name: "Allow Customer Verification", exact: true }).click()
  await expect(page.getByRole("button", { name: "Remove allowance CRM", exact: true })).toBeDisabled()
  await page.getByRole("button", { name: "Remove allowance Customer Verification", exact: true }).click()
  await expect(page.getByRole("dialog")).toContainText("Required transaction checkpoints still apply")
  await page.getByRole("button", { name: "Cancel", exact: true }).click()
  expect(writes).toHaveLength(2)
  await page.getByRole("button", { name: "Remove allowance Customer Verification", exact: true }).click()
  await page.getByRole("dialog").getByRole("button", { name: "Remove allowance", exact: true }).click()
  await expect(page.getByRole("button", { name: "Allow Customer Verification", exact: true })).toBeEnabled()
  expect(writes).toEqual([{ key: "crm", allowed: true }, { key: "customerVerification", allowed: true }, { key: "customerVerification", allowed: false }])
  await page.screenshot({ path: test.info().outputPath("verification-platform.png"), fullPage: true })
})

test("tenant verification activation needs allowance, opens settings and confirms disabling on mobile", async ({ page }) => {
  const flags: ModuleFlag[] = moduleKeys.map(key => ({ key, allowed: key === "crm", enabled: key === "crm" }))
  const writes: unknown[] = []
  await page.route("**/api/**", async route => {
    if (route.request().method() === "PATCH") {
      const input = route.request().postDataJSON(); writes.push(input)
      flags.find(row => row.key === input.key)!.enabled = input.enabled
    }
    await route.fulfill({ json: { canManage: true, modules: moduleSettings(flags) } })
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/settings/modules")
  const card = page.getByRole("region", { name: "Customer Verification", exact: true })
  await expect(card).toContainText("Not allowed by platform")
  await expect(card.getByRole("button", { name: /^(Enable|Disable) Customer Verification$/ })).toHaveCount(0)
  flags.find(row => row.key === "customerVerification")!.allowed = true
  await page.reload()
  await page.getByRole("button", { name: "Enable Customer Verification", exact: true }).click()
  await expect(page.getByRole("link", { name: "Open Customer Verification", exact: true })).toHaveAttribute("href", "/settings/verification")
  await expect(page.getByRole("button", { name: "Disable CRM", exact: true })).toBeDisabled()
  await page.getByRole("button", { name: "Disable Customer Verification", exact: true }).click()
  await expect(page.getByRole("dialog")).toContainText("Required transaction checkpoints still apply")
  await page.getByRole("button", { name: "Cancel", exact: true }).click()
  expect(writes).toHaveLength(1)
  await page.getByRole("button", { name: "Disable Customer Verification", exact: true }).click()
  await page.getByRole("button", { name: "Disable module", exact: true }).click()
  await expect(page.getByRole("button", { name: "Enable Customer Verification", exact: true })).toBeEnabled()
  expect(writes).toEqual([{ key: "customerVerification", enabled: true }, { key: "customerVerification", enabled: false }])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await card.screenshot({ path: test.info().outputPath("verification-tenant-mobile.png") })
})

test("read-only module users cannot toggle verification", async ({ page }) => {
  const flags = moduleKeys.map(key => ({ key, allowed: true, enabled: true }))
  const writes: string[] = []
  await page.route("**/api/**", async route => {
    if (route.request().method() !== "GET") writes.push(route.request().method())
    await route.fulfill({ json: { canManage: false, modules: moduleSettings(flags) } })
  })
  await page.goto("/settings/modules")
  await expect(page.getByRole("region", { name: "Customer Verification", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Disable Customer Verification", exact: true })).toHaveCount(0)
  await expect(page.getByText("Ask a business administrator to change enabled modules.", { exact: true })).toBeVisible()
  expect(writes).toEqual([])
})
