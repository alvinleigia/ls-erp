import { test, expect, type Page } from "@playwright/test"

const summary = {
  range: { label: "This week", startDate: "2030-10-07", endDate: "2030-10-13" },
  kpis: { revenueCents: 123400, revenueTodayCents: 30000, appointments: 7, appointmentsToday: 2, distinctCustomers: 5, pendingLeaves: 1, activeServices: 4, activeStaff: 3 },
  series: { daily: [{ date: "2030-10-07", label: "Mon", revenueCents: 123400, bookings: 7 }] },
  appointmentStatus: [{ status: "CONFIRMED", count: 7 }],
  topServices: [{ serviceId: "service", name: "Consultation", bookings: 7, revenueCents: 123400 }],
  staffUtilization: [{ staffProfileId: "staff", name: "Sam", bookings: 7, bookedMinutes: 120, utilizationPercent: 25 }],
  upcomingAppointments: [{ id: "appointment", startAt: "2030-10-08T10:00:00Z", status: "CONFIRMED", customerName: "Alex", staffName: "Sam", serviceName: "Consultation", priceCents: 30000 }],
  lowStock: [], generatedAt: "2030-10-07T10:00:00Z",
}
const audit = { id: "audit", event: "leave.request.reviewed", entityType: "LeaveRequest", entityId: "leave", actorUserId: "admin", actorName: "Manager", actorEmail: "manager@example.test", actorRole: "MANAGER", requestId: "request-123", metadata: { source: "UI", message: "x".repeat(300) }, before: { status: "PENDING" }, after: { status: "APPROVED" }, createdAt: "2030-10-07T10:00:00Z" }
async function fixture(page: Page) {
  const queries: URL[] = [], writes: string[] = []
  const state = { fail: false, empty: false, detailDenied: false }
  await page.route("**/api/**", async route => {
    if (new URL(route.request().url()).pathname === "/api/modules") return route.fulfill({ json: { modules: ["appointments", "services", "inventory"].map(key => ({ key, enabled: true, allowed: true })), permissions: null } })
    const url = new URL(route.request().url()); queries.push(url)
    if (route.request().method() !== "GET") { writes.push(url.pathname); return route.fulfill({ status: 405, json: { error: "Read only" } }) }
    if (url.pathname.startsWith("/api/settings")) return route.fulfill({ json: { settings: { currency: "INR", locale: "en-IN", numberFormat: "US_UK", dateFormat: "dd/MM/yyyy", timeZone: "Asia/Kolkata" } } })
    if (url.pathname === "/api/reports/audit-logs/audit") return state.detailDenied ? route.fulfill({ status: 404, json: { error: "Audit entry not found or no longer accessible." } }) : route.fulfill({ json: { ...audit, changes: [{ field: "status", before: "PENDING", after: "APPROVED" }] } })
    if (state.fail) return route.fulfill({ status: 503, json: { error: "Report temporarily unavailable." } })
    if (url.pathname === "/api/dashboard/summary") return route.fulfill({ json: { ...summary, range: { ...summary.range, startDate: url.searchParams.get("startDate") || summary.range.startDate, endDate: url.searchParams.get("endDate") || summary.range.endDate } } })
    const row = url.pathname.endsWith("audit-logs") ? audit : { customerId: "customer", customerName: "Alex", customerEmail: "alex@example.test", customerPhone: null, customerStatus: "ACTIVE", couponUsageCount: 2, distinctCouponCount: 1, usedCouponCodes: ["SAVE10"], lastCouponUsedAt: "2030-10-07T10:00:00Z" }
    return route.fulfill({ json: { canReviewSecurity: true, items: state.empty ? [] : [row], total: state.empty ? 0 : 25, totalPages: state.empty ? 1 : 3, page: Number(url.searchParams.get("page") || 1), pageSize: Number(url.searchParams.get("pageSize") || 10), summary: { totalCustomers: 25, usedCustomers: 10, notUsedCustomers: 15, totalRedemptions: 30 } } })
  })
  return { queries, state, writes }
}

