/* eslint-disable @typescript-eslint/no-require-imports */
const { test, before, after } = require("node:test")
const assert = require("node:assert/strict")
const { randomUUID } = require("node:crypto")
const { Pool } = require("pg")
const { PrismaClient } = require("@prisma/client")
const { TenantPgAdapter } = require("../lib/tenant-pg-adapter.ts")
const { crmPresets } = require("../application/crm/presets.ts")
const { createCrmService } = require("../modules/crm/service.ts")
const { createCustomFieldService } = require("../platform/custom-fields/service.ts")
const { enquiryFields, opportunityFields } = require("../modules/crm/custom-fields.ts")
const { projectFields } = require("../modules/real-estate/custom-fields.ts")
const { fieldSchema } = require("../platform/custom-fields/validation.ts")
require("../lib/logger.ts").logger.info = () => {}
const raw = process.env.CRM_TEST_DATABASE_URL, url = new URL(raw || "http://invalid")
if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/ls_salon_crm_test") throw new Error("Use the disposable local CRM database only.")
const suffix = randomUUID(), tenant = `teams_${suffix}`, otherTenant = `teamsb_${suffix}`, clients = [], pools = []
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
let manager, staff, other, adminB, config, staffConfig, configB, crm, staffCrm, contact, pipeline, stage
const definition = (code, extra = {}) => ({ name: code, code, scope: "SALES", type: "TEXT", ...extra })
const edit = (field, extra = {}) => fieldSchema.parse({ ...Object.fromEntries(["salesTeamId", "scope", "code", "name", "type", "helpText", "position", "required", "visibility", "editability", "filterable", "maxLength", "defaultValue", "archived", "version"].map(key => [key, field[key]])), minimum: field.minimum?.toString() ?? null, maximum: field.maximum?.toString() ?? null, options: field.options.map(({ id, name, archived }) => ({ id, name, archived })), ...extra })
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
  crm = createCrmService(db, { tenantId: tenant, userId: manager.id }, undefined, crmPresets); staffCrm = createCrmService(db, { tenantId: tenant, userId: staff.id }, undefined, crmPresets)
  contact = await root.crmContact.create({ data: { tenantId: tenant, name: "Buyer", ownerUserId: staff.id } })
  pipeline = await root.crmPipeline.create({ data: { tenantId: tenant, name: "Sales" } })
  stage = await root.crmStage.create({ data: { tenantId: tenant, pipelineId: pipeline.id, name: "Qualified", position: 0, kind: "OPEN", probability: 10, color: "#123456" } })
})
after(async () => { await Promise.all(clients.map(client => client.$disconnect())); await Promise.all(pools.map(pool => pool.end())) })

async function team(name, workflow = "ENQUIRY_FIRST", members = [staff]) {
  let row = await crm.saveSalesTeam({ name: `${name}-${randomUUID()}`, workflow })
  for (const user of members) row = await crm.changeSalesTeamMember(row.id, { userId: user.id, version: row.version })
  return row
}
const teamEdit = (row, extra = {}) => ({ name: row.name, workflow: row.workflow, archived: row.archived, version: row.version, ...extra })

test("sales teams are manager-configured, paginated, tenant-safe and versioned", async () => {
  await assert.rejects(staffCrm.saveSalesTeam({ name: "Denied" }), status(403))
  const row = await team("Permissions")
  const foreign = createCrmService(dbB, { tenantId: otherTenant, userId: adminB.id })
  await assert.rejects(foreign.getSalesTeam(row.id), status(404))
  await assert.rejects(crm.changeSalesTeamMember(row.id, { userId: adminB.id, version: row.version }), status(400))
  await assert.rejects(crm.saveSalesTeam(teamEdit(row, { name: "Stale", version: 1 }), row.id), status(409))
  assert.equal((await crm.listSalesTeamMembers(row.id, { pageSize: 1 })).total, 1)
  await assert.rejects(staffCrm.listSalesTeamMembers(row.id, {}), status(403))
  assert.ok((await staffCrm.listSalesTeams({})).items.some(item => item.id === row.id))
  assert.equal((await unscoped.crmSalesTeam.findMany()).length, 0)
  assert.equal((await dbB.crmSalesTeam.findMany({ where: { tenantId: tenant } })).length, 0)
  await assert.rejects(root.crmSalesTeamMember.create({ data: { tenantId: otherTenant, teamId: row.id, userId: adminB.id } }))
  assert.ok(await root.auditLog.count({ where: { tenantId: tenant, entityType: "CrmSalesTeam", entityId: row.id } }) >= 2)
})

