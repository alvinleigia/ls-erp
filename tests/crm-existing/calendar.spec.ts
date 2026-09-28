import { test, expect } from "@playwright/test"
import { verifyLogin } from "./fixture"

test.beforeEach(async ({ request }, info) => {
  test.skip(process.env.CRM_VERIFY_CALENDAR_ENABLED !== "1", "Run after deploying with licensed calendars enabled.")
  await verifyLogin(request, String(info.project.metadata.role))
})

test("licensed CRM calendar renders for the existing user", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  await page.goto("/crm/calendar")
  await expect(page.locator(".e-schedule")).toBeVisible()
  await page.waitForLoadState("networkidle")
  await expect(page.getByText(/This application was built using a trial version/i)).toHaveCount(0)
  expect(errors).toEqual([])
})

test("roster can mount and remount its resource calendar without premature binding", async ({ page }, info) => {
  test.skip(info.project.metadata.role !== "ADMIN", "Roster administration is checked with the manager session.")
  const errors: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  // Mount while the staff request is still in flight, then deliver the actual
  // response. This exercises resource initialization without changing data.
  let releaseStaff!: () => void
  const staffReady = new Promise<void>(resolve => { releaseStaff = resolve })
  await page.route("**/api/users?role=STAFF&pageSize=100", async route => {
    await staffReady
    await route.continue()
  })
  await page.goto("/shifts/roster")
  for (let iteration = 0; iteration < 2; iteration++) {
    await page.getByRole("button", { name: "Calendar", exact: true }).click()
    await expect(page.locator(".e-schedule")).toBeVisible()
    releaseStaff()
    await page.waitForLoadState("networkidle")
    await expect(page.locator(".e-resource-cells").first()).toBeVisible()
    await expect(page.getByText(/This application was built using a trial version/i)).toHaveCount(0)
    expect(errors).toEqual([])
    if (iteration === 0) await page.getByRole("button", { name: "Grid", exact: true }).click()
  }
  await page.screenshot({ path: info.outputPath("licensed-roster.png"), fullPage: true })
})
