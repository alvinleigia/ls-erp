/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require("node:test")
const assert = require("node:assert/strict")
const { crmContactSchema, crmEnquiryUpdateSchema, crmEnquiryCreateSchema, crmTaskSchema, crmListSchema } = require("../modules/crm/validation.ts")
const { contactScope, enquiryScope, canUseCrm } = require("../modules/crm/policy.ts")
const pricing = require("../lib/appointments/order-pricing.ts")
const { crmAccountSchema, crmAccountLinkSchema } = require("../modules/crm/validation.ts")
const { pipelineSchema, opportunitySchema, opportunityMoveSchema } = require("../modules/crm/sales-validation.ts")
const { workCreateSchema, workCompleteSchema, workListSchema } = require("../modules/crm/work-validation.ts")
const { wallTimeToInstant, wallTime } = require("../modules/crm/work-time.ts")
const { startOfBusinessDate } = require("../modules/crm/work-time.ts")
const { activityReportSchema, activityReportPageSchema } = require("../modules/crm/report-validation.ts")
const { activityPlanSchema, applyPlanSchema } = require("../modules/crm/plan-validation.ts")
const { followUpRuleSchema } = require("../modules/crm/follow-up-validation.ts")

test("follow-up rules validate matching outcomes, bounded chains and server-owned origins", () => {
  const rule = { name: "Retry", sourceType: "CALL", outcome: "NO_ANSWER", nextStep: { title: "Retry call", type: "CALL", callDirection: "OUTBOUND", dayOffset: 1 } }
  assert.equal(followUpRuleSchema.parse(rule).maxDepth, 3)
  for (const extra of [{ outcome: "DONE" }, { maxDepth: 0 }, { maxDepth: 11 }, { tenantId: "other" }, { version: 1 }, { nextStep: { ...rule.nextStep, dayOffset: 366 } }]) assert.equal(followUpRuleSchema.safeParse({ ...rule, ...extra }).success, false)
  const work = { title: "Call", type: "CALL", callDirection: "OUTBOUND", contactId: "c", assignedUserId: "u", dueOn: "2026-10-01" }
  for (const extra of [{ automationDepth: 0 }, { followUpRuleId: "r" }, { followUpRuleVersion: 1 }]) assert.equal(workCreateSchema.safeParse({ ...work, ...extra }).success, false)
  const completion = { version: 1, summary: "No answer", outcome: "NO_ANSWER", occurredAt: new Date().toISOString() }
  assert.equal(workCompleteSchema.safeParse({ ...completion, ruleDecision: { id: "r", version: 1, action: "APPLY", dueOn: "2026-10-02", reminderAt: null } }).success, true)
  assert.equal(workCompleteSchema.safeParse({ ...completion, ruleDecision: { id: "r", version: 0, action: "APPLY" } }).success, false)
  assert.equal(workCreateSchema.safeParse({ ...work, completion: { ...completion, ruleDecision: { id: "r", version: 1, action: "SKIP", reason: "Past log" } } }).success, false)
})

test("activity plans bound their steps, calendar offsets and reminder times", () => {
  const step = { title: "Call", type: "CALL", callDirection: "OUTBOUND", dayOffset: 0, reminderTime: "09:30" }
  assert.equal(activityPlanSchema.safeParse({ name: "Follow up", steps: [step] }).success, true)
  for (const steps of [[], Array(13).fill(step), [{ ...step, callDirection: null }], [{ ...step, reminderTime: "25:00" }], [{ ...step, dayOffset: -1 }], [{ ...step, dayOffset: 366 }], [{ ...step, dayOffset: 2 }, step]]) assert.equal(activityPlanSchema.safeParse({ name: "Plan", steps }).success, false)
  assert.equal(activityPlanSchema.safeParse({ name: "Plan", steps: [step], tenantId: "other" }).success, false)
  assert.equal(applyPlanSchema.safeParse({ version: 1, requestKey: "not-a-uuid", startOn: "2026-01-01", contactId: "c", assignedUserId: "u" }).success, false)
})

test("activity reporting bounds periods, validates filters and rejects client-controlled scope fields", () => {
  assert.equal(activityReportSchema.parse({}).scope, "mine")
  assert.equal(activityReportSchema.safeParse({ from: "2026-01-01", through: "2026-01-01" }).success, true)
  for (const input of [{ from: "2026-01-01" }, { through: "2026-01-01" }, { from: "2026-02-01", through: "2026-01-01" }, { from: "2025-01-01", through: "2026-02-01" }, { tenantId: "other" }, { scope: "all" }, { type: "UNKNOWN" }]) assert.equal(activityReportSchema.safeParse(input).success, false)
  assert.equal(activityReportPageSchema.safeParse({ pageSize: 101 }).success, false)
  assert.equal(workListSchema.safeParse({ completedFrom: "2026-01-01" }).success, false)
})

