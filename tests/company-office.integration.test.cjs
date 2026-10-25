/* eslint-disable @typescript-eslint/no-require-imports */
const { test, before, after } = require('node:test'), assert = require('node:assert/strict'), { randomUUID } = require('node:crypto')
const { Pool } = require('pg'), { PrismaClient } = require('@prisma/client')
const { TenantPgAdapter } = require('../lib/tenant-pg-adapter.ts'), { runWithDatabaseActor } = require('../lib/database-actor.ts')
const { createCompanyService } = require('../platform/companies/service.ts')
const { fixtureUser } = require('./helpers/access-fixtures.cjs')
const { createAuditReportService } = require('../platform/audit/service.ts')
require('../lib/logger.ts').logger.info = () => {}
const url = new URL(process.env.CRM_TEST_DATABASE_URL || 'http://invalid')
if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/ls_salon_crm_test') throw Error('Disposable local database only.')
const tenant = 'companies_' + randomUUID(), foreign = 'companies_' + randomUUID(), pools = [], clients = []
function client(tenantId, bypass = false) {
  const u = new URL(url); if (!bypass) { u.username = 'crm_test_runtime'; u.password = '' }
  const pool = new Pool({ connectionString: u.toString(), max: 4 }); pools.push(pool)
  const db = new PrismaClient({ adapter: new TenantPgAdapter(pool, { tenantId, bypass }) }); clients.push(db); return db
}
const root = client(undefined, true), db = client(tenant), otherDb = client(foreign), unscoped = client(undefined)
const identity = user => ({ tenantId: user.tenantId, userId: user.id, requestId: 'company-test' }), denied = status => error => error.status === status
let admin, manager, staff, foreignAdmin, companies, other, initial, initialOffice, parent, child, office
before(async () => {
  await root.tenant.createMany({ data: [tenant, foreign].map(id => ({ id, name: id, slug: id })) })
  const user = (tenantId, role) => fixtureUser(root, { data: { tenantId, role, email: randomUUID() + '@example.test' } })
  admin = await user(tenant, 'ADMIN'); manager = await user(tenant, 'MANAGER'); staff = await user(tenant, 'STAFF'); foreignAdmin = await user(foreign, 'ADMIN')
  companies = createCompanyService(db, identity(admin)); other = createCompanyService(otherDb, identity(foreignAdmin))
  initial = (await companies.listCompanies({})).items[0]; initialOffice = (await companies.listOffices({})).items[0]
})
after(async () => { await Promise.all(clients.map(c => c.$disconnect())); await Promise.all(pools.map(p => p.end())) })

