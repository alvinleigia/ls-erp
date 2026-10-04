/* eslint-disable @typescript-eslint/no-require-imports */
const { test, before, after } = require("node:test")
const assert = require("node:assert/strict")
const path = require("node:path")
const { AsyncLocalStorage } = require("node:async_hooks")
const { Client } = require("pg")

const rawUrl = process.env.CRM_TEST_DATABASE_URL
if (!rawUrl) throw new Error("CRM_TEST_DATABASE_URL must point to the disposable local database.")
const url = new URL(rawUrl)
if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/ls_salon_crm_test") throw new Error("Only the isolated local CRM database is permitted.")
const root = new Client({ connectionString: rawUrl })
url.username = "crm_test_runtime"; url.password = ""
process.env.DATABASE_URL = url.toString()
process.env.PLATFORM_ADMIN_TENANT_SLUG = "provision-platform"
const sessions = new AsyncLocalStorage()
// Authentication is the sole stub; actual authorization, routing, Prisma and RLS run.
const authPath = path.resolve(__dirname, "../auth.ts")
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: { auth: async () => { await Promise.resolve(); return sessions.getStore() || null } } }
const { logger } = require("../lib/logger.ts")
const errors = []
logger.info = () => {}
logger.warn = () => {}
logger.error = (_event, context) => { errors.push(context.error?.message || "Unknown server error") }
const { POST, GET } = require("../app/api/tenants/route.ts")
const { GET: moduleGet, PATCH: modulePatch } = require("../app/api/tenants/[id]/modules/route.ts")
const platformSession = { user: { id: "provision_platform_admin", tenantId: "provision_platform", role: "ADMIN" } }
const input = (slug, extra = {}) => ({ name: "Provision test", slug, adminName: "Business admin", adminEmail: `${slug}@example.test`, adminPassword: "SyntheticTest!2026", ...extra })
const request = (method, data, hostname = "provision-platform.localhost") => new Request(`http://${hostname}/api/tenants`, { method, headers: { "Content-Type": "application/json", host: hostname }, ...(data ? { body: JSON.stringify(data) } : {}) })

async function cleanupFixtures() {
  for (const table of ["RealEstateProjectStatus", "RealEstatePropertyCategory", "RealEstateBuyingTimeframe"]) {
    await root.query(`DELETE FROM "${table}" WHERE "tenantId" IN (SELECT id FROM "Tenant" WHERE slug LIKE $1 OR id=$2)`, ["provision-%", "provision_platform"])
  }
  await root.query('DELETE FROM "Tenant" WHERE slug LIKE $1 OR id=$2', ["provision-%", "provision_platform"])
  await root.query('DELETE FROM "Organization" WHERE id IN ($1,$2)', ["provision_org_a", "provision_org_b"])
}

before(async () => {
  await root.connect()
  await cleanupFixtures()
  await root.query('INSERT INTO "Tenant" (id, name, slug, "updatedAt") VALUES ($1,$2,$3,NOW()) ON CONFLICT (id) DO NOTHING', ["provision_platform", "Platform", "provision-platform"])
  await root.query('INSERT INTO "User" (id, name, email, role, "tenantId", "updatedAt") VALUES ($1,$2,$3,$4,$5,NOW()) ON CONFLICT (id) DO NOTHING', ["provision_platform_admin", "Platform admin", "provision-platform@example.test", "ADMIN", "provision_platform"])
})
after(async () => {
  try { await cleanupFixtures() }
  finally {
    await root.end()
    const clients = [global.prisma, global.prismaBypassClient, ...[...(global.prismaScopedClientCache?.values() || [])].map(entry => entry.client)].filter(Boolean)
    await Promise.all(clients.map(client => client.$disconnect()))
    await global.prismaPool?.end()
  }
})

