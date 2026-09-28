/* eslint-disable @typescript-eslint/no-require-imports */
const { test, before, after } = require("node:test")
const assert = require("node:assert/strict")
const { randomUUID } = require("node:crypto")
const { Pool } = require("pg")
const { PrismaClient } = require("@prisma/client")
const { TenantPgAdapter } = require("../lib/tenant-pg-adapter.ts")
const { createCrmService } = require("../modules/crm/service.ts")
require("../lib/logger.ts").logger.info = () => {}
const raw = process.env.CRM_TEST_DATABASE_URL
if (!raw) throw new Error("CRM_TEST_DATABASE_URL is required.")
const url = new URL(raw)
if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/ls_salon_crm_test") throw new Error("Use only the dedicated local test database.")
const suffix = randomUUID().replaceAll("-", ""), a = `re_a_${suffix}`, b = `re_b_${suffix}`
const clients = [], pools = []
function client(tenantId, root = false) {
  const connection = new URL(raw)
  if (!root) { connection.username = "crm_test_runtime"; connection.password = "" }
  const pool = new Pool({ connectionString: connection.toString(), max: 4, ...(!root ? { options: `-c app.tenant_id=${tenantId || ""} -c app.rls_bypass=off` } : {}) })
  pools.push(pool)
  const db = new PrismaClient({ adapter: new TenantPgAdapter(pool, { tenantId: tenantId || undefined, bypass: root }) }); clients.push(db); return db
}
const root = client(null, true), db = client(a), dbB = client(b), unscoped = client(null)
const { crmCsv, checkExportLimit } = require("../modules/crm/csv.ts")
const { salesReportSchema } = require("../modules/crm/sales-report-validation.ts")
const status = n => error => error.status === n
const period = { from: "2026-09-27", through: "2026-09-27", scope: "team" }
let admin, manager, staff, other, customer, adminB, service, reader, second, contact, source, project, child, pipeline, open, won, lost, leads, deals
const makeLead = (title, extra = {}) => root.crmEnquiry.create({ data: { tenantId: a, contactId: contact.id, assignedUserId: staff.id, title, createdAt: new Date("2026-09-27T00:00:00Z"), sourceId: source.id, source: source.name, ...extra } })
const makeDeal = (title, extra = {}) => root.crmOpportunity.create({ data: { tenantId: a, title, contactId: contact.id, assignedUserId: staff.id, pipelineId: pipeline.id, stageId: open.id, amount: "0.1001", currency: "INR", probability: 20, expectedCloseOn: new Date("2026-10-01"), sourceId: source.id, source: source.name, ...extra } })
before(async () => {
  await root.tenant.createMany({ data: [{ id: a, slug: a, name: "Sales A" }, { id: b, slug: b, name: "Sales B" }] })
  const user = (tenantId, role, name) => root.user.create({ data: { tenantId, role, name, email: `${name}-${suffix}@example.test` } })
  admin = await user(a, "ADMIN", "admin"); manager = await user(a, "MANAGER", "manager"); staff = await user(a, "STAFF", "staff"); other = await user(a, "STAFF", "other"); customer = await user(a, "CUSTOMER", "customer"); adminB = await user(b, "ADMIN", "admin-b")
  await root.tenantModule.createMany({ data: [a, b].flatMap(tenantId => [{ tenantId, key: "crm", enabled: true }, { tenantId, key: "realEstate", enabled: true }]) })
  await root.appSetting.create({ data: { tenantId: a, timeZone: "Asia/Kolkata" } })
  service = createCrmService(db, { tenantId: a, userId: manager.id }); reader = createCrmService(db, { tenantId: a, userId: staff.id }); second = createCrmService(dbB, { tenantId: b, userId: adminB.id })
  contact = await root.crmContact.create({ data: { tenantId: a, ownerUserId: staff.id, name: "Buyer" } })
  source = await root.crmLeadSource.create({ data: { tenantId: a, name: "Web", nameKey: "web" } })
  project = await root.realEstateProject.create({ data: { tenantId: a, code: "P", name: "Park", lifecycle: "SELLING" } })
  child = await root.realEstateProject.create({ data: { tenantId: a, code: "P1", name: "East", parentId: project.id, lifecycle: "SELLING" } })
  pipeline = await root.crmPipeline.create({ data: { tenantId: a, name: "Sales" } })
  const stage = (name, kind, position) => root.crmStage.create({ data: { tenantId: a, pipelineId: pipeline.id, name, kind, position, color: "#123456", probability: kind === "WON" ? 100 : 0 } })
  open = await stage("Qualified", "OPEN", 0); won = await stage("Won", "WON", 1); lost = await stage("Lost", "LOST", 2)
  leads = await Promise.all([
    makeLead("Start boundary", { createdAt: new Date("2026-09-26T18:30:00Z") }),
    makeLead("End boundary", { createdAt: new Date("2026-09-27T18:29:59.999Z") }),
    makeLead("Before", { createdAt: new Date("2026-09-26T18:29:59.999Z") }),
    makeLead("After", { createdAt: new Date("2026-09-27T18:30:00Z") }),
    makeLead("Other owner", { assignedUserId: other.id, sourceId: null, source: "Legacy" }),
  ])
  await root.realEstateEnquiryContext.create({ data: { tenantId: a, enquiryId: leads[0].id, projectId: project.id, subprojectId: child.id } })
  deals = await Promise.all([
    makeDeal("Converted", { enquiryId: leads[0].id }),
    makeDeal("Conversion reassigned away", { enquiryId: leads[1].id, assignedUserId: other.id, amount: "0.2002" }),
    makeDeal("Won INR", { stageId: won.id, closedAt: new Date("2026-09-27T00:00:00Z"), amount: "100.1001" }),
    makeDeal("Won USD", { stageId: won.id, closedAt: new Date("2026-09-27T00:00:00Z"), amount: "200.2002", currency: "USD" }),
    makeDeal("Lost INR", { stageId: lost.id, closedAt: new Date("2026-09-27T18:29:59.999Z"), lossReason: "Price", amount: "300.3003" }),
    makeDeal("Won outside", { stageId: won.id, closedAt: new Date("2026-09-27T18:30:00Z"), amount: "999" }),
  ])
  await root.realEstateOpportunityContext.create({ data: { tenantId: a, opportunityId: deals[0].id, projectId: project.id, subprojectId: child.id } })
  await root.crmTask.createMany({ data: [
    { title: "Old lead follow-up", enquiryId: leads[2].id, assignedUserId: other.id },
    { title: "Deal overdue", opportunityId: deals[0].id, assignedUserId: other.id },
    { title: "Second deal activity", opportunityId: deals[0].id, assignedUserId: staff.id },
    { title: "Contact only", assignedUserId: staff.id },
  ].map(row => ({ tenantId: a, contactId: contact.id, dueOn: new Date("2020-01-01"), ...row })) })
})
after(async () => { await Promise.all(clients.map(c => c.$disconnect())); await Promise.all(pools.map(p => p.end())) })

