/* eslint-disable @typescript-eslint/no-require-imports */
const { test, before, after } = require("node:test")
const assert = require("node:assert/strict")
const path = require("node:path")
const { AsyncLocalStorage } = require("node:async_hooks")
const { Client } = require("pg")
const rawUrl = process.env.CRM_TEST_DATABASE_URL
if (!rawUrl) throw new Error("Use the disposable local CRM test database.")
const url = new URL(rawUrl)
if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/ls_salon_crm_test") throw new Error("Only a local CRM test database is permitted.")
const root = new Client({ connectionString: rawUrl })
url.username = "crm_test_runtime"; url.password = ""
process.env.DATABASE_URL = url.toString()
process.env.RLS_POOL_MAX = "1"
const sessions = new AsyncLocalStorage()
const authPath = path.resolve(__dirname, "../auth.ts")
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: { auth: async () => { await Promise.resolve(); return sessions.getStore() || null } } }
const { logger } = require("../lib/logger.ts")
logger.info = () => {}
const { prisma } = require("../lib/prisma.ts")
const { GET } = require("../app/api/dashboard/summary/route.ts")
const session = id => ({ user: { id: `${id}_admin`, tenantId: id, role: "ADMIN" } })
const request = slug => new Request(`http://${slug}.localhost/api/dashboard/summary?range=today&debug=1`, { headers: { host: `${slug}.localhost` } })
before(async () => {
  await root.connect()
  await cleanup()
  for (const id of ["dashboard_a", "dashboard_b"]) {
    await root.query('INSERT INTO "Tenant" (id,name,slug,"updatedAt") VALUES ($1,$1,$1,NOW())', [id])
    await root.query('INSERT INTO "User" (id,name,email,role,"tenantId","updatedAt") VALUES ($1,$1,$2,$3,$4,NOW())', [`${id}_admin`, `${id}@example.test`, "ADMIN", id])
    await root.query('INSERT INTO "AppSetting" (id,"tenantId","timeZone","updatedAt") VALUES ($1,$1,$2,NOW())', [id, id === "dashboard_a" ? "Asia/Kolkata" : "Europe/London"])
  }
})
async function cleanup() {
  // Disposable localhost database only; immutable revisions need a teardown exception.
  await root.query("SET session_replication_role = replica")
  try {
    await root.query('DELETE FROM "CrmQuotationRevision" WHERE "tenantId" IN ($1,$2)', ["dashboard_a", "dashboard_b"])
  } finally { await root.query("SET session_replication_role = origin") }
  for (const table of ["CrmQuotation", "RealEstateEnquiryContext", "RealEstateOpportunityContext", "CrmTask", "CrmActivityType", "CrmOpportunity", "CrmStage", "CrmPipeline", "CrmEnquiry", "CrmContact", "RealEstateProjectMember", "RealEstateProject", "TenantModule", "AppSetting", "User"]) await root.query(`DELETE FROM "${table}" WHERE "tenantId" IN ($1,$2)`, ["dashboard_a", "dashboard_b"])
  for (const table of ["RealEstateProjectStatus", "RealEstatePropertyCategory", "RealEstateBuyingTimeframe"]) await root.query(`DELETE FROM "${table}" WHERE "tenantId" IN ($1,$2)`, ["dashboard_a", "dashboard_b"])
  await root.query('DELETE FROM "Tenant" WHERE id IN ($1,$2)', ["dashboard_a", "dashboard_b"])
}
after(async () => {
  await cleanup()
  await root.end()
  const clients = [global.prisma, global.prismaBypassClient, ...[...(global.prismaScopedClientCache?.values() || [])].map(entry => entry.client)].filter(Boolean)
  await Promise.all(clients.map(client => client.$disconnect()))
  await global.prismaPool?.end()
})

test("parallel unscoped queries respect the configured connection budget", async () => {
  await Promise.all(Array.from({ length: 13 }, () => prisma.$queryRawUnsafe("SELECT 1 AS value FROM pg_sleep(0.01)")))
  assert.equal(global.prismaPool.options.max, 1)
  assert.ok(global.prismaPool.totalCount <= 1)
})

