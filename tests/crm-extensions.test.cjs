/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
require("../modules/crm/service.ts")
const coreLoadedIndustry = Object.keys(require.cache).some(file => file.replaceAll("\\", "/").includes("/modules/real-estate/"))
const { noCrmExtensions } = require("../modules/crm/extensions.ts")
const { crmEnquiryCreateSchema } = require("../modules/crm/validation.ts")
const { realEstateCrmExtension: extension } = require("../modules/real-estate/crm-extension.ts")
const actor = { tenantId: "tenant-a", userId: "staff-a", role: "STAFF" }

test("conversion retries recognize constraints when RLS hides key detail", () => {
  const { constraintTarget, serializationConflict } = require("../modules/crm/database-errors.ts")
  assert.match(constraintTarget({ meta: { target: ["tenantId", "enquiryId"] } }), /enquiryId/)
  assert.match(constraintTarget({ meta: { target: [], driverAdapterError: { cause: { constraint: { fields: ["tenantId", "enquiryId"] } } } } }), /enquiryId/)
  assert.match(constraintTarget({ meta: { driverAdapterError: { cause: { originalMessage: 'duplicate key value violates unique constraint "CrmOpportunity_tenantId_enquiryId_key"' } } } }), /enquiryId/)
  assert.equal(serializationConflict({ code: "P2010", meta: { driverAdapterError: { cause: { originalCode: "40001" } } } }), true)
})

test("core loads independently and cannot import an industry or application composition", () => {
  assert.equal(coreLoadedIndustry, false)
  const root = path.join(__dirname, "../modules/crm")
  for (const file of fs.readdirSync(root, { recursive: true }).filter(file => /\.tsx?$/.test(file))) {
    const source = fs.readFileSync(path.join(root, file), "utf8")
    assert.doesNotMatch(source, /(?:from\s+|import\s*\()["'][^"']*(?:real-estate|application\/crm)/, file)
  }
})

test("standalone CRM has no extension queries and rejects unavailable filters", async () => {
  const tx = new Proxy({}, { get() { throw new Error("Unexpected extension database access") } })
  const records = [{ id: "lead", title: "Generic lead" }]
  assert.deepEqual(await noCrmExtensions.decorate(tx, actor, "enquiry", records), { items: records, metadata: {} })
  const report = await noCrmExtensions.report(tx, actor, {})
  assert.equal(report.enquiryJoins.text, "")
  assert.equal(report.opportunityJoins.text, "")
  await assert.rejects(noCrmExtensions.filters(tx, actor, { projectId: "project" }), error => error.status === 403)
  await assert.rejects(noCrmExtensions.report(tx, actor, { dimension: "project" }), error => error.status === 403)
})

test("extension validation keeps field paths, strict core input and explicit conversion rules", () => {
  const base = { title: "Buyer", contactId: "contact", assignedUserId: "staff" }
  const { core, extension: values } = extension.splitWrite({ ...base, propertyContext: { projectId: "project", bedrooms: 2 } })
  assert.equal(crmEnquiryCreateSchema.parse(core).title, base.title)
  assert.equal("propertyContext" in core, false)
  assert.throws(() => extension.splitWrite({ ...base, propertyContext: { bedrooms: -1 } }), error => error.issues[0].path[0] === "propertyContext")
  assert.throws(() => crmEnquiryCreateSchema.parse(extension.splitWrite({ ...base, tenantId: "other" }).core))
  assert.throws(() => crmEnquiryCreateSchema.parse({ ...base, propertyContext: {} }))
  assert.throws(() => extension.assertConversionInput(values), error => error.status === 400)
  extension.assertConversionInput(extension.splitWrite(base).extension)
  assert.throws(() => extension.assertConversionInput(extension.splitWrite({ ...base, propertyContext: null }).extension), error => error.status === 400)
})

test("extension decoration batches one scoped lookup, including empty and module-off lists", async () => {
  let flags = 0, contexts = 0, enabled = true
  const records = Array.from({ length: 100 }, (_, i) => ({ id: `lead-${i}`, title: `Lead ${i}` }))
  const tx = {
    tenantModule: { findUnique: async ({ where }) => { flags++; assert.equal(where.tenantId_key.tenantId, actor.tenantId); return { enabled } } },
    realEstateEnquiryContext: { findMany: async ({ where }) => { contexts++; assert.equal(where.tenantId, actor.tenantId); assert.deepEqual(where.enquiryId.in, records.map(row => row.id)); return [{ enquiryId: "lead-99", bedrooms: 3 }] } },
  }
  const decorated = await extension.decorate(tx, actor, "enquiry", records)
  assert.equal(decorated.items[99].title, "Lead 99")
  assert.equal(decorated.items[99].propertyContext.bedrooms, 3)
  assert.equal(decorated.items[0].propertyContext, null)
  assert.deepEqual([flags, contexts], [1, 1])
  assert.deepEqual((await extension.decorate(tx, actor, "enquiry", [])).metadata, { realEstateEnabled: true })
  assert.deepEqual([flags, contexts], [2, 1])
  enabled = false
  const hidden = await extension.decorate(tx, actor, "enquiry", records)
  assert.equal(hidden.items.every(row => row.propertyContext === null), true)
  assert.deepEqual([flags, contexts], [3, 1])
})

test("report joins disappear when disabled and enabled filters remain parameterized", async () => {
  let enabled = false
  const tx = { tenantModule: { findUnique: async () => ({ enabled }) } }
  const hidden = await extension.report(tx, actor, {})
  assert.equal(hidden.enquiryJoins.text, "")
  assert.equal(hidden.opportunityJoins.text, "")
  await assert.rejects(extension.report(tx, actor, { projectId: "project" }), error => error.status === 403)
  enabled = true
  const projectId = "' OR true --"
  const visible = await extension.report(tx, actor, { projectId })
  assert.deepEqual(visible.filter.values, [projectId])
  assert.equal(visible.filter.text.includes(projectId), false)
  assert.match(visible.enquiryJoins.text, /x\."tenantId" = r\."tenantId"/)
  await assert.rejects(extension.report(tx, actor, { subprojectId: "child" }), error => error.status === 400)
})
