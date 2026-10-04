import { test, expect, type Page } from "@playwright/test"

const category = { id: "cat", name: "Equipment", description: "Reusable equipment", status: "ACTIVE", sortOrder: 0 }
const supplier = { id: "sup", name: "Acme Supplies", contactPerson: "Alex", email: "alex@example.test", phone: "", city: "Pune", state: "Maharashtra", country: "India", status: "ACTIVE", leadTimeDays: 3, isTaxRegistered: false, taxRegistrationType: null, taxRegistrationNumber: null, notes: "Keep these existing notes." }
const product = { id: "prod", name: "Test product", sku: "STOCK-01", description: "Product description", unit: "unit", category, status: "ACTIVE", costPriceCents: 10000, mrpCents: 15000, onHandQty: 5, reorderPoint: 2, reorderQty: 10, isPhysical: true, taxIds: [], supplierLinks: [{ supplierId: "sup", supplierName: supplier.name, supplierSku: "A1", supplierCostCents: 9500, minOrderQty: 2, leadTimeDays: 3, isPreferred: true }] }
const purchase = { id: "po", orderNumber: "PO-TEST", supplier, status: "ORDERED", orderDate: "2026-10-03", expectedDate: "2026-10-10", notes: "Deliver to office", subtotalCents: 20000, taxCents: 0, totalCents: 20000, items: [{ id: "line", product, quantity: 2, receivedQty: 0, unitCostCents: 10000, lineTaxCents: 0, lineTotalCents: 20000 }] }

async function fixture(page: Page, total = 1) {
  const writes: { path: string; method: string; body: Record<string, unknown> }[] = []
  const queries: URL[] = []
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url()), path = url.pathname, method = route.request().method()
    if (method !== "GET") {
      writes.push({ path, method, body: method === "DELETE" ? {} : route.request().postDataJSON() })
      return route.fulfill({ json: { item: { id: "saved" } } })
    }
    queries.push(url)
    if (path === "/api/modules") return route.fulfill({ json: { permissions: null, modules: [{ key: "inventory", enabled: true, allowed: true }] } })
    if (path.startsWith("/api/settings")) return route.fulfill({ json: { settings: { currency: "INR", locale: "en-IN", dateFormat: "dd/MM/yyyy", timeZone: "Asia/Kolkata" } } })
    const rows = path.endsWith("/products") ? [product] : path.endsWith("/suppliers") ? [supplier] : path.endsWith("/categories") ? [category] : path.endsWith("/purchases") ? [purchase] : []
    return route.fulfill({ json: { items: rows, total: rows.length ? total : 0, page: Number(url.searchParams.get("page") || 1), totalPages: Math.ceil(total / 10), pageSize: 10 } })
  })
  return { writes, queries }
}

async function choose(page: Page, id: string, label: string) {
  await page.locator(`#${id}`).click()
  await page.getByRole("option", { name: label, exact: true }).click()
}