test("platform admin provisions a tenant with admin, settings and audit under enforced RLS", async () => {
  const response = await sessions.run(platformSession, () => POST(request("POST", input("provision-business", { modules: ["crm"] }))))
  assert.equal(response.status, 201, JSON.stringify({ body: await response.clone().json(), errors }))
  const { tenant, admin } = await response.json()
  const flags = (await root.query('SELECT key, allowed, enabled FROM "TenantModule" WHERE "tenantId"=$1', [tenant.id])).rows
  assert.deepEqual(flags.map(row => row.key).sort(), ["appointments", "crm", "inventory", "leaves", "paymentPlans", "realEstate", "salesDocuments", "services", "shifts"])
  assert.deepEqual(flags.filter(row => row.allowed), [{ key: "crm", allowed: true, enabled: true }])
  assert.ok(flags.filter(row => row.key !== "crm").every(row => !row.allowed && !row.enabled))
  assert.equal((await root.query('SELECT id FROM "User" WHERE id=$1 AND "tenantId"=$2 AND role=$3', [admin.id, tenant.id, "ADMIN"])).rowCount, 1)
  assert.equal((await root.query('SELECT id FROM "AppSetting" WHERE "tenantId"=$1', [tenant.id])).rowCount, 1)
  assert.equal((await root.query('SELECT id FROM "AuditLog" WHERE event=$1 AND "entityId"=$2 AND "tenantId"=$3', ["tenant.created", tenant.id, "provision_platform"])).rowCount, 1)
  const listed = await sessions.run(platformSession, () => GET(request("GET")))
  assert.equal(listed.status, 200)
  const result = await listed.json()
  assert.ok(result.items.some(item => item.id === tenant.id))
  assert.equal(result.items.find(item => item.id === tenant.id).userCount, 1)
  assert.ok(result.items.every(item => item.slug !== "provision-platform"))
})

test("duplicate admin detection works across tenants without partial provisioning", async () => {
  const response = await sessions.run(platformSession, () => POST(request("POST", input("provision-duplicate", { adminEmail: "provision-business@example.test" }))))
  assert.equal(response.status, 409)
  assert.equal((await response.json()).error, "Admin email already exists.")
  assert.equal((await root.query('SELECT id FROM "Tenant" WHERE slug=$1', ["provision-duplicate"])).rowCount, 0)
})

test("unauthenticated users and business administrators cannot provision or list other tenants", async () => {
  assert.equal((await sessions.run(null, () => POST(request("POST", input("provision-denied"))))).status, 401)
  const business = (await root.query('SELECT t.id AS "tenantId", u.id FROM "Tenant" t JOIN "User" u ON u."tenantId"=t.id WHERE t.slug=$1', ["provision-business"])).rows[0]
  const session = { user: { ...business, role: "ADMIN" } }
  assert.equal((await sessions.run(session, () => POST(request("POST", input("provision-denied"), "provision-business.localhost")))).status, 403)
  assert.equal((await sessions.run(session, () => GET(request("GET", undefined, "provision-business.localhost")))).status, 403)
  assert.equal((await root.query('SELECT id FROM "Tenant" WHERE slug=$1', ["provision-denied"])).rowCount, 0)
})

test("organization-scoped platform users can provision and list only their organization's tenants", async () => {
  for (const id of ["provision_org_a", "provision_org_b"]) await root.query('INSERT INTO "Organization" (id, name, slug, "updatedAt") VALUES ($1,$1,$1,NOW())', [id])
  await root.query('INSERT INTO "User" (id, name, email, role, "tenantId", "updatedAt") VALUES ($1,$2,$3,$4,$5,NOW())', ["provision_org_admin", "Organization admin", "provision-org@example.test", "STAFF", "provision_platform"])
  await root.query('INSERT INTO "OrganizationMembership" (id, "userId", "organizationId", role, "updatedAt") VALUES ($1,$2,$3,$4,NOW())', ["provision_membership", "provision_org_admin", "provision_org_a", "OWNER"])
  const session = { user: { id: "provision_org_admin", tenantId: "provision_platform", role: "STAFF" } }
  assert.equal((await sessions.run(session, () => POST(request("POST", input("provision-wrong-org", { organizationId: "provision_org_b" }))))).status, 403)
  const created = await sessions.run(session, () => POST(request("POST", input("provision-own-org", { organizationId: "provision_org_a" }))))
  assert.equal(created.status, 201)
  const listed = await sessions.run(session, () => GET(request("GET")))
  const body = await listed.json()
  assert.equal(body.total, 1)
  assert.equal(body.items[0].slug, "provision-own-org")
  assert.equal(body.items[0].userCount, 1)
})

