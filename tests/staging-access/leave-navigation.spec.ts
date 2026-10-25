import { test, expect } from "@playwright/test"
import { seed, login } from "./fixtures"

test("admin leave navigation redirects without employee-only requests; eligible staff keep personal access", async ({ browser }, info) => {
  const fixture = await seed(), admin = await login(browser, fixture.origin, fixture.users.admin.email), staff = await login(browser, fixture.origin, fixture.users.staff.email)
  try {
    const adminRequests: string[] = []
    admin.page.on("request", r => { const u = new URL(r.url()); if (u.pathname === "/api/leaves/request-options" || u.pathname === "/api/leaves/requests" && u.searchParams.get("mineOnly") === "true") adminRequests.push(u.pathname) })
    const approvals = admin.page.waitForResponse(r => new URL(r.url()).pathname === "/api/leaves/requests" && r.status() === 200)
    await admin.page.goto("/leaves/requests")
    await expect(admin.page).toHaveURL(/\/leaves\/approvals$/)
    await approvals
    await expect(admin.page.getByRole("heading", { name: "Leave Approvals", exact: true })).toBeVisible()
    expect(adminRequests).toEqual([])
    const options = staff.page.waitForResponse(r => new URL(r.url()).pathname === "/api/leaves/request-options")
    await staff.page.goto("/leaves/requests")
    expect((await options).status()).toBe(200)
    await expect(staff.page).toHaveURL(/\/leaves\/requests$/)
    await staff.page.setViewportSize({ width: 390, height: 844 })
    expect(await staff.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await staff.page.screenshot({ path: info.outputPath("staff-personal-leaves-mobile.png"), fullPage: true })
  } finally { await admin.context.close(); await staff.context.close(); await fixture.db.end() }
})
