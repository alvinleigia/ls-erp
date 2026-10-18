import { test, expect } from "@playwright/test"
import { seed, login, json } from "./fixtures"

test.describe.configure({ mode: "serial" })
let fixture: Awaited<ReturnType<typeof seed>>
let admin: Awaited<ReturnType<typeof login>>, manager: typeof admin
test.beforeAll(async ({ browser }) => {
  fixture = await seed()
  admin = await login(browser, fixture.origin, fixture.users.admin.email)
  manager = await login(browser, fixture.origin, fixture.users.manager.email)
})
test.afterAll(async () => { await admin?.context.close(); await manager?.context.close(); await fixture?.db.end() })

test("administrator edits, validates and resets labels using shared desktop and mobile controls", async ({}, testInfo) => {
  await admin.page.goto("/settings/terminology")
  await expect(admin.page.getByRole("heading", { name: "Terminology", exact: true })).toBeVisible()
  const singular = admin.page.getByLabel("Enquiry", { exact: true }), plural = admin.page.getByLabel("Enquiries", { exact: true })
  await expect(singular).toHaveAttribute("placeholder", "Enquiry")
  await singular.fill("Lead"); await plural.fill("Leads")
  await admin.page.getByRole("button", { name: "Save terminology", exact: true }).click()
  await expect(admin.page.getByText("Terminology saved.", { exact: true })).toBeVisible()
  await admin.page.reload(); await expect(singular).toHaveValue("Lead")
  await singular.fill("Contact")
  await admin.page.getByRole("button", { name: "Save terminology", exact: true }).click()
  await expect(admin.page.getByRole("alert").filter({ hasText: "already used" })).toBeVisible()
  expect((await json(admin.context, "/api/settings/terminology")).labels["crm.enquiry.singular"]).toBe("Lead")
  await admin.page.getByRole("button", { name: "Refresh terminology", exact: true }).click()
  await expect(singular).toHaveValue("Lead")
  await expect(admin.page.getByRole("button", { name: "Refresh terminology", exact: true })).toHaveCount(0)
  await admin.page.screenshot({ path: testInfo.outputPath("terminology-desktop.png"), fullPage: true })
  await admin.page.setViewportSize({ width: 390, height: 844 })
  expect(await admin.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await admin.page.screenshot({ path: testInfo.outputPath("terminology-mobile.png"), fullPage: true })
  await admin.page.getByRole("button", { name: "Reset Enquiry to default", exact: true }).click()
  await admin.page.getByRole("button", { name: "Reset Enquiries to default", exact: true }).click()
  await admin.page.getByRole("button", { name: "Save terminology", exact: true }).click()
  await expect(singular).toHaveValue("")
  await expect(admin.page.getByRole("button", { name: "Save terminology", exact: true })).toBeDisabled()
  expect((await json(admin.context, "/api/settings/terminology")).labels["crm.enquiry.singular"]).toBe("Enquiry")
})

test("manager cannot open the administrator form or save by calling its API", async () => {
  await manager.page.goto("/settings/terminology")
  await expect(manager.page.getByRole("heading", { name: "Access unavailable" })).toBeVisible()
  const current = await json(manager.context, "/api/settings/terminology")
  expect(current.canManage).toBe(false)
  await json(manager.context, "/api/settings/terminology", 403, "PATCH", { version: current.version, changes: [{ key: "crm.enquiry.singular", label: "Forbidden" }] })
})

test("module deactivation hides controls and rejects a stale module edit while retaining saved labels", async () => {
  const current = await json(admin.context, "/api/settings/terminology")
  const saved = await json(admin.context, "/api/settings/terminology", 200, "PATCH", { version: current.version, changes: [{ key: "realEstate.project.singular", label: "Development" }] })
  await json(admin.context, "/api/modules", 200, "PATCH", { key: "realEstate", enabled: false })
  await admin.page.reload()
  await expect(admin.page.getByRole("heading", { name: "CRM", exact: true })).toBeVisible()
  await expect(admin.page.getByLabel("Project", { exact: true })).toHaveCount(0)
  await json(admin.context, "/api/settings/terminology", 403, "PATCH", { version: saved.version, changes: [{ key: "realEstate.project.singular", label: "Forbidden" }] })
  await json(admin.context, "/api/modules", 200, "PATCH", { key: "realEstate", enabled: true })
  await admin.page.reload()
  await expect(admin.page.getByLabel("Project", { exact: true })).toHaveValue("Development")
})
