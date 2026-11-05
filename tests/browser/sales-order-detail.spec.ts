import { test, expect, type Page } from "@playwright/test"
import { emptyQuotationContent } from "../../modules/sales-documents/quotation-validation"
import { calculateQuotation } from "../../modules/sales-documents/quotation-calculation"
import { moduleKeys, moduleSettings } from "../../platform/modules"

async function fixture(page: Page, options: { limited?: boolean; draft?: boolean; generic?: boolean } = {}) {
  const content = { ...structuredClone(emptyQuotationContent), supplierName: "Sample Business", title: "Sample accepted agreement", currency: "INR", bookingDate: "2026-11-04", terms: "Saved accepted terms", bank: { ...emptyQuotationContent.bank, accountName: "Sample Business" }, lines: [{ description: "Sample unit", quantity: "1", unit: "unit", rate: "1000" }], instalments: [{ label: "Booking", percent: "10", days: 0, note: "" }, { label: "Balance", percent: "90", days: 30, note: "" }] }
  const snapshot = { content, calculation: calculateQuotation(content), customer: { name: "Sample Customer", email: "customer@example.test", phone: null }, opportunity: "Sample opportunity", context: [], locale: "en-IN", dateFormat: "dd/MM/yyyy", numberFormat: "US_UK", currencySymbolPlacement: "BEFORE", actor: "Sample admin", template: null,
    items: options.generic ? [] : [{ kind: "UNIT", itemId: "unit", code: "UNIT-001", name: "Sample unit", version: 1 }],
    participants: { format: 1, participants: ["Sample Customer", "Additional Customer"].map((name, index) => ({ role: index ? "ADDITIONAL_CUSTOMER" : "CUSTOMER", party: { kind: "PERSON", id: `customer-${index}`, name, email: `customer${index}@example.test`, phone: null, sourceVersion: 1 } })) },
  }
  const record = { id: "test", title: content.title, reference: "SO-000001", orderedOn: "2026-11-04", customerName: "Sample Customer", currency: "INR", consideration: "1000", quotationId: "quote", revision: 2, version: 2, status: options.draft ? "DRAFT" : "CONFIRMED", createdAt: "2026-11-04T10:00:00Z", snapshot, canConfirm: false, canCancel: !options.limited, recordAccess: { resource: "salesOrders", id: "test", permissions: { "salesOrders.read": true, "salesOrders.edit": !options.limited } }, history: [{ version: 1, status: "DRAFT", actorName: "Sample admin", createdAt: "2026-11-04T09:00:00Z", reason: "" }, { version: 2, status: "CONFIRMED", actorName: "Sample admin", createdAt: "2026-11-04T10:00:00Z", reason: "" }],
    ...(options.draft ? { confirmationReview: { configurationVersion: 3, missing: [{ participant: "Sample Customer", label: "Postal code" }] } } : {}),
  }
  const reads: string[] = [], writes: string[] = [], unexpected: string[] = []
  await page.route("**/api/**", async route => {
    const req = route.request(), path = new URL(req.url()).pathname, json = (body: unknown, status = 200) => route.fulfill({ json: body, status })
    if (req.method() !== "GET") { writes.push(path); return json({ error: "No business writes in this fixture." }, 403) }
    reads.push(path)
    if (path === "/api/auth/session") return json({ user: { id: "admin", name: "Sample admin", role: "ADMIN" }, expires: "2099-01-01" })
    if (path === "/api/modules") return json({ modules: moduleSettings(moduleKeys.map(key => ({ key, allowed: !options.limited ? key !== "invoicing" : ["crm", "salesDocuments", "salesOrders"].includes(key), enabled: !options.limited ? key !== "invoicing" : ["crm", "salesDocuments", "salesOrders"].includes(key) }))), permissions: options.limited ? ["salesOrders.read", "quotations.read"] : null })
    if (path === "/api/settings/display") return json({ settings: { locale: "en-IN", currency: "INR", dateFormat: "dd/MM/yyyy", timeZone: "Asia/Kolkata", numberFormat: "US_UK", currencySymbolPlacement: "BEFORE" } })
    if (path === "/api/settings/terminology") return json({ labels: {} })
    if (path === "/api/sales-orders/test") return json(record)
    if (path.endsWith("/tax-agreement")) return json({ acceptance: null })
    if (path.endsWith("/documents")) return json({ providers: [{ key: "order-acknowledgement", name: "Order acknowledgement" }], latest: [], items: [{ id: "issued", providerKey: "order-acknowledgement", reference: "SO-000001/ACK/001", templateVersion: 1, isLatest: true, createdAt: record.createdAt }], canIssue: true, recordAccess: { permissions: { "orderDocuments.export": true } }, total: 1, page: 1, pageSize: 10 })
    if (path.endsWith("/reservations")) return json({ units: [{ itemId: "unit", code: "UNIT-001", name: "Sample unit", available: false }], items: [{ id: "reservation", itemCode: "UNIT-001", itemName: "Sample unit", status: "ALLOCATED", expiresAt: "2026-11-07T00:00:00Z", events: [] }], total: 1, page: 1, pageSize: 10, canRelease: true })
    if (path.endsWith("/receivables")) return json({ account: null, currency: "INR", status: record.status, today: "2026-11-05", plan: { blocked: null, total: "1000", lines: [{ label: "Booking", amount: "100", dueOn: "2026-11-04" }] }, lines: [], items: [], total: 0, page: 1, pageSize: 10, canOpen: true })
    if (path.endsWith("/invoices")) return json({ items: [], canCreate: false, notice: "No invoices prepared.", total: 0, page: 1, pageSize: 10 })
    unexpected.push(path); return json({ items: [] })
  })
  return { reads, writes, unexpected, record }
}

