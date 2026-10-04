import { test, expect } from "@playwright/test"
import { PDFDocument } from "pdf-lib"
import { emptyQuotationContent } from "../../modules/sales-documents/quotation-validation"
import { seed, login, json } from "./fixtures"

test.describe.configure({ mode: "serial" })
let fixture: Awaited<ReturnType<typeof seed>>
let admin: Awaited<ReturnType<typeof login>>, staff: typeof admin
let project: { id: string }, child: { id: string }, contact: { id: string }
let lead: { id: string; version: number }, deal: { id: string; version: number }
let pipeline: { id: string; stages: { id: string; kind: string }[] }
let quote: { id: string; version: number }
const content = {
  ...structuredClone(emptyQuotationContent), title: "Green Meadows offer", supplierName: "Local Example Developer", currency: "INR",
  bookingDate: "2030-10-07", lines: [{ description: "Apartment GM-A-201", quantity: "1000", unit: "sq ft", rate: "5000" }],
  discount: "100000", terms: "Local workflow test terms",
  instalments: [{ label: "Booking", percent: "20", days: 0, note: "" }, { label: "Handover", percent: "80", days: 30, note: "" }],
}

test.beforeAll(async ({ browser }) => {
  fixture = await seed()
  admin = await login(browser, fixture.origin, fixture.users.admin.email)
  staff = await login(browser, fixture.origin, fixture.users.staff.email)
})
test.afterAll(async () => {
  for (const actor of [admin, staff]) await actor?.context.close()
  await fixture?.db.end()
})

test("subproject sales action preselects the project and enquiry conversion preserves that context", async () => {
  project = await json(admin.context, "/api/real-estate/projects", 201, "POST", { name: "Green Meadows Local", code: "GM-LOCAL", location: "Pune", currency: "INR" })
  child = await json(admin.context, "/api/real-estate/projects", 201, "POST", { name: "Green Meadows Phase 1", code: "GM-P1", parentId: project.id })
  const parent = await json(admin.context, `/api/real-estate/projects/${project.id}`)
  await json(admin.context, `/api/real-estate/projects/${project.id}/members`, 200, "PATCH", { userId: fixture.users.staff.id, version: parent.version })
  await staff.page.goto(`/crm/projects/${child.id}`)
  await staff.page.getByRole("tab", { name: "Sales", exact: true }).click()
  await staff.page.getByRole("link", { name: "New lead", exact: true }).click()
  await expect(staff.page).toHaveURL(new RegExp(`subprojectId=${child.id}`))
  await expect(staff.page.getByLabel("Project (optional)", { exact: true })).toContainText("Green Meadows Local")
  await expect(staff.page.getByLabel("Subproject (optional)", { exact: true })).toContainText("Green Meadows Phase 1")
  contact = await json(admin.context, "/api/crm/contacts", 201, "POST", { name: "Local Sales Buyer", email: "buyer@example.test" })
  lead = await json(admin.context, "/api/crm/enquiries", 201, "POST", { title: "Apartment enquiry", contactId: contact.id, assignedUserId: fixture.users.staff.id, propertyContext: { projectId: project.id, subprojectId: child.id, budgetCurrency: "INR", budgetMax: "5000000" } })
  lead = await json(staff.context, `/api/crm/enquiries/${lead.id}`, 200, "PATCH", { title: "Apartment enquiry", assignedUserId: fixture.users.staff.id, status: "QUALIFIED", version: lead.version })
  pipeline = await json(admin.context, "/api/crm/pipelines", 201, "POST", { name: "Local property sales", stages: [
    { name: "Qualified", kind: "OPEN", probability: 20, color: "#123456", isConversionDefault: true },
    { name: "Proposal", kind: "OPEN", probability: 60, color: "#456789" },
    { name: "Won", kind: "WON", probability: 100, color: "#008800" },
    { name: "Lost", kind: "LOST", probability: 0, color: "#880000" },
  ] })
  const input = { title: "Green Meadows apartment sale", contactId: contact.id, assignedUserId: fixture.users.staff.id, enquiryId: lead.id, enquiryVersion: lead.version, pipelineId: pipeline.id, stageId: pipeline.stages[0].id, amount: "4900000", currency: "INR", expectedCloseOn: "2030-11-06" }
  deal = await json(staff.context, "/api/crm/opportunities", 201, "POST", input)
  expect((await json(staff.context, "/api/crm/opportunities", 201, "POST", input)).id).toBe(deal.id)
  const saved = await json(staff.context, `/api/crm/opportunities/${deal.id}`)
  expect(saved.propertyContext.projectId).toBe(project.id)
  expect(saved.propertyContext.subprojectId).toBe(child.id)
  expect((await json(staff.context, `/api/crm/enquiries/${lead.id}`)).opportunity.id).toBe(deal.id)
})

test("site visit completion keeps customer history and schedules one follow-up", async () => {
  const type = await json(admin.context, "/api/crm/activity-types", 201, "POST", { name: "Site visit", baseType: "MEETING" })
  const visit = await json(staff.context, "/api/crm/work", 201, "POST", { title: "Visit Phase 1", type: "MEETING", activityTypeId: type.id, contactId: contact.id, opportunityId: deal.id, assignedUserId: fixture.users.staff.id, dueOn: "2030-10-07" })
  const completion = { version: visit.version, outcome: "HELD", summary: "Buyer viewed GM-A-201 and requested a quotation.", occurredAt: new Date().toISOString(), followUp: { title: "Discuss quotation", type: "CALL", callDirection: "OUTBOUND", assignedUserId: fixture.users.staff.id, dueOn: "2030-10-08" } }
  await json(staff.context, `/api/crm/work/${visit.id}/complete`, 200, "POST", completion)
  await json(staff.context, `/api/crm/work/${visit.id}/complete`, 409, "POST", completion)
  const work = await json(staff.context, `/api/crm/work?opportunityId=${deal.id}&state=open`)
  expect(work.total).toBe(1)
  expect(work.items[0].title).toBe("Discuss quotation")
  const history = await json(staff.context, `/api/crm/contacts/${contact.id}/interactions`)
  expect(history.items.some((r: { summary: string }) => r.summary === completion.summary)).toBe(true)
})

