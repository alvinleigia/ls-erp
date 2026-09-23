/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require("node:test")
const assert = require("node:assert/strict")
const { crmContactSchema, crmEnquiryUpdateSchema, crmEnquiryCreateSchema, crmTaskSchema, crmListSchema } = require("../modules/crm/validation.ts")
const { contactScope, enquiryScope, canUseCrm } = require("../modules/crm/policy.ts")
const pricing = require("../lib/appointments/order-pricing.ts")

test("contacts need no login and normalize identifiers before duplicate checks", () => {
  assert.deepEqual(crmContactSchema.parse({ name: " A Buyer ", email: " BUYER@EXAMPLE.COM ", phone: "+91 (98765) 43210" }), { name: "A Buyer", email: "buyer@example.com", phone: "+919876543210" })
  assert.equal(crmContactSchema.parse({ name: "Walk-in" }).email, "")
  assert.equal(crmContactSchema.safeParse({ name: "A", tenantId: "another-business" }).success, false)
  assert.equal(crmContactSchema.safeParse({ name: "A", ownerUserId: "another-user" }).success, false)
  assert.equal(crmContactSchema.safeParse({ name: "A", phone: "9876543210" }).success, false)
})
test("closed enquiries require an outcome and reject client-controlled tenancy", () => {
  const input = { title: "Flat enquiry", assignedUserId: "salesperson", status: "CLOSED", version: 1 }
  assert.equal(crmEnquiryUpdateSchema.safeParse(input).success, false)
  assert.equal(crmEnquiryUpdateSchema.safeParse({ ...input, outcome: "Not proceeding" }).success, true)
  assert.equal(crmEnquiryCreateSchema.safeParse({ title: "A", contactId: "c", assignedUserId: "u", tenantId: "b" }).success, false)
})
test("follow-up dates and bounded pagination are validated", () => {
  assert.equal(crmTaskSchema.safeParse({ title: "Call", dueOn: "2026-02-30" }).success, false)
  assert.equal(crmTaskSchema.safeParse({ title: "Call", dueOn: "2026-09-24" }).success, true)
  assert.equal(crmListSchema.safeParse({ page: 0 }).success, false)
  assert.equal(crmListSchema.safeParse({ pageSize: 101 }).success, false)
})
test("staff scopes include tenant and ownership, and customers cannot use CRM", () => {
  const actor = { tenantId: "a", userId: "staff", role: "STAFF" }
  assert.deepEqual(enquiryScope(actor), { tenantId: "a", assignedUserId: "staff" })
  assert.equal(contactScope(actor).OR[1].enquiries.some.tenantId, "a")
  assert.deepEqual(enquiryScope({ ...actor, role: "MANAGER" }), { tenantId: "a" })
  assert.equal(canUseCrm("CUSTOMER"), false)
  assert.throws(() => enquiryScope({ ...actor, role: "CUSTOMER" }), { status: 403 })
})
test("existing salon pricing keeps discount caps and tax calculation", () => {
  assert.deepEqual(pricing.calculateLineAmounts({ quantity: 2, unitPriceCents: 10000, discountType: "PERCENT", discountValue: 10 }), { lineSubtotalCents: 20000, lineDiscountCents: 2000, lineTotalCents: 18000 })
  assert.equal(pricing.calculateDiscountCents("AMOUNT", 500, 10000), 10000)
  assert.equal(pricing.calculateTaxBreakdown(18000, [{ id: "tax", name: "GST", percent: 18 }])[0].taxCents, 3240)
})
