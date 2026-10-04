import { test, expect } from "@playwright/test"
import { PDFDocument } from "pdf-lib"
import { seed, login, json, password } from "./fixtures"

test.describe.configure({ mode: "serial" })
let fixture: Awaited<ReturnType<typeof seed>>
let admin: Awaited<ReturnType<typeof login>>, staff: typeof admin, manager: typeof admin
let service: { id: string }, customer: { id: string }, product: { id: string }, order: { id: string }
const date = "2030-10-08", startAt = "2030-10-08T04:30:00Z" // 10:00 Asia/Kolkata

test.beforeAll(async ({ browser }) => {
  fixture = await seed()
  admin = await login(browser, fixture.origin, fixture.users.admin.email, "America/Los_Angeles")
  staff = await login(browser, fixture.origin, fixture.users.staff.email, "America/Los_Angeles")
  manager = await login(browser, fixture.origin, fixture.users.manager.email, "America/Los_Angeles")
})
test.afterAll(async () => {
  for (const actor of [admin, staff, manager]) await actor?.context.close()
  await fixture?.db.end()
})

test("service, employee and shift setup makes the requested booking slot available", async () => {
  const category = (await json(admin.context, "/api/service-categories", 200, "POST", { name: "Consultations" })).item
  service = (await json(admin.context, "/api/services", 200, "POST", { name: "Customer consultation", categoryId: category.id, durationMinutes: 60, priceCents: 12000, status: "ACTIVE" })).item
  await json(admin.context, `/api/users/${fixture.users.staff.id}`, 200, "PATCH", { eligibleServiceIds: [service.id], staffProfile: { managerUserId: fixture.users.manager.id, schedulingMode: "STANDARD" } })
  customer = (await json(admin.context, "/api/users", 200, "POST", { name: "Local Booking Customer", email: `booking@${fixture.slug}.test`, role: "CUSTOMER", password })).user
  const template = (await json(admin.context, "/api/shifts/templates", 200, "POST", { name: "Office hours", startTime: "09:00", endTime: "17:00", breaks: [], isActive: true })).template
  const schedule = (await json(admin.context, "/api/shifts/schedules", 200, "POST", { name: "Local office schedule", isDefault: false, staffIds: [fixture.users.staff.id], startDate: "2030-10-07", assignmentStartDate: "2030-10-07", weekOffDay1: "SUNDAY", blocks: [{ templateId: template.id, repeatDays: 5 }] })).schedule
  expect(schedule.assignments).toHaveLength(1)
  const available = await json(admin.context, "/api/appointments/availability", 200, "POST", { serviceId: service.id, staffId: fixture.users.staff.id, customerId: customer.id, startAt })
  expect(available.available, JSON.stringify(available)).toBe(true)
})

test("purchase receiving updates stock once and confirmed booking consumes it", async () => {
  const category = (await json(admin.context, "/api/inventory/categories", 201, "POST", { name: "Local supplies" })).item
  const supplier = (await json(admin.context, "/api/inventory/suppliers", 201, "POST", { name: "Local supplier" })).item
  product = (await json(admin.context, "/api/inventory/products", 201, "POST", { name: "Consultation kit", sku: "KIT-LOCAL", categoryId: category.id, costPriceCents: 1000, mrpCents: 1500, onHandQty: 0, reorderPoint: 2 })).item
  const purchase = (await json(admin.context, "/api/inventory/purchases", 201, "POST", { supplierId: supplier.id, orderDate: "2030-10-07", items: [{ productId: product.id, quantity: 5, unitCostCents: 1000 }] })).item
  for (let repeat = 0; repeat < 2; repeat++) await json(admin.context, `/api/inventory/purchases/${purchase.id}`, 200, "PATCH", { status: "RECEIVED" })
  expect((await json(admin.context, "/api/inventory/products?q=KIT-LOCAL")).items[0].onHandQty).toBe(5)
  await json(admin.context, "/api/appointments/coupons", 201, "POST", { code: "WELCOME", discountType: "AMOUNT", discountValue: 5 })
  order = (await json(admin.context, "/api/appointments/orders", 201, "POST", {
    customerId: customer.id, appointmentDate: date, appointmentStartTime: "10:00", appointmentStartAt: startAt, status: "DRAFT",
    coupons: ["WELCOME"],
    lines: [{ serviceId: service.id, staffId: fixture.users.staff.id, quantity: 1, durationMinutes: 60, unitPriceCents: 12000, discountType: "NONE", discountValue: 0 }],
    productLines: [{ productId: product.id, quantity: 2, unitPriceCents: 1500, discountType: "NONE", discountValue: 0 }],
  })).order
  expect((await json(admin.context, "/api/inventory/products?q=KIT-LOCAL")).items[0].onHandQty).toBe(5)
  const confirmed = (await json(admin.context, `/api/appointments/orders/${order.id}`, 200, "PATCH", { status: "CONFIRMED" })).order
  expect(confirmed.status).toBe("CONFIRMED")
  expect(confirmed.productLines).toHaveLength(1)
  expect(confirmed.coupons[0].code).toBe("WELCOME")
  expect(confirmed.totalCents).toBe(14500)
  expect((await json(admin.context, "/api/inventory/products?q=KIT-LOCAL")).items[0].onHandQty).toBe(3)
  const unavailable = await json(admin.context, "/api/appointments/availability", 200, "POST", { serviceId: service.id, staffId: fixture.users.staff.id, customerId: customer.id, startAt })
  expect(unavailable.available).toBe(false)
})

