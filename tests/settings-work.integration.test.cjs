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
const { prisma, runWithTenantDbContext } = require("../lib/prisma.ts")
const settings = require("../app/api/settings/route.ts")
const work = require("../app/api/crm/work/route.ts")
const { createCrmService } = require("../modules/crm/service.ts")
const session = id => ({ user: { id: `${id}_admin`, tenantId: id, role: "ADMIN" } })
const request = (id, route, body) => new Request(`http://${id}.localhost/api/${route}`, {
  headers: { host: `${id}.localhost`, "Content-Type": "application/json" },
  ...(body ? { method: "PATCH", body: JSON.stringify(body) } : {}),
})
before(async () => {
  await root.connect()
  for (const id of ["settings_work_a", "settings_work_b"]) {
    await root.query('INSERT INTO "Tenant" (id,name,slug,"updatedAt") VALUES ($1,$1,$1,NOW())', [id])
    await root.query('INSERT INTO "User" (id,name,email,role,"tenantId","updatedAt") VALUES ($1,$1,$2,$3,$4,NOW())', [`${id}_admin`, `${id}@example.test`, "ADMIN", id])
    await root.query('INSERT INTO "AppSetting" (id,"tenantId","timeZone","updatedAt") VALUES ($1,$1,$2,NOW())', [id, id.endsWith("a") ? "Asia/Kolkata" : "Europe/London"])
    await root.query('INSERT INTO "TenantModule" ("tenantId",key,enabled,"updatedAt") VALUES ($1,$2,true,NOW())', [id, "crm"])
  }
})
after(async () => {
  await root.query('DELETE FROM "Tenant" WHERE id IN ($1,$2)', ["settings_work_a", "settings_work_b"])
  await root.end()
  await Promise.all([global.prisma, global.prismaBypassClient, ...[...(global.prismaScopedClientCache?.values() || [])].map(entry => entry.client)].filter(Boolean).map(client => client.$disconnect()))
  await global.prismaPool?.end()
})

test("new-business settings load and initialize working hours inside their own tenant scope", async () => {
  const responses = await Promise.all(["settings_work_a", "settings_work_b"].map(id => sessions.run(session(id), () => settings.GET(request(id, "settings")))))
  assert.deepEqual(responses.map(response => response.status), [200, 200])
  const [a, b] = await Promise.all(responses.map(response => response.json()))
  assert.equal(a.settings.timeZone, "Asia/Kolkata"); assert.equal(b.settings.timeZone, "Europe/London")
  assert.equal(a.settings.workingHours.length, 7); assert.equal(b.settings.workingHours.length, 7)
  assert.ok(a.settings.workingHours.every(day => day.periods.length === 1))
  assert.equal(await prisma.appSetting.count(), 0)
})

test("settings edits persist only for the authorized business", async () => {
  const body = { locale: "en-US", currency: "USD", timeZone: "America/New_York", dateFormat: "yyyy-MM-dd" }
  const response = await sessions.run(session("settings_work_a"), () => settings.PATCH(request("settings_work_a", "settings", body)))
  assert.equal(response.status, 200)
  assert.equal((await response.json()).settings.timeZone, body.timeZone)
  const rows = (await root.query('SELECT "tenantId", "timeZone" FROM "AppSetting" ORDER BY "tenantId"')).rows
  assert.equal(rows.find(row => row.tenantId === "settings_work_b").timeZone, "Europe/London")
  assert.equal(await prisma.appSetting.count(), 0)
})

test("settings reject anonymous and cross-tenant sessions", async () => {
  assert.equal((await sessions.run(null, () => settings.GET(request("settings_work_a", "settings")))).status, 401)
  assert.equal((await sessions.run(session("settings_work_a"), () => settings.GET(request("settings_work_b", "settings")))).status, 403)
})

test("CRM work waits for a busy one-connection pool instead of failing after two seconds", async () => {
  await runWithTenantDbContext("settings_work_a", async () => {
    let occupied
    const acquired = new Promise(resolve => { occupied = resolve })
    const blocker = prisma.$transaction(async tx => {
      occupied()
      await tx.$queryRawUnsafe("SELECT 1 AS value FROM pg_sleep(3)")
    })
    await acquired
    const service = createCrmService(prisma, { tenantId: "settings_work_a", userId: "settings_work_a_admin" })
    const results = await Promise.allSettled([blocker, service.listWork({ scope: "visible" })])
    assert.equal(results[1].status, "fulfilled", results[1].reason?.message)
    assert.equal(results[1].value.total, 0)
  })
})

test("concurrent activity API reads succeed with a one-connection pool", async () => {
  const responses = await Promise.all(Array.from({ length: 8 }, (_, index) => {
    const id = index % 2 ? "settings_work_a" : "settings_work_b"
    return sessions.run(session(id), () => work.GET(request(id, "crm/work?scope=visible&state=all")))
  }))
  assert.ok(responses.every(response => response.status === 200))
  for (const response of responses) assert.equal((await response.json()).total, 0)
  assert.equal(await prisma.user.count(), 0)
})
