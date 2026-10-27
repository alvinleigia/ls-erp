import { test, expect, type Page } from "@playwright/test"
import { readFile } from "node:fs/promises"
import { seed, login, json, assignOffices, password } from "./fixtures"
import { allPermissions } from "@/platform/access/catalog"
import { defaultRecordRules, supportedScopes } from "@/platform/access/rules"

test.use({ actionTimeout: 15_000 })
async function pick(page: Page, label: string, name: string) {
  const field = page.getByRole("combobox", { name: label, exact: true });await field.click()
  await page.getByPlaceholder("Type to search...").fill(name);await page.getByRole("option", { name: new RegExp(name) }).click();await expect(page.getByRole("listbox")).toHaveCount(0)
}
async function setup(browser: Parameters<typeof login>[0]) {
  const f = await seed(), admin = await login(browser, f.origin, f.users.admin.email), office = (await json(admin.context, "/api/offices")).items[0]
  for (const u of [f.users.admin, f.users.manager, f.users.staff]) await assignOffices(admin.context, u.id, [office.id], office.id)
  await json(admin.context, "/api/modules", 200, "PATCH", { key: "realEstate", enabled: false })
  const agency = await json(admin.context, "/api/collaborators", 201, "POST", { name: "Activity Alpha Agency", code: "ACT_ALPHA", supervisorUserId: f.users.manager.id })
  const rules = defaultRecordRules();for (const key of Object.keys(rules) as (keyof typeof rules)[]) if (supportedScopes(key.split(".")[0] as Parameters<typeof supportedScopes>[0]).includes("ALL")) rules[key] = "ALL"
  const profile = await json(admin.context, "/api/access/roles", 201, "POST", { name: "Activity reporting", permissions: allPermissions.filter(p => ["dashboard", "contacts", "enquiries", "opportunities", "activities", "activityTypes", "reports", "pipelines"].includes(p.split(".")[0])) })
  for (const id of [f.users.manager.id, f.users.staff.id]) { const p = await json(admin.context, `/api/access/users/${id}`);await json(admin.context, `/api/access/users/${id}`, 200, "PATCH", { version: p.accessPolicy.version, roleIds: [profile.id], rules: { ...rules, ...(id === f.users.staff.id ? { "enquiries.read": "OWN", "opportunities.read": "OWN", "reports.read": "OWN" } : {}) } }) }
  const email = `activity-partner@${f.slug}.test`, partner = (await json(admin.context, "/api/users", 200, "POST", { name: "Activity Partner", email, password, role: "STAFF", collaboratorId: agency.id, accessRoleIds: [profile.id], recordRules: rules })).user
  await assignOffices(admin.context, partner.id, [office.id], office.id)
  const contact = await json(admin.context, "/api/crm/contacts", 201, "POST", { name: "Activity buyer" })
  const source = await json(admin.context, "/api/crm/enquiries", 201, "POST", { title: "Admin-owned Alpha source", contactId: contact.id, assignedUserId: f.users.admin.id, introducedByCollaboratorId: agency.id })
  const ordinary = await json(admin.context, "/api/crm/enquiries", 201, "POST", { title: "Staff-owned ordinary source", contactId: contact.id, assignedUserId: f.users.staff.id })
  const create = (title: string, assignedUserId: string, enquiryId?: string) => json(admin.context, "/api/crm/work", 201, "POST", { title, type: "TASK", contactId: contact.id, assignedUserId, dueOn: "2020-01-01", ...(enquiryId ? { enquiryId } : {}) })
  const internal = await create("Internal Alpha task", f.users.staff.id, source.id), external = await create("External Alpha task", partner.id, source.id)
  const completed = await create("External completed Alpha", partner.id, source.id)
  await json(admin.context, `/api/crm/work/${completed.id}/complete`, 200, "POST", { version: completed.version, outcome: "DONE", summary: "Synthetic completion by admin", occurredAt: new Date().toISOString() })
  await create("Internal ordinary task", f.users.staff.id, ordinary.id)
  return { f, admin, agency, partner, email, profile, internal, external, source, rules }
}

