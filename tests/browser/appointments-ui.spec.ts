import { test, expect, type Page } from "@playwright/test"

const customer = { id: "customer", name: "Alex Taylor", email: "alex@example.test" }
const staff = { id: "staff", name: "Sam", email: "sam@example.test" }
const service = { id: "service", name: "Consultation", durationMinutes: 60, priceCents: 10000, category: { id: "cat", name: "Consultations" }, taxIds: ["tax"], taxMode: "EXCLUSIVE" }
const coupon = { id: "coupon", code: "WELCOME", name: "Welcome offer", discountType: "PERCENT", discountValue: 10, appliesTo: "ORDER", allowedServiceIds: [], allowedCategoryIds: [], allowedProductIds: [], minSubtotalCents: 0, stackingMode: "STACKABLE", isActive: true, validFrom: null, validTo: null, maxUses: null, maxUsesPerCustomer: null, usedCount: 0 }
const order = { id: "order", customerId: customer.id, customer, appointmentDate: "2030-10-03", appointmentStartAt: "2030-10-03T10:00:00+05:30", status: "CONFIRMED", customerNote: "Customer note", internalNote: "Internal note", subtotalCents: 10000, lineDiscountCents: 0, couponDiscountCents: 0, taxCents: 1800, totalCents: 11800, productLines: [], coupons: [], taxes: [{ id: "snapshot", taxId: "tax", name: "GST", percent: 18, taxCents: 1800 }], lines: [{ id: "line", sortOrder: 0, serviceId: service.id, service, staffProfileId: "profile", staffProfile: { id: "profile", user: staff }, quantity: 1, durationMinutes: 60, unitPriceCents: 10000, discountType: "NONE", discountValue: 0, taxIds: ["tax"], taxMode: "EXCLUSIVE", lineSubtotalCents: 10000, lineDiscountCents: 0, lineTaxCents: 1800, lineTotalCents: 11800, startAt: "2030-10-03T10:00:00+05:30", endAt: "2030-10-03T11:00:00+05:30", note: "Line note" }] }
const appointment = { id: "appointment", customer, service, staffProfile: { user: staff }, status: "CONFIRMED", startAt: order.appointmentStartAt, endAt: order.lines[0].endAt, orderLine: { order: { id: "order", status: "CONFIRMED" } } }