test("dashboard keeps server metrics and applies only complete custom periods", async ({ page }) => {
  const { queries, writes } = await fixture(page)
  await page.goto("/dashboard")
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible()
  await expect(page.getByRole("region", { name: "Top services", exact: true })).toContainText("1,234.00")
  await expect(page.getByRole("region", { name: "Staff load", exact: true })).toContainText("2h 0m booked (25%)")
  await page.getByRole("button", { name: "Period", exact: true }).click()
  await page.getByRole("menuitemradio", { name: "This month", exact: true }).click()
  await expect.poll(() => queries.filter(url => url.pathname === "/api/dashboard/summary").at(-1)?.searchParams.get("range")).toBe("month")
  await page.getByRole("button", { name: "Custom date range" }).click()
  await page.getByLabel("From", { exact: true }).fill("2030-10-01")
  await expect(page.getByLabel("From", { exact: true })).toHaveValue("2030-10-01")
  expect(queries.some(url => url.searchParams.get("range") === "custom")).toBe(false)
  await page.getByLabel("To", { exact: true }).fill("2030-10-10")
  await expect.poll(() => queries.at(-1)?.searchParams.get("endDate")).toBe("2030-10-10")
  expect(queries.at(-1)?.searchParams.get("startDate")).toBe("2030-10-01")
  await page.keyboard.press("Escape")
  await expect(page.getByRole("region", { name: "Revenue trend" })).toBeVisible()
  const pie = page.getByRole("region", { name: "Appointment status mix" }).locator(".recharts-sector")
  await expect(pie).toBeVisible()
  let previous = "", stableSamples = 0
  await expect.poll(async () => {
    const charts = await page.locator(".recharts-surface").evaluateAll(nodes => nodes.map(node => node.outerHTML).join(""))
    stableSamples = charts === previous ? stableSamples + 1 : 0
    previous = charts
    return stableSamples
  }, { intervals: [300], timeout: 10000 }).toBeGreaterThanOrEqual(3)
  await page.screenshot({ path: test.info().outputPath("dashboard-desktop.png"), fullPage: true, animations: "disabled" })
  expect(writes).toEqual([])
})

test("dashboard failure hides stale widgets and refresh recovers on mobile", async ({ page }) => {
  const { state } = await fixture(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/dashboard")
  await expect(page.getByRole("region", { name: "Top services" })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  state.fail = true
  await page.getByRole("button", { name: "Refresh", exact: true }).click()
  await expect(page.getByRole("alert").filter({ hasText: "Report temporarily unavailable." })).toBeVisible()
  await expect(page.getByRole("region", { name: "Top services" })).toHaveCount(0)
  state.fail = false
  await page.getByRole("button", { name: "Refresh", exact: true }).click()
  await expect(page.getByRole("region", { name: "Upcoming appointments" })).toBeVisible()
  await page.getByRole("button", { name: "Custom date range" }).click()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: test.info().outputPath("dashboard-mobile-period.png"), animations: "disabled" })
})