test("a newly provisioned empty business gets a valid zero-state dashboard using its settings", async () => {
  const response = await sessions.run(session("dashboard_a"), () => GET(request("dashboard_a")))
  assert.equal(response.status, 200)
  const data = await response.json()
  assert.equal(data.kpis.appointments, 0); assert.equal(data.kpis.activeStaff, 0); assert.equal(data.kpis.revenueCents, 0)
  assert.deepEqual(data.upcomingAppointments, [])
  assert.deepEqual(data.visibility, { appointments: false, leaves: false, services: false, inventory: false })
  assert.equal(data.debug.computedBounds.timeZone, "Asia/Kolkata")
})

test("dashboard visibility follows both platform allowance and tenant activation independently", async () => {
  const expected = { appointments: false, leaves: false, services: false, inventory: false }
  for (const key of Object.keys(expected)) {
    for (const [allowed, enabled] of [[false, false], [true, false], [true, true], [false, false]]) {
      await root.query('INSERT INTO "TenantModule" ("tenantId",key,allowed,enabled,"updatedAt") VALUES ($1,$2,$3,$4,now()) ON CONFLICT ("tenantId",key) DO UPDATE SET allowed=$3,enabled=$4', ["dashboard_a", key, allowed, enabled])
      expected[key] = allowed && enabled
      const response = await sessions.run(session("dashboard_a"), () => GET(request("dashboard_a")))
      assert.equal(response.status, 200)
      assert.deepEqual((await response.json()).visibility, expected, `${key}: allowed=${allowed}, enabled=${enabled}`)
    }
  }
})

test("concurrent dashboards see their own staff and settings without widening later queries", async () => {
  for (const [id, tenant] of [["dashboard_staff_a", "dashboard_a"], ["dashboard_staff_b1", "dashboard_b"], ["dashboard_staff_b2", "dashboard_b"]]) {
    await root.query('INSERT INTO "User" (id,name,email,role,"tenantId","updatedAt") VALUES ($1,$1,$2,$3,$4,NOW())', [id, `${id}@example.test`, "STAFF", tenant])
  }
  const responses = await Promise.all(["dashboard_a", "dashboard_b"].map(id => sessions.run(session(id), () => GET(request(id)))))
  assert.ok(responses.every(response => response.status === 200))
  const [a, b] = await Promise.all(responses.map(response => response.json()))
  assert.equal(a.kpis.activeStaff, 1); assert.equal(b.kpis.activeStaff, 2)
  assert.equal(a.debug.computedBounds.timeZone, "Asia/Kolkata"); assert.equal(b.debug.computedBounds.timeZone, "Europe/London")
  assert.equal(await prisma.user.count(), 0)
})

test("dashboard rejects anonymous and mismatched-tenant sessions", async () => {
  assert.equal((await sessions.run(null, () => GET(request("dashboard_a")))).status, 401)
  assert.equal((await sessions.run(session("dashboard_a"), () => GET(request("dashboard_b")))).status, 403)
})

test("selected calendar dates stay in the tenant timezone, including daylight saving transitions", async () => {
  await root.query('UPDATE "AppSetting" SET "timeZone"=\'America/New_York\' WHERE "tenantId"=\'dashboard_b\'')
  try {
    const response = await sessions.run(session("dashboard_b"), () => GET(new Request("http://dashboard_b.localhost/api/dashboard/summary?range=custom&startDate=2026-11-01&endDate=2026-11-01&debug=1", { headers: { host: "dashboard_b.localhost" } })))
    assert.equal(response.status, 200)
    const data = await response.json()
    assert.equal(data.range.startDate, "2026-11-01"); assert.equal(data.range.endDate, "2026-11-01")
    assert.equal(data.debug.computedBounds.rangeStart, "2026-11-01T04:00:00.000Z")
    assert.equal(data.debug.computedBounds.rangeEndExclusive, "2026-11-02T05:00:00.000Z")
    assert.equal(data.series.daily.length, 1); assert.equal(data.series.daily[0].date, "2026-11-01")
  } finally { await root.query('UPDATE "AppSetting" SET "timeZone"=\'Europe/London\' WHERE "tenantId"=\'dashboard_b\'') }
})

