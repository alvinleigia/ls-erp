/* eslint-disable @typescript-eslint/no-require-imports */
const {fixtureUser}=require("./helpers/access-fixtures.cjs")
const { test, before, after } = require("node:test")
const assert = require("node:assert/strict")
const { randomUUID } = require("node:crypto")
const { Pool } = require("pg")
const { PrismaClient } = require("@prisma/client")
const { TenantPgAdapter } = require("../lib/tenant-pg-adapter.ts")
const { createTerminologyService } = require("../platform/terminology/service.ts")
const { terminologyCatalog } = require("../application/terminology/catalog.ts")
require("../lib/logger.ts").logger.info = () => {}
const url = new URL(process.env.CRM_TEST_DATABASE_URL || "http://invalid")
if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/ls_salon_crm_test") throw Error("Disposable local database only.")
const tenant = `terms-${randomUUID()}`, otherTenant = `terms-${randomUUID()}`, platform = `terms-${randomUUID()}`
const clients = [], pools = []; let queries = []
function client(tenantId, bypass = false) {
  const address = new URL(url)
  if (!bypass) { address.username = "crm_test_runtime"; address.password = "" }
  const pool = new Pool({ connectionString: address.toString(), max: 4 }); pools.push(pool)
  const db = new PrismaClient({ adapter: new TenantPgAdapter(pool, { tenantId, bypass }), log: [{ emit: "event", level: "query" }] })
  db.$on("query", event => queries.push(event.query)); clients.push(db); return db
}
const root = client(undefined, true), db = client(tenant), dbB = client(otherTenant), unscoped = client()
const status = code => error => error.status === code
const key = "crm.enquiry.singular"
let admin, manager, staff, customer, otherAdmin, platformAdmin, service
const identity = user => ({ tenantId: user.tenantId, userId: user.id })
const forUser = (user, connection = db) => createTerminologyService(connection, identity(user), terminologyCatalog)
before(async () => {
  process.env.PLATFORM_ADMIN_TENANT_SLUG = platform
  await root.tenant.createMany({ data: [tenant, otherTenant, platform].map(id => ({ id, slug: id, name: id })) })
  const user = (tenantId, role) => fixtureUser(root,{ data: { tenantId, role, name: role, email: `${randomUUID()}@example.test` } })
  admin = await user(tenant, "ADMIN"); manager = await user(tenant, "MANAGER"); staff = await user(tenant, "STAFF"); customer = await user(tenant, "CUSTOMER")
  otherAdmin = await user(otherTenant, "ADMIN"); platformAdmin = await user(platform, "ADMIN")
  await root.tenantModule.createMany({ data: [tenant, otherTenant].flatMap(tenantId => ["crm", "realEstate", "salesDocuments", "paymentPlans"].map(key => ({ tenantId, key, allowed: true, enabled: true }))) })
  service = forUser(admin)
})
after(async () => { await Promise.all(clients.map(db => db.$disconnect())); await Promise.all(pools.map(pool => pool.end())) })