test("order sections load on demand and preserve the selected tab in its URL", async ({ page }) => {
  const state = await fixture(page)
  await page.goto("/sales-orders/test")
  await expect(page.getByLabel("Order summary")).toContainText("SO-000001")
  await expect(page.getByRole("tab", { name: "Overview", exact: true })).toHaveAttribute("aria-selected", "true")
  await expect(page.getByRole("heading", { name: "Calculated summary", exact: true })).toBeVisible()
  expect(state.reads.some(path => /\/(documents|reservations|receivables|invoices)$/.test(path))).toBe(false)
  await page.screenshot({ path: test.info().outputPath("overview-desktop.png"), fullPage: true, animations: "disabled" })
  await page.getByRole("tab", { name: "Customers", exact: true }).click()
  await expect(page.getByRole("tabpanel")).toContainText("Additional Customer")
  await expect(page.getByRole("heading", { name: "Price and discount", exact: true })).toHaveCount(0)
  await page.getByRole("tab", { name: "Documents", exact: true }).click()
  await expect(page.getByRole("link", { name: "Download issued PDF", exact: true })).toBeVisible()
  expect(state.reads.some(path => path.endsWith("/reservations"))).toBe(false)
  const url = page.url(); await page.reload()
  await expect(page).toHaveURL(url)
  await expect(page.getByRole("tab", { name: "Documents", exact: true })).toHaveAttribute("aria-selected", "true")
  await expect(page.getByRole("link", { name: "Download issued PDF", exact: true })).toHaveAttribute("href", /issued\/pdf/)
  await page.getByRole("tab", { name: "Units", exact: true }).click()
  await expect(page.getByRole("region", { name: "Unit reservations", exact: true })).toContainText("Allocated")
  await page.getByRole("tab", { name: "Payments", exact: true }).click()
  await expect(page.getByRole("button", { name: "Open receivables", exact: true })).toBeVisible()
  await page.getByText("Agreed instalment schedule", { exact: true }).click()
  await expect(page.getByRole("heading", { name: "Instalment schedule", exact: true })).toBeVisible()
  await page.getByRole("tab", { name: "History", exact: true }).click()
  await expect(page.getByRole("tabpanel")).toContainText("Confirmed")
  expect(state.writes).toEqual([]); expect(state.unexpected).toEqual([])
})

test("mobile navigation contains long sections and keeps destructive actions behind confirmation", async ({ page }) => {
  const state = await fixture(page)
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/sales-orders/test")
  await expect(page.getByLabel("Order summary")).toBeVisible()
  await page.getByRole("tab", { name: "Documents", exact: true }).click()
  await expect(page.getByRole("link", { name: "Download issued PDF", exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: test.info().outputPath("documents-mobile.png"), fullPage: true, animations: "disabled" })
  await page.getByRole("tab", { name: "Units", exact: true }).click(); await page.getByRole("button", { name: "Release unit", exact: true }).click()
  await expect(page.getByRole("button", { name: "Confirm release", exact: true })).toBeDisabled()
  await page.getByRole("button", { name: "Go back", exact: true }).click()
  await page.getByRole("tab", { name: "Payments", exact: true }).click(); await page.getByRole("button", { name: "Open receivables", exact: true }).click()
  await expect(page.getByRole("dialog")).toContainText("Amounts come from the saved quotation")
  await page.getByRole("button", { name: "Go back", exact: true }).click()
  await page.getByRole("tab", { name: "Overview", exact: true }).click()
  await page.getByText("Bank instructions and terms", { exact: true }).click()
  await expect(page.getByRole("heading", { name: "Bank details", exact: true })).toBeVisible()
  await expect(page.getByRole("tabpanel")).toContainText("Saved accepted terms")
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(state.writes).toEqual([])
})

test("restricted and generic orders retain saved values without exposing module tabs", async ({ page }) => {
  const state = await fixture(page, { limited: true, generic: true })
  await page.goto("/sales-orders/test?l.record-view.tab=documents")
  await expect(page.getByRole("tab", { name: "Overview", exact: true })).toHaveAttribute("aria-selected", "true")
  await expect(page.getByRole("tab", { name: "Documents", exact: true })).toHaveCount(0)
  await expect(page.getByRole("tab", { name: "Units", exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Cancel sales order", exact: true })).toHaveCount(0)
  await page.getByRole("tab", { name: "Payments", exact: true }).click()
  await page.getByText("Agreed instalment schedule", { exact: true }).click()
  await expect(page.getByRole("tabpanel")).toContainText("Balance")
  expect(state.reads.some(path => /\/(documents|reservations|receivables|invoices)$/.test(path))).toBe(false)
  expect(state.writes).toEqual([])
})

test("incomplete confirmation requirements remain visible when switching sections", async ({ page }) => {
  await fixture(page, { draft: true })
  await page.goto("/sales-orders/test")
  await expect(page.getByRole("region", { name: "Confirmation review", exact: true })).toContainText("Postal code")
  await page.getByRole("tab", { name: "History", exact: true }).click()
  await expect(page.getByRole("region", { name: "Confirmation review", exact: true })).toContainText("Postal code")
  await expect(page.getByRole("button", { name: "Confirm sales order", exact: true })).toHaveCount(0)
  await page.getByRole("tab", { name: "History", exact: true }).press("Home")
  await expect(page.getByRole("tab", { name: "Overview", exact: true })).toBeFocused()
})
