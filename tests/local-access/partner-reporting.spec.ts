import { test, expect, type Page } from "@playwright/test"
import { seed, login, json, assignOffices, password } from "./fixtures"
import { allPermissions } from "@/platform/access/catalog"
import { defaultRecordRules, supportedScopes } from "@/platform/access/rules"

test.use({ actionTimeout: 15_000 })
async function pick(page: Page, label: string, name: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click()
  await page.getByPlaceholder("Type to search...").fill(name)
  await page.getByRole("option", { name: new RegExp(name) }).click()
  await expect(page.getByRole("listbox")).toHaveCount(0)
}
async function setup(browser: Parameters<typeof login>[0]) {
  const f = await seed(), admin = await login(browser, f.origin, f.users.admin.email)
  const office = (await json(admin.context, "/api/offices")).items[0]
  for (const user of [f.users.admin, f.users.manager, f.users.staff]) await assignOffices(admin.context, user.id, [office.id], office.id)
  await json(admin.context, "/api/modules", 200, "PATCH", { key: "realEstate", enabled: false })
  const a = await json(admin.context, "/api/collaborators", 201, "POST", { name: "UI Alpha Agency", code: "UI_ALPHA", supervisorUserId: f.users.manager.id })
  const b = await json(admin.context, "/api/collaborators", 201, "POST", { name: "UI Beta Agency", code: "UI_BETA", supervisorUserId: f.users.admin.id })
  const contact = await json(admin.context, "/api/crm/contacts", 201, "POST", { name: "UI reporting buyer" })
  const pipeline = await json(admin.context, "/api/crm/pipelines", 201, "POST", { name: "UI reporting pipeline", stages: [{ name: "Open", kind: "OPEN", probability: 10, color: "#123456" }, { name: "Won", kind: "WON", probability: 100, color: "#00aa00" }, { name: "Lost", kind: "LOST", probability: 0, color: "#aa0000" }] })
  const rules = defaultRecordRules()
  for (const key of Object.keys(rules) as (keyof typeof rules)[]) if (supportedScopes(key.split(".")[0] as Parameters<typeof supportedScopes>[0]).includes("ALL")) rules[key] = "ALL"
  const profile = await json(admin.context, "/api/access/roles", 201, "POST", { name: "UI partner sales", permissions: allPermissions.filter(p => ["dashboard", "contacts", "enquiries", "opportunities", "pipelines", "reports", "activities"].includes(p.split(".")[0])) })
  const email = `partner@${f.slug}.test`, partner = (await json(admin.context, "/api/users", 200, "POST", { name: "UI Partner", email, password, role: "STAFF", collaboratorId: a.id, accessRoleIds: [profile.id], recordRules: rules })).user
  await assignOffices(admin.context, partner.id, [office.id], office.id)
  const membership = await json(admin.context, `/api/access/users/${f.users.manager.id}`)
  await json(admin.context, `/api/access/users/${f.users.manager.id}`, 200, "PATCH", { version: membership.accessPolicy.version, roleIds: [profile.id], rules })
  return { f, admin, office, a, b, contact, pipeline, partner, email }
}

