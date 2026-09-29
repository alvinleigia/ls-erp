/* eslint-disable @typescript-eslint/no-require-imports */
const { test, before, after } = require("node:test")
const assert = require("node:assert/strict")
const { randomUUID } = require("node:crypto")
const { Pool } = require("pg")
const { PrismaClient } = require("@prisma/client")
const { TenantPgAdapter } = require("../lib/tenant-pg-adapter.ts")
const { createCrmService } = require("../modules/crm/service.ts")
const { createRealEstateService } = require("../modules/real-estate/service.ts")
const { createCustomFieldService } = require("../platform/custom-fields/service.ts")
const { enquiryFields, opportunityFields } = require("../modules/crm/custom-fields.ts")
const { projectFields } = require("../modules/real-estate/custom-fields.ts")
const { fieldSchema } = require("../platform/custom-fields/validation.ts")
require("../lib/logger.ts").logger.info = () => {}
const raw = process.env.CRM_TEST_DATABASE_URL, url = new URL(raw || "http://invalid")
if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/ls_salon_crm_test") throw new Error("Use the disposable local CRM database only.")
const suffix = randomUUID(), tenant = `cf_${suffix}`, otherTenant = `cfb_${suffix}`, clients = [], pools = []
let queries = []
function client(tenantId, root = false) {
  const connection = new URL(raw)
  if (!root) { connection.username = "crm_test_runtime"; connection.password = "" }
  const pool = new Pool({ connectionString: connection.toString(), max: 4 }); pools.push(pool)
  const db = new PrismaClient({ adapter: new TenantPgAdapter(pool, { tenantId, bypass: root }), log: [{ emit: "event", level: "query" }] })
  db.$on("query", event => queries.push(event.query)); clients.push(db); return db
}
const root = client(undefined, true), db = client(tenant), dbB = client(otherTenant), unscoped = client(undefined)
const resources = [enquiryFields, opportunityFields, projectFields]
const status = code => error => error.status === code
let manager, staff, other, adminB, config, staffConfig, configB, crm, staffCrm, realEstate, contact, pipeline, stage
const definition = (code, extra = {}) => ({ name: code, code, scope: "SALES", type: "TEXT", ...extra })
const edit = (field, extra = {}) => fieldSchema.parse({ ...Object.fromEntries(["scope", "code", "name", "type", "helpText", "position", "required", "visibility", "editability", "filterable", "maxLength", "defaultValue", "archived", "version"].map(key => [key, field[key]])), minimum: field.minimum?.toString() ?? null, maximum: field.maximum?.toString() ?? null, options: field.options.map(({ id, name, archived }) => ({ id, name, archived })), ...extra })
const leadInput = (extra = {}) => ({ title: "Custom field lead", contactId: contact.id, assignedUserId: staff.id, ...extra })
const leadUpdate = (row, extra = {}) => ({ title: row.title, assignedUserId: row.assignedUserId, version: row.version, status: row.status, ...extra })
const dealInput = (extra = {}) => ({ title: "Custom field deal", contactId: contact.id, assignedUserId: staff.id, pipelineId: pipeline.id, stageId: stage.id, amount: "100", currency: "INR", expectedCloseOn: "2026-12-31", ...extra })
before(async () => {
  await root.tenant.createMany({ data: [{ id: tenant, slug: tenant, name: "Custom fields" }, { id: otherTenant, slug: otherTenant, name: "Other fields" }] })
  const user = (tenantId, role) => root.user.create({ data: { tenantId, role, name: role, email: `${randomUUID()}@example.test` } })
  manager = await user(tenant, "MANAGER"); staff = await user(tenant, "STAFF"); other = await user(tenant, "STAFF"); adminB = await user(otherTenant, "ADMIN")
  await root.tenantModule.createMany({ data: [tenant, otherTenant].flatMap(tenantId => ["crm", "realEstate"].map(key => ({ tenantId, key, enabled: true }))) })
  config = createCustomFieldService(db, { tenantId: tenant, userId: manager.id }, resources)
  staffConfig = createCustomFieldService(db, { tenantId: tenant, userId: staff.id }, resources)
  configB = createCustomFieldService(dbB, { tenantId: otherTenant, userId: adminB.id }, resources)
  crm = createCrmService(db, { tenantId: tenant, userId: manager.id }); staffCrm = createCrmService(db, { tenantId: tenant, userId: staff.id })
  realEstate = createRealEstateService(db, { tenantId: tenant, userId: manager.id })
  contact = await root.crmContact.create({ data: { tenantId: tenant, name: "Buyer", ownerUserId: staff.id } })
  pipeline = await root.crmPipeline.create({ data: { tenantId: tenant, name: "Sales" } })
  stage = await root.crmStage.create({ data: { tenantId: tenant, pipelineId: pipeline.id, name: "Qualified", position: 0, kind: "OPEN", probability: 10, color: "#123456" } })
})
after(async () => { await Promise.all(clients.map(client => client.$disconnect())); await Promise.all(pools.map(pool => pool.end())) })