test("booking cancellation restores stock once and keeps a readable invoice", async () => {
  for (let repeat = 0; repeat < 2; repeat++) {
    const result = (await json(admin.context, `/api/appointments/orders/${order.id}`, 200, "PATCH", { status: "CANCELED" })).order
    expect(result.status).toBe("CANCELED")
  }
  expect((await json(admin.context, "/api/inventory/products?q=KIT-LOCAL")).items[0].onHandQty).toBe(5)
  const available = await json(admin.context, "/api/appointments/availability", 200, "POST", { serviceId: service.id, staffId: fixture.users.staff.id, customerId: customer.id, startAt })
  expect(available.available).toBe(true)
  const invoice = await admin.context.request.get(`/api/appointments/orders/${order.id}/invoice`)
  expect(invoice.status()).toBe(200)
  expect(invoice.headers()["content-type"]).toContain("application/pdf")
  expect((await PDFDocument.load(await invoice.body())).getPageCount()).toBeGreaterThan(0)
  await json(admin.context, `/api/appointments/orders/${order.id}`, 409, "PATCH", { status: "CONFIRMED", productLines: [{ productId: product.id, quantity: 6, unitPriceCents: 1500, discountType: "NONE", discountValue: 0 }] })
  expect((await json(admin.context, `/api/appointments/orders/${order.id}`)).order.status).toBe("CANCELED")
  expect((await json(admin.context, "/api/inventory/products?q=KIT-LOCAL")).items[0].onHandQty).toBe(5)
  const cleared = (await json(admin.context, `/api/appointments/orders/${order.id}`, 200, "PATCH", { coupons: [], productLines: [] })).order
  expect(cleared.productLines).toHaveLength(0)
  expect(cleared.coupons).toHaveLength(0)
  expect(cleared.totalCents).toBe(12000)
})

test("staff leave submission and manager approval affect booking availability and audit history", async () => {
  const definition = (await json(admin.context, "/api/leaves/definitions", 201, "POST", { code: "AL", name: "Annual leave", leaveType: "PAID", minDaysPerRequest: 1, maxDaysPerRequest: 10, maxPendingRequests: 5 })).item
  await json(admin.context, "/api/leaves/groups", 201, "POST", { code: "OFFICE", name: "Office staff", assignmentMode: "SELECTED_STAFF", leaveDefinitionIds: [definition.id], staffIds: [fixture.users.staff.id], status: "ACTIVE" })
  const leave = (await json(staff.context, "/api/leaves/requests", 201, "POST", { leaveDefinitionId: definition.id, startDate: date, endDate: date, reason: "Local workflow leave" })).item
  expect(leave.status).toBe("PENDING")
  await json(staff.context, `/api/leaves/requests/${leave.id}/review`, 403, "PATCH", { status: "APPROVED" })
  const approved = (await json(manager.context, `/api/leaves/requests/${leave.id}/review`, 200, "PATCH", { status: "APPROVED", reviewerComment: "Approved by direct manager" })).item
  expect(approved.status).toBe("APPROVED")
  const available = await json(admin.context, "/api/appointments/availability", 200, "POST", { serviceId: service.id, staffId: fixture.users.staff.id, customerId: customer.id, startAt })
  expect(available.available).toBe(false)
  expect(available.reason).toMatch(/leave/i)
  const audit = await json(admin.context, `/api/reports/audit-logs?entityId=${leave.id}`)
  expect(audit.items.some((r: { actorUserId: string }) => r.actorUserId === fixture.users.manager.id)).toBe(true)
  await staff.page.goto("/leaves/requests")
  await expect(staff.page.getByText("Local workflow leave", { exact: true })).toBeVisible()
  await expect(staff.page.getByRole("row").filter({ hasText: "Local workflow leave" })).toContainText("08/10/2030")
  await expect(staff.page.getByRole("row").filter({ hasText: "Local workflow leave" })).toContainText("Asia/Kolkata")
  await staff.page.screenshot({ path: test.info().outputPath("approved-leave.png"), fullPage: true, animations: "disabled" })
  await staff.page.getByRole("button", { name: "Record actions" }).click()
  await staff.page.getByRole("menuitem", { name: "View details" }).click()
  await expect(staff.page.getByText("08/10/2030", { exact: true }).first()).toBeVisible()
  await expect(staff.page.getByText(/Asia\/Kolkata/).last()).toBeVisible()
  await staff.page.screenshot({ path: test.info().outputPath("leave-history.png"), fullPage: true, animations: "disabled" })
})

