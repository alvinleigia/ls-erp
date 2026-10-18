import { test, expect, type Page } from "@playwright/test"
import { seed, login, json } from "./fixtures"

async function select(page: Page, label: string, option: string) {
  await page.getByLabel(label, { exact: true }).click()
  await page.getByRole("menuitemradio", { name: option, exact: true }).click()
}

test("custom-field resource labels and team context preserve saved definitions", async ({ browser }, testInfo) => {
  const fixture = await seed(), { context, page } = await login(browser, fixture.origin, fixture.users.admin.email)
  try {
    const team = await json(context, "/api/crm/sales-teams", 201, "POST", { name: "Field team" })
    await page.goto("/crm/configuration/custom-fields/new")
    await page.getByLabel("Name", { exact: true }).fill("Land reference")
    await page.getByLabel("Field code", { exact: true }).fill("land_reference")
    await page.getByLabel("Sales team", { exact: true }).click()
    await page.getByRole("option", { name: "Field team", exact: true }).click()
    await select(page, "Applies to", "Projects")
    await expect(page.getByLabel("Sales team", { exact: true })).toHaveCount(0)
    const terms = await json(context, "/api/settings/terminology")
    await json(context, "/api/settings/terminology", 200, "PATCH", { version: terms.version, changes: [{ key: "realEstate.project.plural", label: "Developments" }] })
    await page.evaluate(() => window.dispatchEvent(new Event("terminology-changed")))
    await expect(page.getByLabel("Applies to", { exact: true })).toContainText("Developments")
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Land reference")
    await page.screenshot({ path: testInfo.outputPath("resource-field-form.png"), fullPage: true, animations: "disabled" })
    const saved = page.waitForResponse(r => new URL(r.url()).pathname === "/api/crm/custom-fields" && r.request().method() === "POST")
    await page.getByRole("button", { name: "Save field", exact: true }).click()
    const response = await saved
    expect(response.status()).toBe(201)
    expect(response.request().postDataJSON()).toMatchObject({ scope: "PROJECT", salesTeamId: null, code: "land_reference" })
    const field = await response.json()
    await expect(page.getByRole("cell", { name: "Developments", exact: true })).toBeVisible()
    await json(context, "/api/crm/custom-fields", 400, "POST", { name: "Invalid team field", code: "bad_team", type: "TEXT", scope: "PROJECT", salesTeamId: team.id })
    await json(context, "/api/modules", 200, "PATCH", { key: "realEstate", enabled: false })
    await page.reload()
    await expect(page.getByRole("link", { name: "Land reference", exact: true })).toHaveCount(0)
    await page.getByRole("link", { name: "New field", exact: true }).click()
    await page.getByLabel("Applies to", { exact: true }).click()
    await expect(page.getByRole("menuitemradio", { name: "Projects", exact: true })).toHaveCount(0)
    await expect(page.getByRole("menuitemradio", { name: "Developments", exact: true })).toHaveCount(0)
    await expect(page.getByRole("menuitemradio", { name: "Enquiries", exact: true })).toBeVisible()
    await page.keyboard.press("Escape")
    await json(context, `/api/crm/custom-fields/${field.id}`, 404)
    await json(context, "/api/modules", 200, "PATCH", { key: "realEstate", enabled: true })
    const restored = await json(context, `/api/crm/custom-fields/${field.id}`)
    expect(restored).toMatchObject({ id: field.id, code: "land_reference", scope: "PROJECT", version: field.version, salesTeamId: null })
  } finally { await context.close(); await fixture.db.end() }
})

test("shared exports enforce record and report permissions across module screens", async ({ browser }) => {
  const fixture = await seed(), admin = await login(browser, fixture.origin, fixture.users.admin.email)
  const manager = await login(browser, fixture.origin, fixture.users.manager.email)
  try {
    const reads = ["dashboard.read", "contacts.read", "enquiries.read", "opportunities.read", "pipelines.read", "activities.read", "reports.read", "projects.read"]
    let role = await json(admin.context, "/api/access/roles", 201, "POST", { name: "Export checks", permissions: reads, crmRecordScope: "ALL" })
    await json(admin.context, `/api/access/users/${fixture.users.manager.id}`, 200, "PATCH", { roleId: role.id, previousRoleId: null })
    const page = manager.page
    const button = page.getByRole("button", { name: "Export CSV", exact: true })
    async function permissions(extra: string[]) {
      role = await json(admin.context, `/api/access/roles/${role.id}`, 200, "PATCH", { name: role.name, version: role.version, permissions: [...reads, ...extra], crmRecordScope: "ALL" })
      const refreshed = page.waitForResponse(r => new URL(r.url()).pathname === "/api/modules")
      await page.evaluate(() => window.dispatchEvent(new Event("business-modules-changed")))
      await refreshed
    }
    await json(admin.context, "/api/real-estate/projects", 201, "POST", { name: "Export project", code: "EXPORT" })
    for (const [path, permission, endpoint] of [
      ["/crm/enquiries", "enquiries.export", "/api/crm/enquiries/export"],
      ["/crm/opportunities", "opportunities.export", "/api/crm/opportunities/export"],
      ["/crm/projects", "projects.export", "/api/real-estate/projects/export"],
    ]) {
      await permissions([])
      await page.goto(path)
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
      await expect(button).toHaveCount(0)
      expect((await manager.context.request.get(endpoint)).status()).toBe(403)
      await permissions([permission])
      await expect(button).toBeVisible()
      if (permission === "projects.export") {
        const download = page.waitForEvent("download")
        await button.click()
        expect((await download).suggestedFilename()).toBe("projects.csv")
      }
    }
    await permissions(["reports.export"])
    await page.goto("/crm/sales")
    await expect(page.getByLabel("Report records", { exact: true })).toBeVisible()
    await expect(button).toHaveCount(0)
    await permissions(["enquiries.export"])
    await expect(button).toHaveCount(0)
    await permissions(["reports.export", "enquiries.export"])
    await expect(button).toBeVisible()
    await select(page, "Report records", "Open opportunities")
    await expect(button).toHaveCount(0)
    await permissions(["reports.export", "opportunities.export"])
    await expect(button).toBeVisible()
    await select(page, "Report records", "Overdue follow-ups")
    await expect(button).toHaveCount(0)
    await permissions(["reports.export", "activities.export"])
    await expect(button).toBeVisible()
    await permissions([])
    await expect(button).toHaveCount(0)
  } finally { await admin.context.close(); await manager.context.close(); await fixture.db.end() }
})