test("membership never broadens record visibility and assignments require active members", async () => {
  const row = await team("Assignment", "ENQUIRY_FIRST", [staff, other])
  await assert.rejects(crm.createEnquiry(leadInput({ salesTeamId: row.id, assignedUserId: manager.id })), status(400))
  const lead = await crm.createEnquiry(leadInput({ salesTeamId: row.id, assignedUserId: other.id }))
  await assert.rejects(staffCrm.getEnquiry(lead.id), status(404))
  assert.equal((await staffCrm.listEnquiries({ salesTeamId: row.id })).total, 0)
  await assert.rejects(staffCrm.createEnquiry(leadInput({ salesTeamId: row.id, assignedUserId: other.id })), status(403))
  const selectors = await crm.listAssignees({ salesTeamId: row.id })
  assert.equal(selectors.total, 2)
  await root.user.update({ where: { id: other.id }, data: { status: "SUSPENDED" } })
  try { await assert.rejects(crm.createEnquiry(leadInput({ salesTeamId: row.id, assignedUserId: other.id })), status(400)) }
  finally { await root.user.update({ where: { id: other.id }, data: { status: "ACTIVE" } }) }
})

test("qualification-first workflow and conversion preserve team, custom fields and original attribution", async () => {
  const row = await team("Qualification")
  const field = await config.save(definition("team_qualification", { salesTeamId: row.id, required: true }))
  await assert.rejects(crm.createOpportunity(dealInput({ salesTeamId: row.id })), status(400))
  const lead = await staffCrm.createEnquiry(leadInput({ salesTeamId: row.id, customFields: { [field.id]: "Qualified interest" } }))
  await assert.rejects(staffCrm.createOpportunity(dealInput({ enquiryId: lead.id, salesTeamId: row.id })), status(400))
  const qualified = await staffCrm.updateEnquiry(lead.id, leadUpdate(lead, { status: "QUALIFIED" }))
  const result = await staffCrm.createOpportunity(dealInput({ enquiryId: lead.id, enquiryVersion: qualified.version }))
  assert.equal(result.salesTeamId, row.id)
  assert.equal(result.customFields.find(item => item.id === field.id).value, "Qualified interest")
  assert.equal((await staffCrm.createOpportunity(dealInput({ enquiryId: lead.id }))).id, result.id)
  await assert.rejects(crm.updateEnquiry(lead.id, leadUpdate(qualified, { salesTeamId: null })), status(409))
  assert.equal((await crm.listOpportunities({ salesTeamId: row.id })).total, 1)
})

test("direct teams skip enquiry intake; legacy unassigned records retain both creation paths", async () => {
  const row = await team("Direct", "DIRECT")
  await assert.rejects(crm.createEnquiry(leadInput({ salesTeamId: row.id })), status(400))
  assert.equal((await staffCrm.createOpportunity(dealInput({ salesTeamId: row.id }))).salesTeamId, row.id)
  const legacy = await staffCrm.createEnquiry(leadInput())
  assert.equal(legacy.salesTeamId, null)
  assert.equal((await staffCrm.createOpportunity(dealInput({ enquiryId: legacy.id }))).salesTeamId, null)
  assert.equal((await staffCrm.createOpportunity(dealInput())).salesTeamId, null)
  const intake = await team("Change workflow")
  const old = await crm.createEnquiry(leadInput({ salesTeamId: intake.id }))
  await crm.saveSalesTeam(teamEdit(intake, { workflow: "DIRECT" }), intake.id)
  assert.equal((await crm.createOpportunity(dealInput({ enquiryId: old.id }))).salesTeamId, intake.id)
})

test("archive preserves history; member removal blocks open records and transfer is manager-only", async () => {
  let row = await team("Archive", "ENQUIRY_FIRST", [staff, other])
  const lead = await staffCrm.createEnquiry(leadInput({ salesTeamId: row.id }))
  await assert.rejects(crm.changeSalesTeamMember(row.id, { userId: staff.id, version: row.version, remove: true }), status(409))
  await assert.rejects(staffCrm.updateEnquiry(lead.id, leadUpdate(lead, { salesTeamId: null })), status(403))
  const moved = await crm.updateEnquiry(lead.id, leadUpdate(lead, { assignedUserId: other.id }))
  row = await crm.changeSalesTeamMember(row.id, { userId: staff.id, version: row.version, remove: true })
  row = await crm.saveSalesTeam(teamEdit(row, { archived: true }), row.id)
  await assert.rejects(crm.createEnquiry(leadInput({ salesTeamId: row.id, assignedUserId: other.id })), status(409))
  assert.equal((await crm.updateEnquiry(moved.id, leadUpdate(moved, { title: "Archived team history" }))).title, "Archived team history")
  assert.equal((await crm.listSalesTeams({ archived: "true" })).items.some(item => item.id === row.id), true)
})

