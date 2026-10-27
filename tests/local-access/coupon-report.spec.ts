import { test, expect } from "@playwright/test"
import { seed, login, json } from "./fixtures"

test("coupon report scopes customers, totals, offices and tenant dates after real sign-in", async ({ browser }) => {
  test.setTimeout(150_000)
  const f = await seed(), admin = await login(browser, f.origin, f.users.admin.email)
  let manager: typeof admin | undefined
  try {
    const company = await json(admin.context, "/api/companies", 201, "POST", { name: "Report company", code: "REPORT" })
    const east = await json(admin.context, "/api/offices", 201, "POST", { companyId: company.id, name: "East", code: "EAST" })
    const west = await json(admin.context, "/api/offices", 201, "POST", { companyId: company.id, name: "West", code: "WEST" })
    async function grant(officeIds: string[]) {
      const current = await json(admin.context, `/api/access/users/${f.users.manager.id}/offices`)
      await json(admin.context, `/api/access/users/${f.users.manager.id}/offices`, 200, "PATCH", { version: current.version, officeIds, companies: [], creationOfficeId: officeIds[0] ?? null })
    }
    await grant([east.id])
    const customers = ["Visible coupon customer", "Visible no-coupon customer", "Hidden customer", "Directory only customer"]
    for (const [index, name] of customers.entries()) await f.db.query(`INSERT INTO "User"(id,"tenantId",name,email,role,"updatedAt") VALUES($1,$2,$3,$1||'@example.test','CUSTOMER',now())`, [f.slug + index, f.slug, name])
    for (const [key, customer, office, codes, created] of [
      ["used", 0, east.id, ["SAVE", "VIP"], "2036-02-04T10:00Z"],
      ["plain", 1, east.id, [], "2036-02-04T11:00Z"],
      ["mixed", 1, west.id, ["PRIVATE"], "2036-02-04T10:00Z"],
      ["hidden", 2, west.id, ["SECRET"], "2036-02-04T10:00Z"],
      ["boundary", 0, east.id, ["LATER"], "2036-02-04T18:30Z"],
    ] as const) {
      const orderId = f.slug + key
      await f.db.query(`INSERT INTO "AppointmentOrder"(id,"tenantId","officeId","customerId","appointmentDate","appointmentStartAt","createdAt","updatedAt") VALUES($1,$2,$3,$4,'2038-06-01','2038-06-01T10:00Z',$5,now())`, [orderId, f.slug, office, f.slug + customer, created])
      for (const code of codes) await f.db.query('INSERT INTO "AppointmentOrderCoupon"(id,"orderId",code) VALUES($1,$2,$3)', [orderId + code, orderId, code])
    }
    manager = await login(browser, f.origin, f.users.manager.email, "America/Los_Angeles")
    const page = manager.page
    await page.goto("/reports/coupon-usage")
    await expect(page.getByRole("cell", { name: customers[0], exact: true })).toBeVisible()
    await expect(page.getByRole("status").filter({ hasText: "All readable booking offices" })).toBeVisible()
    await page.getByRole("button", { name: /^Filters/ }).click()
    await page.getByLabel("Date from", { exact: true }).fill("2036-02-04")
    await page.getByLabel("Date to", { exact: true }).fill("2036-02-04")
    await expect(page.getByRole("listbox")).toHaveCount(0)
    await page.keyboard.press("Escape")
    await expect(page.getByRole("heading", { name: "Filters", exact: true })).toHaveCount(0)
    await expect(page.getByRole("cell", { name: "04/02/2036 15:30", exact: true })).toBeVisible()
    await expect(page.getByRole("cell", { name: "SAVE, VIP", exact: true })).toBeVisible()
    await expect(page.getByText("LATER", { exact: true })).toHaveCount(0)
    await expect(page.getByRole("cell", { name: customers[2], exact: true })).toHaveCount(0)
    await expect(page.getByText(customers[3], { exact: true })).toHaveCount(0)
    const metric = (label: string) => page.getByText(label, { exact: true }).locator("..")
    await expect(metric("Customers in report")).toHaveText("Customers in report2")
    await expect(metric("Coupon redemptions")).toHaveText("Coupon redemptions2")
    await page.screenshot({ path: "test-results/local-access/coupon-report-desktop.png", fullPage: true, animations: "disabled" })
    await page.getByLabel("Status", { exact: true }).click()
    await page.getByRole("menuitemradio", { name: "No matching coupon use", exact: true }).click()
    await expect(page.getByRole("cell", { name: customers[1], exact: true })).toBeVisible()
    await expect(page.getByText("PRIVATE", { exact: true })).toHaveCount(0)
    const query = await json(manager.context, "/api/reports/coupon-usage?status=not_used&dateFrom=2036-02-04&dateTo=2036-02-04")
    expect(query.summary).toEqual({ totalCustomers: 2, usedCustomers: 1, notUsedCustomers: 1, totalRedemptions: 2 })
    await grant([east.id, west.id])
    await f.db.query('UPDATE "BusinessOffice" SET archived=true WHERE id=$1', [west.id])
    await page.getByLabel("Status", { exact: true }).click()
    await page.getByRole("menuitemradio", { name: "With matching coupon use", exact: true }).click()
    await page.getByRole("button", { name: /^Filters/ }).click()
    await page.getByLabel("Booking office", { exact: true }).click()
    await page.getByRole("option", { name: "West / Report company (closed)", exact: true }).click()
    await expect(page.getByRole("listbox")).toHaveCount(0)
    await page.keyboard.press("Escape")
    await expect(page.getByRole("heading", { name: "Filters", exact: true })).toHaveCount(0)
    await expect(page.getByRole("status").filter({ hasText: "Report company / West (Closed)" })).toBeVisible()
    await expect(page.getByRole("cell", { name: customers[2], exact: true })).toBeVisible()
    await expect(metric("Coupon redemptions")).toHaveText("Coupon redemptions2")
    await expect(page.getByRole("cell", { name: customers[0], exact: true })).toHaveCount(0)
    await page.setViewportSize({ width: 390, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: "test-results/local-access/coupon-report-mobile.png", fullPage: true, animations: "disabled" })
    await page.getByRole("button", { name: /^Filters/ }).click()
    await expect(page.getByLabel("Booking office", { exact: true })).toContainText("West")
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: "test-results/local-access/coupon-report-mobile-filters.png", fullPage: true, animations: "disabled" })
    await expect(page.getByRole("listbox")).toHaveCount(0)
    await page.keyboard.press("Escape")
    await expect(page.getByRole("heading", { name: "Filters", exact: true })).toHaveCount(0)
    await grant([east.id])
    await page.getByRole("button", { name: "Refresh", exact: true }).click()
    await expect(page.getByRole("main").getByRole("alert")).toHaveText("Booking office access is not permitted.")
    await expect(page.getByRole("cell", { name: customers[2], exact: true })).toHaveCount(0)
    await expect(page.getByText("Customers in report", { exact: true })).toHaveCount(0)
    await page.getByRole("button", { name: /^Filters/ }).click()
    await page.getByRole("button", { name: "Reset filters", exact: true }).click()
    await expect(page.getByRole("status").filter({ hasText: "All readable booking offices" })).toBeVisible()
    await expect(page.getByRole("cell", { name: customers[0], exact: true })).toBeVisible()
    await expect(page.getByRole("cell", { name: customers[2], exact: true })).toHaveCount(0)
  } finally {
    await manager?.context.close(); await admin.context.close(); await f.db.end()
  }
})
