import { test, expect } from "@playwright/test"

test.beforeEach(async ({ request }) => {
  const session = await (await request.get("/api/auth/session")).json()
  test.skip(session.user?.role !== "STAFF", "Use a saved staff login for staff-access checks.")
})

test("staff can open assigned work with business formatting but cannot reassign it", async ({ page, request }, info) => {
  const response = await request.get("/api/crm/work?scope=mine&state=open&pageSize=1")
  expect(response.status()).toBe(200)
  const record = (await response.json()).items[0]
  test.skip(!record, "Assign an open activity to the staff test user first.")
  const failures: string[] = []
  page.on("response", response => {
    if (response.url().includes("/api/") && response.status() >= 400) failures.push(`${new URL(response.url()).pathname}: ${response.status()}`)
  })
  const display = page.waitForResponse(response => new URL(response.url()).pathname === "/api/settings/display")
  await page.goto(`/crm/activities/${record.id}`)
  const displayResponse = await display
  expect(displayResponse.status()).toBe(200)
  const { settings } = await displayResponse.json()
  await expect(page.getByRole("heading", { name: record.title, exact: true })).toBeVisible()
  await expect(page.locator("#work-title")).toHaveValue(record.title)
  await expect(page.locator("#work-title")).toBeEnabled()
  await expect(page.locator("#work-assignee")).toBeDisabled()
  await expect(page.getByText(`Schedule a specific time (${settings.timeZone})`, { exact: true })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Activity history and internal notes", exact: true })).toBeVisible()
  expect(failures).toEqual([])
  await page.screenshot({ path: info.outputPath("staff-activity.png"), fullPage: true })
  // Staff may read display preferences, but administrative settings stay blocked.
  expect((await request.get("/api/settings")).status()).toBe(401)
})

for (const route of ["/crm/activities/new", "/crm/activity-plans/apply", "/crm/opportunities/new"]) {
  test(`staff display preferences load on ${route}`, async ({ page }) => {
    const preferences = page.waitForResponse(response => new URL(response.url()).pathname === "/api/settings/display")
    const adminRequests: string[] = []
    page.on("request", request => { if (new URL(request.url()).pathname === "/api/settings") adminRequests.push(request.url()) })
    await page.goto(route)
    expect((await preferences).status()).toBe(200)
    await expect(page.getByText("Unauthorized", { exact: true })).toHaveCount(0)
    expect(adminRequests).toEqual([])
  })
}

test("temporarily disabled staff calendar offers My Work without loading the scheduler", async ({ page }) => {
  test.skip(process.env.NEXT_PUBLIC_ENABLE_CALENDAR_VIEWS === "true", "Calendar views explicitly re-enabled for this build.")
  await page.goto("/crm/calendar")
  await expect(page).toHaveTitle("Leiweissen ERP")
  await expect(page.getByRole("status").filter({ hasText: "Calendar view is temporarily unavailable." })).toBeVisible()
  await expect(page.getByRole("main").getByRole("link", { name: "My Work", exact: true })).toBeVisible()
  await expect(page.locator(".e-schedule")).toHaveCount(0)
  await expect(page.getByText(/This application was built using a trial version/)).toHaveCount(0)
})
