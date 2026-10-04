/* eslint-disable @typescript-eslint/no-require-imports */
const { test, before, after } = require("node:test")
const assert = require("node:assert/strict")
const path = require("node:path")
const { AsyncLocalStorage } = require("node:async_hooks")
const { Client } = require("pg")
const bcrypt = require("bcryptjs")

const rawUrl = process.env.CRM_TEST_DATABASE_URL
if (!rawUrl) throw new Error("Use the disposable local CRM test database.")
const url = new URL(rawUrl)
if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/ls_salon_crm_test") throw new Error("Only a local CRM test database is permitted.")
const root = new Client({ connectionString: rawUrl })
url.username = "crm_test_runtime"; url.password = ""
process.env.DATABASE_URL = url.toString()
process.env.RLS_POOL_MAX = "1"
const sessions = new AsyncLocalStorage()
// Only authentication is stubbed. Routes, authorization, Prisma and RLS are real.
const authPath = path.resolve(__dirname, "../auth.ts")
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: { auth: async () => { await Promise.resolve(); return sessions.getStore() || null } } }
const { logger } = require("../lib/logger.ts")
const errors = []
logger.info = () => {}
logger.error = (_event, context) => { errors.push(context.error?.message || "Unknown server error") }
const users = require("../app/api/users/route.ts")
const detail = require("../app/api/users/[id]/route.ts")
const { prisma } = require("../lib/prisma.ts")
const suffix = require("node:crypto").randomUUID().replaceAll("-", "")
const tenantA = `users_test_a_${suffix}`, tenantB = `users_test_b_${suffix}`
const session = (tenantId = tenantA, role = "ADMIN") => ({ user: { tenantId, role, id: `${tenantId}_${role.toLowerCase()}` } })
const request = (method, body, tenantId = tenantA, suffix = "") => new Request(`http://${tenantId}.localhost/api/users${suffix}`, {
  method, headers: { host: `${tenantId}.localhost`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}),
})
const input = { name: "CRM Test Staff", email: `new-staff-${suffix}@example.test`, role: "STAFF", status: "ACTIVE", gender: "PREFER_NOT_TO_SAY", password: "SyntheticTest!2026", phone: "", image: "", marketingOptIn: false }
const params = id => ({ params: Promise.resolve({ id }) })

before(async () => {
  await root.connect()
  for (const tenant of [tenantA, tenantB]) {
    await root.query('INSERT INTO "Tenant" (id,name,slug,"updatedAt") VALUES ($1,$1,$1,NOW())', [tenant])
    for (const role of ["ADMIN", "MANAGER", "STAFF", "CUSTOMER"]) {
      const id = `${tenant}_${role.toLowerCase()}`
      await root.query('INSERT INTO "User" (id,name,email,role,"tenantId","updatedAt") VALUES ($1,$1,$2,$3,$4,NOW())', [id, `${id}@example.test`, role, tenant])
    }
  }
})
after(async () => {
  for (const table of ["RealEstateProjectStatus", "RealEstatePropertyCategory", "RealEstateBuyingTimeframe"]) await root.query(`DELETE FROM "${table}" WHERE "tenantId" IN ($1,$2)`, [tenantA, tenantB])
  await root.query('DELETE FROM "TenantRoleAssignment" WHERE "tenantId" IN ($1,$2)', [tenantA, tenantB])
  await root.query('DELETE FROM "Tenant" WHERE id IN ($1,$2)', [tenantA, tenantB])
  await root.end()
  await Promise.all([global.prisma, global.prismaBypassClient, ...[...(global.prismaScopedClientCache?.values() || [])].map(entry => entry.client)].filter(Boolean).map(client => client.$disconnect()))
  await global.prismaPool?.end()
})

test("admin creates staff with optional fields blank under enforced tenant RLS", async () => {
  const response = await sessions.run(session(), () => users.POST(request("POST", input)))
  assert.equal(response.status, 200, JSON.stringify({ body: await response.clone().json(), errors }))
  const { user } = await response.json()
  assert.equal(user.role, "STAFF"); assert.equal(user.status, "ACTIVE")
  assert.equal(user.email, input.email); assert.equal(user.marketingOptIn, false)
  assert.equal(user.passwordHash, undefined)
  const saved = (await root.query('SELECT "tenantId", "passwordHash" FROM "User" WHERE id=$1', [user.id])).rows[0]
  assert.equal(saved.tenantId, tenantA)
  assert.ok(await bcrypt.compare(input.password, saved.passwordHash))
})

test("duplicate email returns a conflict without creating another user", async () => {
  const body = { ...input, email: `${tenantA}_staff@example.test` }
  const response = await sessions.run(session(), () => users.POST(request("POST", body)))
  assert.equal(response.status, 409, JSON.stringify({ body: await response.clone().json(), errors }))
  assert.equal((await response.json()).error, "Email already in use.")
  assert.equal((await root.query('SELECT id FROM "User" WHERE email=$1', [body.email])).rowCount, 1)
})

test("concurrent lists return each tenant's users and respect staff/search filters", async () => {
  const responses = await Promise.all([tenantA, tenantB, tenantA, tenantB].map(tenant => sessions.run(session(tenant), () => users.GET(request("GET", null, tenant, "?role=STAFF&q=users_test&pageSize=20")))))
  for (const [index, response] of responses.entries()) {
    assert.equal(response.status, 200)
    const result = await response.json()
    assert.equal(result.total, 1)
    assert.equal(result.items[0].id, `${index % 2 ? tenantB : tenantA}_staff`)
    assert.equal(result.items[0].passwordHash, undefined)
  }
})

