import { test, expect } from "@playwright/test"
import { seed, login, json, password } from "./fixtures"

test("smaller proxy preserves sign-in, signed cookies, tenant boundaries and fresh account status", async ({ browser }) => {
  test.setTimeout(120_000)
  const fixture = await seed()
  const admin = await login(browser, fixture.origin, fixture.users.admin.email)
  const staff = await login(browser, fixture.origin, fixture.users.staff.email)
  const foreign = await login(browser, `http://${fixture.otherSlug}.localhost:3108`, fixture.users.other.email)
  const platform = await login(browser, "http://localhost:3108", fixture.users.platform.email)
  const invalid = await browser.newContext({ baseURL: fixture.origin })
  try {
    const contact = await json(admin.context, "/api/crm/contacts", 201, "POST", { name: "Hosting auth customer" })
    const enquiry = await json(admin.context, "/api/crm/enquiries", 201, "POST", { title: "Hosting auth enquiry", contactId: contact.id, assignedUserId: fixture.users.staff.id })
    await json(staff.context, `/api/crm/enquiries/${enquiry.id}`)
    await json(foreign.context, `/api/crm/enquiries/${enquiry.id}`, 404)
    await json(platform.context, "/api/crm/contacts", 403)
    await platform.page.goto("/settings/roles")
    await expect(platform.page).toHaveURL(/\/settings\/tenants$/)
    await staff.page.goto(`/crm/enquiries/${enquiry.id}`)
    await expect(staff.page.getByRole("heading", { name: "Hosting auth enquiry", exact: true })).toBeVisible()

    // A copied cookie with a broken signature cannot gain API access.
    const cookies = await staff.context.cookies()
    const sessionCookie = cookies.find(cookie => cookie.name.includes("session-token"))
    expect(sessionCookie).toBeTruthy()
    await invalid.addCookies([{ ...sessionCookie!, value: "invalid.signature.token" }])
    await json(invalid, `/api/crm/enquiries/${enquiry.id}`, 401)

    const page = await invalid.newPage()
    await invalid.clearCookies()
    await page.goto("/auth/signin")
    await page.getByLabel("Email", { exact: true }).fill(fixture.users.staff.email)
    await page.getByLabel("Password", { exact: true }).fill(password + "wrong")
    await page.getByRole("button", { name: "Sign in", exact: true }).click()
    await expect(page.getByText("Invalid email or password.", { exact: true })).toBeVisible()

    await json(admin.context, `/api/users/${fixture.users.staff.id}`, 200, "PATCH", { status: "SUSPENDED" })
    await json(staff.context, `/api/crm/enquiries/${enquiry.id}`, 403)
  } finally {
    await Promise.all([admin, staff, foreign, platform].map(actor => actor.context.close()))
    await invalid.close(); await fixture.db.end()
  }
})