test('new tenant provisioning atomically creates one initial company and main office', async () => {
  assert.equal((await companies.listCompanies({})).total, 1); assert.equal((await companies.listOffices({})).total, 1)
  assert.equal(initial.isInitial, true); assert.equal(initialOffice.isInitial, true); assert.equal(initialOffice.companyId, initial.id)
  assert.equal((await other.listCompanies({})).total, 1)
  const rollbackTenant = 'rollback_' + randomUUID()
  await assert.rejects(root.$transaction(async tx => { await tx.tenant.create({ data: { id: rollbackTenant, name: 'Rollback', slug: rollbackTenant } }); throw Error('Abort provisioning') }), /Abort provisioning/)
  assert.equal(await root.businessCompany.count({ where: { tenantId: rollbackTenant } }), 0)
  assert.equal(await root.businessOffice.count({ where: { tenantId: rollbackTenant } }), 0)
})
test('subsidiaries and offices use separate generic records with normalized stable codes', async () => {
  parent = await companies.createCompany({ name: '  Northern business  ', code: ' north ', parentId: initial.id })
  child = await companies.createCompany({ name: 'Subsidiary', code: 'SUB', parentId: parent.id })
  office = await companies.createOffice({ name: 'Regional office', code: 'west', companyId: parent.id })
  assert.equal(parent.name, 'Northern business'); assert.equal(parent.code, 'NORTH'); assert.equal(child.parent.id, parent.id)
  assert.equal(office.code, 'WEST'); assert.equal(office.company.id, parent.id)
  await assert.rejects(companies.createCompany({ name: 'Duplicate code', code: 'north' }), denied(409))
  await assert.rejects(companies.createOffice({ name: 'Duplicate office code', code: 'west', companyId: parent.id }), denied(409))
  const second = await companies.createOffice({ name: 'Different company', code: 'WEST', companyId: child.id }); assert.equal(second.companyId, child.id)
  await companies.updateOffice(second.id, { archived: true, version: second.version })
})
test('tenant administrators alone can list or manage structure, regardless of profile breadth', async () => {
  for (const user of [manager, staff]) {
    const deniedService = createCompanyService(db, identity(user))
    for (const operation of [() => deniedService.listCompanies({}), () => deniedService.listOffices({}), () => deniedService.getCompany(initial.id), () => deniedService.getOffice(initialOffice.id), () => deniedService.createCompany({ name: 'Denied', code: 'DENIED' }), () => deniedService.updateCompany(parent.id, { name: 'Denied', version: parent.version })]) await assert.rejects(operation(), denied(403))
  }
})
test('cross-tenant reads, parent selection and office assignment fail without disclosing foreign rows', async () => {
  const foreignCompany = (await other.listCompanies({})).items[0]
  await assert.rejects(companies.getCompany(foreignCompany.id), denied(404))
  await assert.rejects(companies.getOffice((await other.listOffices({})).items[0].id), denied(404))
  await assert.rejects(companies.listOffices({ companyId: foreignCompany.id }), denied(404))
  await assert.rejects(companies.createCompany({ name: 'Foreign parent', code: 'BAD', parentId: foreignCompany.id }), denied(400))
  await assert.rejects(companies.createOffice({ name: 'Foreign company', code: 'BAD', companyId: foreignCompany.id }), denied(400))
  assert.equal((await companies.listCompanies({ q: foreignCompany.id })).total, 0)
})
test('a company cannot become its own parent or descendant, through service or direct SQL', async () => {
  await assert.rejects(companies.updateCompany(parent.id, { parentId: parent.id, version: parent.version }), denied(409))
  await assert.rejects(companies.updateCompany(parent.id, { parentId: child.id, version: parent.version }), denied(409))
  await assert.rejects(root.businessCompany.update({ where: { id: parent.id }, data: { parentId: child.id } }), /cycle/)
  const foreignCompany = (await other.listCompanies({})).items[0]
  await assert.rejects(root.businessCompany.update({ where: { id: child.id }, data: { parentId: foreignCompany.id } }), /active parent company/)
})
test('initial records, tenant ownership, office company and codes cannot be reassigned', async () => {
  await assert.rejects(companies.updateCompany(initial.id, { archived: true, version: initial.version }), denied(409))
  await assert.rejects(companies.updateOffice(initialOffice.id, { archived: true, version: initialOffice.version }), denied(409))
  await assert.rejects(companies.updateCompany(initial.id, { parentId: parent.id, version: initial.version }), denied(409))
  for (const data of [{ tenantId: foreign }, { code: 'REPLACED' }, { isInitial: false }, { archived: true }]) await assert.rejects(root.businessCompany.update({ where: { id: initial.id }, data }))
  await assert.rejects(root.businessOffice.update({ where: { id: office.id }, data: { companyId: child.id } }), /cannot be moved/)
  assert.throws(() => companies.updateCompany(parent.id, { code: 'REPLACED', version: parent.version }))
  assert.throws(() => companies.updateOffice(office.id, { companyId: child.id, version: office.version }))
  assert.throws(() => companies.createCompany({ name: 'Injected authority', code: 'BAD', isInitial: true }))
})
test('archiving requires inactive descendants and offices; restoring follows company hierarchy', async () => {
  await assert.rejects(companies.updateCompany(parent.id, { archived: true, version: parent.version }), denied(409))
  await assert.rejects(root.businessCompany.update({ where: { id: parent.id }, data: { archived: true } }), /subsidiaries and offices/)
  child = await companies.updateCompany(child.id, { archived: true, version: child.version })
  office = await companies.updateOffice(office.id, { archived: true, version: office.version })
  parent = await companies.updateCompany(parent.id, { archived: true, version: parent.version })
  assert.equal((await companies.listCompanies({ status: 'archived' })).total, 2)
  await assert.rejects(companies.updateCompany(child.id, { archived: false, version: child.version }), denied(400))
  await assert.rejects(companies.updateOffice(office.id, { archived: false, version: office.version }), denied(400))
  await assert.rejects(companies.createOffice({ name: 'Archived parent', code: 'BAD', companyId: parent.id }), denied(400))
  parent = await companies.updateCompany(parent.id, { archived: false, version: parent.version })
  child = await companies.updateCompany(child.id, { archived: false, version: child.version })
  office = await companies.updateOffice(office.id, { archived: false, version: office.version })
})
test('search, company filtering, pagination and status counts use the same server predicate', async () => {
  const first = await companies.listCompanies({ pageSize: 2 }), second = await companies.listCompanies({ page: 2, pageSize: 2 })
  assert.equal(first.total, 3); assert.equal(first.totalPages, 2); assert.equal(first.items[0].id, initial.id)
  assert.equal(new Set([...first.items, ...second.items].map(r => r.id)).size, 3)
  assert.equal((await companies.listCompanies({ q: 'nOrTh' })).items[0].id, parent.id)
  assert.equal((await companies.listOffices({ companyId: parent.id, q: 'REGIONAL' })).items[0].id, office.id)
  assert.equal((await companies.listOffices({ status: 'all' })).total, 3)
  for (const invalid of [{ page: 0 }, { pageSize: 101 }, { status: 'garbage' }, { q: 'x'.repeat(161) }, { sort: 'passwordHash' }]) assert.throws(() => companies.listCompanies(invalid))
})
test('concurrent edits keep one version winner and reject the stale save', async () => {
  const results = await Promise.allSettled(['Name A', 'Name B'].map(name => companies.updateCompany(parent.id, { name, version: parent.version })))
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
  assert.equal(results.filter(r => r.status === 'rejected' && r.reason.status === 409).length, 1)
  parent = await companies.getCompany(parent.id)
  const stale = office.version; office = await companies.updateOffice(office.id, { name: 'West office', version: office.version })
  await assert.rejects(companies.updateOffice(office.id, { name: 'Lost update', version: stale }), denied(409))
})
test('fresh account and tenant authority applies after suspension or admin demotion', async () => {
  await root.user.update({ where: { id: admin.id }, data: { role: 'MANAGER' } })
  try { await assert.rejects(companies.listCompanies({}), denied(403)); await assert.rejects(companies.updateCompany(parent.id, { name: 'Denied', version: parent.version }), denied(403)) }
  finally { await root.user.update({ where: { id: admin.id }, data: { role: 'ADMIN' } }) }
  await root.user.update({ where: { id: admin.id }, data: { status: 'SUSPENDED' } })
  try { await assert.rejects(companies.listOffices({}), denied(403)) } finally { await root.user.update({ where: { id: admin.id }, data: { status: 'ACTIVE' } }) }
  await root.tenant.update({ where: { id: tenant }, data: { status: 'SUSPENDED' } })
  try { await assert.rejects(companies.listCompanies({}), denied(403)) } finally { await root.tenant.update({ where: { id: tenant }, data: { status: 'ACTIVE' } }) }
  const previous = process.env.PLATFORM_ADMIN_TENANT_SLUG; process.env.PLATFORM_ADMIN_TENANT_SLUG = tenant
  try { await assert.rejects(companies.listCompanies({}), denied(403)) }
  finally { if (previous === undefined) delete process.env.PLATFORM_ADMIN_TENANT_SLUG; else process.env.PLATFORM_ADMIN_TENANT_SLUG = previous }
})
test('forced RLS denies unscoped, foreign and non-admin queries, including audit copies and hard delete', async () => {
  assert.equal(await unscoped.businessCompany.count(), 0)
  assert.equal(await db.businessCompany.count(), 0)
  assert.equal(await runWithDatabaseActor(manager.id, async () => await db.businessCompany.count()), 0)
  assert.equal(await runWithDatabaseActor(staff.id, async () => await db.businessOffice.count()), 0)
  assert.equal(await runWithDatabaseActor(admin.id, async () => await otherDb.businessCompany.count()), 0)
  assert.equal(await runWithDatabaseActor(admin.id, async () => await db.businessCompany.count()), 3)
  await assert.rejects(runWithDatabaseActor(manager.id, async () => await db.businessCompany.create({ data: { tenantId: tenant, name: 'Denied SQL', code: 'DENIEDSQL' } })))
  const eventWhere = { tenantId: tenant, event: { startsWith: 'structure.' } }
  assert.ok(await runWithDatabaseActor(admin.id, async () => await db.auditLog.count({ where: eventWhere })) > 0)
  assert.equal(await runWithDatabaseActor(manager.id, async () => await db.auditLog.count({ where: eventWhere })), 0)
  assert.equal((await runWithDatabaseActor(admin.id, async () => await db.businessOffice.deleteMany({ where: { id: office.id } }))).count, 0)
  const [role] = await db.$queryRaw`SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`
  assert.equal(role.rolsuper, false); assert.equal(role.rolbypassrls, false)
})
test('successful changes are auditable and an audit failure rolls back the business change', async () => {
  const report = createAuditReportService(db, identity(admin))
  const rows = await report.list({ entityType: 'BusinessCompany', category: 'security' }); assert.ok(rows.total > 0)
  assert.equal((await createAuditReportService(db, identity(manager)).list({ entityType: 'BusinessCompany' })).total, 0)
  const faulty = new Proxy(db, { get(target, key) { if (key === '$transaction') return fn => target.$transaction(tx => fn(new Proxy(tx, { get(t, k) { if (k === 'auditLog') return { createMany: () => { throw Error('Required audit unavailable') } }; return t[k] } }))); return target[key] } })
  await assert.rejects(createCompanyService(faulty, identity(admin)).createCompany({ name: 'Rolled back', code: 'NOAUDIT' }), /Required audit unavailable/)
  assert.equal((await companies.listCompanies({ q: 'NOAUDIT' })).total, 0)
})
test('an existing operating company can later join a new holding company without changing its identity', async () => {
  const holding = await companies.createCompany({ name: 'Holding company', code: 'GROUP' })
  const moved = await companies.updateCompany(initial.id, { parentId: holding.id, version: initial.version })
  assert.equal(moved.id, initial.id); assert.equal(moved.isInitial, true); assert.equal(moved.parentId, holding.id)
  assert.equal((await companies.getOffice(initialOffice.id)).companyId, initial.id)
  await assert.rejects(companies.updateCompany(holding.id, { archived: true, version: holding.version }), denied(409))
})
test('concurrent hierarchy changes cannot create a cycle', async () => {
  const a = await companies.createCompany({ name: 'Concurrent A', code: 'CYCLE_A' })
  const b = await companies.createCompany({ name: 'Concurrent B', code: 'CYCLE_B' })
  const results = await Promise.allSettled([companies.updateCompany(a.id, { parentId: b.id, version: a.version }), companies.updateCompany(b.id, { parentId: a.id, version: b.version })])
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
  assert.equal(results.filter(r => r.status === 'rejected' && r.reason.status === 409).length, 1)
})
test('maintenance tenant deletion cleans its structure atomically without permitting isolated company deletion', async () => {
  const id = 'cleanup_' + randomUUID()
  await root.tenant.create({ data: { id, name: 'Disposable cleanup', slug: id } })
  const company = await root.businessCompany.findFirstOrThrow({ where: { tenantId: id } })
  await root.businessCompany.create({ data: { tenantId: id, name: 'Subsidiary', code: 'SUB', parentId: company.id } })
  await assert.rejects(root.businessCompany.delete({ where: { id: company.id } }))
  await root.$transaction(async tx => {
    // Existing reference catalogs deliberately restrict tenant deletion. The
    // maintenance path already removes those unused synthetic choices first.
    await tx.realEstateProjectStatus.deleteMany({ where: { tenantId: id } })
    await tx.realEstatePropertyCategory.deleteMany({ where: { tenantId: id } })
    await tx.realEstateBuyingTimeframe.deleteMany({ where: { tenantId: id } })
    await tx.tenant.delete({ where: { id } })
  })
  assert.equal(await root.businessCompany.count({ where: { tenantId: id } }), 0)
  assert.equal(await root.businessOffice.count({ where: { tenantId: id } }), 0)
})
