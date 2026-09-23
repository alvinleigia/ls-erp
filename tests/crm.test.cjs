/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require("node:test")
const assert = require("node:assert/strict")
const { crmContactSchema, crmEnquiryUpdateSchema, crmEnquiryCreateSchema, crmTaskSchema, crmListSchema } = require("../modules/crm/validation.ts")
const { contactScope, enquiryScope, canUseCrm } = require("../modules/crm/policy.ts")
const pricing = require("../lib/appointments/order-pricing.ts")
const { crmAccountSchema, crmAccountLinkSchema } = require("../modules/crm/validation.ts")
const { pipelineSchema, opportunitySchema, opportunityMoveSchema } = require("../modules/crm/sales-validation.ts")

test("opportunity money formatting respects business settings without losing precision", () => {
  const { formatDecimalCurrency } = require("../lib/formatting.ts")
  assert.equal(formatDecimalCurrency("99999999999999.9999", "INR"), "INR 99,999,999,999,999.9999")
  assert.equal(formatDecimalCurrency("1234.5678", "EUR", { numberFormat: "EUROPEAN", currencySymbolPlacement: "AFTER" }), "1.234,5678 EUR")
  assert.equal(formatDecimalCurrency("1000", "JPY"), "JPY 1,000")
  assert.equal(formatDecimalCurrency("1", "KWD"), "KWD 1.000")
})

test("configurable stages validate outcomes, unique names and required active stages", () => {
  const stages = [{ name: "Open", kind: "OPEN", probability: 25, color: "#123456" }, { name: "Won", kind: "WON", probability: 100, color: "#123456" }, { name: "Lost", kind: "LOST", probability: 0, color: "#123456" }]
  assert.equal(pipelineSchema.safeParse({ name: "Custom process", stages }).success, true)
  for (const bad of [stages.slice(0, 2), stages.map(s => ({ ...s, name: "Same" })), stages.map(s => ({ ...s, probability: 50 })), stages.map(s => ({ ...s, archived: true })), stages.map(s => ({ ...s, color: "url(evil)" }))]) {
    assert.equal(pipelineSchema.safeParse({ name: "Pipeline", stages: bad }).success, false)
  }
})

test("opportunities validate exact money, currency, date and server-owned fields", () => {
  const input = { title: "Deal", pipelineId: "p", stageId: "s", contactId: "c", assignedUserId: "u", amount: "99999999999999.9999", currency: "inr", expectedCloseOn: "2026-10-01" }
  assert.equal(opportunitySchema.parse(input).currency, "INR")
  for (const amount of ["-1", "1e3", "1.12345", "100000000000000", 10]) assert.equal(opportunitySchema.safeParse({ ...input, amount }).success, false)
  for (const extra of [{ currency: "XYZ" }, { expectedCloseOn: "2026-02-30" }, { tenantId: "other" }, { closedAt: "2026-01-01" }]) assert.equal(opportunitySchema.safeParse({ ...input, ...extra }).success, false)
  assert.equal(opportunityMoveSchema.safeParse({ pipelineId: "p", stageId: "s", version: 0 }).success, false)
})

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
test("business accounts normalize contact details and allow only safe website protocols", () => {
  const account = crmAccountSchema.parse({ name: " Example Ltd ", email: " OFFICE@EXAMPLE.COM ", website: " https://example.com " })
  assert.equal(account.name, "Example Ltd")
  assert.equal(account.email, "office@example.com")
  assert.equal(account.website, "https://example.com")
  for (const website of ["javascript:alert(1)", "file:///tmp/test", "https://user:password@example.com", "invalid"]) {
    assert.equal(crmAccountSchema.safeParse({ name: "Company", website }).success, false)
  }
  assert.equal(crmAccountSchema.safeParse({ name: "Company", ownerUserId: "other" }).success, false)
  assert.equal(crmAccountLinkSchema.safeParse({ accountId: "account", tenantId: "other" }).success, false)
})
