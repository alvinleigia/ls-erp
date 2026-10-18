import { test, expect } from "@playwright/test"
import { seed, login, json } from "./fixtures"

test("archive confirmation copy refreshes without changing the draft or sending a write", async ({ browser }, testInfo) => {
  const fixture = await seed(), { context, page } = await login(browser, fixture.origin, fixture.users.admin.email)
  async function rename(labels: Record<string, string | null>) {
    const current = await json(context, "/api/settings/terminology")
    await json(context, "/api/settings/terminology", 200, "PATCH", { version: current.version, changes: Object.entries(labels).map(([key, label]) => ({ key, label })) })
    await page.evaluate(() => window.dispatchEvent(new Event("terminology-changed")))
  }
  try {
    const contact = await json(context, "/api/crm/contacts", 201, "POST", { name: "Original contact", email: "copy@example.test" })
    await page.goto(`/crm/contacts/${contact.id}`)
    await rename({ "crm.contact.singular": "Person", "crm.contact.plural": "People", "crm.enquiry.plural": "Prospects" })
    await page.getByRole("button", { name: "Edit person details", exact: true }).click()
    const editor = page.getByRole("dialog")
    await expect(editor.getByText("Basic information and Person status.", { exact: true })).toBeVisible()
    await editor.getByRole("button", { name: "Person status", exact: true }).click()
    await page.getByRole("menuitemradio", { name: "Archived", exact: true }).click()
    await expect(editor.getByText("Archived People keep their history. Restore to Active to create new Prospects.", { exact: true })).toBeVisible()
    await editor.getByRole("button", { name: "Save changes", exact: true }).click()
    const confirmation = page.getByRole("dialog", { name: "Archive this Person?", exact: true })
    await expect(confirmation).toBeVisible()
    let writes = 0
    page.on("request", request => { if (request.url().endsWith(`/api/crm/contacts/${contact.id}`) && request.method() === "PATCH") writes++ })
    await rename({ "crm.contact.singular": "Buyer", "crm.enquiry.plural": "Leads" })
    const updated = page.getByRole("dialog", { name: "Archive this Buyer?", exact: true })
    await expect(updated.getByText("Existing Leads and history will be kept. New Leads cannot be created until the Buyer is restored.", { exact: true })).toBeVisible()
    expect(writes).toBe(0)
    expect((await json(context, `/api/crm/contacts/${contact.id}`)).archived).toBe(false)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: testInfo.outputPath("archive-mobile.png"), fullPage: true, animations: "disabled" })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await updated.getByRole("button", { name: "Archive Buyer", exact: true }).click()
    await expect(page.getByText("Buyer saved.", { exact: true })).toBeVisible()
    expect((await json(context, `/api/crm/contacts/${contact.id}`))).toMatchObject({ name: "Original contact", archived: true })
    expect(writes).toBe(1)
    await page.goto("/crm/accounts/new")
    await rename({ "crm.account.singular": "Company" })
    await page.getByLabel("Company name", { exact: true }).fill("Unsaved company")
    await rename({ "crm.account.singular": "Organization" })
    await expect(page.getByLabel("Organization name", { exact: true })).toHaveValue("Unsaved company")
    await rename({ "crm.account.singular": null })
    await expect(page.getByLabel("Company name", { exact: true })).toHaveValue("Unsaved company")
  } finally { await context.close(); await fixture.db.end() }
})