test("quotation UI saves a revision and preserves exact payment totals and original snapshots", async () => {
  const template = await json(admin.context, "/api/crm/quotation-templates", 201, "POST", { name: "20 / 80 plan", content: { ...content, bookingDate: "" } })
  quote = await json(staff.context, `/api/crm/opportunities/${deal.id}/quotations`, 201, "POST", { content, templateId: template.id })
  const saved = await json(staff.context, `/api/crm/quotations/${quote.id}`)
  expect(saved.snapshot.calculation.consideration).toBe("4900000.00")
  expect(saved.snapshot.calculation.instalments.map((r: { amount: string }) => r.amount)).toEqual(["980000.00", "3920000.00"])
  expect(saved.snapshot.calculation.instalments.map((r: { dueDate: string }) => r.dueDate)).toEqual(["2030-10-07", "2030-11-06"])
  await staff.page.goto(`/crm/quotations/${quote.id}`)
  await expect(staff.page.getByRole("heading", { name: /Green Meadows offer.*version 1/ })).toBeVisible()
  await staff.page.getByRole("tab", { name: "Payment plan", exact: true }).click()
  await expect(staff.page.getByText("Handover", { exact: true })).toBeVisible()
  await staff.page.screenshot({ path: test.info().outputPath("sales-payment-plan.png"), fullPage: true, animations: "disabled" })
  await staff.page.getByRole("tab", { name: "Bank and terms", exact: true }).click()
  await staff.page.getByRole("button", { name: "Edit terms and remarks", exact: true }).click()
  const editor = staff.page.getByRole("dialog", { name: "Edit record", exact: true })
  await editor.getByLabel("Terms / remarks", { exact: true }).fill("Revised local terms")
  const saving = staff.page.waitForResponse(response => response.url().endsWith(`/api/crm/quotations/${quote.id}`) && response.request().method() === "PUT")
  await editor.getByRole("button", { name: "Save new version", exact: true }).click()
  expect((await saving).status()).toBe(200)
  await expect(editor).toBeHidden()
  quote = await json(staff.context, `/api/crm/quotations/${quote.id}`)
  expect(quote.version).toBe(2)
  const original = await json(staff.context, `/api/crm/quotations/${quote.id}?revision=1`)
  expect(original.snapshot.content.terms).toBe(content.terms)
  expect((await json(staff.context, `/api/crm/quotations/${quote.id}`)).snapshot.content.terms).toBe("Revised local terms")
  const pdf = await staff.context.request.get(`/api/crm/quotations/${quote.id}/pdf`)
  expect(pdf.status()).toBe(200)
  expect(pdf.headers()["content-type"]).toContain("application/pdf")
  expect((await PDFDocument.load(await pdf.body())).getPageCount()).toBeGreaterThan(0)
})

test("won close updates probability and a disabled payment module preserves saved schedules", async () => {
  deal = await json(staff.context, `/api/crm/opportunities/${deal.id}/move`, 200, "PATCH", { pipelineId: pipeline.id, stageId: pipeline.stages[2].id, version: deal.version })
  const saved = await json(staff.context, `/api/crm/opportunities/${deal.id}`)
  expect(saved.probability).toBe(100)
  expect(saved.closedAt).toBeTruthy()
  expect(saved.stage.kind).toBe("WON")
  await json(admin.context, "/api/modules", 200, "PATCH", { key: "paymentPlans", enabled: false })
  const historical = await json(staff.context, `/api/crm/quotations/${quote.id}`)
  expect(historical.snapshot.calculation.instalments).toHaveLength(2)
  await json(staff.context, `/api/crm/quotations/${quote.id}`, 403, "PUT", { content, version: quote.version })
  await json(admin.context, "/api/modules", 200, "PATCH", { key: "paymentPlans", enabled: true })
})

test("spam enquiries keep a structured loss reason and remain searchable", async () => {
  const reason = await json(admin.context, "/api/crm/lost-reasons", 201, "POST", { name: "Spam" })
  const spam = await json(staff.context, "/api/crm/enquiries", 201, "POST", { title: "Spam enquiry", contactId: contact.id, assignedUserId: fixture.users.staff.id })
  await json(staff.context, `/api/crm/enquiries/${spam.id}`, 200, "PATCH", { title: "Spam enquiry", assignedUserId: fixture.users.staff.id, status: "CLOSED", lostReasonId: reason.id, outcome: "Invalid sales request", version: spam.version })
  const rows = await json(staff.context, `/api/crm/enquiries?lostReasonId=${reason.id}&status=CLOSED`)
  expect(rows.total).toBe(1)
  expect(rows.items[0].id).toBe(spam.id)
  const exportResult = await staff.context.request.get(`/api/crm/enquiries/export?lostReasonId=${reason.id}&status=CLOSED`)
  expect(exportResult.status()).toBe(200)
  expect(await exportResult.text()).toContain("Spam enquiry")
  expect(await exportResult.text()).not.toContain("Apartment enquiry")
})