test("sales totals, paginated drilldowns and CSVs reconcile with inclusive business dates", async () => {
  const result = await service.salesOverview(period)
  assert.deepEqual(result.totals, { leads: 3, converted: 2, pipeline: 2, won: 2, lost: 1, overdue: 3, gaps: 1 })
  assert.equal(result.conversionPercent, 66.67)
  assert.equal(result.timeZone, "Asia/Kolkata")
  for (const [view, expected] of Object.entries(result.totals)) {
    const rows = await service.salesReportRecords({ ...period, view, pageSize: 1 })
    assert.equal(rows.total, expected)
    const ids = []
    for (let page = 1; page <= rows.totalPages; page++) ids.push(...(await service.salesReportRecords({ ...period, view, pageSize: 1, page })).items.map(r => r.id))
    assert.equal(new Set(ids).size, expected)
    const csv = await service.exportSalesReport({ ...period, view, page: 99, pageSize: 1 })
    assert.equal(csv.split("\r\n").length - 2, expected)
    for (const id of ids) assert.ok(csv.includes(id))
  }
  assert.equal((await service.salesReportRecords({ ...period, page: 99 })).total, 3)
  assert.equal((await service.salesReportRecords({ ...period, page: 99 })).items.length, 0)
})

test("staff visibility, conversion privacy and tenant RLS apply to every report path", async () => {
  const own = { ...period, scope: "mine" }
  assert.deepEqual((await reader.salesOverview(own)).totals, { leads: 2, converted: 1, pipeline: 1, won: 2, lost: 1, overdue: 3, gaps: 0 })
  assert.equal((await reader.salesOverview(own)).conversionPercent, 50)
  for (const method of ["salesOverview", "salesLeadBreakdown", "salesReportRecords", "exportSalesReport"]) {
    await assert.rejects(reader[method](period), status(403))
    await assert.rejects(reader[method]({ ...own, assignedUserId: other.id }), status(403))
  }
  await assert.rejects(reader.salesValueBreakdown({ ...period, view: "pipeline" }), status(403))
  assert.equal((await second.salesOverview(period)).totals.leads, 0)
  assert.equal((await second.salesReportRecords({ ...period, sourceId: source.id })).total, 0)
  assert.equal((await second.salesLeadBreakdown({ ...period, projectId: project.id })).total, 0)
  assert.equal((await second.exportSalesReport(period)).split("\r\n").length, 2)
  assert.equal(await unscoped.crmEnquiry.count(), 0)
  const wrongContext = createCrmService(dbB, { tenantId: a, userId: manager.id })
  await assert.rejects(wrongContext.salesOverview(period), status(403))
  await assert.rejects(createCrmService(db, { tenantId: a, userId: customer.id }).salesOverview(period), status(403))
  assert.equal((await createCrmService(db, { tenantId: a, userId: admin.id }).salesOverview(period)).totals.leads, 3)
})