test("leave conflict preview and saved appointment use tenant time in a Los Angeles browser", async () => {
  const appointment = (await json(admin.context, "/api/appointments", 201, "POST", { serviceId: service.id, staffId: fixture.users.staff.id, customerId: customer.id, startAt: "2030-10-09T04:30:00Z" })).appointment
  await json(admin.context, "/api/appointments/resolve", 400, "POST", { action: "reschedule", appointmentIds: [appointment.id], rescheduleDate: "2030-02-30", rescheduleTime: "10:00" })
  expect((await json(admin.context, `/api/appointments/${appointment.id}`)).appointment.startAt).toBe("2030-10-09T04:30:00.000Z")
  const definition = (await json(admin.context, "/api/leaves/definitions")).items.find((item: { code: string }) => item.code === "AL")
  const leave = (await json(staff.context, "/api/leaves/requests", 201, "POST", { leaveDefinitionId: definition.id, startDate: "2030-10-09", endDate: "2030-10-09", reason: "Timezone conflict test" })).item
  await manager.page.goto("/leaves/approvals")
  const row = manager.page.getByRole("row").filter({ hasText: "Timezone conflict test" })
  await expect(row).toContainText("09/10/2030")
  await row.getByRole("button", { name: "Record actions" }).click()
  await manager.page.getByRole("menuitem", { name: "Approve", exact: true }).click()
  await manager.page.getByLabel("Reschedule date", { exact: true }).fill("2030-10-10")
  await manager.page.getByLabel("Reschedule start time (Asia/Kolkata)", { exact: true }).fill("10:00")
  await expect(manager.page.getByText("10/10/2030 10:00 (Asia/Kolkata)", { exact: false })).toBeVisible()
  await manager.page.screenshot({ path: test.info().outputPath("leave-reschedule.png"), fullPage: true, animations: "disabled" })
  const resolved = manager.page.waitForResponse(response => response.url().endsWith("/api/appointments/resolve") && response.request().method() === "POST")
  const reviewed = manager.page.waitForResponse(response => response.url().endsWith(`/api/leaves/requests/${leave.id}/review`) && response.request().method() === "PATCH")
  await manager.page.getByRole("button", { name: "Reschedule conflicts and approve", exact: true }).click()
  const resolution = await resolved
  expect(resolution.request().postDataJSON()).toMatchObject({ action: "reschedule", rescheduleDate: "2030-10-10", rescheduleTime: "10:00", appointmentIds: [appointment.id] })
  expect(resolution.status()).toBe(200)
  expect((await reviewed).status()).toBe(200)
  await expect(manager.page.getByRole("button", { name: "Reschedule conflicts and approve", exact: true })).not.toBeVisible()
  await expect(row).toHaveCount(0) // Approved rows leave the default Pending queue.
  const saved = (await json(admin.context, `/api/appointments/${appointment.id}`)).appointment
  expect(saved.startAt).toBe("2030-10-10T04:30:00.000Z")
  expect(saved.endAt).toBe("2030-10-10T05:30:00.000Z")
  expect((await json(staff.context, `/api/leaves/requests/${leave.id}`)).item.status).toBe("APPROVED")
})
