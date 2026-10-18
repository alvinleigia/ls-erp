/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require("node:test")
const assert = require("node:assert/strict")
const { ZodError } = require("zod")
const { BusinessError } = require("../platform/policy.ts")
const { termText, resolveTermText } = require("../platform/terminology/message.ts")
const { createTermResolver } = require("../platform/terminology/resolver.ts")
const { presentTermError, createTermErrorPresenter } = require("../platform/terminology/error-presentation.ts")
const { terminologyCatalog } = require("../application/terminology/catalog.ts")
const { crmEnquiryCreateSchema } = require("../modules/crm/validation.ts")
const { workCreateSchema } = require("../modules/crm/work-validation.ts")
const { applyPlanSchema } = require("../modules/crm/plan-validation.ts")
const { prepareRuleFollowUp } = require("../modules/crm/follow-up-service.ts")
const { createWorkService } = require("../modules/crm/work-service.ts")

test("explicit error parts preserve canonical message, status and literal user content", () => {
  const literal = "Saved contact {label} $&", error = new BusinessError(409, [literal, ": ", termText("crm.contact.singular", "Contact changed.", "{label} changed.")])
  const before = error.message
  assert.equal(error.status, 409)
  assert.equal(presentTermError(error, createTermResolver({ "crm.contact.singular": "Buyer $&" })).error, `${literal}: Buyer $& changed.`)
  assert.equal(error.message, before)
  assert.equal(resolveTermText(error.presentation), before)
  assert.equal(presentTermError(new BusinessError(400, "Contact changed."), createTermResolver({ "crm.contact.singular": "Buyer" })), undefined)
  assert.equal(presentTermError(new Error("Contact changed."), createTermResolver({})), undefined)
})

test("Zod presentation retains field paths and canonical validation issues", () => {
  const result = crmEnquiryCreateSchema.safeParse({ title: "Lead", assignedUserId: "staff" })
  assert.equal(result.success, false)
  const before = JSON.stringify(result.error.issues)
  assert.equal(presentTermError(result.error, createTermResolver({ "crm.contact.singular": "Person" })).details.fieldErrors.contactId[0], "Choose an existing Person or enter a new Person.")
  assert.equal(JSON.stringify(result.error.issues), before)
  assert.deepEqual(presentTermError(result.error, createTermResolver({})).details, result.error.flatten())
  for (const [schema,input] of [
    [workCreateSchema, { title: "Call", type: "TASK", dueOn: "2030-01-01", assignedUserId: "staff", contactId: "contact", enquiryId: "lead", opportunityId: "deal" }],
    [applyPlanSchema, { version: 1, requestKey: "12345678-1234-4234-8234-123456789012", startOn: "2030-01-01", contactId: "contact", assignedUserId: "staff", enquiryId: "lead", opportunityId: "deal" }],
  ]) {
    const error = schema.safeParse(input).error
    assert.ok(error instanceof ZodError)
    const presented = presentTermError(error, createTermResolver({ "crm.enquiry.singular": "Lead", "crm.opportunity.singular": "Deal" }))
    assert.match(presented.details.fieldErrors.opportunityId[0], /either a Lead or a Deal/)
    assert.deepEqual(presentTermError(error, createTermResolver({})).details, error.flatten())
  }
})

test("error presentation does no reads for ordinary failures and only three scoped reads for annotated errors", async () => {
  const calls = [], actor = { tenantId: "a", userId: "staff", role: "ADMIN" }
  const tx = {
    user: { findFirst: async query => { calls.push(query); return { role: "STAFF", tenant: { status: "ACTIVE", slug: "a" } } } },
    tenantTerminology: { findMany: async query => { calls.push(query); return [{ key: "crm.contact.singular", label: "Buyer" }, { key: "realEstate.project.singular", label: "Estate" }] } },
    tenantModule: { findMany: async query => { calls.push(query); return [{ key: "crm", allowed: true, enabled: true }, { key: "realEstate", allowed: true, enabled: false }] } },
  }
  const presenter = createTermErrorPresenter({ $transaction: async fn => fn(tx) }, terminologyCatalog)
  assert.equal(await presenter(new BusinessError(403, "Forbidden."), actor), undefined)
  assert.equal(calls.length, 0)
  const error = new BusinessError(404, [termText("crm.contact.singular", "Contact"), "/", termText("realEstate.project.singular", "Project"), " not found."])
  assert.equal((await presenter(error, actor)).error, "Buyer/Project not found.")
  assert.equal(calls.length, 3)
  for (const query of calls) assert.equal(query.where.tenantId, "a")
  assert.equal(calls[0].where.id, "staff"); assert.equal(calls[0].where.status, "ACTIVE")
  calls.length = 0; tx.user.findFirst = async () => null
  assert.equal(await presenter(error, actor), undefined)
  assert.equal(calls.length, 0)
  const failed = createTermErrorPresenter({ $transaction: async () => { throw Error("Database unavailable") } }, terminologyCatalog)
  assert.equal(await failed(error, actor), undefined)
  assert.equal(error.message, "Contact/Project not found.")
})

test("live follow-up explanations preserve canonical content and interpolate only record labels", async () => {
  const term = createTermResolver({ "crm.activity.singular": "Touchpoint", "crm.activity.plural": "Touchpoints" })
  const planned = await prepareRuleFollowUp({}, {}, { planLaunchId: "plan" }, "DONE")
  assert.equal(resolveTermText(planned.blockedReasonText), planned.blockedReason)
  assert.match(resolveTermText(planned.blockedReasonText, term), /^Touchpoint plans already schedule/)
  const tx = { crmFollowUpRule: { findFirst: async () => ({ id: "rule", name: "User {label} $&", version: 1, maxDepth: 3 }) }, appSetting: { findUnique: async () => ({ timeZone: "UTC" }) } }
  const limited = await prepareRuleFollowUp(tx, { tenantId: "a" }, { type: "CALL", automationDepth: 3 }, "NO_ANSWER")
  assert.equal(limited.rule.name, "User {label} $&")
  assert.equal(resolveTermText(limited.blockedReasonText, term), "The follow-up chain has reached this rule's limit of 3 generated Touchpoints.")
  assert.equal(resolveTermText(limited.blockedReasonText), limited.blockedReason)
  const actor = { tenantId: "a", userId: "staff", role: "ADMIN", permissions: ["activities.read", "activities.edit"] }
  tx.crmTask = { findFirst: async () => ({ id: "work", version: 1, type: "CALL", status: "OPEN", assignedUserId: "staff", automationDepth: 3 }) }
  const service = createWorkService({ run: (_permission, fn) => fn(tx, actor) })
  const denied = await service.previewWorkFollowUp("work", { version: 1, outcome: "NO_ANSWER" })
  assert.match(denied.blockedReason, /^Your access role/)
  assert.equal(denied.blockedReasonText, undefined, "permission explanations must replace previous label metadata too")
})