test("source, project, subproject and salesperson breakdowns reconcile including unclassified leads", async () => {
  for (const dimension of ["source", "project", "salesperson"]) {
    const first = await service.salesLeadBreakdown({ ...period, dimension, pageSize: 1 })
    let total = 0, converted = 0
    for (let page = 1; page <= first.totalPages; page++) {
      const group = (await service.salesLeadBreakdown({ ...period, dimension, pageSize: 1, page })).items[0]
      total += group.leads; converted += group.converted
      assert.equal((await service.salesReportRecords({ ...period, dimension, bucket: group.id })).total, group.leads)
      assert.equal((await service.salesReportRecords({ ...period, dimension, bucket: group.id, view: "converted" })).total, group.converted)
    }
    assert.equal(total, 3); assert.equal(converted, 2)
  }
  const filtered = { ...period, sourceId: source.id, projectId: project.id, subprojectId: child.id, assignedUserId: staff.id }
  assert.equal((await service.salesOverview(filtered)).totals.leads, 1)
  assert.equal((await service.salesReportRecords(filtered)).items[0].id, leads[0].id)
  assert.equal((await service.listEnquiries({ sourceId: source.id, projectId: project.id, subprojectId: child.id, assignedUserId: staff.id })).total, 1)
  assert.equal((await service.listOpportunities({ sourceId: source.id, projectId: project.id, subprojectId: child.id, assignedUserId: staff.id })).total, 1)
  await assert.rejects(service.salesOverview({ ...period, subprojectId: child.id }), status(400))
  assert.equal((await service.salesOverview({ ...period, projectId: "' OR 1=1 --" })).totals.leads, 0)
})

test("deal values retain decimal precision and separate currencies; filtered rows match grouped values", async () => {
  const pipelineValues = await service.salesValueBreakdown({ ...period, view: "pipeline" })
  assert.equal(pipelineValues.items.length, 1)
  assert.equal(pipelineValues.items[0].amount, "0.3003")
  assert.equal(pipelineValues.items[0].count, 2)
  const values = await service.salesValueBreakdown({ ...period, view: "won" })
  assert.deepEqual(values.items.map(r => [r.currency, r.amount]), [["INR", "100.1001"], ["USD", "200.2002"]])
  for (const group of values.items) {
    const selected = { ...period, view: "won", stageId: group.stageId, currency: group.currency }
    assert.equal((await service.salesReportRecords(selected)).total, group.count)
    assert.ok((await service.exportSalesReport(selected)).includes(group.amount))
  }
  await root.crmOpportunity.update({ where: { id: deals[2].id }, data: { stageId: open.id, closedAt: null } })
  assert.equal((await service.salesOverview(period)).totals.won, 1)
  await root.crmOpportunity.update({ where: { id: deals[2].id }, data: { stageId: won.id, closedAt: new Date("2026-09-27T00:00:00Z") } })
})

test("archived configuration and inactive owners preserve historical counts; current pipeline excludes archived records", async () => {
  await root.crmLeadSource.update({ where: { id: source.id }, data: { archived: true } })
  await root.realEstateProject.update({ where: { id: project.id }, data: { archived: true } })
  await root.user.update({ where: { id: other.id }, data: { status: "SUSPENDED" } })
  assert.equal((await service.salesOverview(period)).totals.leads, 3)
  assert.equal((await service.salesLeadBreakdown({ ...period, dimension: "project" })).items.find(r => r.id === project.id).leads, 1)
  assert.equal((await service.salesLeadBreakdown({ ...period, dimension: "salesperson" })).items.find(r => r.id === other.id).leads, 1)
  await root.crmPipeline.update({ where: { id: pipeline.id }, data: { archived: true } })
  const report = await service.salesOverview(period)
  assert.equal(report.totals.pipeline, 0); assert.equal(report.totals.gaps, 0); assert.equal(report.totals.won, 2)
  await root.crmPipeline.update({ where: { id: pipeline.id }, data: { archived: false } })
  await root.user.update({ where: { id: other.id }, data: { status: "ACTIVE" } })
})