test("coupon report preserves filters, resets pages and distinguishes load errors from empty results", async ({ page }) => {
  const { queries, state } = await fixture(page)
  await page.goto("/reports/coupon-usage")
  await expect(page.getByRole("cell", { name: "Alex", exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Next page" }).click()
  await expect.poll(() => queries.at(-1)?.searchParams.get("page")).toBe("2")
  await page.getByLabel("Status", { exact: true }).click()
  await page.getByRole("menuitemradio", { name: "Not used coupons", exact: true }).click()
  await expect.poll(() => queries.at(-1)?.searchParams.get("status")).toBe("not_used")
  expect(queries.at(-1)?.searchParams.get("page")).toBe("1")
  await page.getByRole("button", { name: "Filters", exact: true }).click()
  await page.getByLabel("Coupon code", { exact: true }).fill("SAVE10")
  await page.getByLabel("Date from", { exact: true }).fill("2030-10-01")
  await page.getByLabel("Date to", { exact: true }).fill("2030-10-10")
  await expect.poll(() => queries.at(-1)?.searchParams.get("dateTo")).toBe("2030-10-10")
  expect(queries.at(-1)?.searchParams.get("couponCode")).toBe("SAVE10")
  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: "Rows per page" }).click()
  await page.getByRole("menuitemradio", { name: "20 / page", exact: true }).click()
  await expect.poll(() => queries.at(-1)?.searchParams.get("pageSize")).toBe("20")
  expect(queries.at(-1)?.searchParams.get("page")).toBe("1")
  await page.screenshot({ path: test.info().outputPath("coupon-report-desktop.png"), animations: "disabled" })
  state.fail = true
  await page.getByRole("button", { name: "Refresh" }).click()
  await expect(page.getByRole("alert").filter({ hasText: "Report temporarily unavailable." })).toBeVisible()
  await expect(page.getByText("All customers have used coupons.")).toHaveCount(0)
  state.fail = false; state.empty = true
  await page.getByRole("button", { name: "Refresh" }).click()
  await expect(page.getByText("All customers have used coupons.")).toBeVisible()
  await expect(page.getByRole("navigation", { name: "Pagination" })).toHaveCount(0)
})

test("audit filters and read-only snapshots work in a narrow panel with fixed close actions", async ({ page }) => {
  const { queries, writes } = await fixture(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/reports/audit-logs")
  await page.getByRole("button", { name: "Filters", exact: true }).click()
  await page.getByLabel("Entity type", { exact: true }).fill("LeaveRequest")
  await page.getByLabel("Request ID", { exact: true }).fill("request-123")
  await expect.poll(() => queries.at(-1)?.searchParams.get("requestId")).toBe("request-123")
  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: "View", exact: true }).click()
  await expect(page.getByRole("region", { name: "Changed fields", exact: true })).toContainText("APPROVED")
  await page.getByText("Recorded snapshots", { exact: true }).click()
  await expect(page.getByRole("region", { name: "Before", exact: true })).toContainText("PENDING")
  await expect(page.getByRole("region", { name: "After", exact: true })).toContainText("APPROVED")
  await expect(page.getByRole("dialog").getByRole("textbox")).toHaveCount(0)
  const close = page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).first()
  await expect(close).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: test.info().outputPath("audit-mobile.png"), animations: "disabled" })
  await close.click()
  await page.getByRole("button", { name: /Filters/ }).click()
  await page.getByRole("button", { name: "Reset filters" }).click()
  await expect.poll(() => queries.at(-1)?.searchParams.has("requestId")).toBe(false)
  expect(writes).toEqual([])
})

test("audit security/actor filters reset pagination and a revoked detail clears prior snapshots", async ({ page }) => {
 const { queries, state } = await fixture(page)
 await page.goto("/reports/audit-logs")
 await page.getByRole("button", { name: "Next page" }).click()
 await expect.poll(() => queries.at(-1)?.searchParams.get("page")).toBe("2")
 await page.getByRole("button", { name: "Event category" }).click()
 await page.getByRole("menuitemradio", { name: "Security events", exact: true }).click()
 await expect.poll(() => queries.at(-1)?.searchParams.get("category")).toBe("security")
 expect(queries.at(-1)?.searchParams.get("page")).toBe("1")
 await page.getByRole("button", { name: "Filters", exact: true }).click()
 await page.getByLabel("Actor ID", { exact: true }).fill("manager-id")
 await page.getByLabel("Record ID", { exact: true }).fill("record-id")
 await expect.poll(() => queries.at(-1)?.searchParams.get("entityId")).toBe("record-id")
 expect(queries.at(-1)?.searchParams.get("actorUserId")).toBe("manager-id")
 await page.keyboard.press("Escape")
 await page.getByRole("button", { name: "View", exact: true }).click()
 await expect(page.getByRole("region", { name: "Changed fields" })).toContainText("APPROVED")
 await page.screenshot({ path: test.info().outputPath("audit-changes-desktop.png"), fullPage: true, animations: "disabled" })
 state.detailDenied = true
 await page.getByRole("button", { name: "Reload entry", exact: true }).click()
 await expect(page.getByRole("alert")).toContainText("no longer accessible")
 await expect(page.getByRole("region", { name: "Changed fields" })).toHaveCount(0)
 await expect(page.getByText("APPROVED", { exact: true })).toHaveCount(0)
})
