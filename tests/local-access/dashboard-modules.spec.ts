import { test, expect } from "@playwright/test"
import { seed, login, json } from "./fixtures"
import { emptyQuotationContent } from "../../modules/sales-documents/quotation-validation"

test("dashboard widgets follow module activation, including changes on an open page", async ({ browser }, testInfo) => {
  const fixture = await seed()
  let admin: Awaited<ReturnType<typeof login>> | undefined
  try {
    admin = await login(browser, fixture.origin, fixture.users.admin.email)
    const { page, context } = admin
    const project = await json(context, "/api/real-estate/projects", 201, "POST", { name: "Green Meadows", code: "DASH", location: "Pune", currency: "INR" })
    const contact = await json(context, "/api/crm/contacts", 201, "POST", { name: "Dashboard buyer" })
    const pipeline = await json(context, "/api/crm/pipelines", 201, "POST", { name: "Property sales", stages: [
      { name: "Proposal", kind: "OPEN", probability: 60, color: "#123456" },
      { name: "Won", kind: "WON", probability: 100, color: "#008800" },
      { name: "Lost", kind: "LOST", probability: 0, color: "#880000" },
    ] })
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date())
    const deal = await json(context, "/api/crm/opportunities", 201, "POST", { title: "Green Meadows apartment", contactId: contact.id, assignedUserId: fixture.users.admin.id, pipelineId: pipeline.id, stageId: pipeline.stages[0].id, amount: "5000000", currency: "INR", expectedCloseOn: day, propertyContext: { projectId: project.id } })
    await json(context, `/api/crm/opportunities/${deal.id}/quotations`, 201, "POST", { content: { ...structuredClone(emptyQuotationContent), title: "Apartment offer", supplierName: "Local Developer", currency: "INR", bookingDate: day, lines: [{ description: "Apartment", quantity: "1", rate: "5000000", unit: "" }], instalments: [{ label: "Booking", percent: "100", days: 1, note: "" }] } })
    const activityType = await json(context, "/api/crm/activity-types", 201, "POST", { name: "Site Visit", baseType: "MEETING" })
    const visit = await json(context, "/api/crm/work", 201, "POST", { title: "Visit Green Meadows", type: "MEETING", activityTypeId: activityType.id, contactId: contact.id, opportunityId: deal.id, assignedUserId: fixture.users.admin.id, dueOn: day })
    await json(context, `/api/crm/work/${visit.id}/complete`, 200, "POST", { version: visit.version, outcome: "HELD", summary: "Viewed apartment", occurredAt: new Date().toISOString() })
    await page.getByRole("button", { name: "Refresh", exact: true }).click()
    await expect(page.getByRole("heading", { name: "Payment Plans", exact: true })).toBeVisible()
    await expect(page.getByRole("region", { name: "Completed activities by type", exact: true }).getByText("Site Visit", { exact: true })).toBeVisible()
    const summary = await json(context, "/api/dashboard/summary?range=week")
    expect(summary.sales.quotations.total).toBe(1)
    expect(summary.sales.paymentPlans.upcomingCount).toBe(1)
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
    await expect(page.getByRole("heading", { name: "CRM and sales", exact: true })).toBeVisible()
    for (const label of ["Revenue", "Unique customers", "Pending leaves", "Revenue trend", "Appointment status mix", "Daily bookings", "Staff load", "Upcoming appointments", "Low stock alerts", "Top services", "Active services"]) {
      await expect(page.getByText(label, { exact: true })).toHaveCount(0)
    }
    await page.screenshot({ path: testInfo.outputPath("crm-only.png"), fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: testInfo.outputPath("sales-mobile.png"), fullPage: true })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    for (const [key, heading] of [["paymentPlans", "Payment Plans"], ["salesDocuments", "Sales Documents"], ["realEstate", "Real Estate"], ["crm", "CRM and sales"]]) {
      await json(context, "/api/modules", 200, "PATCH", { key, enabled: false })
      await page.evaluate(() => window.dispatchEvent(new Event("business-modules-changed")))
      await expect(page.getByRole("heading", { name: heading, exact: true })).toHaveCount(0)
      await expect(page.getByRole("status")).toHaveCount(0)
    }
    await expect(page.getByText("No dashboard summaries available for your current modules.")).toBeVisible()

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