async function fixture(page: Page, status = "CONFIRMED") {
  const writes: { path: string; method: string; body: Record<string, unknown> }[] = []
  const queries: URL[] = []
  const state = { conflict: false, missing: false, timeFormat: "H24" }
  await page.route("**/api/**", async route => {
    if (new URL(route.request().url()).pathname === "/api/modules") return route.fulfill({ json: { modules: ["appointments", "services", "inventory"].map(key => ({ key, enabled: true, allowed: true })), permissions: null } })
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

test("booking list uses shared filters, paging and cancellation confirmation", async ({ page }) => {
  const { writes, queries } = await fixture(page)
  await page.goto("/appointments")
  await page.getByRole("button", { name: "Next page" }).click()
  await expect(page.getByText("Page 2 of 4", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Status filter" }).click()
  await page.getByRole("menuitemradio", { name: "Confirmed", exact: true }).click()
  await expect.poll(() => queries.filter(url => url.pathname === "/api/appointments").at(-1)?.searchParams.get("page")).toBe("1")
  await page.getByRole("button", { name: "Alex Taylor", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Appointment info" })).toBeVisible()
  await page.getByRole("button", { name: "Close", exact: true }).first().click()
  await page.getByRole("button", { name: "Record actions" }).click()
  await page.getByRole("menuitem", { name: "Cancel appointment", exact: true }).click()
  expect(writes).toHaveLength(0)
  await page.getByRole("button", { name: "Confirm cancel" }).click()
  await expect.poll(() => writes.length).toBe(1)
  expect(writes[0]).toMatchObject({ path: "/api/appointments/appointment", method: "DELETE" })
  await page.screenshot({ path: test.info().outputPath("appointments-desktop.png"), fullPage: true, animations: "disabled" })
})

test("saved booking is read-only until edit; discard and save preserve prices and line payload", async ({ page }) => {
  const { writes, state } = await fixture(page)
  await page.goto("/appointments/order/edit")
  await expect(page.getByRole("heading", { name: "Booking details" })).toBeVisible()
  await expect(page.getByRole("textbox")).toHaveCount(0)
  await page.getByRole("button", { name: "Edit booking", exact: true }).click()
  await page.getByLabel("Customer note", { exact: true }).fill("Unsaved")
  await page.getByRole("button", { name: "Cancel", exact: true }).click()
  await page.getByRole("button", { name: "Discard changes" }).click()
  expect(writes).toHaveLength(0)
  await page.getByRole("button", { name: "Edit booking", exact: true }).click()
  await expect(page.getByLabel("Customer note", { exact: true })).toHaveValue("Customer note")
  await page.getByLabel("Customer note", { exact: true }).fill("Updated note")
  state.conflict = true
  await page.getByRole("button", { name: "Save changes", exact: true }).click()
  await expect(page.getByRole("alert")).toHaveText("Selected time is unavailable.")
  await expect(page.getByRole("button", { name: "Apply suggested time" })).toBeVisible()
  await page.getByRole("button", { name: "Apply suggested time" }).click()
  state.conflict = false
  await page.getByRole("button", { name: "Save changes", exact: true }).click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  expect(writes[1].body).toMatchObject({ status: "CONFIRMED", customerNote: "Updated note", lines: [{ serviceId: "service", staffId: "staff", unitPriceCents: 10000, taxIds: ["tax"], taxMode: "EXCLUSIVE", quantity: 1, note: "Line note" }] })
  await expect(page.getByText("Updated note", { exact: true })).toBeVisible()
})

test("historical and missing bookings cannot expose edit controls", async ({ page }) => {
  const { writes, state } = await fixture(page, "COMPLETED")
  await page.goto("/appointments/order/edit")
  await expect(page.getByText("This booking is in the past or in a closed status and is read-only.")).toBeVisible()
  await expect(page.getByRole("button", { name: "Edit booking", exact: true })).toHaveCount(0)
  await expect(page.getByRole("textbox")).toHaveCount(0)
  await expect(page.getByText("₹ 118.00", { exact: true })).toHaveCount(2)
  state.missing = true
  await page.reload()
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Booking order not found.")
  await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0)
  expect(writes).toHaveLength(0)
})

test("mobile draft edit keeps both save actions visible and does not confirm on add item", async ({ page }) => {
  const { writes } = await fixture(page, "DRAFT")
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/appointments/order/edit")
  await page.getByRole("button", { name: "Edit booking", exact: true }).click()
  const panel = page.getByRole("dialog", { name: "Edit booking", exact: true })
  await expect.poll(async () => (await panel.boundingBox())?.x).toBe(0)
  await expect(panel.locator("select:visible")).toHaveCount(0)
  await page.getByRole("button", { name: "Add item", exact: true }).click()
  expect(writes).toHaveLength(0)
  await page.getByRole("button", { name: "Remove service item 2", exact: true }).click()
  const save = page.getByRole("button", { name: "Save draft", exact: true })
  const bounds = await save.boundingBox()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844)
  const confirm = await page.getByRole("button", { name: "Confirm booking", exact: true }).boundingBox()
  expect(confirm!.x + confirm!.width).toBeLessThanOrEqual(390)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: test.info().outputPath("booking-mobile.png"), fullPage: true, animations: "disabled" })
  await page.setViewportSize({ width: 320, height: 700 })
  const narrowConfirm = await page.getByRole("button", { name: "Confirm booking", exact: true }).boundingBox()
  expect(narrowConfirm!.x).toBeGreaterThanOrEqual(0)
  expect(narrowConfirm!.x + narrowConfirm!.width).toBeLessThanOrEqual(320)
  await save.click()
  await expect.poll(() => writes.length).toBe(1)
  expect(writes[0].body.status).toBe("DRAFT")
})

test("coupon detail, draft controls and confirmed deletion preserve eligibility payload", async ({ page }) => {
  const { writes } = await fixture(page)
  await page.goto("/appointments/coupons")
  await page.getByRole("button", { name: "WELCOME", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Eligibility", exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Edit details" }).click()
  await page.getByLabel("Name", { exact: true }).fill("Updated offer")
  await expect(page.locator("select:visible")).toHaveCount(0)
  await page.getByRole("button", { name: "Save changes", exact: true }).click()
  await expect.poll(() => writes.length).toBe(1)
  expect(writes[0].body).toMatchObject({ code: "WELCOME", name: "Updated offer", discountValue: 10, discountType: "PERCENT", allowedServiceIds: [], allowedCategoryIds: [], allowedProductIds: [], appliesTo: "ORDER" })
  await page.getByRole("button", { name: "Record actions" }).click()
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click()
  expect(writes).toHaveLength(1)
  await page.getByRole("button", { name: "Delete", exact: true }).click()
  await expect.poll(() => writes.length).toBe(2)
  expect(writes[1].method).toBe("DELETE")
})

test("new booking uses shared 12-hour time controls and saves the correct draft payload", async ({ page }) => {
  const { writes, state } = await fixture(page)
  state.timeFormat = "H12"
  await page.goto("/appointments/new")
  await page.getByLabel("Customer", { exact: true }).click()
  await page.getByRole("option", { name: "Alex Taylor (alex@example.test)", exact: true }).click()
  await page.getByLabel("Date", { exact: true }).fill("2030-10-03")
  await page.getByRole("button", { name: "Hour", exact: true }).click()
  await page.getByRole("menuitemradio", { name: "12", exact: true }).click()
  await page.getByRole("button", { name: "Minute", exact: true }).click()
  await page.getByRole("menuitemradio", { name: "15", exact: true }).click()
  await page.getByRole("button", { name: "AM or PM", exact: true }).click()
  await page.getByRole("menuitemradio", { name: "PM", exact: true }).click()
  // Let the closing menu restore focus before opening the next popover.
  await expect(page.getByRole("button", { name: "AM or PM", exact: true })).toBeFocused()
  await page.getByLabel("Service", { exact: true }).click()
  await page.getByRole("option", { name: "Consultation (60m)", exact: true }).click()
  await page.getByLabel("Attendant", { exact: true }).click()
  await page.getByRole("option", { name: "Sam", exact: true }).click()
  await page.getByRole("button", { name: "Save draft", exact: true }).click()
  await expect.poll(() => writes.length).toBe(1)
  expect(writes[0].body).toMatchObject({ customerId: "customer", appointmentDate: "2030-10-03", appointmentStartTime: "12:15", status: "DRAFT", lines: [{ serviceId: "service", staffId: "staff", taxIds: ["tax"], unitPriceCents: 10000, taxMode: "EXCLUSIVE" }] })
})
