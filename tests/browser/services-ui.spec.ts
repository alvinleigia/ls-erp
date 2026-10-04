import { test, expect, type Page } from "@playwright/test"

const category = { id: "cat", name: "Consultations", description: "Consultation services", status: "ACTIVE", sortOrder: 2, createdAt: "2026-10-03T09:00:00.000Z" }
const service = { id: "svc", name: "Initial consultation", description: "One hour consultation", category, durationMinutes: 60, priceCents: 11800, taxMode: "INCLUSIVE", taxIds: ["tax"], type: "STANDARD", status: "ACTIVE", packageItems: [] }
const bundle = { ...service, id: "pkg", name: "Consultation package", type: "PACKAGE", packageItems: [{ itemService: { id: "old", name: "Existing inactive service" } }] }

async function fixture(page: Page, packageMode = false) {
  const writes: { path: string; method: string; body: Record<string, unknown> }[] = []
  const queries: URL[] = []
  const state = { failSave: false, blockDelete: false }
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname, method = route.request().method()
    if (path === "/api/modules") return route.fulfill({ json: { modules: [{ key: "services", allowed: true, enabled: true }], permissions: null } })
    if (method !== "GET") {
      writes.push({ path, method, body: method === "DELETE" ? {} : route.request().postDataJSON() })
      if (state.failSave) return route.fulfill({ status: 400, json: { error: "Check service details.", details: { fieldErrors: { name: ["Name already exists."] } } } })
      if (state.blockDelete) return route.fulfill({ status: 409, json: { error: "Record is still in use." } })
      return route.fulfill({ json: { item: { id: "saved" }, ok: true } })
    }
    const url = new URL(route.request().url()); queries.push(url)
    if ((path.startsWith("/api/settings/taxes") || path === "/api/lookups/taxes")) return route.fulfill({ json: { items: [{ id: "tax", name: "GST", percent: 18, isActive: true }], total: 1 } })
    if (path.startsWith("/api/settings")) return route.fulfill({ json: { settings: { locale: "en-IN", currency: "INR", dateFormat: "dd/MM/yyyy", currencySymbolPlacement: "BEFORE", numberFormat: "US_UK" } } })
    const picker = url.searchParams.get("type") === "STANDARD"
    const rows = path === "/api/service-categories" ? [category] : picker ? [{ ...service, id: "extra", name: "Special follow-up" }] : [packageMode ? bundle : service]
    const total = picker ? 1 : 31, pageSize = Number(url.searchParams.get("pageSize") || 10)
    return route.fulfill({ json: { items: rows, total, page: Number(url.searchParams.get("page") || 1), pageSize, totalPages: Math.ceil(total / pageSize) } })
  })
  return { writes, queries, state }
}

async function select(page: Page, id: string, option: string) {
  await page.locator(`#${id}`).click()
  await page.getByRole("option", { name: option, exact: true }).click()
}

