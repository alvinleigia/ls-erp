import { test, expect, type BrowserContext } from "@playwright/test"
import { seed, login, json } from "./fixtures"
test.use({ actionTimeout: 15_000 })

test("office ownership survives actual form submission, a stale tab and shared record requests", async ({ browser }) => {
  test.setTimeout(150_000)
  const fixture = await seed(), admin = await login(browser, fixture.origin, fixture.users.admin.email)
  let staff: Awaited<ReturnType<typeof login>> | undefined
  async function choose(officeId: string) {
    const p = await json(admin.context, "/api/workspace/office")
    return json(admin.context, "/api/workspace/office", 200, "PATCH", { version: p.version, officeId })
  }
  async function create(context: BrowserContext, data: unknown, status = 201, explicit = true) {
    const p = await json(context, "/api/workspace/office")
    const response = await context.request.post("/api/crm/enquiries", { data, headers: explicit ? { "x-office-id": p.creationOffice.id, "x-office-version": String(p.version) } : {} })
    expect(response.status(), await response.text()).toBe(status)
    return response.json()
  }
  try {
    const company = await json(admin.context, "/api/companies", 201, "POST", { name: "Office browser checks", code: "BROWSER" })
    const a = await json(admin.context, "/api/offices", 201, "POST", { name: "East", code: "EAST", companyId: company.id })
    const b = await json(admin.context, "/api/offices", 201, "POST", { name: "West", code: "WEST", companyId: company.id })
    await choose(a.id)
    const path = `/api/access/users/${fixture.users.staff.id}/offices`
    await json(admin.context, path, 200, "PATCH", { version: 0, officeIds: [a.id], companies: [], creationOfficeId: a.id })
    const contact = await json(admin.context, "/api/crm/contacts", 201, "POST", { name: "Office browser customer" })
    const east = await create(admin.context, { title: "Browser East", contactId: contact.id, assignedUserId: fixture.users.staff.id })
    expect(east.officeId).toBe(a.id)
    await create(admin.context, { title: "No context", contactId: contact.id, assignedUserId: fixture.users.admin.id }, 403, false)
    await choose(b.id)
    const west = await create(admin.context, { title: "Browser West", contactId: contact.id, assignedUserId: fixture.users.admin.id })
    staff = await login(browser, fixture.origin, fixture.users.staff.email)
    await json(staff.context, `/api/crm/enquiries/${east.id}`)
    await json(staff.context, `/api/crm/enquiries/${west.id}`, 404)
    expect((await json(staff.context, "/api/crm/enquiries")).items.map((r: { id: string }) => r.id)).toEqual([east.id])

    // Use the real form's captured context. A second tab selects another office.
    await choose(a.id)
    const captured = admin.page.waitForResponse(r => new URL(r.url()).pathname === "/api/workspace/office" && r.request().method() === "GET")
    await admin.page.goto(`/crm/enquiries/new?contactId=${contact.id}`)
    await captured
    await admin.page.getByText("Enquiry details", { exact: true }).click()
    await admin.page.getByLabel("Enquiry title", { exact: true }).fill("Stale office browser draft")
    await choose(b.id)
    const rejected = admin.page.waitForResponse(r => new URL(r.url()).pathname === "/api/crm/enquiries" && r.request().method() === "POST")
    await admin.page.getByRole("button", { name: "Save enquiry", exact: true }).click()
    const response = await rejected
    expect(response.status()).toBe(409)
    expect(response.request().headers()["x-office-id"]).toBe(a.id)
    await expect(admin.page.getByText("Office context changed; reload the creation form.", { exact: true })).toBeVisible()
    expect((await json(admin.context, "/api/crm/enquiries?q=Stale%20office%20browser%20draft")).total).toBe(0)

    // Reload captures the new office; a successful save persists that office.
    const recaptured = admin.page.waitForResponse(r => new URL(r.url()).pathname === "/api/workspace/office" && r.request().method() === "GET")
    admin.page.once("dialog", dialog => dialog.accept())
    await admin.page.reload(); await recaptured
    await admin.page.getByText("Enquiry details", { exact: true }).click()
    await admin.page.getByLabel("Enquiry title", { exact: true }).fill("Fresh office browser draft")
    const saved = admin.page.waitForResponse(r => new URL(r.url()).pathname === "/api/crm/enquiries" && r.request().method() === "POST")
    await admin.page.getByRole("button", { name: "Save enquiry", exact: true }).click()
    const result = await saved
    expect(result.status(), await result.text()).toBe(201)
    expect((await result.json()).officeId).toBe(b.id)
    await admin.page.waitForURL(/\/crm\/enquiries\/[^/]+$/)
    await expect(admin.page.getByRole("heading", { name: "Fresh office browser draft", exact: true })).toBeVisible()
    await admin.page.screenshot({ path: test.info().outputPath("office-record-creation.png"), fullPage: true, animations: "disabled" })
    await json(staff.context, `/api/crm/enquiries/${west.id}`, 404)
  } finally { await staff?.context.close(); await admin.context.close(); await fixture.db.end() }
})