test("sales KPIs reconcile scoped records, custom activity types, currencies and latest payment schedules", async () => {
  const { runWithTenantDbContext } = require("../lib/prisma.ts")
  const { salesDashboard } = require("../platform/dashboard/sales-summary.ts")
  const tenant = "dashboard_a", now = new Date("2026-10-06T12:00:00Z")
  const period = { start: new Date("2026-10-01T00:00:00Z"), end: new Date("2026-11-01T00:00:00Z"), now, today: "2026-10-06" }
  const flags = ["crm", "realEstate", "salesDocuments", "paymentPlans"].map(key => ({ key, allowed: true, enabled: true }))
  const actor = { tenantId: tenant, userId: "dashboard_a_admin", role: "ADMIN" }
  const read = (who = actor, modules = flags) => runWithTenantDbContext(tenant, () => salesDashboard(prisma, who, modules, period))
  await root.query('INSERT INTO "CrmContact" (id,"tenantId",name,"ownerUserId","updatedAt") VALUES (\'dash_contact\',$1,\'Buyer\',$2,now())', [tenant, actor.userId])
  await root.query('INSERT INTO "CrmPipeline" (id,"tenantId",name,"updatedAt") VALUES (\'dash_pipeline\',$1,\'Property sales\',now())', [tenant])
  for (const [index, kind] of ["OPEN", "WON", "LOST"].entries()) await root.query('INSERT INTO "CrmStage" (id,"tenantId","pipelineId",name,kind,probability,color,position) VALUES ($1,$2,\'dash_pipeline\',$3::text,$3::text::"CrmStageKind",CASE WHEN $3=\'WON\' THEN 100 WHEN $3=\'LOST\' THEN 0 ELSE 50 END,\'blue\',$4)', [`dash_${kind}`, tenant, kind, index])
  for (let i = 0; i < 4; i++) {
    await root.query('INSERT INTO "CrmEnquiry" (id,"tenantId","contactId",title,"assignedUserId","createdAt","updatedAt") VALUES ($1,$2,\'dash_contact\',$1,$3,$4,now())', [`dash_lead${i}`, tenant, actor.userId, i === 3 ? new Date("2026-09-01") : now])
    await root.query('INSERT INTO "CrmOpportunity" (id,"tenantId",title,"pipelineId","stageId","contactId","enquiryId","assignedUserId",amount,currency,probability,"expectedCloseOn","closedAt","createdAt","updatedAt") VALUES ($1,$2,$1,\'dash_pipeline\',$3,\'dash_contact\',$4,$5,100,$6,50,\'2026-10-31\',$7,$8,now())', [`dash_deal${i}`, tenant, `dash_${["OPEN", "WON", "LOST", "OPEN"][i]}`, i < 2 ? `dash_lead${i}` : null, i === 3 ? "dashboard_staff_a" : actor.userId, i === 3 ? "USD" : "INR", i === 1 || i === 2 ? now : null, now])
  }
  await root.query('INSERT INTO "CrmActivityType" (id,"tenantId",name,"nameKey","baseType","updatedAt") VALUES (\'dash_visit\',$1,\'Site Visit\',\'site visit\',\'MEETING\',now())', [tenant])
  for (let i = 0; i < 4; i++) await root.query('INSERT INTO "CrmTask" (id,"tenantId","contactId","assignedUserId",title,type,status,"dueOn",outcome,"completedAt","activityTypeId","activityTypeName","updatedAt") VALUES ($1,$2,\'dash_contact\',$3,$1,$4,$5,\'2026-10-05\',$6,$7,$8,$9,now())', [`dash_task${i}`, tenant, actor.userId, i < 2 ? "CALL" : "MEETING", i === 3 ? "OPEN" : "COMPLETED", i === 0 ? "CONNECTED" : "NO_ANSWER", i === 3 ? null : now, i === 2 ? "dash_visit" : null, i === 2 ? "Site Visit" : null])
  await root.query('INSERT INTO "RealEstateProjectStatus" ("tenantId",id,name,"nameKey","updatedAt") VALUES ($1,\'dash_status\',\'Launch\',\'launch\',now())', [tenant])
  await root.query('INSERT INTO "RealEstateProject" (id,"tenantId",name,code,lifecycle,"updatedAt") VALUES (\'dash_project\',$1,\'Green Meadows\',\'DASH\',\'dash_status\',now())', [tenant])
  await root.query('INSERT INTO "RealEstateEnquiryContext" ("tenantId","enquiryId","projectId") VALUES ($1,\'dash_lead0\',\'dash_project\')', [tenant])
  await root.query('INSERT INTO "RealEstateOpportunityContext" ("tenantId","opportunityId","projectId") VALUES ($1,\'dash_deal0\',\'dash_project\')', [tenant])
  for (let i = 0; i < 2; i++) {
    await root.query('INSERT INTO "CrmQuotation" (id,"tenantId","opportunityId",title,currency,consideration,version,"createdAt","updatedAt") VALUES ($1,$2,$3,$1,$4,100,2,$5,now())', [`dash_quote${i}`, tenant, i ? "dash_deal3" : "dash_deal0", i ? "USD" : "INR", now])
    for (let version = 1; version <= 2; version++) await root.query('INSERT INTO "CrmQuotationRevision" ("tenantId","quotationId",number,snapshot) VALUES ($1,$2,$3,$4)', [tenant, `dash_quote${i}`, version, { calculation: { instalments: version === 1 ? [{ label: "Obsolete", amount: "999", dueDate: "2026-10-07" }] : [{ label: "Booking", amount: "20", dueDate: "2026-10-06" }, { label: "Later", amount: "30", dueDate: "2026-11-06" }, { label: "Undated", amount: "50", dueDate: "" }] } }])
  }
  const data = await read()
  assert.equal(data.enquiries.total, 3); assert.equal(data.enquiries.converted, 2); assert.equal(data.enquiries.conversionPercent, 66.7)
  assert.equal(data.opportunities.open, 2); assert.equal(data.opportunities.won, 1); assert.equal(data.opportunities.lost, 1); assert.equal(data.opportunities.winPercent, 50)
  assert.deepEqual(data.opportunities.values.map(r => [r.currency, r.amount]), [["INR", "100"], ["USD", "100"]])
  assert.equal(data.activities.calls, 2); assert.equal(data.activities.connected, 1); assert.equal(data.activities.overdue, 1)
  assert.ok(data.activities.types.some(r => r.label === "Site Visit" && r.count === 1))
  assert.equal(data.projects.active, 1); assert.equal(data.projects.items[0].enquiries, 1); assert.equal(data.projects.items[0].opportunities, 1)
  assert.equal(data.quotations.total, 2); assert.equal(data.paymentPlans.documents, 2); assert.equal(data.paymentPlans.undated, 2); assert.equal(data.paymentPlans.upcomingCount, 2)
  assert.deepEqual(data.paymentPlans.values.map(r => [r.currency, r.amount]), [["INR", "20"], ["USD", "20"]])
  assert.ok(data.paymentPlans.upcoming.every(r => r.label === "Booking"))
  const staff = await read({ ...actor, userId: "dashboard_staff_a", role: "STAFF" })
  assert.equal(staff.enquiries.total, 0); assert.equal(staff.opportunities.open, 1); assert.equal(staff.activities.completed, 0)
  assert.equal(staff.projects.active, 0); assert.equal(staff.quotations.total, 1); assert.equal(staff.paymentPlans.documents, 1)
  const ownManager = await read({ ...actor, userId: "dashboard_staff_a", role: "MANAGER", crmRecordScope: "OWN" })
  assert.equal(ownManager.opportunities.open, 1); assert.equal(ownManager.paymentPlans.documents, 1)
  const otherTenant = await runWithTenantDbContext("dashboard_b", () => salesDashboard(prisma, { ...actor, tenantId: "dashboard_b", userId: "dashboard_b_admin" }, flags, period))
  assert.equal(otherTenant.enquiries.total, 0); assert.equal(otherTenant.quotations.total, 0); assert.equal(otherTenant.paymentPlans.documents, 0)
  const denied = await read({ ...actor, role: "MANAGER", permissions: ["dashboard.read"] })
  assert.ok(Object.values(denied).every(value => value === null))
  const onlyProjects = await read({ ...actor, role: "MANAGER", permissions: ["dashboard.read", "projects.read"] })
  assert.equal(onlyProjects.projects.items[0].enquiries, null)
  const disabled = await read(actor, flags.map(row => ({ ...row, enabled: false })))
  assert.ok(Object.values(disabled).every(value => value === null))
  const noPlans = await read(actor, flags.map(row => row.key === "paymentPlans" ? { ...row, allowed: false } : row))
  assert.equal(noPlans.quotations.total, 2); assert.equal(noPlans.paymentPlans, null)
  const noCrm = await read(actor, flags.map(row => row.key === "crm" ? { ...row, allowed: false } : row))
  assert.ok(Object.values(noCrm).every(value => value === null))
})