test("failed baseline settings creation rolls back both the tenant and its new administrator", async () => {
  await root.query('ALTER TABLE "AppSetting" ADD CONSTRAINT "provision_test_settings_failure" CHECK (locale <> \'en-US\') NOT VALID')
  try {
    const response = await sessions.run(platformSession, () => POST(request("POST", input("provision-rollback"))))
    assert.equal(response.status, 500)
    assert.equal((await root.query('SELECT id FROM "Tenant" WHERE slug=$1', ["provision-rollback"])).rowCount, 0)
    assert.equal((await root.query('SELECT id FROM "User" WHERE email=$1', ["provision-rollback@example.test"])).rowCount, 0)
  } finally { await root.query('ALTER TABLE "AppSetting" DROP CONSTRAINT "provision_test_settings_failure"') }
})

test("provisioning bypass does not escape into subsequent unscoped database reads", async () => {
  const { prisma } = require("../lib/prisma.ts")
  assert.equal(await prisma.user.count(), 0)
  const response = await sessions.run(platformSession, () => POST(request("POST", input("provision-scope-check"))))
  assert.equal(response.status, 201)
  assert.equal(await prisma.user.count(), 0)
})


test("platform module API grants only to authenticated current platform administrators", async () => {
  const target = (await root.query('SELECT id FROM "Tenant" WHERE slug=$1', ["provision-business"])).rows[0].id
  const context = { params: Promise.resolve({ id: target }) }
  const url = `http://provision-platform.localhost/api/tenants/${target}/modules`
  const req = (method, data) => new Request(url, { method, headers: { host: "provision-platform.localhost", "Content-Type": "application/json" }, ...(data ? { body: JSON.stringify(data) } : {}) })
  assert.equal((await sessions.run(null, () => moduleGet(req("GET"), context))).status, 401)
  const orgSession = { user: { id: "provision_org_admin", tenantId: "provision_platform", role: "STAFF" } }
  assert.equal((await sessions.run(orgSession, () => modulePatch(req("PATCH", { key: "realEstate", allowed: true }), context))).status, 403)
  const granted = await sessions.run(platformSession, () => modulePatch(req("PATCH", { key: "realEstate", allowed: true }), context))
  assert.equal(granted.status, 200, JSON.stringify(await granted.clone().json()))
  assert.equal((await granted.json()).modules.find(row => row.key === "realEstate").enabled, true)
  const denied = await sessions.run(platformSession, () => modulePatch(req("PATCH", { key: "crm", allowed: false }), context))
  assert.equal(denied.status, 409)
  const listed = await sessions.run(platformSession, () => moduleGet(req("GET"), context))
  assert.equal(listed.headers.get("Cache-Control"), "no-store")
  await root.query('UPDATE "User" SET role=$1 WHERE id=$2', ["STAFF", platformSession.user.id])
  try { assert.equal((await sessions.run(platformSession, () => moduleGet(req("GET"), context))).status, 403) }
  finally { await root.query('UPDATE "User" SET role=$1 WHERE id=$2', ["ADMIN", platformSession.user.id]) }
  const orgCreate = await sessions.run(orgSession, () => POST(request("POST", input("provision-org-escalation", { organizationId: "provision_org_a", modules: ["crm"] }))))
  assert.equal(orgCreate.status, 403)
  assert.equal((await root.query('SELECT id FROM "Tenant" WHERE slug=$1', ["provision-org-escalation"])).rowCount, 0)
})