test("category records separate viewing/editing, confirm discard/delete, and reset pagination on filters", async ({ page }) => {
  const { writes, queries } = await fixture(page, 21)
  await page.goto("/inventory/categories")
  await page.getByRole("button", { name: "Equipment", exact: true }).click()
  await expect(page.getByRole("dialog").getByText("Reusable equipment", { exact: true })).toBeVisible()
  await expect(page.getByRole("dialog").getByRole("textbox")).toHaveCount(0)
  await page.getByRole("button", { name: "Edit details" }).click()
  await page.getByLabel("Name", { exact: true }).fill("Unsaved change")
  await page.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Discard unsaved changes?" })).toBeVisible()
  await page.getByRole("button", { name: "Keep editing" }).click()
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Unsaved change")
  await page.getByRole("button", { name: "Cancel", exact: true }).click()
  await page.getByRole("button", { name: "Discard changes" }).click()
  expect(writes).toHaveLength(0)
  await page.getByRole("button", { name: "Next page" }).click()
  await expect(page.getByText("Page 2 of 3", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Status filter" }).click()
  await page.getByRole("menuitemradio", { name: "Inactive", exact: true }).click()
  await expect.poll(() => queries.filter(url => url.pathname.endsWith("/categories")).at(-1)?.searchParams.get("status")).toBe("INACTIVE")
  expect(queries.filter(url => url.pathname.endsWith("/categories")).at(-1)?.searchParams.get("page")).toBe("1")
  await page.getByRole("button", { name: "Next page" }).click()
  await expect(page.getByText("Page 2 of 3", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Rows per page" }).click()
  await page.getByRole("menuitemradio", { name: "20 / page", exact: true }).click()
  await expect.poll(() => queries.filter(url => url.pathname.endsWith("/categories")).at(-1)?.searchParams.get("pageSize")).toBe("20")
  expect(queries.filter(url => url.pathname.endsWith("/categories")).at(-1)?.searchParams.get("page")).toBe("1")
  await page.getByRole("button", { name: "Record actions" }).click()
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click()
  expect(writes).toHaveLength(0)
  await page.getByRole("button", { name: "Cancel", exact: true }).click()
  await page.getByRole("button", { name: "Record actions" }).click()
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click()
  await page.getByRole("button", { name: "Delete", exact: true }).click()
  await expect.poll(() => writes.length).toBe(1)
  expect(writes[0].method).toBe("DELETE")
  await page.screenshot({ path: test.info().outputPath("inventory-categories-desktop.png"), fullPage: true, animations: "disabled" })
})

test("product editor uses shared sections, retains links and fits a mobile screen", async ({ page }) => {
  const { writes, queries } = await fixture(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/inventory")
  await page.getByRole("button", { name: "Test product", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Pricing and stock", exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Edit details" }).click()
  await expect(page.locator("#product-category")).toContainText("Equipment")
  await expect(page.locator("#supplier-0")).toContainText("Acme Supplies")
  await expect(page.locator("select:visible")).toHaveCount(0)
  await page.getByLabel("Product name", { exact: true }).fill("Updated product")
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await expect.poll(async () => (await page.getByRole("dialog", { name: "Edit product" }).boundingBox())?.x).toBe(0)
  const footer = await page.getByRole("button", { name: "Save changes", exact: true }).boundingBox()
  expect(footer!.y + footer!.height).toBeLessThanOrEqual(844)
  expect(footer!.x + footer!.width).toBeLessThanOrEqual(390)
  await page.screenshot({ path: test.info().outputPath("inventory-product-mobile.png"), fullPage: true, animations: "disabled" })
  await page.getByRole("button", { name: "Save changes", exact: true }).click()
  await expect.poll(() => writes.length).toBe(1)
  expect(writes[0].body.name).toBe("Updated product")
  expect(writes[0].body.categoryId).toBe("cat")
  expect(writes[0].body.supplierLinks).toEqual([{ supplierId: "sup", supplierSku: "A1", supplierCostCents: 9500, minOrderQty: 2, leadTimeDays: 3, isPreferred: true }])
  expect(queries.some(url => url.pathname.endsWith("/suppliers") && url.searchParams.get("pageSize") === "100")).toBe(false)
})

test("supplier view and editor retain saved notes and dropdown selections", async ({ page }) => {
  const { writes } = await fixture(page)
  await page.goto("/inventory/suppliers")
  await page.getByRole("button", { name: "Acme Supplies", exact: true }).click()
  await expect(page.getByText("Keep these existing notes.", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Edit details" }).click()
  await expect(page.getByRole("textbox", { name: "Notes", exact: true })).toHaveValue("Keep these existing notes.")
  await page.getByLabel("Contact person", { exact: true }).fill("New contact")
  await expect(page.locator("select:visible")).toHaveCount(0)
  await page.getByRole("button", { name: "Save changes", exact: true }).click()
  await expect.poll(() => writes.length).toBe(1)
  expect(writes[0].body.notes).toBe("Keep these existing notes.")
  expect(writes[0].body.country).toBe("India")
  expect(writes[0].body.state).toBe("Maharashtra")
})

test("purchase order details, stock confirmation and creation preserve quantities and prices", async ({ page }) => {
  const { writes } = await fixture(page)
  await page.goto("/inventory/purchases")
  await page.getByRole("button", { name: "PO-TEST", exact: true }).click()
  await expect(page.getByText("03/10/2026", { exact: true })).toHaveCount(2)
  await expect(page.getByRole("heading", { name: "Totals", exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Mark as received", exact: true }).click()
  expect(writes).toHaveLength(0)
  await page.getByRole("button", { name: "Receive stock", exact: true }).click()
  await expect.poll(() => writes.length).toBe(1)
  expect(writes[0].body).toEqual({ status: "RECEIVED" })
  await page.getByRole("button", { name: "New PO", exact: true }).click()
  await choose(page, "po-supplier", "Acme Supplies")
  await choose(page, "po-item-product-0", "Test product")
  await page.getByLabel("Qty", { exact: true }).fill("3")
  await page.getByLabel("Unit cost", { exact: true }).fill("25.50")
  await page.getByRole("button", { name: "Create purchase order", exact: true }).click()
  await expect.poll(() => writes.length).toBe(2)
  expect(writes[1].body.items).toEqual([{ productId: "prod", quantity: 3, unitCostCents: 2550 }])
  expect(writes[1].body.supplierId).toBe("sup")
})