test("configuration is manager-only, tenant scoped, versioned and audited", async () => {
  await assert.rejects(staffConfig.save(definition("denied")), status(403))
  const field = await config.save(definition("config"))
  await assert.rejects(configB.get(field.id), status(404))
  await assert.rejects(config.save(edit(field, { scope: "PROJECT" }), field.id), status(409))
  await assert.rejects(config.save(edit(field, { type: "NUMBER" }), field.id), status(409))
  await config.save(edit(field, { name: "New label" }), field.id)
  await assert.rejects(config.save(edit(field), field.id), status(409))
  assert.equal(await root.auditLog.count({ where: { tenantId: tenant, entityId: field.id } }), 2)
  assert.equal((await unscoped.customFieldDefinition.findMany()).length, 0)
  assert.equal((await db.customFieldDefinition.findMany({ where: { tenantId: otherTenant } })).length, 0)
})

test("all typed fields validate, filter and export with no per-record field queries", async () => {
  const text = await config.save(definition("area", { filterable: true }))
  const number = await config.save(definition("budget", { type: "NUMBER", filterable: true, minimum: "0", maximum: "1000" }))
  const date = await config.save(definition("visit", { type: "DATE", filterable: true }))
  const bool = await config.save(definition("finance", { type: "BOOLEAN", filterable: true, defaultValue: false }))
  const select = await config.save(definition("interest", { type: "SELECT", filterable: true, options: [{ name: "North" }, { name: "South" }] }))
  const row = await staffCrm.createEnquiry(leadInput({ customFields: { [text.id]: "PUNE", [number.id]: "123.123456", [date.id]: "2026-10-02", [select.id]: select.options[0].id } }))
  assert.equal(row.customFields.find(field => field.id === bool.id).value, false)
  for (const [id, value] of [[text.id, "pune"], [number.id, "123.123456"], [date.id, "2026-10-02"], [bool.id, "false"], [select.id, select.options[0].id]]) {
    const result = await staffCrm.listEnquiries({ customFieldId: id, customFieldValue: value })
    assert.equal(result.items.some(item => item.id === row.id), true)
  }
  const range = await staffCrm.listEnquiries({ customFieldId: number.id, customFieldValue: "124", customFieldOperator: "gte" })
  assert.equal(range.items.some(item => item.id === row.id), false)
  await assert.rejects(staffCrm.createEnquiry(leadInput({ customFields: { [date.id]: "2026-02-30" } })), status(400))
  await assert.rejects(staffCrm.createEnquiry(leadInput({ customFields: { [number.id]: "1.1234567" } })), status(400))
  await assert.rejects(staffCrm.createEnquiry(leadInput({ customFields: { [select.id]: "not-an-option" } })), status(400))
  const unicode = "😀".repeat(900)
  await staffCrm.updateEnquiry(row.id, leadUpdate(row, { customFields: { [text.id]: unicode } }))
  assert.equal((await staffCrm.listEnquiries({ customFieldId: text.id, customFieldValue: unicode })).total, 1)
  queries = []
  const result = await staffCrm.listEnquiries({}, true)
  assert.ok(result.customFieldExport.headers.includes("budget [sales.budget]"))
  assert.ok(result.customFieldExport.values[row.id].includes("123.123456"))
  const valueQueries = queries.filter(query => query.includes('FROM "CrmEnquiryFieldValue"'))
  assert.equal(valueQueries.length, 1, "Export values must use one batch query")
})

