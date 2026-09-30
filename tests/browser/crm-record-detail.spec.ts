import { test, expect, type Page } from "@playwright/test"
import { emptyQuotationContent } from "../../modules/sales-documents/quotation-validation"
import { calculateQuotation } from "../../modules/sales-documents/quotation-calculation"

test.beforeEach(({ baseURL }) => { test.skip(baseURL !== "http://127.0.0.1:3012", "Isolated component host only; all APIs intercepted.") })

async function fixture(page: Page, options: { manager?: boolean; documents?: boolean; plans?: boolean; conversionDefault?: boolean } = {}) {
  const manager = options.manager !== false
  const common = { id: "test", version: 2, archived: false, canManage: manager, canEdit: manager }
  const contact = { ...common, name: "Alex Taylor", email: "alex@example.com", phone: "+919876543210" }
  const account = { ...common, name: "Taylor Enterprises", email: "office@example.com", phone: "", website: "", notes: "Development partner" }
  const assignee = { id: "admin", name: "Test Admin" }
  const stage = { isConversionDefault: options.conversionDefault || false, id: "stage", name: "Qualified", kind: "OPEN", probability: 30, color: "#64748b", archived: false }
  const pipeline = { ...common, name: "Property sales", stages: [stage, { ...stage, id: "won", name: "Won", kind: "WON", probability: 100 }, { ...stage, id: "lost", name: "Lost", kind: "LOST", probability: 0 }] }
  if (options.conversionDefault) pipeline.stages.unshift({ ...stage, id: "first", name: "Discovery", probability: 10, isConversionDefault: false })
  const enquiry = { ...common, title: "Apartment enquiry", contact, contactId: "test", assignedUserId: "admin", assignee, status: "QUALIFIED", requirements: "Three bedrooms", sourceId: null, source: "Referral", sourceChoice: null, customFields: [], createdAt: "2026-09-28T10:00:00Z", updatedAt: "2026-09-28T10:00:00Z", creator: assignee, realEstateEnabled: false }
  const opportunity = { ...enquiry, title: "Apartment opportunity", amount: "5000000", currency: "INR", pipelineId: "test", pipeline, stageId: "stage", stage, probability: 30, expectedCloseOn: "2026-10-30", outcome: "OPEN" }
  const step = { title: "Follow up", type: "CALL", callDirection: "OUTBOUND", dayOffset: 1, description: "Discuss requirements", priority: 2, reminderTime: "10:00" }
  const plan = { ...common, name: "Sales follow-up", description: "Follow through", steps: [step, { ...step, title: "Site visit", type: "MEETING", dayOffset: 3 }] }
  const rule = { ...common, name: "Retry unanswered calls", sourceType: "CALL", outcome: "NO_ANSWER", maxDepth: 3, nextStep: step }
  const work = { ...common, title: "Call Alex", type: "CALL", callDirection: "OUTBOUND", status: "OPEN", priority: 2, dueOn: "2026-09-30", description: "Review proposal", contactId: "test", contact, assignedUserId: "admin", assignee, timeZone: "Asia/Kolkata", reminderAt: null }
  const team = { ...common, name: "Property team", workflow: "ENQUIRY_FIRST" }
  const field = { ...common, scope: "SALES", code: "budget", name: "Budget", type: "NUMBER", helpText: "Customer budget", position: 0, required: false, visibility: "ALL", editability: "ALL", filterable: true, maxLength: 2000, minimum: "0", maximum: null, defaultValue: null, salesTeamId: null, options: [] }
  const content = { ...emptyQuotationContent, title: "Apartment quotation", currency: "INR", supplierName: "Leiweissen", bookingDate: "2026-09-29", lines: [{ description: "Apartment", quantity: "1", unit: "unit", rate: "5000000" }], instalments: [{ label: "Booking", percent: "20", days: 0, note: "On acceptance" }, { label: "Balance", percent: "80", days: 30, note: "" }] }
  const snapshot = { content, calculation: calculateQuotation(content), customer: contact, opportunity: opportunity.title, actor: "Test Admin", context: [{ label: "Project", value: "Green Meadows" }], locale: "en-IN", dateFormat: "dd/MM/yyyy", numberFormat: "US_UK", currencySymbolPlacement: "BEFORE", template: null }
  const quote = { ...common, title: content.title, opportunityId: "test", revision: 2, snapshot, paymentPlansEnabled: options.plans !== false }
  const template = { ...common, name: "Apartment template", content: { ...content, bookingDate: "" }, paymentPlansEnabled: options.plans !== false }
  const rows: Record<string, object> = { contacts: contact, accounts: account, enquiries: enquiry, opportunities: opportunity, pipelines: pipeline, "activity-plans": plan, "follow-up-rules": rule, work, "sales-teams": team, "custom-fields": field, quotations: quote, "quotation-templates": template }
  const writes: { path: string; body: Record<string, unknown> }[] = [], reads: string[] = []
  let conflict = false
  await page.route("**/api/**", async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname
    const list = { items: [], total: 0, page: 1, pageSize: 20, totalPages: 1, canManage: manager, canAssign: manager, currentUserId: "admin", timeZone: "Asia/Kolkata", serverTime: "2026-09-29T10:00:00Z", scopes: ["SALES", "ENQUIRY", "OPPORTUNITY", "PROJECT"] }
    const match = path.match(/^\/api\/crm\/([^/]+)\/test$/), row = match && rows[match[1]]
    if (req.method() !== "GET") {
      const body = req.postDataJSON(); writes.push({ path, body })
      if (conflict) return route.fulfill({ status: 409, json: { error: "This record changed. Refresh before saving." } })
      if (row) {
        if (match![1] === "quotations") Object.assign(quote, { version: quote.version + 1, revision: quote.revision + 1, snapshot: { ...snapshot, content: body.content, calculation: calculateQuotation(body.content) } })
        else Object.assign(row, body, { version: 3 })
        return route.fulfill({ json: row })
      }
      return route.fulfill({ json: { id: "test", version: 3 } })
    }
    reads.push(path)
    if (row) return route.fulfill({ json: match![1] === "quotations" && url.searchParams.has("revision") ? { ...quote, revision: Number(url.searchParams.get("revision")) } : row })
    if (path === "/api/real-estate/choices/property-categories/test") return route.fulfill({ json: { ...common, name: "Apartment", position: 0, isDefault: true } })
    if (path === "/api/crm/pipelines") return route.fulfill({ json: { ...list, items: [pipeline], total: 1 } })
    if (path === "/api/modules") return route.fulfill({ json: { permissions: null, modules: [{ key: "crm", allowed: true, enabled: true }, { key: "salesDocuments", allowed: true, enabled: options.documents !== false }, { key: "paymentPlans", allowed: true, enabled: options.plans !== false }] } })
    if (path === "/api/settings/display") return route.fulfill({ json: { settings: { currency: "INR", locale: "en-IN", dateFormat: "dd/MM/yyyy", timeZone: "Asia/Kolkata" } } })
    if (path.includes("custom-fields/form")) return route.fulfill({ json: [] })
    if (["lead-sources", "lost-reasons", "activity-types"].some(key => path === `/api/crm/${key}`)) return route.fulfill({ json: { ...list, items: [{ ...common, name: "Configured choice", baseType: "CALL", defaultInstructions: "Call customer" }], total: 1 } })
    if (path.endsWith("/follow-up-preview")) return route.fulfill({ json: { rule: null } })
    return route.fulfill({ json: list })
  })
  return { reads, writes, pipeline, conflict: () => { conflict = true } }
}