test("activity type/origin filters preserve totals, current assignee credit, paged links and the actual CSV download", async ({ browser }) => {
  test.setTimeout(150_000)
  const s = await setup(browser), viewer = await login(browser, s.f.origin, s.f.users.manager.email), { page } = viewer
  try {
    await page.goto("/crm/overview");await page.getByRole("button", { name: "Scope", exact: true }).click();await page.getByRole("menuitemradio", { name: "All accessible work", exact: true }).click()
    await expect(page.getByRole("link", { name: /Open activities\s*3/ })).toBeVisible()
    await page.getByRole("button", { name: "Filters", exact: true }).click();await page.getByLabel("Assigned user type", { exact: true }).click();await page.getByRole("menuitemradio", { name: "External collaborators", exact: true }).click()
    await pick(page, "Introducing collaborator", "Activity Alpha Agency");await page.getByRole("heading", { name: "Activity overview", exact: true }).click()
    await expect(page.getByRole("link", { name: /Open activities\s*1/ })).toBeVisible();await expect(page.getByRole("link", { name: /Completed in period\s*1/ }).first()).toBeVisible()
    await expect(page.getByRole("row").filter({ hasText: "Activity Partner" })).toContainText("External collaborator")
    await page.getByRole("link", { name: /Open activities\s*1/ }).click();await expect(page).toHaveURL(/responsibleType=external/);await expect(page).toHaveURL(new RegExp(`introducedByCollaboratorId=${s.agency.id}`))
    await expect(page.getByRole("link", { name: "External Alpha task", exact: true })).toBeVisible();await expect(page.getByRole("link", { name: "Internal Alpha task", exact: true })).toHaveCount(0)
    const download = page.waitForEvent("download");await page.getByRole("button", { name: "Export CSV", exact: true }).click();const file = await download, body = await readFile((await file.path())!, "utf8")
    expect(body).toContain("External Alpha task");expect(body).not.toContain("External completed Alpha");expect(body).not.toContain("Internal Alpha task")
    await page.screenshot({ path: "test-results/local-access/activity-partner-drilldown.png", fullPage: true, animations: "disabled" })
  } finally { await viewer.context.close();await s.admin.context.close();await s.f.db.end() }
})

test("source-hidden staff cannot discover partner attribution and a stale report clears on current authority loss", async ({ browser }) => {
  test.setTimeout(120_000)
  const s = await setup(browser), viewer = await login(browser, s.f.origin, s.f.users.staff.email), { page, context } = viewer
  try {
    const tasks = await json(context, "/api/crm/work?scope=mine");expect(tasks.items.find((r: { id: string }) => r.id === s.internal.id).parent).toBeNull()
    const filtered = await json(context, `/api/crm/reports/activities?introducedByCollaboratorId=${s.agency.id}`);expect(filtered.totals.open).toBe(0)
    const choices = await json(context, `/api/crm/reports/activity-attribution-choices?scope=mine&choice=partner&selectedId=${s.agency.id}`);expect(choices.total).toBe(0)
    await page.goto("/crm/overview");await expect(page.getByRole("link", { name: /Open activities\s*2/ })).toBeVisible()
    const current = await json(s.admin.context, `/api/access/users/${s.f.users.staff.id}`);await json(s.admin.context, `/api/access/users/${s.f.users.staff.id}`, 200, "PATCH", { version: current.accessPolicy.version, roleIds: [], rules: current.accessPolicy.rules })
    await page.getByRole("button", { name: "Refresh", exact: true }).click();await expect(page.getByRole("alert").filter({ hasText: "does not permit" })).toBeVisible();await expect(page.getByRole("link", { name: /Open activities/ })).toHaveCount(0)
  } finally { await viewer.context.close();await s.admin.context.close();await s.f.db.end() }
})

test("archived partner choices remain source-backed and generic activity filters fit mobile with reachable final controls", async ({ browser }) => {
  test.setTimeout(120_000)
  const s = await setup(browser), { page, context } = s.admin
  try {
    await json(context, `/api/collaborators/${s.agency.id}`, 200, "PATCH", { version: s.agency.version, archived: true })
    await page.goto("/crm/overview");await page.getByRole("button", { name: "Scope", exact: true }).click();await page.getByRole("menuitemradio", { name: "All accessible work", exact: true }).click()
    await page.setViewportSize({ width: 390, height: 844 });await page.getByRole("button", { name: "Filters", exact: true }).click();await pick(page, "Introducing collaborator", "Activity Alpha Agency")
    await page.getByLabel("Supervisor at introduction", { exact: true }).scrollIntoViewIfNeeded();await expect(page.getByRole("dialog", { name: "Filters", exact: true })).toBeInViewport({ ratio: 1 })
    await page.screenshot({ path: "test-results/local-access/activity-attribution-filters-mobile.png", fullPage: false, animations: "disabled" })
    await page.getByRole("heading", { name: "Activity overview", exact: true }).click();await expect(page.getByRole("link", { name: /Open activities\s*2/ })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: "test-results/local-access/activity-attribution-mobile.png", fullPage: true, animations: "disabled" })
    await page.setViewportSize({ width: 1280, height: 900 });await page.screenshot({ path: "test-results/local-access/activity-attribution-desktop.png", fullPage: true, animations: "disabled" })
  } finally { await context.close();await s.f.db.end() }
})