test("default resolution is tenant-scoped, bounded and never writes configuration", async () => {
  queries = []
  const current = await service.read()
  assert.equal(current.version, 0); assert.equal(current.terms.length, 18); assert.equal(current.labels[key], "Enquiry")
  assert.deepEqual(current.replacements, {})
  assert.ok(queries.length <= 6, `Expected a fixed snapshot query count, got ${queries.length}`)
  assert.equal(await root.tenantTerminology.count({ where: { tenantId: tenant } }), 0)
  assert.equal(await root.tenantTerminologyRevision.count({ where: { tenantId: tenant } }), 0)
})
test("administrator saves are audited, versioned, normalized and reset without deleting history", async () => {
  let current = await service.read()
  current = await service.update({ version: current.version, changes: [{ key, label: "  Lead  " }, { key: "crm.enquiry.plural", label: "Leads" }] })
  assert.equal(current.labels[key], "Lead"); assert.equal(current.version, 1)
  assert.equal(current.replacements[key], "Lead")
  assert.equal((await forUser(otherAdmin, dbB).read()).labels[key], "Enquiry")
  const auditCount = await root.auditLog.count({ where: { tenantId: tenant, event: "terminology.updated" } })
  const noOp = await service.update({ version: current.version, changes: [{ key, label: "Lead" }] })
  assert.equal(noOp.version, current.version)
  assert.equal(await root.auditLog.count({ where: { tenantId: tenant, event: "terminology.updated" } }), auditCount)
  current = await service.update({ version: current.version, changes: [{ key, label: null }, { key: "crm.enquiry.plural", label: "Enquiries" }] })
  assert.equal(current.labels[key], "Enquiry"); assert.equal(current.version, 2)
  assert.deepEqual(current.replacements, {})
  assert.equal(await root.tenantTerminology.count({ where: { tenantId: tenant } }), 0)
  const audit = await root.auditLog.findFirst({ where: { tenantId: tenant, event: "terminology.updated" }, orderBy: { createdAt: "desc" } })
  assert.equal(audit.before.labels[key], "Lead"); assert.equal(audit.after.labels[key], null)
})
test("staff and managers can resolve labels but only active tenant admins can edit", async () => {
  const version = (await service.read()).version
  for (const user of [manager, staff]) {
    assert.equal((await forUser(user).read()).canManage, false)
    await assert.rejects(forUser(user).update({ version, changes: [{ key, label: "Forbidden" }] }), status(403))
  }
  await assert.rejects(forUser(customer).read(), status(403))
  await assert.rejects(forUser(otherAdmin).read(), status(403))
  await assert.rejects(forUser(platformAdmin, root).read(), status(403))
  await root.user.update({ where: { id: admin.id }, data: { status: "SUSPENDED" } })
  try { await assert.rejects(service.update({ version, changes: [{ key, label: "Forbidden" }] }), status(403)) }
  finally { await root.user.update({ where: { id: admin.id }, data: { status: "ACTIVE" } }) }
})
test("invalid, unknown, duplicate and colliding changes roll back the entire batch", async () => {
  const current = await service.read()
  for (const change of [{ key, label: "Contacts" }, { key, label: "Status" }, { key: "unknown.field", label: "Unknown" }, { key, label: "<script>" }]) {
    const invalid = change.label === "Contacts" ? { ...change, key: "crm.enquiry.plural" } : change
    await assert.rejects(service.update({ version: current.version, changes: [{ key: "crm.activity.singular", label: "Task" }, invalid] }))
    assert.deepEqual(await service.read(), current)
  }
  await assert.rejects(service.update({ version: current.version, changes: [{ key, label: "Lead" }, { key, label: null }] }), status(400))
})
test("disabled modules retain overrides, reject edits and obey parent dependencies", async () => {
  let current = await service.read()
  current = await service.update({ version: current.version, changes: [{ key: "realEstate.project.singular", label: "Development" }] })
  for (const moduleKey of ["realEstate", "crm"]) {
    await root.tenantModule.update({ where: { tenantId_key: { tenantId: tenant, key: moduleKey } }, data: { enabled: false } })
    try {
      assert.equal((await service.read()).labels["realEstate.project.singular"], undefined)
      await assert.rejects(service.update({ version: current.version, changes: [{ key: "realEstate.project.singular", label: null }] }), status(403))
      assert.equal((await root.tenantTerminology.findUnique({ where: { tenantId_key: { tenantId: tenant, key: "realEstate.project.singular" } } })).label, "Development")
    } finally { await root.tenantModule.update({ where: { tenantId_key: { tenantId: tenant, key: moduleKey } }, data: { enabled: true } }) }
  }
  assert.equal((await service.read()).labels["realEstate.project.singular"], "Development")
})
test("concurrent edits accept one writer and stale browsers cannot overwrite it", async () => {
  const current = await service.read()
  const results = await Promise.allSettled(["Lead", "Prospect"].map(label => service.update({ version: current.version, changes: [{ key, label }] })))
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1)
  assert.equal(results.find(result => result.status === "rejected").reason.status, 409)
  await assert.rejects(service.update({ version: current.version, changes: [{ key, label: "Late" }] }), status(409))
})
test("audit failure rolls configuration and revision back together", async () => {
  const current = await service.read()
  const faulty = new Proxy(db, { get(target, prop) {
    if (prop === "$transaction") return (operation, options) => target.$transaction(tx => operation(new Proxy(tx, { get(inner, key) {
      if (key === "auditLog") return { createMany: async () => { throw Error("audit fault") } }
      const value = inner[key]; return typeof value === "function" ? value.bind(inner) : value
    } })), options)
    const value = target[prop]; return typeof value === "function" ? value.bind(target) : value
  } })
  await assert.rejects(forUser(admin, faulty).update({ version: current.version, changes: [{ key, label: "Rollback" }] }), /audit fault/)
  assert.deepEqual(await service.read(), current)
})
test("queued writers recheck administrator role and module access after the tenant lock", async () => {
  const before = await service.read()
  const auditCount = await root.auditLog.count({ where: { tenantId: tenant, event: "terminology.updated" } })
  for (const scenario of ["role", "module"]) {
    const locker = await pools[0].connect(); let pending
    try {
      await locker.query("BEGIN")
      const pid = (await locker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid
      await locker.query('SELECT id FROM "Tenant" WHERE id=$1 FOR UPDATE', [tenant])
      pending = service.update({ version: before.version, changes: [{ key, label: "Must not save" }] }).then(value => ({ value }), error => ({ error }))
      let waiting = false
      const deadline = Date.now() + 5000
      while (Date.now() < deadline) {
        waiting = (await root.$queryRaw`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE ${pid}::int = ANY(pg_blocking_pids(pid))) AS waiting`)[0].waiting
        if (waiting) break
        await new Promise(resolve => setTimeout(resolve, 20))
      }
      assert.equal(waiting, true, "Save must be queued on the tenant lock")
      if (scenario === "role") await root.user.update({ where: { id: admin.id }, data: { role: "MANAGER" } })
      else await root.tenantModule.update({ where: { tenantId_key: { tenantId: tenant, key: "crm" } }, data: { enabled: false } })
      await locker.query("COMMIT")
      assert.equal((await pending).error?.status, 403)
    } finally {
      await locker.query("ROLLBACK"); locker.release()
      if (pending) await pending
      await root.user.update({ where: { id: admin.id }, data: { role: "ADMIN" } })
      await root.tenantModule.update({ where: { tenantId_key: { tenantId: tenant, key: "crm" } }, data: { enabled: true } })
    }
  }
  assert.deepEqual(await service.read(), before)
  assert.equal(await root.auditLog.count({ where: { tenantId: tenant, event: "terminology.updated" } }), auditCount)
})

test("forced RLS blocks foreign and unscoped label/revision reads and writes", async () => {
  assert.deepEqual(await dbB.tenantTerminology.findMany({ where: { tenantId: tenant } }), [])
  assert.deepEqual(await unscoped.tenantTerminology.findMany(), [])
  assert.deepEqual(await unscoped.tenantTerminologyRevision.findMany(), [])
  await assert.rejects(dbB.tenantTerminology.create({ data: { tenantId: tenant, key: "forbidden.key", label: "Foreign" } }))
  await assert.rejects(dbB.tenantTerminologyRevision.create({ data: { tenantId: tenant, version: 999 } }))
  const tables = await root.$queryRaw`SELECT relname::text, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname IN ('TenantTerminology', 'TenantTerminologyRevision')`
  assert.equal(tables.length, 2); assert.ok(tables.every(table => table.relrowsecurity && table.relforcerowsecurity))
})