for (const [route, field, section] of [
  ["contacts", "Full name", "Contact details"], ["accounts", "Company name", "Account details"],
  ["enquiries", "Enquiry title", "Enquiry details"], ["opportunities", "Opportunity title", "Opportunity details"],
  ["activities", "Activity title", "Activity details"], ["activity-plans", "Plan name", "Plan details"],
  ["follow-up-rules", "Rule name", "Rule trigger"], ["pipelines", "Pipeline name", "Pipeline configuration"],
  ["configuration/sales-teams", "Team name", "Team details"], ["configuration/custom-fields", "Name", "Field details"],
]) {
  test(`${route}: saved summary, edit and discard restore canonical fields`, async ({ page }) => {
    const state = await fixture(page)
    await page.goto(`/crm/${route}/test`)
    await expect(page.getByRole("button", { name: "Edit details", exact: true })).toBeEnabled()
    await expect(page.getByRole("textbox")).toHaveCount(0)
    await page.getByRole("button", { name: `Edit ${section.toLowerCase()}`, exact: true }).click()
    const input = page.getByRole("dialog").getByLabel(field, { exact: true })
    const original = await input.inputValue()
    await input.fill("Changed draft")
    await page.getByRole("button", { name: "Cancel", exact: true }).click()
    await page.getByRole("button", { name: "Discard changes", exact: true }).click()
    await expect(page.getByRole("dialog")).toHaveCount(0)
    expect(state.writes).toHaveLength(0)
    await page.getByRole("button", { name: "Edit details", exact: true }).click()
    await expect(page.getByRole("dialog").getByLabel(field, { exact: true })).toHaveValue(original)
    await page.getByRole("dialog").getByLabel(field, { exact: true }).fill("Saved change")
    await page.getByRole("button", { name: "Save changes", exact: true }).click()
    await expect(page.getByRole("dialog")).toHaveCount(0)
    expect(state.writes[0].body.version).toBe(2)
  })
}

