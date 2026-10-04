import { test, expect, type Page } from "@playwright/test"

const customer = { id: "customer", name: "Alex Taylor", email: "alex@example.test" }
const staff = { id: "staff", name: "Sam", email: "sam@example.test" }
const service = { id: "service", name: "Consultation", durationMinutes: 60, priceCents: 10000, category: { id: "cat", name: "Consultations" }, taxIds: ["tax"], taxMode: "EXCLUSIVE" }
const coupon = { id: "coupon", code: "WELCOME", name: "Welcome offer", discountType: "PERCENT", discountValue: 10, appliesTo: "ORDER", allowedServiceIds: [], allowedCategoryIds: [], allowedProductIds: [], minSubtotalCents: 0, stackingMode: "STACKABLE", isActive: true, validFrom: null, validTo: null, maxUses: null, maxUsesPerCustomer: null, usedCount: 0 }
const order = { id: "order", customerId: customer.id, customer, appointmentDate: "2030-10-03", appointmentStartAt: "2030-10-03T10:00:00+05:30", status: "CONFIRMED", customerNote: "Customer note", internalNote: "Internal note", subtotalCents: 10000, lineDiscountCents: 0, couponDiscountCents: 0, taxCents: 1800, totalCents: 11800, productLines: [], coupons: [], taxes: [{ id: "snapshot", taxId: "tax", name: "GST", percent: 18, taxCents: 1800 }], lines: [{ id: "line", sortOrder: 0, serviceId: service.id, service, staffProfileId: "profile", staffProfile: { id: "profile", user: staff }, quantity: 1, durationMinutes: 60, unitPriceCents: 10000, discountType: "NONE", discountValue: 0, taxIds: ["tax"], taxMode: "EXCLUSIVE", lineSubtotalCents: 10000, lineDiscountCents: 0, lineTaxCents: 1800, lineTotalCents: 11800, startAt: "2030-10-03T10:00:00+05:30", endAt: "2030-10-03T11:00:00+05:30", note: "Line note" }] }
const appointment = { id: "appointment", customer, service, staffProfile: { user: staff }, status: "CONFIRMED", startAt: order.appointmentStartAt, endAt: order.lines[0].endAt, orderLine: { order: { id: "order", status: "CONFIRMED" } } }

async function fixture(page: Page, status = "CONFIRMED", permissions: string[] = [], enabled = true) {
  const writes: { path: string; method: string; body: Record<string, unknown> }[] = []
  const queries: URL[] = []
  const state = { conflict: false, missing: false, timeFormat: "H24" }
  await page.route("**/api/**", async route => {
    if (new URL(route.request().url()).pathname === "/api/modules") return route.fulfill({ json: { modules: ["appointments", "services", "inventory"].map(key => ({ key, enabled, allowed: true })), permissions } })
    const url = new URL(route.request().url()), path = url.pathname, method = route.request().method()
    if (method !== "GET") {
      const body = method === "DELETE" ? {} : route.request().postDataJSON()
      writes.push({ path, method, body })
      if (state.conflict && path.startsWith("/api/appointments/orders")) return route.fulfill({ status: 409, json: { error: "Selected time is unavailable.", suggestedStartAt: "2030-10-03T12:00:00+05:30", canApplySuggestion: true } })
      return route.fulfill({ json: { ok: true, available: true, order: { ...order, status: body.status || status, customerNote: body.customerNote ?? order.customerNote } } })
    }
    queries.push(url)
    if (path === "/api/appointments/orders/order") return route.fulfill({ status: state.missing ? 404 : 200, json: state.missing ? { error: "Not found" } : { order: { ...order, status } } })
    if (["/api/settings/taxes", "/api/lookups/taxes"].includes(path)) return route.fulfill({ json: { items: [{ id: "tax", name: "GST", percent: 18, isActive: true }], total: 1 } })
    if (path.startsWith("/api/settings")) return route.fulfill({ json: { settings: { currency: "INR", locale: "en-IN", numberFormat: "US_UK", dateFormat: "dd/MM/yyyy", timeFormat: state.timeFormat, firstDayOfWeek: "MONDAY" } } })
    const rows = ["/api/users", "/api/directory"].includes(path) ? [url.searchParams.get("role") === "STAFF" ? staff : customer] : path === "/api/services" ? [service] : path === "/api/appointments/coupons" ? [coupon] : path === "/api/appointments" ? [appointment] : path === "/api/service-categories" ? [service.category] : []
    const total = path === "/api/appointments" ? 31 : rows.length
    return route.fulfill({ json: { items: rows, total, page: Number(url.searchParams.get("page") || 1), pageSize: 10, totalPages: Math.ceil(total / 10) } })
  })
  return { writes, queries, state }
}

