import { test, expect, type BrowserContext, type Page } from "@playwright/test"
import { seed, login, json } from "./fixtures"

test.use({ actionTimeout: 10000 })

async function salesData(context: BrowserContext, userId: string) {
  const project = await json(context, "/api/real-estate/projects", 201, "POST", { name: "North project", code: "NORTH" })
  const child = await json(context, "/api/real-estate/projects", 201, "POST", { name: "North phase", code: "NORTH-1", parentId: project.id })
  const other = await json(context, "/api/real-estate/projects", 201, "POST", { name: "South project", code: "SOUTH" })
  const contact = await json(context, "/api/crm/contacts", 201, "POST", { name: "Sales customer", email: "sales-views@example.test" })
  const pipeline = await json(context, "/api/crm/pipelines", 201, "POST", { name: "Sales pipeline", stages: [{ name: "Qualified", kind: "OPEN", probability: 20, color: "#123456" }, { name: "Won", kind: "WON", probability: 100, color: "#16a34a" }, { name: "Lost", kind: "LOST", probability: 0, color: "#dc2626" }] })
  const records = []
  for (const [name, projectId, subprojectId] of [["North parent", project.id, undefined], ["North child", project.id, child.id], ["South", other.id, undefined]] as const) {
    const common = { contactId: contact.id, assignedUserId: userId, propertyContext: { projectId, subprojectId } }
    const lead = await json(context, "/api/crm/enquiries", 201, "POST", { ...common, title: `${name} enquiry` })
    const deal = await json(context, "/api/crm/opportunities", 201, "POST", { ...common, title: `${name} opportunity`, pipelineId: pipeline.id, stageId: pipeline.stages[0].id, amount: "1000", currency: "INR", expectedCloseOn: "2030-12-01" })
    records.push({ lead, deal })
  }
  return { project, child, other, contact, records }
}
async function select(page: Page, label: string, option: string) {
  await page.getByLabel(label, { exact: true }).click()
  await page.getByRole("option", { name: option, exact: true }).click()
}
async function openFilters(page: Page) {
  const trigger = page.getByRole("button", { name: /^Filters/ })
  if (await trigger.getAttribute("aria-expanded") !== "true") await trigger.click()
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
  await expect(page.getByRole("button", { name: "Reset filters", exact: true })).toBeVisible()
}
async function toggle(context: BrowserContext, page: Page, key: string, enabled: boolean) {
  await json(context, "/api/modules", 200, "PATCH", { key, enabled })
  await page.evaluate(() => window.dispatchEvent(new Event("business-modules-changed")))
}

for (const kind of ["enquiries", "opportunities"] as const) test(`${kind} filters, reset and export use the owning extension query`, async ({ browser }, testInfo) => {
  const fixture = await seed(), { context, page } = await login(browser, fixture.origin, fixture.users.admin.email)
  try {
    const data = await salesData(context, fixture.users.admin.id)
    const singular = kind === "enquiries" ? "enquiry" : "opportunity"
    const requests: URL[] = []
    page.on("request", r => { const url = new URL(r.url()); if (url.pathname === `/api/crm/${kind}`) requests.push(url) })
    await page.goto(`/crm/${kind}`)
    if (kind === "opportunities") await page.getByRole("button", { name: "List", exact: true }).click()
    await expect(page.getByRole("link", { name: `South ${singular}`, exact: true })).toBeVisible()
    await openFilters(page)
    await select(page, "Project", "North project")
    await select(page, "Subproject", "North phase")
    await page.keyboard.press("Escape")
    await expect(page.getByRole("link", { name: `South ${singular}`, exact: true })).toHaveCount(0)
    await expect(page.getByRole("link", { name: `North parent ${singular}`, exact: true })).toHaveCount(0)
    await expect(page.getByRole("link", { name: `North child ${singular}`, exact: true })).toBeVisible()
    expect(requests.at(-1)?.searchParams.get("projectId")).toBe(data.project.id)
    expect(requests.at(-1)?.searchParams.get("subprojectId")).toBe(data.child.id)
    const exportRequest = page.waitForRequest(r => new URL(r.url()).pathname === `/api/crm/${kind}/export`)
    await page.getByRole("button", { name: "Export CSV", exact: true }).click()
    const exportUrl = new URL((await exportRequest).url())
    expect(exportUrl.searchParams.get("subprojectId")).toBe(data.child.id)
    const reads = requests.length
    const terms = await json(context, "/api/settings/terminology")
    await json(context, "/api/settings/terminology", 200, "PATCH", { version: terms.version, changes: [{ key: "realEstate.project.singular", label: "Development" }] })
    await page.evaluate(() => window.dispatchEvent(new Event("terminology-changed")))
    await openFilters(page)
    await expect(page.getByLabel("Development", { exact: true })).toContainText("North project")
    expect(requests.length).toBe(reads)
    await select(page, "Development", "South project")
    await expect(page.getByLabel("Subproject", { exact: true })).not.toContainText("North phase")
    await page.getByRole("button", { name: "Reset filters", exact: true }).click()
    await expect(page.getByRole("link", { name: `North child ${singular}`, exact: true })).toBeVisible()
    await expect(page.getByRole("link", { name: `South ${singular}`, exact: true })).toBeVisible()
    expect(requests.at(-1)?.searchParams.has("projectId")).toBe(false)
    await select(page, "Development", "North project")
    await page.keyboard.press("Escape")
    await expect(page.getByRole("link", { name: `South ${singular}`, exact: true })).toHaveCount(0)
    await toggle(context, page, "realEstate", false)
    await expect(page.getByRole("link", { name: `South ${singular}`, exact: true })).toBeVisible()
    expect(requests.at(-1)?.searchParams.has("projectId")).toBe(false)
    await openFilters(page)
    await expect(page.getByLabel("Project", { exact: true })).toHaveCount(0)
    await expect(page.getByLabel("Development", { exact: true })).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath("module-off-filters.png"), fullPage: true, animations: "disabled" })
    await page.keyboard.press("Escape")
    // Fixed project scope survives reset in the embedded list.
    if (kind === "enquiries") {
      await toggle(context, page, "realEstate", true)
      await page.goto(`/crm/projects/${data.child.id}`)
      await page.getByRole("tab", { name: "Sales", exact: true }).click()
      await expect(page.getByRole("link", { name: "North child enquiry", exact: true })).toBeVisible()
      await openFilters(page)
      await page.getByRole("button", { name: "Reset filters", exact: true }).click()
      await page.keyboard.press("Escape")
      await expect(page.getByRole("link", { name: "North parent enquiry", exact: true })).toHaveCount(0)
      expect(requests.at(-1)?.searchParams.get("subprojectId")).toBe(data.child.id)
    }
  } finally { await context.close(); await fixture.db.end() }
})