test("field and record permissions protect details, writes, filters and exports", async () => {
  const secret = await config.save(definition("private_notes", { visibility: "MANAGERS", editability: "MANAGERS", filterable: true, defaultValue: "private" }))
  const readonly = await config.save(definition("approved", { editability: "MANAGERS" }))
  const row = await staffCrm.createEnquiry(leadInput())
  assert.equal(row.customFields.some(field => field.id === secret.id), false)
  assert.equal(row.customFields.find(field => field.id === readonly.id).editable, false)
  for (const field of [secret, readonly]) await assert.rejects(staffCrm.updateEnquiry(row.id, leadUpdate(row, { customFields: { [field.id]: "changed" } })), status(400))
  await assert.rejects(staffCrm.listEnquiries({ customFieldId: secret.id, customFieldValue: "private" }), status(400))
  assert.equal((await staffCrm.listEnquiries({}, true)).customFieldExport.headers.some(header => header.includes("private_notes")), false)
  await assert.rejects(staffConfig.get(secret.id), status(404))
  const otherRow = await crm.createEnquiry(leadInput({ assignedUserId: other.id }))
  await assert.rejects(staffCrm.getEnquiry(otherRow.id), status(404))
  assert.equal((await staffCrm.listEnquiries({}, true)).customFieldExport.values[otherRow.id], undefined)
  await assert.rejects(config.save(definition("invalid_required", { required: true, editability: "MANAGERS" })), status(400))
})

test("required changes are prospective and preserve legacy conversion cohorts", async () => {
  const old = await crm.createEnquiry(leadInput())
  const field = await config.save(definition("required_later", { required: true }))
  await staffCrm.updateEnquiry(old.id, leadUpdate(old))
  await assert.rejects(staffCrm.createEnquiry(leadInput()), status(400))
  const converted = await staffCrm.createOpportunity(dealInput({ enquiryId: old.id }))
  assert.equal(converted.customFields.find(item => item.id === field.id).required, false)
  assert.equal(converted.customFieldsCreatedAt.toISOString(), old.createdAt.toISOString())
  await config.save(edit(field, { required: false }), field.id)
})

test("conversion copies shared values and snapshots; enquiry-only fields remain on source", async () => {
  let shared = await config.save(definition("shared_choice", { type: "SELECT", options: [{ name: "Original option" }, { name: "Other" }] }))
  const local = await config.save(definition("intake_note", { scope: "ENQUIRY" }))
  const own = await config.save(definition("deal_note", { scope: "OPPORTUNITY", defaultValue: "Deal default" }))
  const row = await staffCrm.createEnquiry(leadInput({ customFields: { [shared.id]: shared.options[0].id, [local.id]: "Source only" } }))
  shared = await config.save(edit(shared, { name: "Renamed field", options: shared.options.map((option, index) => ({ id: option.id, name: index ? option.name : "Renamed option", archived: !index })) }), shared.id)
  const converted = await staffCrm.createOpportunity(dealInput({ enquiryId: row.id, customFields: { [own.id]: "Explicit deal value" } }))
  const value = converted.customFields.find(field => field.id === shared.id)
  assert.equal(value.savedName, "shared_choice"); assert.equal(value.optionName, "Original option")
  assert.equal(converted.customFields.some(field => field.id === local.id), false)
  assert.equal((await staffCrm.getEnquiry(row.id)).customFields.find(field => field.id === local.id).value, "Source only")
  const second = await staffCrm.createEnquiry(leadInput())
  await assert.rejects(staffCrm.createOpportunity(dealInput({ enquiryId: second.id, customFields: { [shared.id]: shared.options[1].id } })), status(400))
  assert.equal(await root.crmOpportunity.count({ where: { tenantId: tenant, enquiryId: second.id } }), 0, "Rejected conversion rolls back")
  await config.save(edit(shared, { archived: true }), shared.id)
  const retained = await staffCrm.getOpportunity(converted.id)
  assert.equal(retained.customFields.find(field => field.id === shared.id).archived, true)
})