test("admin creation and conversion show immutable introduction evidence in generic CRM, including archived-choice errors and mobile", async ({ browser }) => {
  test.setTimeout(180_000)
  const s = await setup(browser), { page, context } = s.admin
  try {
    await page.goto(`/crm/enquiries/new?contactId=${s.contact.id}`)
    await page.getByText("Enquiry details", { exact: true }).click();await page.getByLabel("Enquiry title", { exact: true }).fill("UI introduced enquiry")
    await page.getByText("Introducing collaborator", { exact: true }).click();await pick(page, "Introducing collaborator (optional)", "UI Alpha Agency")
    const saved = page.waitForResponse(r => r.url().endsWith("/api/crm/enquiries") && r.request().method() === "POST")
    await page.getByRole("button", { name: "Save enquiry", exact: true }).click();const lead = await (await saved).json()
    await expect(page).toHaveURL(new RegExp(`/crm/enquiries/${lead.id}$`));await expect(page.getByText("UI Alpha Agency (UI_ALPHA)", { exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "Edit introducing collaborator", exact: true })).toHaveCount(0)
    await page.goto(`/crm/opportunities/new?enquiryId=${lead.id}`)
    await page.getByLabel("Expected close date", { exact: true }).fill("2030-01-01")
    await page.getByText("Introducing collaborator", { exact: true }).click();await expect(page.getByText("UI Alpha Agency (UI_ALPHA)", { exact: true })).toBeVisible();await expect(page.getByRole("combobox", { name: "Introducing collaborator (optional)", exact: true })).toHaveCount(0)
    await page.getByRole("button", { name: "Save opportunity", exact: true }).click();await expect(page).toHaveURL(/\/crm\/opportunities\/(?!new)[^/]+$/)
    await expect(page.getByText("UI Alpha Agency (UI_ALPHA)", { exact: true })).toBeVisible()
    await page.goto("/crm/opportunities/new");await page.getByLabel("Opportunity title", { exact: true }).fill("UI direct introduction");await pick(page, "Contact", "UI reporting buyer");await page.getByLabel("Expected close date", { exact: true }).fill("2030-01-01")
    await page.getByText("Introducing collaborator", { exact: true }).click();await pick(page, "Introducing collaborator (optional)", "UI Beta Agency")
    await page.getByRole("button", { name: "Save opportunity", exact: true }).click();await expect(page).toHaveURL(/\/crm\/opportunities\/(?!new)[^/]+$/)
    await expect(page.getByText("UI Beta Agency (UI_BETA)", { exact: true })).toBeVisible()
    await page.goto(`/crm/enquiries/new?contactId=${s.contact.id}`);await page.getByText("Enquiry details", { exact: true }).click();await page.getByLabel("Enquiry title", { exact: true }).fill("Preserved rejected introduction")
    await page.getByText("Introducing collaborator", { exact: true }).click();await pick(page, "Introducing collaborator (optional)", "UI Beta Agency")
    await json(context, `/api/collaborators/${s.b.id}`, 200, "PATCH", { version: s.b.version, archived: true })
    await page.getByRole("button", { name: "Save enquiry", exact: true }).click();await expect(page.getByRole("alert").filter({ hasText: "Choose an active introducing collaborator" })).toBeVisible()
    await page.getByText("Enquiry details", { exact: true }).click();await expect(page.getByLabel("Enquiry title", { exact: true })).toHaveValue("Preserved rejected introduction")
    await page.setViewportSize({ width: 390, height: 844 });await page.getByText("Introducing collaborator", { exact: true }).click();await expect(page.getByRole("combobox", { name: "Introducing collaborator (optional)", exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: "test-results/local-access/partner-introduction-mobile.png", fullPage: true, animations: "disabled" })
  } finally { await context.close();await s.f.db.end() }
})

test("an external login creates its own introduction without loading the admin directory or offering a partner selector", async ({ browser }) => {
  test.setTimeout(120_000)
  const s = await setup(browser), partner = await login(browser, s.f.origin, s.email), { page, context } = partner
  try {
    const requests: string[] = [];page.on("request", request => { if (new URL(request.url()).pathname === "/api/collaborators") requests.push(request.url()) })
    await page.goto(`/crm/enquiries/new?contactId=${s.contact.id}`);await page.getByText("Enquiry details", { exact: true }).click();await page.getByLabel("Enquiry title", { exact: true }).fill("UI self introduction")
    await page.getByText("Introducing collaborator", { exact: true }).click();await expect(page.getByText(/External logins automatically record their own collaborator/)).toBeVisible();await expect(page.getByRole("combobox", { name: "Introducing collaborator (optional)", exact: true })).toHaveCount(0)
    const saved = page.waitForResponse(r => r.url().endsWith("/api/crm/enquiries") && r.request().method() === "POST")
    await page.getByRole("button", { name: "Save enquiry", exact: true }).click();const row = await (await saved).json();expect(row.introducedByCollaboratorId).toBe(s.a.id)
    await expect(page.getByText("UI Alpha Agency (UI_ALPHA)", { exact: true })).toBeVisible();expect(requests).toEqual([])
  } finally { await context.close();await s.admin.context.close();await s.f.db.end() }
})

test("sales report filters, choices, grouping, drilldown and export work without collaborator-directory access and on mobile", async ({ browser }) => {
  test.setTimeout(150_000)
  const s = await setup(browser)
  let manager: Awaited<ReturnType<typeof login>> | undefined
  try {
    for (const [title, id] of [["UI Alpha sales", s.a.id], ["UI Beta sales", s.b.id]]) await json(s.admin.context, "/api/crm/enquiries", 201, "POST", { title, contactId: s.contact.id, assignedUserId: s.f.users.manager.id, introducedByCollaboratorId: id })
    await json(s.admin.context, "/api/crm/enquiries", 201, "POST", { title: "UI ordinary sales", contactId: s.contact.id, assignedUserId: s.f.users.manager.id })
    await json(s.admin.context, `/api/collaborators/${s.a.id}`, 200, "PATCH", { version: s.a.version, archived: true })
    manager = await login(browser, s.f.origin, s.f.users.manager.email);const { page, context } = manager
    await json(context, "/api/collaborators", 403)
    await page.goto("/crm/sales");await expect(page.getByRole("button", { name: /Leads created\s*3/ })).toBeVisible()
    await page.getByRole("button", { name: "Filters", exact: true }).click();await page.getByLabel("Partner introduction", { exact: true }).click();await page.getByRole("menuitemradio", { name: "Partner introduced", exact: true }).click()
    await pick(page, "Introducing collaborator", "UI Alpha Agency");await page.keyboard.press("Escape")
    await expect(page.getByRole("button", { name: /Leads created\s*1/ })).toBeVisible();await expect(page.getByRole("row").filter({ hasText: "UI Alpha sales" })).toHaveCount(1)
    await expect(page.getByRole("row").filter({ hasText: "UI Beta sales" })).toHaveCount(0)
    const exported = await context.request.get("/api/crm/reports/sales/export?scope=mine&introduction=partner&introducedByCollaboratorId=" + s.a.id)
    expect(exported.ok()).toBe(true);expect(await exported.text()).toContain("UI Alpha sales");expect(await exported.text()).not.toContain("UI Beta sales")
    await page.getByRole("button", { name: "Group leads by", exact: true }).click();await page.getByRole("menuitemradio", { name: "By introducing collaborator", exact: true }).click()
    await expect(page.getByRole("cell", { name: "UI Alpha Agency", exact: true })).toBeVisible()
    await page.screenshot({ path: "test-results/local-access/partner-sales-report-desktop.png", fullPage: true, animations: "disabled" })
    await page.setViewportSize({ width: 390, height: 844 });await page.getByRole("button", { name: /^Filters/ }).click();await expect(page.getByLabel("Supervisor at introduction", { exact: true })).toBeVisible()
    await expect(page.getByRole("dialog", { name: "Filters", exact: true })).toBeInViewport({ ratio: 1 })
    await page.getByLabel("Lead source", { exact: true }).scrollIntoViewIfNeeded();await expect(page.getByLabel("Lead source", { exact: true })).toBeInViewport({ ratio: 1 })
    await page.getByRole("button", { name: "Reset filters", exact: true }).click();await page.getByLabel("Salesperson type", { exact: true }).click();await page.getByRole("menuitemradio", { name: "External collaborators", exact: true }).click();await page.keyboard.press("Escape")
    await expect(page.getByRole("button", { name: /Leads created\s*0/ })).toBeVisible();expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: "test-results/local-access/partner-sales-filters-mobile.png", fullPage: false, animations: "disabled" })
    await page.getByRole("heading", { name: "Sales reports", exact: true }).click()
    await expect(page.getByLabel("Supervisor at introduction", { exact: true })).toHaveCount(0)
    await page.screenshot({ path: "test-results/local-access/partner-sales-report-mobile.png", fullPage: true, animations: "disabled" })
    const access = await json(s.admin.context, `/api/access/users/${s.f.users.manager.id}`)
    await json(s.admin.context, `/api/access/users/${s.f.users.manager.id}`, 200, "PATCH", { version: access.accessPolicy.version, roleIds: [], rules: access.accessPolicy.rules })
    await page.getByRole("button", { name: "Refresh", exact: true }).click();await expect(page.getByRole("alert").filter({ hasText: "does not permit" })).toBeVisible()
    await expect(page.getByRole("button", { name: /Leads created/ })).toHaveCount(0)
  } finally { await manager?.context.close();await s.admin.context.close();await s.f.db.end() }
})
