import { test, expect } from "@playwright/test"
import { randomUUID } from "node:crypto"
import { seed, login, json } from "./fixtures"
import { emptyQuotationContent } from "../../modules/sales-documents/quotation-validation"

test("private quotations and orders protect financial children while unique-item availability stays authoritative", async ({ browser }) => {
  const fixture = await seed(), admin = await login(browser, fixture.origin, fixture.users.admin.email), manager = await login(browser, fixture.origin, fixture.users.manager.email), staff = await login(browser, fixture.origin, fixture.users.staff.email)
  async function share(resource: string, id: string, restricted: boolean, level?: string) {
    const before = await json(admin.context, `/api/access/records/${resource}/${id}`)
    await json(admin.context, `/api/access/records/${resource}/${id}`, 200, "PATCH", { version: before.version, restricted, grants: level ? [{ kind: "USER", id: fixture.users.staff.id, level }] : [] })
  }
  try {
    const contact = await json(admin.context, "/api/crm/contacts", 201, "POST", { name: "Private agreement customer" })
    const pipeline = await json(admin.context, "/api/crm/pipelines", 201, "POST", { name: "Private agreement pipeline", stages: [{ name: "Open", kind: "OPEN", probability: 10, color: "#123456" }, { name: "Won", kind: "WON", probability: 100, color: "#00aa00" }, { name: "Lost", kind: "LOST", probability: 0, color: "#aa0000" }] })
    const deal = await json(admin.context, "/api/crm/opportunities", 201, "POST", { title: "Private agreement", contactId: contact.id, assignedUserId: fixture.users.admin.id, pipelineId: pipeline.id, stageId: pipeline.stages[0].id, amount: "100", currency: "INR", expectedCloseOn: "2030-10-31" })
    const item = await json(admin.context, "/api/catalog/items", 201, "POST", { code: "PRIVATE-UNIT", name: "Private agreement unit", kind: "UNIT", unit: "unit", price: "100", currency: "INR" })
    const quote = await json(admin.context, `/api/crm/opportunities/${deal.id}/quotations`, 201, "POST", { content: { ...structuredClone(emptyQuotationContent), title: "Private agreement quote", supplierName: "QA R9", currency: "INR", lines: [{ description: item.name, quantity: "1", unit: "unit", rate: "100", catalogItemId: item.id, catalogItemVersion: item.version }] } })
    const order = await json(admin.context, "/api/sales-orders", 200, "POST", { quotationId: quote.id, revision: 1 })
    await json(admin.context, `/api/sales-orders/${order.id}`, 200, "PATCH", { action: "confirm", version: 1 })
    const path = `/api/sales-orders/${order.id}/receivables`
    const proposed = await json(admin.context, path)
    await json(admin.context, path, 200, "POST", { dueDates: proposed.plan.lines.map(() => null) })
    await json(admin.context, `/api/sales-orders/${order.id}/reservations`, 200, "POST", { itemId: item.id, expiresAt: new Date(Date.now() + 86400000).toISOString() })
    await share("quotations", quote.id, true)
    for (const endpoint of [`/api/crm/quotations/${quote.id}`, `/api/sales-orders/${order.id}`, path, `/api/sales-orders/${order.id}/reservations`]) await json(manager.context, endpoint, 404)
    expect((await manager.context.request.get(`/api/crm/quotations/${quote.id}/pdf`)).status()).toBe(404)
    await share("salesOrders", order.id, true, "READ")
    await json(staff.context, `/api/sales-orders/${order.id}`, 404)
    await share("quotations", quote.id, false)
    await json(staff.context, `/api/sales-orders/${order.id}`)
    const readable = await json(staff.context, path)
    expect(readable.canRecord).toBe(false)
    expect((await json(staff.context, `/api/sales-orders/${order.id}/reservations`)).items).toHaveLength(1)
    expect((await json(manager.context, "/api/receivables")).total).toBe(0)
    expect((await json(manager.context, `/api/catalog/items/${item.id}`)).reservationState).toBe("RESERVED")
    expect((await json(manager.context, "/api/catalog/items?availability=AVAILABLE")).total).toBe(0)
    const payment = { requestKey: randomUUID(), version: readable.account.version, amount: "10", receivedOn: readable.today, method: "CASH", reference: "QA R9 sharing", note: "Hosted selected-access check" }
    await json(staff.context, path + "/payments", 404, "POST", payment)
    await share("salesOrders", order.id, true, "EDIT")
    expect((await json(staff.context, path)).canRecord).toBe(true)
    await json(staff.context, path + "/payments", 200, "POST", payment)
    await share("salesOrders", order.id, true)
    await json(staff.context, path, 404)
  } finally { await staff.context.close(); await manager.context.close(); await admin.context.close(); await fixture.db.end() }
})