test("admin can open and edit a staff profile with tenant context preserved", async () => {
  const id = `${tenantA}_staff`
  const loaded = await sessions.run(session(), () => detail.GET(request("GET"), params(id)))
  assert.equal(loaded.status, 200)
  assert.equal((await loaded.json()).user.staffProfile, null)
  const updated = await sessions.run(session(), () => detail.PATCH(request("PATCH", { name: "Updated staff", phone: "+919876543210" }), params(id)))
  assert.equal(updated.status, 200)
  assert.equal((await updated.json()).user.name, "Updated staff")
  assert.equal((await root.query('SELECT phone FROM "User" WHERE id=$1', [id])).rows[0].phone, "+919876543210")
})

test("staff self-service does not permit role or status escalation", async () => {
  const id = `${tenantA}_staff`
  const updated = await sessions.run(session(tenantA, "STAFF"), () => detail.PATCH(request("PATCH", { name: "Self-service staff", role: "ADMIN", status: "ARCHIVED" }), params(id)))
  assert.equal(updated.status, 200)
  const { user } = await updated.json()
  assert.equal(user.name, "Self-service staff"); assert.equal(user.role, "STAFF"); assert.equal(user.status, "ACTIVE")
  assert.equal((await sessions.run(session(tenantA, "STAFF"), () => detail.GET(request("GET"), params(id)))).status, 200)
})

test("anonymous, non-admin and cross-tenant user management remain blocked", async () => {
  assert.equal((await sessions.run(null, () => users.POST(request("POST", input)))).status, 401)
  for (const role of ["MANAGER", "STAFF", "CUSTOMER"]) assert.equal((await sessions.run(session(tenantA, role), () => users.POST(request("POST", input)))).status, 403)
  for (const role of ["STAFF", "CUSTOMER"]) assert.equal((await sessions.run(session(tenantA, role), () => users.GET(request("GET")))).status, 403)
  assert.equal((await sessions.run(session(), () => users.GET(request("GET", null, tenantB)))).status, 403)
  const otherId = `${tenantB}_staff`
  assert.equal((await sessions.run(session(), () => detail.GET(request("GET"), params(otherId)))).status, 404)
  assert.equal((await sessions.run(session(), () => detail.PATCH(request("PATCH", { name: "Forbidden edit" }), params(otherId)))).status, 404)
  assert.equal((await root.query('SELECT name FROM "User" WHERE id=$1', [otherId])).rows[0].name, otherId)
  assert.equal((await sessions.run(session(tenantA, "STAFF"), () => detail.PATCH(request("PATCH", { name: "Forbidden edit" }), params(`${tenantA}_admin`)))).status, 403)
})

test("user API tenant context does not leak into unscoped database operations", async () => {
  await sessions.run(session(), () => users.GET(request("GET")))
  assert.equal(await prisma.user.count(), 0)
})


test("role APIs reject non-admins, enforce optimistic updates and return current permissions", async () => {
 const roleApi = require('../app/api/access/roles/route.ts')
 const roleDetail = require('../app/api/access/roles/[id]/route.ts')
 const assignmentApi = require('../app/api/access/users/[id]/route.ts')
 const modulesApi = require('../app/api/modules/route.ts')
 assert.equal((await sessions.run(session(tenantA,'MANAGER'),()=>roleApi.GET(request('GET')))).status,403)
 const created = await sessions.run(session(),()=>roleApi.POST(request('POST',{name:'Sales observer',permissions:['enquiries.read']})))
 assert.equal(created.status,201); const accessRole=await created.json()
 const assigned=await sessions.run(session(),()=>assignmentApi.PATCH(request('PATCH',{roleId:accessRole.id,previousRoleId:null}),params(`${tenantA}_staff`)))
 assert.equal(assigned.status,200)
 const flags=await sessions.run(session(tenantA,'STAFF'),()=>modulesApi.GET(request('GET')))
 assert.deepEqual((await flags.json()).permissions,['enquiries.read'])
 assert.equal((await sessions.run(session(),()=>roleDetail.PATCH(request('PATCH',{name:'Stale',permissions:[],version:2}),params(accessRole.id)))).status,409)
 const saved=await sessions.run(session(),()=>users.POST(request('POST',{...input,email:`with-role-${suffix}@example.test`,accessRoleId:accessRole.id})))
 assert.equal(saved.status,200); const newUser=(await saved.json()).user
 assert.equal((await root.query('SELECT "roleId" FROM "TenantRoleAssignment" WHERE "userId"=$1',[newUser.id])).rows[0].roleId,accessRole.id)
 assert.equal((await sessions.run(session(),()=>detail.PATCH(request('PATCH',{role:'STAFF'}),params(`${tenantA}_admin`)))).status,409)
 await root.query('UPDATE "User" SET role=\'STAFF\' WHERE id=$1',[`${tenantA}_admin`])
 assert.equal((await sessions.run(session(),()=>roleApi.GET(request('GET')))).status,403)
 assert.equal((await sessions.run(session(),()=>users.POST(request('POST',{...input,email:`stale-${suffix}@example.test`})))).status,403)
})
