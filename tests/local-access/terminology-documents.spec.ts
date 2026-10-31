import { test, expect } from "@playwright/test"
import { PDFDocument } from "pdf-lib"
import { seed, login, json } from "./fixtures"

test("quotation revisions retain saved labels while new documents use current terminology", async ({ browser }, testInfo) => {
  test.setTimeout(180000)
  const fixture = await seed(), { context, page } = await login(browser, fixture.origin, fixture.users.admin.email)
  async function rename(changes: Record<string, string | null>) {
    const state = await json(context, "/api/settings/terminology")
    await json(context, "/api/settings/terminology", 200, "PATCH", { version: state.version, changes: Object.entries(changes).map(([key, label]) => ({ key, label })) })
    await page.evaluate(() => window.dispatchEvent(new Event("terminology-changed")))
  }
  try {
    await page.goto("/crm/opportunities")
    const contact = await json(context, "/api/crm/contacts", 201, "POST", { name: "Original buyer", email: "quote-terms@example.test" })
    const project = await json(context, "/api/real-estate/projects", 201, "POST", { name: "Original project", code: "DOC-TERMS", location: "Pune" })
    const pipeline = await json(context, "/api/crm/pipelines", 201, "POST", { name: "Document sales", stages: [{ name: "Qualified", kind: "OPEN", probability: 20, color: "#123456" }, { name: "Won", kind: "WON", probability: 100, color: "#16a34a" }, { name: "Lost", kind: "LOST", probability: 0, color: "#dc2626" }] })
    const deal = await json(context, "/api/crm/opportunities", 201, "POST", { title: "Original deal", contactId: contact.id, assignedUserId: fixture.users.admin.id, pipelineId: pipeline.id, stageId: pipeline.stages[0].id, amount: "1000", currency: "INR", expectedCloseOn: "2030-11-06", propertyContext: { projectId: project.id } })
    const names = { "crm.contact.singular": "Buyer", "crm.opportunity.singular": "Deal", "realEstate.project.singular": "Development", "salesDocuments.quotation.singular": "Offer", "paymentPlans.paymentPlan.singular": "Payment schedule" }
    await rename(names)
    await page.goto(`/crm/quotations/new?opportunityId=${deal.id}`)
    await expect(page.getByLabel("Offer title", { exact: true })).toHaveValue("Offer")
    await page.getByLabel("Offer title", { exact: true }).fill("Negotiated title")
    await rename({ "salesDocuments.quotation.singular": "Proposal" })
    await expect(page.getByRole("heading", { name: "New Proposal", exact: true })).toBeVisible()
    await expect(page.getByLabel("Proposal title", { exact: true })).toHaveValue("Negotiated title")
    const defaults = await json(context, `/api/crm/opportunities/${deal.id}/quotations/defaults`)
    const content = { ...defaults.content, title: "Negotiated title", instalments: [{ label: "Original milestone", percent: "100", days: 0, note: "Original condition" }] }
    const saved = await json(context, `/api/crm/opportunities/${deal.id}/quotations`, 201, "POST", { content })
    const before = await json(context, `/api/crm/quotations/${saved.id}`)
    await page.goto(`/crm/quotations/${saved.id}`)
    await expect(page.getByRole("region", { name: "Sales context", exact: true }).getByText("Deal", { exact: true })).toBeVisible()
    await expect(page.getByText("Development", { exact: true })).toBeVisible()
    await rename(Object.fromEntries(Object.keys(names).map(key => [key, null])))
    await expect(page.getByRole("region", { name: "Sales context", exact: true }).getByText("Deal", { exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath("saved-labels-desktop.png"), fullPage: true, animations: "disabled" })
    await page.getByRole("tab", { name: "Payment plan", exact: true }).click()
    await expect(page.getByRole("heading", { name: "Payment schedule", exact: true })).toBeVisible()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: testInfo.outputPath("saved-labels-mobile.png"), fullPage: true, animations: "disabled" })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
    expect((await json(context, `/api/crm/quotations/${saved.id}`)).snapshot).toEqual(before.snapshot)
    await json(context, `/api/crm/quotations/${saved.id}`, 200, "PUT", { content, version: 1 })
    const latest = await json(context, `/api/crm/quotations/${saved.id}`)
    expect(latest.snapshot.labels.opportunity).toBe("Opportunity")
    expect(latest.snapshot.content).toEqual(before.snapshot.content)
    expect(latest.snapshot.calculation).toEqual(before.snapshot.calculation)
    expect((await json(context, `/api/crm/quotations/${saved.id}?revision=1`)).snapshot).toEqual(before.snapshot)
    const pdf = await context.request.get(`/api/crm/quotations/${saved.id}/pdf?revision=1`)
    expect(pdf.status()).toBe(200)
    expect((await PDFDocument.load(await pdf.body())).getPageCount()).toBeGreaterThan(0)
    const current = await json(context, "/api/settings/terminology")
    await json(context, "/api/settings/terminology", 400, "PATCH", { version: current.version, changes: [{ key: "paymentPlans.paymentPlan.singular", label: "Bank details" }] })
  } finally { await context.close(); await fixture.db.end() }
})
