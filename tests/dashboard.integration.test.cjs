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
