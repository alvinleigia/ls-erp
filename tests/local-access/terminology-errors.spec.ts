import { test, expect } from "@playwright/test"
import { seed, login, json } from "./fixtures"

test("error responses use only the caller's active terminology and retain validation paths/status", async ({ browser }) => {
  const fixture = await seed(), admin = await login(browser, fixture.origin, fixture.users.admin.email)
  const other = await login(browser, `http://${fixture.otherSlug}.localhost:3108`, fixture.users.other.email)
  try {
    const current = await json(admin.context, "/api/settings/terminology")
    const labels = { "crm.contact.singular": "Buyer", "crm.opportunity.singular": "Deal", "crm.activity.singular": "Touchpoint", "realEstate.project.singular": "Estate", "salesDocuments.quotation.singular": "Offer" }
    await json(admin.context, "/api/settings/terminology", 200, "PATCH", { version: current.version, changes: Object.entries(labels).map(([key, label]) => ({ key, label })) })
    for (const [url, message] of [
      ["/api/crm/contacts/missing", "Buyer not found."], ["/api/crm/opportunities/missing", "Deal not found."],
      ["/api/crm/work/missing", "Touchpoint not found."], ["/api/real-estate/projects/missing", "Estate not found."],
      ["/api/crm/quotations/missing", "Offer not found."],
    ]) expect((await json(admin.context, url, 404)).error).toBe(message)
    expect((await json(other.context, "/api/crm/contacts/missing", 404)).error).toBe("Contact not found.")
    const invalid = await json(admin.context, "/api/crm/enquiries", 400, "POST", { title: "Invalid", assignedUserId: fixture.users.admin.id })
    expect(invalid.error).toBe("Please check the highlighted fields.")
    expect(invalid.details.fieldErrors.contactId).toEqual(["Choose an existing Buyer or enter a new Buyer."])
    const mixed = await json(admin.context, "/api/crm/work", 400, "POST", { title: "Invalid", type: "TASK", dueOn: "2030-01-01", assignedUserId: fixture.users.admin.id, contactId: "contact", enquiryId: "lead", opportunityId: "deal" })
    expect(mixed.details.fieldErrors.opportunityId).toEqual(["Link either an enquiry or a Deal."])
    const contact = await json(admin.context, "/api/crm/contacts", 201, "POST", { name: "Literal Contact", email: "history-labels@example.test" })
    const work = await json(admin.context, "/api/crm/work", 201, "POST", { title: "Literal Activity", type: "TASK", dueOn: "2030-01-01", assignedUserId: fixture.users.admin.id, contactId: contact.id })
    const history = await json(admin.context, `/api/crm/work/${work.id}/history`)
    await admin.page.goto(`/crm/activities/${work.id}`)
    await admin.page.getByRole("tab", { name: "History and notes", exact: true }).click()
    await expect(admin.page.getByText("scheduled a Touchpoint", { exact: true })).toBeVisible()
    expect(await json(admin.context, `/api/crm/work/${work.id}/history`)).toEqual(history)
    await json(admin.context, "/api/modules", 200, "PATCH", { key: "realEstate", enabled: false })
    expect((await json(admin.context, "/api/real-estate/projects/missing", 403)).error).toBe("Real Estate is not enabled for this business.")
  } finally { await admin.context.close(); await other.context.close(); await fixture.db.end() }
})

test("a delayed failed load uses the latest labels without restarting the request", async ({ browser }) => {
  const fixture = await seed(), { context, page } = await login(browser, fixture.origin, fixture.users.admin.email)
  try {
    const contact = await json(context, "/api/crm/contacts", 201, "POST", { name: "Contact", email: "delayed-labels@example.test" })
    let requests = 0
    let release!: () => void, arrived!: () => void
    const held = new Promise<void>(resolve => { release = resolve }), started = new Promise<void>(resolve => { arrived = resolve })
    await page.route(`**/api/crm/contacts/${contact.id}`, async route => { requests++; arrived(); await held; await route.fulfill({ status: 500, json: {} }) })
    await page.goto(`/crm/contacts/${contact.id}`)
    await started
    const current = await json(context, "/api/settings/terminology")
    await json(context, "/api/settings/terminology", 200, "PATCH", { version: current.version, changes: [{ key: "crm.contact.singular", label: "Individual" }] })
    await page.evaluate(() => window.dispatchEvent(new Event("terminology-changed")))
    await expect(page.getByText("Loading Individual…", { exact: true })).toBeVisible()
    release()
    await expect(page.getByRole("alert").filter({ hasText: "Unable to load Individual." })).toBeVisible()
    expect(requests).toBe(1)
  } finally { await context.close(); await fixture.db.end() }
})

test("renaming during an edit preserves the draft and the conflict protection", async ({ browser }, testInfo) => {
  const fixture = await seed(), { context, page } = await login(browser, fixture.origin, fixture.users.admin.email)
  try {
    const contact = await json(context, "/api/crm/contacts", 201, "POST", { name: "Original contact", email: "conflict-terms@example.test" })
    await page.goto(`/crm/contacts/${contact.id}`)
    await page.getByRole("button", { name: "Edit contact details", exact: true }).click()
    const editor = page.getByRole("dialog")
    await editor.getByLabel("Full name", { exact: true }).fill("Unsaved draft")
    await json(context, `/api/crm/contacts/${contact.id}`, 200, "PATCH", { name: "Changed elsewhere", email: contact.email, version: contact.version, archived: false })
    let reloads = 0
    page.on("request", request => { if (request.url().endsWith(`/api/crm/contacts/${contact.id}`) && request.method() === "GET") reloads++ })
    const current = await json(context, "/api/settings/terminology")
    await json(context, "/api/settings/terminology", 200, "PATCH", { version: current.version, changes: [{ key: "crm.contact.singular", label: "Buyer" }] })
    await page.evaluate(() => window.dispatchEvent(new Event("terminology-changed")))
    await expect(editor.getByText("Buyer details", { exact: true })).toBeVisible()
    await expect(editor.getByLabel("Full name", { exact: true })).toHaveValue("Unsaved draft")
    expect(reloads).toBe(0)
    await editor.getByRole("button", { name: "Save changes", exact: true }).click()
    await expect(editor.getByRole("alert")).toContainText("This Buyer changed. Refresh before saving.")
    await expect(editor.getByLabel("Full name", { exact: true })).toHaveValue("Unsaved draft")
    expect((await json(context, `/api/crm/contacts/${contact.id}`)).name).toBe("Changed elsewhere")
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: testInfo.outputPath("conflict-mobile.png"), fullPage: true, animations: "disabled" })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  } finally { await context.close(); await fixture.db.end() }
})