test("enquiry save, lazy history, version conflict and responsive panel", async ({ page }, info) => {
  const state = await fixture(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/crm/enquiries/test")
  await page.getByRole("button", { name: "Edit enquiry details", exact: true }).click()
  await page.getByLabel("Enquiry title", { exact: true }).fill("Updated enquiry")
  await page.getByRole("button", { name: "Save changes", exact: true }).click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  expect(state.writes[0].body).toMatchObject({ title: "Updated enquiry", version: 2, status: "QUALIFIED" })
  expect(state.reads.some(path => path.includes("/timeline"))).toBe(false)
  await page.screenshot({ path: info.outputPath("enquiry-mobile.png"), fullPage: true, animations: "disabled" })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  state.conflict()
  await page.getByRole("button", { name: "Edit details", exact: true }).click()
  await page.getByLabel("Enquiry title", { exact: true }).fill("Keep draft on conflict")
  await expect(page.getByRole("button", { name: "Save changes", exact: true })).toBeInViewport()
  await page.screenshot({ path: info.outputPath("edit-mobile.png"), fullPage: true, animations: "disabled" })
  await page.getByRole("button", { name: "Save changes", exact: true }).click()
  await expect(page.getByRole("dialog").getByRole("alert").first()).toHaveText("This record changed. Refresh before saving.")
  await expect(page.getByLabel("Enquiry title", { exact: true })).toHaveValue("Keep draft on conflict")
})

test("quotation tabs, versioned save and immutable old versions", async ({ page }, info) => {
  const state = await fixture(page)
  await page.goto("/crm/quotations/test")
  await expect(page.getByRole("button", { name: "Edit details", exact: true })).toBeEnabled()
  await expect(page.getByRole("textbox")).toHaveCount(0)
  await page.screenshot({ path: info.outputPath("quotation-overview.png"), fullPage: true, animations: "disabled" })
  await page.getByRole("tab", { name: "Payment plan", exact: true }).click()
  await expect(page.getByRole("cell", { name: "20%", exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Edit instalment schedule", exact: true }).click()
  await expect(page.locator('details[open] summary')).toHaveText("Instalment schedule")
  await page.getByRole("button", { name: "Cancel", exact: true }).click()
  await page.getByRole("tab", { name: "Overview", exact: true }).click()
  await page.getByRole("button", { name: "Edit document details", exact: true }).click()
  await page.getByLabel("Document title", { exact: true }).fill("Updated quotation")
  await page.getByRole("button", { name: "Save new version", exact: true }).click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  expect(state.writes[0].body.version).toBe(2)
  await page.goto("/crm/quotations/test?revision=1")
  await expect(page.getByRole("button", { name: "Edit details", exact: true })).toBeDisabled()
  await expect(page.getByRole("button", { name: "Edit document details", exact: true })).toHaveCount(0)
  await expect(page.getByRole("link", { name: "Download saved PDF" })).toHaveAttribute("href", /revision=1/)
})

test("optional document modules and staff permissions remain enforced", async ({ page }) => {
  await fixture(page, { manager: false, documents: false, plans: false })
  await page.goto("/crm/contacts/test")
  await expect(page.getByRole("heading", { name: "Alex Taylor", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: /^Edit/ })).toHaveCount(0)
  await page.goto("/crm/opportunities/test")
  await expect(page.getByRole("button", { name: "Edit details", exact: true })).toBeVisible()
  await expect(page.getByRole("tab", { name: "Sales documents" })).toHaveCount(0)
  await page.goto("/crm/quotations/test")
  await expect(page.getByRole("button", { name: "Edit details", exact: true })).toBeDisabled()
  await expect(page.getByRole("tab", { name: "Payment plan", exact: true })).toBeVisible()
})

for (const route of ["lead-sources", "lost-reasons", "activity-types"]) test(`${route}: shared configuration panel guards discard`, async ({ page }) => {
  const state = await fixture(page)
  await page.goto(`/crm/${route}`)
  await page.getByRole("button", { name: "Edit Configured choice" }).click()
  await page.getByRole("dialog").getByRole("textbox").first().fill("Uncommitted change")
  await page.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(page.getByRole("alertdialog").or(page.getByRole("dialog", { name: "Discard unsaved changes?" }))).toBeVisible()
  await page.getByRole("button", { name: "Discard changes", exact: true }).click()
  expect(state.writes).toHaveLength(0)
})


test("template and property configuration use the same section editor", async ({ page }) => {
  await fixture(page)
  await page.goto("/crm/configuration/quotation-templates/test")
  await expect(page.getByRole("textbox")).toHaveCount(0)
  await page.getByRole("tab", { name: "Bank and terms", exact: true }).click()
  await page.getByRole("button", { name: "Edit terms and remarks", exact: true }).click()
  await expect(page.getByLabel("Terms / remarks", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Cancel", exact: true }).click()
  await page.goto("/crm/configuration/real-estate/property-categories/test")
  await page.getByRole("button", { name: "Edit choice details", exact: true }).click()
  await expect(page.getByRole("dialog").getByLabel("Name", { exact: true })).toHaveValue("Apartment")
})

test("new contact keeps creation controls and activity outcomes stay separate", async ({ page }) => {
  const state = await fixture(page)
  await page.goto("/crm/contacts/new")
  await page.getByLabel("Full name", { exact: true }).fill("New test contact")
  await page.getByRole("button", { name: "Save contact", exact: true }).click()
  await expect.poll(() => state.writes.length).toBe(1)
  expect(state.writes[0]).toMatchObject({ path: "/api/crm/contacts", body: { name: "New test contact" } })
  await page.goto("/crm/activities/test")
  await page.getByRole("button", { name: "Record outcome", exact: true }).click()
  await expect(page.getByLabel("Customer interaction summary", { exact: true })).toBeVisible()
  await expect(page.getByLabel("Activity title", { exact: true })).toHaveCount(0)
  await page.getByRole("tab", { name: "History and notes", exact: true }).click()
  await expect.poll(() => state.reads.some(path => path === "/api/crm/work/test/history")).toBe(true)
})

test("failed record loads stay visible outside the closed editor", async ({ page }) => {
  await fixture(page)
  await page.route("**/api/crm/enquiries/test", route => route.fulfill({ status: 404, json: { error: "Enquiry not found." } }))
  await page.goto("/crm/enquiries/test")
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Enquiry not found.")
  await expect(page.getByRole("button", { name: "Edit details", exact: true })).toBeDisabled()
  await expect(page.getByRole("textbox")).toHaveCount(0)
})


test("pipeline conversion default can be selected, reordered, saved and cleared", async ({ page }, info) => {
  const state = await fixture(page, { conversionDefault: true })
  await page.goto("/crm/pipelines/test")
  await page.getByRole("button", { name: "Edit pipeline configuration", exact: true }).click()
  const selector = page.getByLabel("Default conversion stage", { exact: true })
  await expect(selector).toContainText("Qualified")
  await page.getByRole("button", { name: "Move Qualified up", exact: true }).click()
  await expect(selector).toContainText("Qualified")
  await selector.click()
  await expect(page.getByRole("menuitemradio", { name: "Won", exact: true })).toHaveCount(0)
  await page.getByRole("menuitemradio", { name: "Discovery", exact: true }).click()
  await page.screenshot({ path: info.outputPath("conversion-default.png"), fullPage: true })
  await page.getByRole("button", { name: "Save changes", exact: true }).click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  const stages = state.writes[0].body.stages as { name: string; isConversionDefault: boolean }[]
  expect(stages.filter(s => s.isConversionDefault).map(s => s.name)).toEqual(["Discovery"])
  await page.reload()
  await page.getByRole("button", { name: "Edit pipeline configuration", exact: true }).click()
  await expect(selector).toContainText("Discovery")
  await selector.click()
  await page.getByRole("menuitemradio", { name: "Automatic (first active open stage)", exact: true }).click()
  await page.getByRole("button", { name: "Save changes", exact: true }).click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  expect((state.writes[1].body.stages as typeof stages).some(s => s.isConversionDefault)).toBe(false)
})

test("enquiry conversion prefills configured stage and probability while respecting overrides and direct creation", async ({ page }) => {
  await fixture(page, { conversionDefault: true, documents: false })
  await page.goto("/crm/opportunities/new?enquiryId=test")
  await expect(page.getByLabel("Stage", { exact: true })).toContainText("Qualified")
  await expect(page.getByLabel("Probability %", { exact: true })).toHaveValue("30")
  await page.getByLabel("Stage", { exact: true }).click()
  await page.getByRole("menuitemradio", { name: "Discovery", exact: true }).click()
  await expect(page.getByLabel("Probability %", { exact: true })).toHaveValue("10")
  await page.getByLabel("Opportunity title", { exact: true }).fill("Manual override")
  await expect(page.getByLabel("Stage", { exact: true })).toContainText("Discovery")
  await page.goto("/crm/opportunities/new")
  await expect(page.getByLabel("Stage", { exact: true })).toContainText("Discovery")
  await expect(page.getByLabel("Probability %", { exact: true })).toHaveValue("10")
})