test("projects reuse typed fields, indexed filters, scoped exports and module gating", async () => {
  const field = await config.save(definition("approval_date", { scope: "PROJECT", type: "DATE", filterable: true }))
  const project = await realEstate.createProject({ name: "Field project", code: "CF", customFields: { [field.id]: "2026-10-01" } })
  assert.equal((await realEstate.getProject(project.id)).customFields[0].value, "2026-10-01")
  const result = await realEstate.listProjects({ customFieldId: field.id, customFieldValue: "2026-10-01" }, true)
  assert.equal(result.total, 1); assert.deepEqual(result.customFieldExport.values[project.id], ["2026-10-01"])
  await assert.rejects(staffCrm.createEnquiry(leadInput({ customFields: { [field.id]: "2026-10-01" } })), status(400))
  await root.tenantModule.update({ where: { tenantId_key: { tenantId: tenant, key: "realEstate" } }, data: { enabled: false } })
  assert.equal((await config.list({})).scopes.includes("PROJECT"), false)
  await assert.rejects(config.get(field.id), status(404))
  await assert.rejects(config.form("project"), status(403))
  await assert.rejects(realEstate.getProject(project.id), status(403))
  assert.ok((await staffCrm.createEnquiry(leadInput())).id)
  await root.tenantModule.update({ where: { tenantId_key: { tenantId: tenant, key: "realEstate" } }, data: { enabled: true } })
})

test("tenant-safe foreign keys, typed checks and stale versions protect data", async () => {
  const field = await configB.save(definition("foreign"))
  const row = await staffCrm.createEnquiry(leadInput())
  await assert.rejects(root.crmEnquiryFieldValue.create({ data: { tenantId: tenant, recordId: row.id, fieldId: field.id, scope: "SALES", type: "TEXT", textValue: "bad", textKey: "a".repeat(64), fieldName: "Foreign" } }))
  const own = await config.save(definition("typed"))
  await assert.rejects(root.crmEnquiryFieldValue.create({ data: { tenantId: tenant, recordId: row.id, fieldId: own.id, scope: "SALES", type: "TEXT", numberValue: "4", fieldName: "Wrong type" } }))
  const before = await staffCrm.getEnquiry(row.id)
  await assert.rejects(staffCrm.updateEnquiry(row.id, leadUpdate(before, { version: before.version + 1, customFields: { [own.id]: "must not persist" } })), status(409))
  assert.equal((await staffCrm.getEnquiry(row.id)).customFields.find(item => item.id === own.id).value, null)
})

