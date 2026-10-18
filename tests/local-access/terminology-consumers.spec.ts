import { test, expect } from "@playwright/test"
import { seed, login, json } from "./fixtures"

test.describe.configure({ mode: "serial" })
let fixture: Awaited<ReturnType<typeof seed>>
let admin: Awaited<ReturnType<typeof login>>, other: typeof admin
async function rename(labels: Record<string, string | null>) {
  const current = await json(admin.context, "/api/settings/terminology")
  return json(admin.context, "/api/settings/terminology", 200, "PATCH", {
    version: current.version, changes: Object.entries(labels).map(([key, label]) => ({ key, label })),
  })
}
const refresh = () => admin.page.evaluate(() => window.dispatchEvent(new Event("terminology-changed")))
test.beforeAll(async ({ browser }) => {
  fixture = await seed()
  admin = await login(browser, fixture.origin, fixture.users.admin.email)
  other = await login(browser, `http://${fixture.otherSlug}.localhost:3108`, fixture.users.other.email)
})
test.afterAll(async () => { await admin?.context.close(); await other?.context.close(); await fixture?.db.end() })

test("shared labels reach navigation, lists and forms without per-row or navigation refetches", async ({}, testInfo) => {
  const contact = await json(admin.context, "/api/crm/contacts", 201, "POST", { name: "Contact name stays unchanged", email: "terminology@example.test" })
  await json(admin.context, "/api/crm/enquiries", 201, "POST", { title: "Enquiry title stays unchanged", contactId: contact.id, assignedUserId: fixture.users.admin.id })
  await rename({ "crm.enquiry.singular": "Prospect", "crm.enquiry.plural": "Prospects", "crm.contact.singular": "Person", "crm.contact.plural": "People", "crm.opportunity.singular": "Deal", "crm.opportunity.plural": "Deals", "realEstate.project.plural": "Developments" })
  await admin.page.goto("/crm/enquiries")
  await expect(admin.page.getByRole("heading", { name: "Prospects", exact: true })).toBeVisible()
  await expect(admin.page.getByRole("link", { name: "Prospects", exact: true })).toBeVisible()
  await expect(admin.page.getByRole("columnheader", { name: "Prospect", exact: true })).toBeVisible()
  await expect(admin.page.getByRole("columnheader", { name: "Person", exact: true })).toBeVisible()
  await expect(admin.page.getByRole("link", { name: "Enquiry title stays unchanged", exact: true })).toBeVisible()
  await expect(admin.page.getByText("Contact name stays unchanged", { exact: true })).toBeVisible()
  await admin.page.screenshot({ path: testInfo.outputPath("renamed-list.png"), fullPage: true })
  let reads = 0
  admin.page.on("request", request => { if (request.url().endsWith("/api/settings/terminology")) reads++ })
  await admin.page.getByRole("link", { name: "New Prospect", exact: true }).click()
  await expect(admin.page.getByRole("heading", { name: "New Prospect", exact: true })).toBeVisible()
  await expect(admin.page.getByRole("button", { name: "Save Prospect", exact: true })).toBeVisible()
  await admin.page.getByText("Prospect details", { exact: true }).click()
  await expect(admin.page.getByLabel("Prospect title", { exact: true })).toBeVisible()
  expect(reads).toBe(0)
  await admin.page.setViewportSize({ width: 390, height: 844 })
  expect(await admin.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await admin.page.screenshot({ path: testInfo.outputPath("renamed-form-mobile.png"), fullPage: true })
  await admin.page.setViewportSize({ width: 1280, height: 900 })
  await admin.page.goto("/crm/opportunities")
  await expect(admin.page.getByRole("heading", { name: "Deals", exact: true })).toBeVisible()
  await expect(admin.page.getByRole("link", { name: "New Deal", exact: true })).toBeVisible()
  await admin.page.goto("/crm/projects")
  await expect(admin.page.getByRole("heading", { name: "Developments", exact: true })).toBeVisible()
  await other.page.goto("/crm/enquiries")
  await expect(other.page.getByRole("heading", { name: "Enquiries", exact: true })).toBeVisible()
  await expect(other.page.getByRole("link", { name: "New enquiry", exact: true })).toBeVisible()
})

test("refresh and reset preserve open form sections and unsaved values", async () => {
  await admin.page.goto("/crm/contacts/new")
  await expect(admin.page.getByRole("heading", { name: "New Person", exact: true })).toBeVisible()
  await admin.page.getByLabel("Full name", { exact: true }).fill("Unsaved Contact draft")
  await rename({ "crm.contact.singular": "Individual" }); await refresh()
  await expect(admin.page.getByRole("heading", { name: "New Individual", exact: true })).toBeVisible()
  await expect(admin.page.getByLabel("Full name", { exact: true })).toBeVisible()
  await expect(admin.page.getByLabel("Full name", { exact: true })).toHaveValue("Unsaved Contact draft")
  await expect(admin.page.getByRole("button", { name: "Save Individual", exact: true })).toBeVisible()
  await rename({ "crm.contact.singular": null }); await refresh()
  await expect(admin.page.getByRole("heading", { name: "New contact", exact: true })).toBeVisible()
  await expect(admin.page.getByLabel("Full name", { exact: true })).toHaveValue("Unsaved Contact draft")
})

test("failed refresh falls back to defaults and focus recovers without changing the draft", async () => {
  await rename({ "crm.contact.singular": "Person" }); await refresh()
  await expect(admin.page.getByRole("heading", { name: "New Person", exact: true })).toBeVisible()
  await admin.page.route("**/api/settings/terminology", route => route.fulfill({ status: 403, json: { error: "Access changed" } }))
  await refresh()
  await expect(admin.page.getByRole("heading", { name: "New contact", exact: true })).toBeVisible()
  await expect(admin.page.getByLabel("Full name", { exact: true })).toHaveValue("Unsaved Contact draft")
  await admin.page.unroute("**/api/settings/terminology")
  await admin.page.evaluate(() => window.dispatchEvent(new Event("focus")))
  await expect(admin.page.getByRole("heading", { name: "New Person", exact: true })).toBeVisible()
  await expect(admin.page.getByLabel("Full name", { exact: true })).toBeVisible()
})

test("renamed summary edit actions open the matching section and retain drawer drafts", async () => {
  const contact = await json(admin.context, "/api/crm/contacts", 201, "POST", { name: "Original contact", email: "drawer@example.test" })
  await admin.page.goto(`/crm/contacts/${contact.id}`)
  await admin.page.getByRole("button", { name: "Edit person details", exact: true }).click()
  const dialog = admin.page.getByRole("dialog")
  await expect(dialog.getByLabel("Full name", { exact: true })).toBeVisible()
  await dialog.getByLabel("Full name", { exact: true }).fill("Unsaved drawer draft")
  await rename({ "crm.contact.singular": "Individual" }); await refresh()
  await expect(dialog.getByText("Individual details", { exact: true })).toBeVisible()
  await expect(dialog.getByLabel("Full name", { exact: true })).toBeVisible()
  await expect(dialog.getByLabel("Full name", { exact: true })).toHaveValue("Unsaved drawer draft")
  expect((await json(admin.context, `/api/crm/contacts/${contact.id}`)).name).toBe("Original contact")
})