test("team fields apply only to matching records; transfers preserve history without leaking it to filters/exports", async () => {
  const a = await team("Fields A"), b = await team("Fields B")
  const field = await config.save(definition("only_team_a", { salesTeamId: a.id, filterable: true }))
  await assert.rejects(config.save(definition("project_team", { scope: "PROJECT", salesTeamId: a.id })), status(400))
  await assert.rejects(config.save(edit(field, { salesTeamId: b.id }), field.id), status(409))
  await assert.rejects(staffCrm.createEnquiry(leadInput({ salesTeamId: b.id, customFields: { [field.id]: "denied" } })), status(400))
  assert.equal((await staffConfig.form("enquiry", b.id)).some(item => item.id === field.id), false)
  const lead = await staffCrm.createEnquiry(leadInput({ salesTeamId: a.id, customFields: { [field.id]: "Retained" } }))
  const moved = await crm.updateEnquiry(lead.id, leadUpdate(lead, { salesTeamId: b.id }))
  assert.equal(moved.customFields.some(item => item.id === field.id), false)
  assert.equal((await crm.listEnquiries({ customFieldId: field.id, customFieldValue: "Retained" })).total, 0)
  const exported = await crm.listEnquiries({ salesTeamId: b.id }, true)
  assert.equal(exported.customFieldExport.values[lead.id].includes("Retained"), false)
  const restored = await crm.updateEnquiry(lead.id, leadUpdate(moved, { salesTeamId: a.id }))
  assert.equal(restored.customFields.find(item => item.id === field.id).value, "Retained")
  await assert.rejects(configB.save(definition("cross_team", { salesTeamId: a.id })), status(400))
})

test("team sales reports, drilldowns and exports reconcile without widening staff scope", async () => {
  const row = await team("Reports", "DIRECT", [staff, other])
  await crm.createOpportunity(dealInput({ salesTeamId: row.id }))
  await crm.createOpportunity(dealInput({ salesTeamId: row.id, assignedUserId: other.id }))
  const filters = { scope: "team", salesTeamId: row.id, view: "pipeline" }
  const summary = await crm.salesOverview(filters), records = await crm.salesReportRecords(filters)
  assert.equal(summary.totals.pipeline, 2); assert.equal(records.total, 2)
  assert.equal((await staffCrm.salesReportRecords({ ...filters, scope: "mine" })).total, 1)
  await assert.rejects(staffCrm.salesOverview(filters), status(403))
  const exported = await crm.exportSalesReport(filters)
  assert.ok(JSON.stringify(exported).includes("Custom field deal"))
})

test("presets preview, preserve customized/archived settings, reject stale review and work without an industry module", async () => {
  await assert.rejects(staffCrm.previewPreset("general-sales"), status(403))
  const prior = await crm.previewPreset("general-sales")
  const customized = await crm.createActivityType({ name: "Proposal review", baseType: "TASK", defaultInstructions: "Keep my instructions" })
  await assert.rejects(crm.applyPreset("general-sales", { token: prior.token }), status(409))
  const preview = await crm.previewPreset("general-sales")
  const applied = await crm.applyPreset("general-sales", { token: preview.token })
  assert.ok(applied.items.every(item => item.action === "KEEP"))
  assert.equal((await crm.getActivityType(customized.id)).defaultInstructions, "Keep my instructions")
  const sourceRow = await root.crmLeadSource.findFirst({ where: { tenantId: tenant, nameKey: "website" } })
  await root.crmLeadSource.update({ where: { id: sourceRow.id }, data: { name: "Customized Website", nameKey: "customized website", archived: true, version: { increment: 1 } } })
  const repeat = await crm.previewPreset("general-sales")
  assert.equal(repeat.items.find(item => item.key === "source.Website").action, "KEEP")
  await crm.applyPreset("general-sales", { token: repeat.token })
  assert.equal((await root.crmLeadSource.findUnique({ where: { id: sourceRow.id } })).archived, true)
  await root.tenantModule.update({ where: { tenantId_key: { tenantId: tenant, key: "realEstate" } }, data: { enabled: false } })
  try {
    assert.equal((await crm.listPresets()).some(item => item.id === "real-estate-sales"), false)
    await assert.rejects(crm.previewPreset("real-estate-sales"), status(403))
    assert.equal((await crm.listSalesTeams({})).total > 0, true)
  } finally { await root.tenantModule.update({ where: { tenantId_key: { tenantId: tenant, key: "realEstate" } }, data: { enabled: true } }) }
  const property = await crm.previewPreset("real-estate-sales")
  assert.ok((await crm.applyPreset("real-estate-sales", { token: property.token })).items.every(item => item.action === "KEEP"))
})