test("module-off reporting hides property context while preserving generic CRM and blocks CRM-off access", async () => {
  await root.tenantModule.update({ where: { tenantId_key: { tenantId: a, key: "realEstate" } }, data: { enabled: false } })
  assert.equal((await service.salesOverview(period)).realEstateEnabled, false)
  assert.ok((await service.salesReportRecords(period)).items.every(r => r.project === null && r.subproject === null))
  assert.ok(!(await service.exportSalesReport(period)).includes('"Project"'))
  await assert.rejects(service.salesOverview({ ...period, projectId: project.id }), status(403))
  await assert.rejects(service.salesLeadBreakdown({ ...period, dimension: "project" }), status(403))
  await root.tenantModule.update({ where: { tenantId_key: { tenantId: a, key: "crm" } }, data: { enabled: false } })
  await assert.rejects(service.exportSalesReport(period), status(403))
  await assert.rejects(service.listEnquiries({}, true), status(403))
  await root.tenantModule.updateMany({ where: { tenantId: a }, data: { enabled: true } })
})

test("list exports reuse filters and ordering, ignore current page, and never widen staff access", async () => {
  const filters = { sourceId: source.id, assignedUserId: staff.id, sort: "title", order: "asc", pageSize: 1 }
  for (const method of ["listEnquiries", "listOpportunities"]) {
    const list = await service[method](filters)
    const exported = await service[method]({ ...filters, page: 99 }, true)
    assert.equal(exported.items.length, list.total)
    assert.equal(exported.items[0].id, list.items[0].id)
    assert.equal((await reader[method]({ assignedUserId: other.id }, true)).items.length, 0)
    assert.equal((await second[method]({ sourceId: source.id }, true)).items.length, 0)
  }
  assert.equal((await service.listEnquiries({ q: "Start boundary" }, true)).items[0].id, leads[0].id)
  assert.equal((await service.listOpportunities({ kind: "WON", sourceId: source.id }, true)).items.length, 3)
})

test("CSV escaping and export bounds reject oversized selections without returning partial exports", async () => {
  const csv = crmCsv(["Title", "Phone"], [[' =HYPERLINK("bad")', "+91999"], ["line\nquote\"", "@SUM(1)"]])
  assert.ok(csv.startsWith("\uFEFF")); assert.ok(csv.includes('"\' =HYPERLINK(""bad"")"')); assert.ok(csv.includes('"\'+91999"')); assert.ok(csv.includes('"line\nquote"""')); assert.ok(csv.includes('"\'@SUM(1)"'))
  assert.doesNotThrow(() => checkExportLimit(2000)); assert.throws(() => checkExportLimit(2001), status(400))
  await root.crmEnquiry.createMany({ data: Array.from({ length: 2001 }, (_, i) => ({ tenantId: a, contactId: contact.id, assignedUserId: manager.id, title: `Bulk ${i}`, createdAt: new Date("2026-09-27T00:00:00Z") })) })
  const bulk = { ...period, assignedUserId: manager.id }
  assert.equal((await service.salesOverview(bulk)).totals.leads, 2001)
  assert.equal((await service.salesReportRecords({ ...bulk, pageSize: 10 })).items.length, 10)
  await assert.rejects(service.exportSalesReport(bulk), status(400))
  await assert.rejects(service.listEnquiries({ q: "Bulk" }, true), status(400))
})

test("date validation rejects incomplete, reversed, excessive and unknown filters; DST days use business midnight", async () => {
  for (const input of [{ from: "2026-01-01" }, { from: "2026-02-01", through: "2026-01-01" }, { from: "2024-01-01", through: "2026-01-01" }, { from: "2026-02-30", through: "2026-03-01" }, { arbitrary: "x" }]) assert.equal(salesReportSchema.safeParse(input).success, false)
  await root.appSetting.update({ where: { tenantId: a }, data: { timeZone: "America/New_York" } })
  const dst = await makeLead("DST boundary", { createdAt: new Date("2026-03-09T03:59:59.999Z") })
  const after = await makeLead("DST next day", { createdAt: new Date("2026-03-09T04:00:00Z") })
  const rows = await service.salesReportRecords({ ...period, from: "2026-03-08", through: "2026-03-08" })
  assert.ok(rows.items.some(r => r.id === dst.id)); assert.ok(!rows.items.some(r => r.id === after.id))
  await root.appSetting.update({ where: { tenantId: a }, data: { timeZone: "Asia/Kolkata" } })
})