for (const mode of ["disabled", "denied", "readonly", "editor"] as const) {
 test(`Appointments ${mode} access`, async ({ page }) => {
  const permissions = mode === "denied" ? [] : ["appointments.read", ...(mode === "editor" ? ["appointments.create", "appointments.edit", "services.read"] : [])]
  const { writes, queries } = await fixture(page, "CONFIRMED", permissions, mode !== "disabled")
  await page.goto("/appointments")
  if (mode === "disabled" || mode === "denied") {
   await expect(page.getByRole("heading", { name: mode === "disabled" ? "Module unavailable" : "Access unavailable" })).toBeVisible()
   expect(queries.some(q => q.pathname === "/api/appointments")).toBe(false)
   return
  }
  if (mode === "readonly") await expect(page.getByRole("button", { name: "New appointment" })).toBeDisabled()
  else await expect(page.getByRole("button", { name: "New appointment" })).toBeEnabled()
  await page.getByRole("button", { name: "Record actions" }).click()
  await expect(page.getByRole("menuitem", { name: "Cancel appointment", exact: true })).toHaveCount(0)
  if (mode === "readonly") await expect(page.getByRole("menuitem", { name: "Edit", exact: true })).toHaveCount(0)
  else await expect(page.getByRole("menuitem", { name: "Edit", exact: true })).toBeVisible()
  await page.keyboard.press("Escape")
  await page.goto("/appointments/order/edit")
  await expect(page.getByRole("heading", { name: "Booking details" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Print invoice" })).toBeDisabled()
  await expect(page.getByRole("button", { name: "Email invoice" })).toBeDisabled()
  if (mode === "readonly") {
   await expect(page.getByRole("button", { name: "Edit booking", exact: true })).toHaveCount(0)
   await page.screenshot({ path: test.info().outputPath("booking-readonly.png"), fullPage: true, animations: "disabled" })
   await page.goto("/appointments/new")
   await expect(page.getByRole("heading", { name: "Access unavailable" })).toBeVisible()
  } else await expect(page.getByRole("button", { name: "Edit booking", exact: true })).toBeEnabled()
  expect(writes).toHaveLength(0)
 })
}

test("coupon editor cannot archive and denied coupon reports do not fetch records", async ({ page }) => {
 const { writes, queries } = await fixture(page, "CONFIRMED", ["appointmentCoupons.read", "appointmentCoupons.edit"])
 await page.goto("/appointments/coupons")
 await expect(page.getByRole("button", { name: "New coupon" })).toBeDisabled()
 await page.getByRole("button", { name: "Record actions" }).click()
 await expect(page.getByRole("menuitem", { name: "Delete", exact: true })).toBeDisabled()
 await page.getByRole("menuitem", { name: "Edit", exact: true }).click()
 await expect(page.getByRole("checkbox", { name: "Active", exact: true })).toBeDisabled()
 await page.setViewportSize({ width: 390, height: 844 })
 await expect(page.getByRole("button", { name: "Save changes", exact: true })).toBeInViewport()
 await page.screenshot({ path: test.info().outputPath("coupon-permissions-mobile.png"), fullPage: true, animations: "disabled" })
 await page.goto("/reports/coupon-usage")
 await expect(page.getByRole("heading", { name: "Access unavailable" })).toBeVisible()
 expect(queries.some(q => q.pathname === "/api/reports/coupon-usage")).toBe(false)
 expect(writes).toHaveLength(0)
})

test("invoice export alone enables printing but not emailing", async ({ page }) => {
 await fixture(page, "CONFIRMED", ["appointments.read", "appointments.export"])
 await page.goto("/appointments/order/edit")
 await expect(page.getByRole("button", { name: "Print invoice" })).toBeEnabled()
 await expect(page.getByRole("button", { name: "Email invoice" })).toBeDisabled()
})