test("required custom-field audit failure rolls back the record and values", async () => {
  const field = await config.save(definition("rollback"))
  const row = await staffCrm.createEnquiry(leadInput())
  // Fault is limited to this disposable tenant and event; other local browser tests keep working.
  const functionName = `cf_fail_${suffix.replaceAll("-", "")}`
  await root.$executeRawUnsafe(`CREATE FUNCTION app.${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."tenantId" = '${tenant}' AND NEW.event = 'crm.customFields.updated' THEN RAISE EXCEPTION 'custom field audit fault'; END IF; RETURN NEW; END $$`)
  await root.$executeRawUnsafe(`CREATE TRIGGER ${functionName} BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION app.${functionName}()`)
  try {
    await assert.rejects(staffCrm.updateEnquiry(row.id, leadUpdate(row, { title: "Must roll back", customFields: { [field.id]: "Must roll back" } })))
    const unchanged = await staffCrm.getEnquiry(row.id)
    assert.equal(unchanged.title, row.title); assert.equal(unchanged.version, row.version)
    assert.equal(unchanged.customFields.find(value => value.id === field.id).value, null)
  } finally {
    await root.$executeRawUnsafe(`DROP TRIGGER ${functionName} ON "AuditLog"`)
    await root.$executeRawUnsafe(`DROP FUNCTION app.${functionName}()`)
  }
})

test("configuration races, archived selections and bounded options retain safe identities", async () => {
  const field = await config.save(definition("concurrent", { type: "SELECT", options: [{ name: "One" }, { name: "Two" }] }))
  const results = await Promise.allSettled([config.save(edit(field, { name: "First edit" }), field.id), config.save(edit(field, { name: "Second edit" }), field.id)])
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1)
  const current = await config.get(field.id)
  await assert.rejects(config.save(edit(current, { options: [] }), field.id))
  assert.throws(() => config.save(definition("too_many_options", { type: "SELECT", options: Array.from({ length: 51 }, (_, index) => ({ name: String(index) })) })))
  const row = await staffCrm.createEnquiry(leadInput({ customFields: { [field.id]: current.options[0].id } }))
  await config.save(edit(current, { options: current.options.map((option, index) => ({ id: option.id, name: option.name, archived: index === 0 })) }), field.id)
  await staffCrm.updateEnquiry(row.id, leadUpdate(row, { customFields: { [field.id]: current.options[0].id } }))
  await assert.rejects(staffCrm.createEnquiry(leadInput({ customFields: { [field.id]: current.options[0].id } })), status(400))
})

test("10,000 typed values use an indexed filter and bounded record queries", async () => {
  const field = await config.save(definition("scale_number", { type: "NUMBER", filterable: true }))
  const prefix = `scale_${suffix}_`
  await root.$executeRaw`INSERT INTO "CrmEnquiry" (id,"tenantId","contactId",title,"assignedUserId","updatedAt") SELECT ${prefix} || i::text,${tenant},${contact.id},'Scale lead ' || i::text,${staff.id},CURRENT_TIMESTAMP FROM generate_series(1,10000) i`
  await root.$executeRaw`INSERT INTO "CrmEnquiryFieldValue" ("tenantId","recordId","fieldId",scope,type,"numberValue","fieldName") SELECT ${tenant},${prefix} || i::text,${field.id},'SALES','NUMBER',i % 1000,'Scale number' FROM generate_series(1,10000) i`
  await root.$executeRawUnsafe('ANALYZE "CrmEnquiryFieldValue"')
  const plan = await root.$queryRaw`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT "recordId" FROM "CrmEnquiryFieldValue" WHERE "tenantId"=${tenant} AND "fieldId"=${field.id} AND "numberValue"=123 LIMIT 20`
  assert.match(JSON.stringify(plan), /Index.*Scan/)
  queries = []
  const started = performance.now()
  const rows = await staffCrm.listEnquiries({ customFieldId: field.id, customFieldValue: "123", pageSize: 5 })
  assert.equal(rows.total, 10); assert.equal(rows.items.length, 5)
  assert.ok(queries.length < 15, `Expected bounded queries, got ${queries.length}`)
  console.log(`Custom field indexed filter: 10,000 values, page 5, ${queries.length} queries, ${(performance.now() - started).toFixed(1)} ms service; ${plan[0]["QUERY PLAN"][0]["Execution Time"]} ms indexed SQL.`)
})
