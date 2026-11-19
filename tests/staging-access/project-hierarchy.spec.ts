// Hosted writes are restricted to the synthetic tenant provisioned by the guarded fixture.
import fs from "node:fs"
import { randomUUID } from "node:crypto"
import { test, expect } from "@playwright/test"
import { stagingFixture } from "../helpers/p13s-staging"
import { api } from "../helpers/p13s-acceptance"
import { emptyQuotationContent } from "../../modules/sales-documents/quotation-validation"
import { defaultRecordRules } from "../../platform/access/rules"

test.use({ actionTimeout: 30_000 })

test("hosted hierarchy, launch admission and existing commitments stay isolated and functional", async ({ browser }, info) => {
  test.setTimeout(600_000)
  const f = await stagingFixture(browser, ["crm", "realEstate", "catalog", "salesDocuments", "paymentPlans", "salesOrders", "receivables"])
  const a = f.admin.context, page = f.admin.page, errors: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  async function project(name: string, code: string, parentId = "") {
    const office = await api(a, "/api/workspace/office")
    const response = await a.request.post("/api/real-estate/projects", { headers: { "x-office-id": office.creationOffice.id, "x-office-version": String(office.version) }, data: { name, code, parentId } })
    expect(response.status(), await response.text()).toBe(201)
    return response.json()
  }
  try {
    const nodes = [await project("QA Estate", "ESTATE")]
    for (const name of ["Square", "Sector", "Block", "Wing", "Floor"]) nodes.push(await project(`QA ${name}`, name.toUpperCase(), nodes.at(-1).id))
    const root = nodes[0], leaf = nodes.at(-1)
    expect(leaf.rootId).toBe(root.id)
    const detail = await api(a, `/api/real-estate/projects/${leaf.id}`)
    expect(detail.breadcrumbs.map((node: { id: string }) => node.id)).toEqual(nodes.map(node => node.id))
    expect(detail.officeId).toBe(root.officeId)
    expect((await api(a, `/api/real-estate/projects?descendantOf=${root.id}&pageSize=2`)).total).toBe(5)
    await page.goto(`/crm/projects/${leaf.id}`)
    await expect(page.getByRole("navigation", { name: "Project hierarchy" }).getByText("QA Floor", { exact: true })).toBeVisible()
    await page.getByRole("tab", { name: "Launch phases", exact: true }).click()
    await page.getByRole("button", { name: "New launch phase", exact: true }).click()
    await page.getByLabel("Phase name", { exact: true }).fill("QA Phase 1")
    await page.getByLabel("Phase code", { exact: true }).fill("PHASE-1")
    await page.getByRole("button", { name: "Save changes", exact: true }).click()
    await expect(page.getByRole("dialog")).toHaveCount(0)
    await expect(page.getByText("Planned", { exact: true })).toBeVisible()
    let phase = (await api(a, `/api/real-estate/projects/${root.id}/launch-phases`)).items[0]
    expect(phase.projectId).toBe(root.id)
    const category = (await api(a, "/api/real-estate/choices/property-categories")).items[0].id
    const item = await api(a, "/api/catalog/items", 201, "POST", { code: "QA-PLOT", name: "QA phase plot", kind: "UNIT", unit: "plot", price: "1000", currency: "INR", extensionKey: "realEstate", extension: { projectId: leaf.id, categoryId: category, launchPhaseId: phase.id } })
    const person = await api(a, "/api/crm/contacts", 201, "POST", { name: "SYNTHETIC launch buyer" })
    const pipeline = await api(a, "/api/crm/pipelines", 201, "POST", { name: "QA launch sales", stages: [{ name: "Open", kind: "OPEN", probability: 10, color: "#123456" }, { name: "Won", kind: "WON", probability: 100, color: "#228833" }, { name: "Lost", kind: "LOST", probability: 0, color: "#aa2233" }] })
    const lead = await api(a, "/api/crm/enquiries", 201, "POST", { title: "QA nested enquiry", contactId: person.id, assignedUserId: f.admin.id, propertyContext: { projectId: root.id, subprojectId: leaf.id } })
    const deal = await api(a, "/api/crm/opportunities", 201, "POST", { title: "QA nested opportunity", enquiryId: lead.id, enquiryVersion: lead.version, contactId: person.id, assignedUserId: f.admin.id, pipelineId: pipeline.id, stageId: pipeline.stages[0].id, amount: "1000", currency: "INR", expectedCloseOn: "2027-12-01" })
    expect(deal.propertyContext.subprojectId).toBe(leaf.id)
    expect((await api(a, `/api/crm/enquiries?projectId=${root.id}&subprojectId=${nodes[2].id}`)).total).toBe(1)
    const quote = await api(a, `/api/crm/opportunities/${deal.id}/quotations`, 201, "POST", { content: { ...structuredClone(emptyQuotationContent), title: "SYNTHETIC launch agreement", supplierName: "QA Industries", currency: "INR", lines: [{ description: item.name, quantity: "1", unit: "plot", rate: "1000", catalogItemId: item.id, catalogItemVersion: item.version }] } })
    const order = await api(a, "/api/sales-orders", 200, "POST", { quotationId: quote.id, revision: 1 })
    const endpoint = `/api/sales-orders/${order.id}/reservations`, expiresAt = new Date(Date.now() + 86400000).toISOString()
    expect((await api(a, endpoint)).units[0].available).toBe(false)
    await api(a, endpoint, 409, "POST", { itemId: item.id, expiresAt })
    await page.getByRole("button", { name: "Edit QA Phase 1", exact: true }).click()
    await page.getByLabel("Booking status", { exact: true }).click()
    await page.getByRole("menuitemradio", { name: "Open", exact: true }).click()
    await page.getByRole("button", { name: "Save changes", exact: true }).click()
    await expect(page.getByRole("dialog")).toHaveCount(0)
    phase = (await api(a, `/api/real-estate/projects/${root.id}/launch-phases`)).items[0]
    const phaseEndpoint = `/api/real-estate/projects/${root.id}/launch-phases/${phase.id}`
    phase = await api(a, phaseEndpoint, 200, "PATCH", { name: phase.name, code: phase.code, status: "OPEN", opensAt: expiresAt, version: phase.version })
    await api(a, endpoint, 409, "POST", { itemId: item.id, expiresAt })
    phase = await api(a, phaseEndpoint, 200, "PATCH", { name: phase.name, code: phase.code, status: "OPEN", opensAt: null, version: phase.version })
    const held = await api(a, endpoint, 200, "POST", { itemId: item.id, expiresAt })
    await api(a, phaseEndpoint, 200, "PATCH", { name: phase.name, code: phase.code, status: "PAUSED", opensAt: null, version: phase.version })
    expect((await api(a, endpoint, 200, "POST", { itemId: item.id, expiresAt })).id).toBe(held.id)
    await api(a, `/api/sales-orders/${order.id}`, 200, "PATCH", { action: "confirm", version: order.version })
    const allocated = await api(a, `${endpoint}/${held.id}`, 200, "PATCH", { action: "allocate", version: held.version })
    expect(allocated.status).toBe("ALLOCATED")
    await api(a, `/api/sales-orders/${order.id}/receivables`, 200, "POST", { dueDates: [null] })
    await api(a, `/api/sales-orders/${order.id}/receivables/payments`, 200, "POST", { requestKey: randomUUID(), version: 1, amount: "100", receivedOn: String(order.orderedOn).slice(0, 10), method: "CASH", reference: "SYNTHETIC ONLY", note: "No real payment" })
    expect(String((await api(a, `/api/sales-orders/${order.id}/receivables`)).paid)).toBe("100")
    const officeAccess = await api(a, `/api/access/users/${f.reviewer.id}/offices`)
    await api(a, `/api/access/users/${f.reviewer.id}/offices`, 200, "PATCH", { version: officeAccess.version, officeIds: [root.officeId], companies: [], creationOfficeId: root.officeId })
    const role = await api(a, "/api/access/roles", 201, "POST", { name: "QA assigned project reader", permissions: ["dashboard.read", "projects.read", "catalogItems.read"] })
    const policy = await api(a, `/api/access/users/${f.reviewer.id}`), rules = defaultRecordRules()
    rules["projects.read"] = "ASSIGNED"
    await api(a, `/api/access/users/${f.reviewer.id}`, 200, "PATCH", { version: policy.accessPolicy.version, roleIds: [role.id], rules })
    await api(f.reviewer.context, `/api/real-estate/projects/${leaf.id}`, 404)
    const current = await api(a, `/api/real-estate/projects/${root.id}`)
    await api(a, `/api/real-estate/projects/${root.id}/members`, 200, "PATCH", { version: current.version, userId: f.reviewer.id })
    expect((await api(f.reviewer.context, `/api/real-estate/projects/${leaf.id}`)).id).toBe(leaf.id)
    expect((await api(f.reviewer.context, `/api/real-estate/projects/${leaf.id}/launch-phases`)).canManage).toBe(false)
    await api(f.reviewer.context, `/api/real-estate/projects/${root.id}/launch-phases`, 403, "POST", { name: "Forbidden", code: "NO", status: "OPEN" })
    await page.reload()
    await expect(page.getByText("Paused", { exact: true })).toBeVisible()
    await page.screenshot({ path: info.outputPath("hierarchy-launch-desktop.png"), fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
    await page.screenshot({ path: info.outputPath("hierarchy-launch-mobile.png"), fullPage: true })
    expect(errors).toEqual([])
    fs.writeFileSync(`tmp/project-hierarchy-staging/acceptance.json`, JSON.stringify({ source: f.receipt.source, deployment: f.receipt.deployment, tenantId: f.receipt.tenantId, levels: nodes.length, phaseControls: true, retainedAllocation: allocated.id, accessInheritance: true, pageErrors: errors.length, at: new Date().toISOString(), run: randomUUID() }, null, 2), { mode: 0o600 })
  } finally { await f.close() }
})