test("category viewing, draft discard, creation and server pagination use shared controls", async ({ page }) => {
  const { writes, queries } = await fixture(page)
  await page.goto("/services/categories")
  await page.getByRole("button", { name: "Consultations", exact: true }).click()
  await expect(page.getByRole("dialog").getByRole("textbox")).toHaveCount(0)
  await expect(page.getByRole("dialog").getByText("03/10/2026", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Edit details" }).click()
  await page.getByLabel("Name", { exact: true }).fill("Unsaved category")
  await page.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Discard unsaved changes?" })).toBeVisible()
  await page.getByRole("button", { name: "Discard changes" }).click()
  expect(writes).toHaveLength(0)
  await page.getByRole("button", { name: "Next page" }).click()
  await expect(page.getByText("Page 2 of 4", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Rows per page" }).click()
  await page.getByRole("menuitemradio", { name: "20 / page", exact: true }).click()
  await expect(page.getByText("Page 1 of 2", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Status filter" }).click()
  await page.getByRole("menuitemradio", { name: "Inactive", exact: true }).click()
  await expect.poll(() => queries.at(-1)?.searchParams.get("status")).toBe("INACTIVE")
  await page.getByRole("button", { name: "New category", exact: true }).click()
  await page.getByLabel("Name", { exact: true }).fill("New category")
  await page.getByLabel("Description", { exact: true }).fill("Category notes")
  await page.getByLabel("Sort order", { exact: true }).fill("4")
  await expect(page.locator("select:visible")).toHaveCount(0)
  await page.getByRole("button", { name: "Create category", exact: true }).click()
  await expect.poll(() => writes.length).toBe(1)
  expect(writes[0].body).toEqual({ name: "New category", description: "Category notes", status: "ACTIVE", sortOrder: 4 })
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await page.screenshot({ path: test.info().outputPath("service-categories-desktop.png"), fullPage: true, animations: "disabled" })
})

test("service details show inclusive prices and mobile edits preserve tax settings after failed saves", async ({ page }) => {
  const { writes, state } = await fixture(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/services")
  await page.getByRole("button", { name: service.name, exact: true }).click()
  const panel = page.getByRole("dialog")
  await expect(panel.locator("dd").filter({ hasText: /^₹\s*100\.00$/ })).toBeVisible()
  await expect(panel.locator("dd").filter({ hasText: /^₹\s*18\.00$/ })).toBeVisible()
  await expect(panel.locator("dd").filter({ hasText: /^₹\s*118\.00$/ })).toBeVisible()
  await page.getByRole("button", { name: "Edit details" }).click()
  await expect(page.locator("#edit-service-category")).toContainText(category.name)
  await expect(page.locator("#edit-service-tax-mode")).toContainText("Inclusive")
  await expect(page.getByRole("checkbox", { name: "GST (18%)" })).toBeChecked()
  await page.getByLabel("Name", { exact: true }).fill("Updated consultation")
  await expect.poll(async () => (await page.getByRole("dialog", { name: "Edit service" }).boundingBox())?.x).toBe(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const save = page.getByRole("button", { name: "Save changes", exact: true })
  const bounds = await save.boundingBox()
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390)
  await page.screenshot({ path: test.info().outputPath("service-edit-mobile.png"), fullPage: true, animations: "disabled" })
  state.failSave = true
  await save.click()
  await expect(page.getByRole("alert")).toHaveText("Check service details.")
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Updated consultation")
  await expect(save).toBeEnabled()
  state.failSave = false
  await save.click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  expect(writes).toHaveLength(2)
  expect(writes[1].body).toMatchObject({ priceCents: 11800, taxMode: "INCLUSIVE", taxIds: ["tax"], categoryId: "cat", durationMinutes: 60, packageItemIds: [] })
})

test("package editor retains existing items and searches server choices without capped preloads", async ({ page }) => {
  const { writes, queries } = await fixture(page, true)
  await page.goto("/services")
  await page.getByRole("button", { name: bundle.name, exact: true }).click()
  await expect(page.getByText("Existing inactive service", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Edit details" }).click()
  await expect(page.getByRole("button", { name: "Remove Existing inactive service" })).toBeVisible()
  await page.locator("#edit-service-package-items").click()
  await page.getByPlaceholder("Type to search...").fill("Special")
  await expect.poll(() => queries.some(url => url.pathname === "/api/services" && url.searchParams.get("q") === "Special" && url.searchParams.get("type") === "STANDARD")).toBe(true)
  await page.getByRole("option", { name: "Special follow-up", exact: true }).click()
  await expect(page.getByRole("button", { name: "Remove Special follow-up" })).toBeVisible()
  await page.getByRole("button", { name: "Save changes", exact: true }).click()
  await expect.poll(() => writes.length).toBe(1)
  expect(writes[0].body.packageItemIds).toEqual(["old", "extra"])
  expect(queries.some(url => ["/api/services", "/api/service-categories"].includes(url.pathname) && url.searchParams.get("pageSize") === "100")).toBe(false)
})

test("service creation, category filtering and blocked delete preserve the existing workflow", async ({ page }) => {
  const { writes, queries, state } = await fixture(page)
  await page.goto("/services")
  await page.getByRole("button", { name: "Next page" }).click()
  await expect(page.getByText("Page 2 of 4", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Filters", exact: true }).click()
  await select(page, "category-filter", category.name)
  await expect.poll(() => queries.some(url => url.searchParams.get("categoryId") === "cat" && url.searchParams.get("page") === "1")).toBe(true)
  await page.getByRole("button", { name: "Reset filters", exact: true }).click()
  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: "Record actions" }).click()
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click()
  expect(writes).toHaveLength(0)
  state.blockDelete = true
  await page.getByRole("button", { name: "Delete", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Delete service" })).toBeVisible()
  await page.getByRole("button", { name: "Cancel", exact: true }).click()
  await page.getByRole("button", { name: "New service", exact: true }).click()
  await page.getByLabel("Name", { exact: true }).fill("Follow-up session")
  await select(page, "create-service-category", category.name)
  await page.getByLabel("Price", { exact: true }).fill("49.50")
  await page.getByLabel("Duration (minutes)").fill("30")
  await page.getByRole("checkbox", { name: "GST (18%)" }).check()
  state.blockDelete = false
  await page.getByRole("button", { name: "Create service", exact: true }).click()
  await expect.poll(() => writes.length).toBe(2)
  expect(writes[1].body).toMatchObject({ name: "Follow-up session", priceCents: 4950, taxMode: "EXCLUSIVE", taxIds: ["tax"], categoryId: "cat", durationMinutes: 30, type: "STANDARD" })
})