test("concurrent membership and conversion requests remain consistent", async () => {
  const row = await team("Concurrent")
  const outcomes = await Promise.allSettled([other, manager].map(user => crm.changeSalesTeamMember(row.id, { userId: user.id, version: row.version })))
  assert.equal(outcomes.filter(item => item.status === "fulfilled").length, 1)
  assert.equal(outcomes.find(item => item.status === "rejected").reason.status, 409)
  const lead = await crm.createEnquiry(leadInput({ salesTeamId: row.id }))
  const qualified = await crm.updateEnquiry(lead.id, leadUpdate(lead, { status: "QUALIFIED" }))
  const results = await Promise.all([1, 2].map(() => crm.createOpportunity(dealInput({ enquiryId: lead.id, enquiryVersion: qualified.version }))))
  assert.equal(results[0].id, results[1].id)
  assert.equal(await root.crmOpportunity.count({ where: { tenantId: tenant, enquiryId: lead.id } }), 1)
  const removal = await team("Removal race")
  const race = await Promise.allSettled([
    crm.changeSalesTeamMember(removal.id, { userId: staff.id, version: removal.version, remove: true }),
    crm.createEnquiry(leadInput({ salesTeamId: removal.id })),
  ])
  assert.equal(race.filter(item => item.status === "fulfilled").length, 1)
  const members = await crm.listSalesTeamMembers(removal.id, {})
  const leads = await crm.listEnquiries({ salesTeamId: removal.id })
  assert.ok(!leads.total || members.items.some(item => item.id === staff.id))
})

test("required audit failure rolls team creation back", async () => {
  const auditFault = client => new Proxy(client, { get(target, key) {
    if (key === "$transaction") return (operation, options) => target.$transaction(tx => operation(new Proxy(tx, { get(inner, prop) {
      if (prop === "auditLog") return { create: async () => { throw new Error("audit unavailable") } }
      const value = inner[prop]; return typeof value === "function" ? value.bind(inner) : value
    } })), options)
    const value = target[key]; return typeof value === "function" ? value.bind(target) : value
  } })
  const broken = createCrmService(auditFault(db), { tenantId: tenant, userId: manager.id }, undefined, crmPresets)
  await assert.rejects(broken.saveSalesTeam({ name: "Must roll back" }), /audit unavailable/)
  assert.equal(await root.crmSalesTeam.count({ where: { tenantId: tenant, name: "Must roll back" } }), 0)
  const brokenPreset = createCrmService(auditFault(dbB), { tenantId: otherTenant, userId: adminB.id }, undefined, crmPresets)
  const preview = await brokenPreset.previewPreset("general-sales")
  await assert.rejects(brokenPreset.applyPreset("general-sales", { token: preview.token }), /audit unavailable/)
  assert.equal(await root.crmLeadSource.count({ where: { tenantId: otherTenant } }), 0)
  assert.equal(await root.customFieldDefinition.count({ where: { tenantId: otherTenant } }), 0)
})

test("10,000 sales rows use indexed team selection with bounded query counts", async () => {
  const row = await team("Scale")
  await root.$executeRawUnsafe(`INSERT INTO "CrmEnquiry" (id,"tenantId",title,"contactId","assignedUserId","salesTeamId","updatedAt") SELECT $1 || n, $2, 'Scale lead', $3, $4, CASE WHEN n % 100 = 0 THEN $5 ELSE NULL END, NOW() FROM generate_series(1,10000) n`, `${row.id}-`, tenant, contact.id, staff.id, row.id)
  await root.$executeRawUnsafe('ANALYZE "CrmEnquiry"')
  queries = []
  const start = performance.now(), result = await crm.listEnquiries({ salesTeamId: row.id, pageSize: 5 })
  assert.equal(result.total, 100); assert.equal(result.items.length, 5)
  assert.ok(queries.length <= 15, `Bounded list queries: ${queries.length}`)
  const queryCount = queries.length, elapsed = Math.round(performance.now() - start)
  const plan = await root.$queryRawUnsafe('EXPLAIN (ANALYZE, FORMAT JSON) SELECT id FROM "CrmEnquiry" WHERE "tenantId"=$1 AND "salesTeamId"=$2 LIMIT 5', tenant, row.id)
  assert.match(JSON.stringify(plan), /CrmEnquiry_tenantId_salesTeamId_idx/)
  console.log(`Team scale: 10,000 rows; ${queryCount} statements; service ${elapsed}ms; SQL ${plan[0]["QUERY PLAN"][0]["Execution Time"]}ms`)
})
