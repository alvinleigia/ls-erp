import { test, expect } from "@playwright/test"
import { seed, login, json } from "./fixtures"

test("dashboard widgets follow module activation, including changes on an open page", async ({ browser }, testInfo) => {
  const fixture = await seed()
  let admin: Awaited<ReturnType<typeof login>> | undefined
  try {
    admin = await login(browser, fixture.origin, fixture.users.admin.email)
    const { page, context } = admin
    await expect(page.getByText("Pending leaves", { exact: true })).toBeVisible()
    await expect(page.getByText("Active services", { exact: true })).toBeVisible()
    await expect(page.getByRole("heading", { name: "Revenue trend", exact: true })).toBeVisible()
    await expect(page.getByRole("heading", { name: "Low stock alerts", exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath("all-modules.png"), fullPage: true })

    for (const [key, label] of [["leaves", "Pending leaves"], ["inventory", "Low stock alerts"], ["services", "Active services"]]) {
      await json(context, "/api/modules", 200, "PATCH", { key, enabled: false })
      await page.evaluate(() => window.dispatchEvent(new Event("business-modules-changed")))
      await expect(page.getByText(label, { exact: true })).toHaveCount(0)
      await expect(page.getByRole("heading", { name: "Revenue trend", exact: true })).toBeVisible()
    }
    await expect(page.getByRole("heading", { name: "Top services", exact: true })).toHaveCount(0)
    await json(context, "/api/modules", 200, "PATCH", { key: "appointments", enabled: false })
    await page.evaluate(() => window.dispatchEvent(new Event("business-modules-changed")))
    await expect(page.getByText("No dashboard summaries available for your current modules.")).toBeVisible()
    for (const label of ["Revenue", "Unique customers", "Pending leaves", "Revenue trend", "Appointment status mix", "Daily bookings", "Staff load", "Upcoming appointments", "Low stock alerts", "Top services", "Active services"]) {
      await expect(page.getByText(label, { exact: true })).toHaveCount(0)
    }
    await expect(page.getByRole("button", { name: "Custom date range" })).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath("crm-only.png"), fullPage: true })

    await json(context, "/api/modules", 200, "PATCH", { key: "leaves", enabled: true })
    await page.getByRole("button", { name: "Refresh", exact: true }).click()
    await expect(page.getByText("Pending leaves", { exact: true })).toBeVisible()
    await expect(page.getByText("No dashboard summaries available for your current modules.")).toHaveCount(0)
    await expect(page.getByRole("heading", { name: "Revenue trend", exact: true })).toHaveCount(0)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: testInfo.outputPath("leaves-only-mobile.png"), fullPage: true })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  } finally {
    await admin?.context.close()
    await fixture.db.end()
  }
})