test("creation URLs retain defaults and changing addon activation preserves editor drafts", async ({ browser }) => {
  const fixture = await seed(), { context, page } = await login(browser, fixture.origin, fixture.users.admin.email)
  try {
    const data = await salesData(context, fixture.users.admin.id)
    const query = `projectId=${data.project.id}&subprojectId=${data.child.id}`
    for (const kind of ["enquiries", "opportunities"]) {
      await page.goto(`/crm/${kind}/new?${query}&contactId=${data.contact.id}`)
      await page.getByText("Property interest", { exact: true }).click()
      await expect(page.getByLabel("Project (optional)", { exact: true })).toContainText("North project")
      await expect(page.getByLabel("Subproject (optional)", { exact: true })).toContainText("North phase")
    }
    const lead = data.records[1].lead
    await page.goto(`/crm/enquiries/${lead.id}`)
    await page.getByRole("button", { name: "Edit enquiry details", exact: true }).click()
    const editor = page.getByRole("dialog")
    await editor.getByLabel("Enquiry title", { exact: true }).fill("Unsaved cross-module draft")
    let reloads = 0
    page.on("request", r => { if (new URL(r.url()).pathname === `/api/crm/enquiries/${lead.id}` && r.method() === "GET") reloads++ })
    await toggle(context, page, "paymentPlans", false)
    await toggle(context, page, "salesDocuments", false)
    await toggle(context, page, "realEstate", false)
    await expect(editor.getByText("Property interest", { exact: true })).toHaveCount(0)
    await expect(editor.getByLabel("Enquiry title", { exact: true })).toHaveValue("Unsaved cross-module draft")
    expect(reloads).toBe(0)
    const savedResponse = page.waitForResponse(r => new URL(r.url()).pathname === `/api/crm/enquiries/${lead.id}` && r.request().method() === "PATCH")
    await editor.getByRole("button", { name: "Save changes", exact: true }).click()
    const response = await savedResponse
    expect(response.status()).toBe(200)
    expect(response.request().postDataJSON()).not.toHaveProperty("propertyContext")
    await toggle(context, page, "realEstate", true)
    const saved = await json(context, `/api/crm/enquiries/${lead.id}`)
    expect(saved.title).toBe("Unsaved cross-module draft")
    expect(saved.propertyContext.projectId).toBe(data.project.id)
    expect(saved.propertyContext.subprojectId).toBe(data.child.id)
  } finally { await context.close(); await fixture.db.end() }
})

test("module refresh retains the draft while pending and denies the view on a failed access response", async ({ browser }) => {
  const fixture = await seed(), { context, page } = await login(browser, fixture.origin, fixture.users.admin.email)
  let release = () => {}
  try {
    const contact = await json(context, "/api/crm/contacts", 201, "POST", { name: "Original", email: "refresh-draft@example.test" })
    await page.goto(`/crm/contacts/${contact.id}`)
    await page.getByRole("button", { name: "Edit contact details", exact: true }).click()
    await page.getByRole("dialog").getByLabel("Full name", { exact: true }).fill("Pending draft")
    let arrived!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    const started = new Promise<void>(resolve => { arrived = resolve })
    await page.route("**/api/modules", async route => { arrived(); await pending; await route.fulfill({ status: 403, json: { error: "Forbidden" } }) })
    await page.evaluate(() => window.dispatchEvent(new Event("business-modules-changed")))
    await started
    await expect(page.getByRole("dialog").getByLabel("Full name", { exact: true })).toHaveValue("Pending draft")
    release()
    await expect(page.getByRole("heading", { name: "Access unavailable", exact: true })).toBeVisible()
    await expect(page.getByRole("dialog")).toHaveCount(0)
    expect((await json(context, `/api/crm/contacts/${contact.id}`)).name).toBe("Original")
  } finally { release(); await context.close(); await fixture.db.end() }
})