test("report boundaries include local dates with skipped midnight and daylight-saving changes", () => {
  assert.equal(startOfBusinessDate("2026-01-10", "Asia/Kolkata").toISOString(), "2026-01-09T18:30:00.000Z")
  assert.equal(startOfBusinessDate("2026-03-09", "America/New_York") - startOfBusinessDate("2026-03-08", "America/New_York"), 23 * 3600000)
  assert.equal(startOfBusinessDate("2026-11-02", "America/New_York") - startOfBusinessDate("2026-11-01", "America/New_York"), 25 * 3600000)
  assert.equal(startOfBusinessDate("2018-11-04", "America/Sao_Paulo").toISOString(), "2018-11-04T03:00:00.000Z")
  assert.equal(startOfBusinessDate("2011-12-30", "Pacific/Apia").toISOString(), startOfBusinessDate("2011-12-31", "Pacific/Apia").toISOString())
})

test("activity schedules validate timed windows, call direction, reminders and strict tenancy", () => {
  const data = { title: "Call", type: "CALL", assignedUserId: "u", contactId: "c", dueOn: "2026-10-01", callDirection: "OUTBOUND", startsAt: "2026-10-01T10:00:00Z", endsAt: "2026-10-01T10:30:00Z", reminderAt: "2026-10-01T09:45:00Z" }
  assert.equal(workCreateSchema.safeParse(data).success, true)
  for (const extra of [{ callDirection: null }, { endsAt: null }, { endsAt: data.startsAt }, { endsAt: "2026-10-03T10:00:00Z" }, { reminderAt: data.endsAt }, { tenantId: "other" }, { enquiryId: "e", opportunityId: "o" }]) assert.equal(workCreateSchema.safeParse({ ...data, ...extra }).success, false)
  assert.equal(workCompleteSchema.safeParse({ version: 1, summary: " ", outcome: "DONE", occurredAt: new Date().toISOString() }).success, false)
  assert.equal(workListSchema.safeParse({ from: "2026-01-01", to: "2026-12-31" }).success, false)
})
test("calendar conversions respect business time zone and reject daylight-saving gaps and ambiguous hours", () => {
  assert.equal(wallTimeToInstant("2026-10-01T09:30", "Asia/Kolkata"), "2026-10-01T04:00:00.000Z")
  assert.equal(wallTime("2026-10-01T04:00:00Z", "Asia/Kolkata"), "2026-10-01T09:30")
  assert.throws(() => wallTimeToInstant("2026-03-08T02:30", "America/New_York"), /does not exist/)
  assert.throws(() => wallTimeToInstant("2026-11-01T01:30", "America/New_York"), /occurs twice/)
  assert.equal(wallTimeToInstant("2026-11-01T03:30", "America/New_York"), "2026-11-01T08:30:00.000Z")
})

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
test("enquiry reason input is structured; transition requirements are checked by the service", () => {
  const input = { title: "Flat enquiry", assignedUserId: "salesperson", status: "CLOSED", version: 1 }
  assert.equal(crmEnquiryUpdateSchema.safeParse(input).success, true)
  assert.equal(crmEnquiryUpdateSchema.safeParse({ ...input, lostReasonId: "reason-id" }).success, true)
  assert.equal(crmEnquiryUpdateSchema.safeParse({ ...input, lostReasonName: "Spoofed" }).success, false)
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
  assert.deepEqual(enquiryScope(actor), { tenantId: "a", AND: [{ OR: [{ assignedUserId: "staff" }] }] })
  assert.equal(contactScope(actor).AND[0].OR[1].enquiries.some.tenantId, "a")
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


test("conversion defaults accept one active open stage and reject closed, archived or duplicate defaults", () => {
  const stages = [
    { id: "first", name: "Discovery", kind: "OPEN", probability: 10, color: "#123456" },
    { id: "qualified", name: "Qualified", kind: "OPEN", probability: 40, color: "#123456", isConversionDefault: true },
    { id: "won", name: "Won", kind: "WON", probability: 100, color: "#123456" },
    { id: "lost", name: "Lost", kind: "LOST", probability: 0, color: "#123456" },
  ]
  assert.equal(pipelineSchema.safeParse({ name: "Sales", stages }).success, true)
  for (const index of [0, 2, 3]) assert.equal(pipelineSchema.safeParse({ name: "Sales", stages: stages.map((s, i) => ({ ...s, isConversionDefault: i === index || i === 1 })) }).success, false)
  assert.equal(pipelineSchema.safeParse({ name: "Sales", stages: stages.map(s => ({ ...s, archived: s.id === "qualified" })) }).success, false)
  for (const index of [2, 3]) assert.equal(pipelineSchema.safeParse({ name: "Sales", stages: stages.map((s, i) => ({ ...s, isConversionDefault: i === index })) }).success, false)
  const { initialOpportunityStage } = require("../modules/crm/conversion-stage.ts")
  assert.equal(initialOpportunityStage(stages, true).id, "qualified")
  assert.equal(initialOpportunityStage(stages, false).id, "first")
  assert.equal(initialOpportunityStage(stages.map(s => ({ ...s, isConversionDefault: false })), true).id, "first")
  assert.equal(initialOpportunityStage(stages.map(s => ({ ...s, archived: s.id === "qualified" })), true).id, "first")
  assert.equal(initialOpportunityStage(stages.filter(s => s.kind !== "OPEN"), true), undefined)
})
