/* eslint-disable @typescript-eslint/no-require-imports */
const { test, before, after } = require("node:test")
const assert = require("node:assert/strict")
const { Client } = require("pg")
const rawUrl = process.env.CRM_TEST_DATABASE_URL
if (!rawUrl) throw new Error("Use the disposable local CRM test database.")
const url = new URL(rawUrl)
if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/ls_salon_crm_test") throw new Error("Only the local CRM test database is permitted.")
const root = new Client({ connectionString: rawUrl })
url.username = "crm_test_runtime"; url.password = ""
process.env.DATABASE_URL = url.toString()
process.env.RLS_POOL_MAX = "1"
const { prisma, runWithTenantDbContext: tenant, runWithRlsBypassDbContext: bypass } = require("../lib/prisma.ts")
const { runtimeDatabaseUrl } = require("../lib/tenant-pg-adapter.ts")
const ids = ["pool_a", "pool_b"]
before(async () => {
  await root.connect()
  for (const id of ids) {
    await root.query('INSERT INTO "Tenant" (id,name,slug,"updatedAt") VALUES ($1,$1,$1,NOW())', [id])
    await root.query('INSERT INTO "User" (id,name,email,role,"tenantId","updatedAt") VALUES ($1,$1,$2,$3,$1,NOW())', [id, `${id}@example.test`, "ADMIN"])
  }
})
after(async () => {
  await root.query('DELETE FROM "Tenant" WHERE id = ANY($1)', [ids])
  await root.end()
  await Promise.all([global.prisma, global.prismaBypassClient, ...[...(global.prismaScopedClientCache?.values() || [])].map(entry => entry.client)].filter(Boolean).map(client => client.$disconnect()))
  await global.prismaPool.end()
})

test("runtime selects Supabase transaction mode without changing direct/local URLs or credentials", () => {
  const input = "postgresql://app.ref:p%40ss@aws-0-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=require"
  const before = new URL(input), after = new URL(runtimeDatabaseUrl(input))
  assert.equal(after.port, "6543"); assert.equal(after.username, before.username); assert.equal(after.password, before.password); assert.equal(after.search, before.search)
  for (const input of [url.toString(), "postgresql://u:p@db.ref.supabase.co:5432/postgres", "postgresql://u:p@example.com:5432/db", "postgresql://u:p@aws-0-ap-south-1.pooler.supabase.com:6543/postgres"]) assert.equal(runtimeDatabaseUrl(input), input)
})

test("concurrent tenant, platform and unscoped queries share one physical connection without leaking scope", async () => {
  const inspect = () => prisma.$queryRawUnsafe("SELECT pg_backend_pid() AS pid, current_setting('app.tenant_id') AS tenant, current_setting('app.rls_bypass') AS bypass")
  const results = await Promise.all(Array.from({ length: 16 }, async (_, index) => {
    const scope = index % 4
    const run = scope === 0 ? callback => tenant("pool_a", callback) : scope === 1 ? callback => tenant("pool_b", callback) : scope === 2 ? bypass : callback => callback()
    return run(async () => {
      const [context] = await inspect()
      assert.equal(context.tenant, scope === 0 ? "pool_a" : scope === 1 ? "pool_b" : "")
      assert.equal(context.bypass, scope === 2 ? "on" : "off")
      const rows = await prisma.user.findMany({ where: { id: { in: ids } }, select: { tenantId: true } })
      assert.deepEqual(rows.map(row => row.tenantId).sort(), scope === 0 ? ["pool_a"] : scope === 1 ? ["pool_b"] : scope === 2 ? ids : [])
      return context.pid
    })
  }))
  assert.equal(new Set(results).size, 1)
  assert.equal(global.prismaPool.totalCount, 1)
  const raw = await global.prismaPool.query("SELECT current_setting('app.tenant_id',true) AS tenant, current_setting('app.rls_bypass',true) AS bypass")
  assert.ok(!raw.rows[0].tenant); assert.notEqual(raw.rows[0].bypass, "on")
})

test("interactive and batch transactions retain scope and roll back all writes on failure", async () => {
  await tenant("pool_a", async () => {
    await assert.rejects(prisma.$transaction(async tx => {
      await tx.user.update({ where: { id: "pool_a" }, data: { name: "Must roll back" } })
      assert.equal(await tx.user.count({ where: { id: "pool_b" } }), 0)
      throw new Error("Intentional rollback")
    }), /Intentional rollback/)
    assert.equal((await prisma.user.findUnique({ where: { id: "pool_a" } })).name, "pool_a")
    const [own, foreign] = await prisma.$transaction([
      prisma.user.count({ where: { id: "pool_a" } }), prisma.user.count({ where: { id: "pool_b" } }),
    ])
    assert.equal(own, 1); assert.equal(foreign, 0)
    await assert.rejects(prisma.$executeRawUnsafe('UPDATE "User" SET "tenantId" = $1 WHERE id = $2', "pool_b", "pool_a"))
    await assert.rejects(prisma.$queryRawUnsafe("SELECT 1 / 0"))
    assert.equal(await prisma.user.count({ where: { id: "pool_a" } }), 1)
  })
  assert.equal(await prisma.user.count({ where: { id: { in: ids } } }), 0)
})

test("disconnecting a tenant client leaves the shared pool usable by other tenants", async () => {
  await tenant("pool_a", () => prisma.$disconnect())
  assert.equal(await tenant("pool_b", () => prisma.user.count({ where: { id: "pool_b" } })), 1)
  assert.equal(await tenant("pool_a", () => prisma.user.count({ where: { id: "pool_a" } })), 1)
  assert.equal(global.prismaPool.totalCount, 1)
})

test("new physical connections establish transaction-local scope again", async () => {
  const connection = await global.prismaPool.connect()
  connection.release(true)
  assert.equal(await tenant("pool_b", () => prisma.user.count({ where: { id: "pool_b" } })), 1)
  assert.equal(await prisma.user.count({ where: { id: { in: ids } } }), 0)
})

test("failed platform queries and invalid tenant identifiers cannot leak bypass", async () => {
  await assert.rejects(bypass(() => prisma.$queryRawUnsafe("SELECT 1 / 0")))
  await assert.rejects(tenant("pool_a'; SELECT 1; --", () => prisma.user.count()), /Invalid tenantId/)
  assert.equal(await prisma.user.count({ where: { id: { in: ids } } }), 0)
  assert.equal(await tenant("pool_b", () => prisma.user.count({ where: { id: { in: ids } } })), 1)
})
