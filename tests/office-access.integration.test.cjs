/* eslint-disable @typescript-eslint/no-require-imports */
const { test, before, after } = require('node:test'), assert = require('node:assert/strict'), { randomUUID } = require('node:crypto')
const { Pool } = require('pg'), { PrismaClient } = require('@prisma/client')
const { TenantPgAdapter } = require('../lib/tenant-pg-adapter.ts'), { runWithDatabaseActor } = require('../lib/database-actor.ts')
const { createCompanyService } = require('../platform/companies/service.ts')
const { createOfficeAccessService } = require('../platform/companies/office-access.ts')
const { findAccessUser, assignedPermissions } = require('../platform/access/server.ts')
require('../lib/logger.ts').logger.info = () => {}
const url = new URL(process.env.CRM_TEST_DATABASE_URL || 'http://invalid')
if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/ls_salon_crm_test') throw Error('Disposable local database only.')
const tenant = 'office_' + randomUUID(), foreign = 'office_' + randomUUID(), pools = [], clients = []
function client(tenantId, bypass = false) {
  const u = new URL(url); if (!bypass) { u.username = 'crm_test_runtime'; u.password = '' }
  const pool = new Pool({ connectionString: u.toString(), max: 4 }); pools.push(pool)
  const db = new PrismaClient({ adapter: new TenantPgAdapter(pool, { tenantId, bypass }) }); clients.push(db); return db
}
const root = client(undefined, true), db = client(tenant), otherDb = client(foreign), unscoped = client(undefined)
const identity = user => ({ tenantId: user.tenantId, userId: user.id, requestId: 'office-access-test' }), denied = status => error => error.status === status
const direct = (user, fn) => runWithDatabaseActor(user.id, fn)
let admin, manager, staff, peer, customer, foreignAdmin, service, own, companies, parent, child, grandchild, sibling, a, b, c, d, foreignOffice
async function save(user, officeIds = [], grants = [], creationOfficeId = null) {
  const current = await service.getMemberships(user.id)
  return service.saveMemberships(user.id, { version: current.version, creationOfficeId, officeIds, companies: grants })
}
const list = async user => (await createOfficeAccessService(db, identity(user)).listOwnOffices({ pageSize: 100 })).items.map(o => o.id).sort()
before(async () => {
  await root.tenant.createMany({ data: [tenant, foreign].map(id => ({ id, name: id, slug: id })) })
  const user = (tenantId, role) => root.user.create({ data: { tenantId, role, name: role, email: randomUUID() + '@example.test' } })
  admin = await user(tenant, 'ADMIN'); manager = await user(tenant, 'MANAGER'); staff = await user(tenant, 'STAFF'); peer = await user(tenant, 'STAFF'); customer = await user(tenant, 'CUSTOMER'); foreignAdmin = await user(foreign, 'ADMIN')
  service = createOfficeAccessService(db, identity(admin)); own = createOfficeAccessService(db, identity(staff)); companies = createCompanyService(db, identity(admin))
  parent = await companies.createCompany({ name: 'Parent', code: 'PARENT' })
  child = await companies.createCompany({ name: 'Child', code: 'CHILD', parentId: parent.id })
  grandchild = await companies.createCompany({ name: 'Grandchild', code: 'GRANDCHILD', parentId: child.id })
  sibling = await companies.createCompany({ name: 'Sibling', code: 'SIBLING' })
  a = await companies.createOffice({ name: 'Parent east', code: 'EAST', companyId: parent.id })
  b = await companies.createOffice({ name: 'Child west', code: 'WEST', companyId: child.id })
  c = await companies.createOffice({ name: 'Grandchild north', code: 'NORTH', companyId: grandchild.id })
  d = await companies.createOffice({ name: 'Sibling south', code: 'SOUTH', companyId: sibling.id })
  foreignOffice = (await createCompanyService(otherDb, identity(foreignAdmin)).listOffices({})).items[0]
})
after(async () => { await Promise.all(clients.map(c => c.$disconnect())); await Promise.all(pools.map(p => p.end())) })

test('new unassigned business users have no implicit office or creation context', async () => {
  assert.equal((await service.getMemberships(staff.id)).version, 0)
  assert.deepEqual(await list(staff), [])
  assert.deepEqual(await own.getOwnContext(), { creationOffice: null, version: 0 })
  await assert.rejects(own.selectCreationOffice({ version: 0, officeId: a.id }), denied(403))
  assert.equal((await service.getMemberships(staff.id)).version, 0)
})
test('exact office grants do not grant sibling offices or an entire company', async () => {
  await save(staff, [a.id], [], a.id)
  assert.deepEqual(await list(staff), [a.id]); assert.equal((await own.getOwnContext()).creationOffice.id, a.id)
  const another = await companies.createOffice({ name: 'Parent other', code: 'OTHER', companyId: parent.id })
  assert.deepEqual(await list(staff), [a.id])
  await companies.updateOffice(another.id, { archived: true, version: another.version })
})
test('company access includes its offices but never descendants unless explicitly requested', async () => {
  await save(staff, [], [{ companyId: parent.id, includeSubsidiaries: false }], a.id)
  assert.deepEqual(await list(staff), [a.id])
  await save(staff, [], [{ companyId: parent.id, includeSubsidiaries: true }], a.id)
  assert.deepEqual(await list(staff), [a.id, b.id, c.id].sort())
  await save(staff, [], [{ companyId: child.id, includeSubsidiaries: true }], b.id)
  assert.deepEqual(await list(staff), [b.id, c.id].sort())
})
test('company grants intentionally include future offices while exact grants remain fixed', async () => {
  await save(staff, [], [{ companyId: parent.id, includeSubsidiaries: false }], a.id)
  const future = await companies.createOffice({ name: 'Future office', code: 'FUTURE', companyId: parent.id })
  assert.deepEqual(await list(staff), [a.id, future.id].sort())
  await companies.updateOffice(future.id, { archived: true, version: future.version })
})
test('reparenting a subsidiary re-evaluates explicitly inherited access on the next request', async () => {
  await save(staff, [], [{ companyId: parent.id, includeSubsidiaries: true }], a.id)
  child = await companies.updateCompany(child.id, { parentId: sibling.id, version: child.version })
  assert.deepEqual(await list(staff), [a.id])
  child = await companies.updateCompany(child.id, { parentId: parent.id, version: child.version })
  assert.deepEqual(await list(staff), [a.id, b.id, c.id].sort())
})
test('several company/office grants combine without duplicate rows or action grants', async () => {
  const before = assignedPermissions(await findAccessUser(db, tenant, staff.id))
  await save(staff, [a.id, b.id, d.id], [{ companyId: parent.id, includeSubsidiaries: true }], a.id)
  assert.deepEqual(await list(staff), [a.id, b.id, c.id, d.id].sort())
  assert.deepEqual(assignedPermissions(await findAccessUser(db, tenant, staff.id)), before)
  assert.deepEqual(before, [])
  assert.equal(await root.tenantRoleAssignment.count({ where: { tenantId: tenant, userId: staff.id } }), 0)
})
test('creation preference selects only an accessible office and never adds a grant', async () => {
  const current = await own.getOwnContext(), grants = await service.getMemberships(staff.id)
  const changed = await own.selectCreationOffice({ version: current.version, officeId: b.id })
  assert.equal(changed.version, current.version + 1)
  const after = await service.getMemberships(staff.id)
  assert.deepEqual(after.offices, grants.offices); assert.deepEqual(after.companies, grants.companies)
  assert.equal((await own.getOwnContext()).creationOffice.id, b.id)
  await save(staff, [a.id], [], a.id)
  await assert.rejects(own.selectCreationOffice({ version: (await own.getOwnContext()).version, officeId: d.id }), denied(403))
  assert.equal((await own.getOwnContext()).creationOffice.id, a.id)
})
test('invalid creation-office selections roll back the entire membership replacement', async () => {
  const before = await service.getMemberships(staff.id)
  await assert.rejects(service.saveMemberships(staff.id, { version: before.version, officeIds: [b.id], companies: [], creationOfficeId: d.id }), denied(400))
  assert.deepEqual(await service.getMemberships(staff.id), before)
  await assert.rejects(service.saveMemberships(staff.id, { version: before.version, officeIds: [], companies: [], creationOfficeId: foreignOffice.id }), denied(400))
  assert.deepEqual(await service.getMemberships(staff.id), before)
})
test('complete revocation clears context without silently falling back to the initial office', async () => {
  await save(staff, [], [], null)
  assert.deepEqual(await list(staff), []); assert.equal((await own.getOwnContext()).creationOffice, null)
  const current = await own.getOwnContext()
  await assert.rejects(own.selectCreationOffice({ version: current.version, officeId: a.id }), denied(403))
})
test('closed offices leave creation choices immediately while retaining explicitly authorized historical eligibility', async () => {
  await save(staff, [a.id], [], a.id)
  a = await companies.updateOffice(a.id, { archived: true, version: a.version })
  assert.deepEqual(await list(staff), []); assert.equal((await own.getOwnContext()).creationOffice, null)
  assert.equal((await direct(admin, async () => await db.$queryRaw`SELECT app.business_office_access(${tenant},${a.id},${staff.id}) allowed`))[0].allowed, true)
  await assert.rejects(save(staff, [a.id], [], a.id), denied(400))
  await save(staff, [a.id], [], null)
  assert.deepEqual(await list(staff), [])
  a = await companies.updateOffice(a.id, { archived: false, version: a.version })
  assert.deepEqual(await list(staff), [a.id]); assert.equal((await own.getOwnContext()).creationOffice, null)
})
test('administrator oversight spans active offices; Manager label alone confers no office access', async () => {
  assert.ok((await list(admin)).includes(d.id)); assert.deepEqual(await list(manager), [])
  await save(manager, [b.id], [], b.id); assert.deepEqual(await list(manager), [b.id])
  await save(manager, [], [], null); assert.deepEqual(await list(manager), [])
})
test('only fresh tenant administrators can inspect or replace another user membership policy', async () => {
  for (const user of [staff, manager]) {
    const forbidden = createOfficeAccessService(db, identity(user))
    await assert.rejects(forbidden.getMemberships(staff.id), denied(403))
    await assert.rejects(forbidden.saveMemberships(user.id, { version: 0, officeIds: [d.id], companies: [], creationOfficeId: d.id }), denied(403))
  }
  await root.user.update({ where: { id: admin.id }, data: { role: 'MANAGER' } })
  try { await assert.rejects(service.getMemberships(staff.id), denied(403)) } finally { await root.user.update({ where: { id: admin.id }, data: { role: 'ADMIN' } }) }
})
test('cross-tenant user, office and company selections are rejected', async () => {
  await assert.rejects(service.getMemberships(foreignAdmin.id), denied(404))
  await assert.rejects(save(staff, [foreignOffice.id], [], null), denied(400))
  await assert.rejects(save(staff, [], [{ companyId: foreignOffice.companyId, includeSubsidiaries: true }]), denied(400))
  await assert.rejects(own.selectCreationOffice({ version: (await own.getOwnContext()).version, officeId: foreignOffice.id }), denied(403))
})
test('inactive users and tenants are rechecked by both service and database resolver', async () => {
  await root.user.update({ where: { id: staff.id }, data: { status: 'SUSPENDED' } })
  try {
    await assert.rejects(own.listOwnOffices({}), denied(403))
    assert.equal((await direct(admin, async () => await db.$queryRaw`SELECT app.business_office_allowed(${tenant},${a.id},${staff.id}) allowed`))[0].allowed, false)
    await assert.rejects(save(staff, [a.id], [], a.id), denied(400))
    await save(staff, [], [], null)
  } finally { await root.user.update({ where: { id: staff.id }, data: { status: 'ACTIVE' } }) }
  await root.tenant.update({ where: { id: tenant }, data: { status: 'SUSPENDED' } })
  try { await assert.rejects(service.listOwnOffices({}), denied(403)) } finally { await root.tenant.update({ where: { id: tenant }, data: { status: 'ACTIVE' } }) }
  await assert.rejects(createOfficeAccessService(db, identity(customer)).getOwnContext(), denied(403))
  await assert.rejects(save(customer, [a.id], [], a.id), denied(400))
})
test('stale and concurrent saves cannot overwrite a membership policy or creation preference', async () => {
  const current = await save(staff, [a.id, b.id], [], a.id)
  const results = await Promise.allSettled([a.id, b.id].map(officeId => own.selectCreationOffice({ version: current.version, officeId })))
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
  assert.equal(results.filter(r => r.status === 'rejected' && r.reason.status === 409).length, 1)
  await assert.rejects(service.saveMemberships(staff.id, { version: current.version, officeIds: [], companies: [], creationOfficeId: null }), denied(409))
})
test('duplicate grants, unrecognized fields and unbounded queries fail validation', async () => {
  const input = { version: 0, officeIds: [a.id], companies: [], creationOfficeId: a.id }
  for (const patch of [{ officeIds: [a.id, a.id] }, { companies: [{ companyId: parent.id, includeSubsidiaries: false }, { companyId: parent.id, includeSubsidiaries: true }] }, { permissions: ['enquiries.edit'] }, { version: -1 }, { companies: [{ companyId: parent.id }] }]) assert.throws(() => service.saveMemberships(staff.id, { ...input, ...patch }))
  for (const query of [{ pageSize: 101 }, { page: 0 }, { q: 'x'.repeat(161) }, { userId: peer.id }]) assert.throws(() => own.listOwnOffices(query))
})
test('pagination/search counts distinct accessible offices before slicing', async () => {
  await save(staff, [a.id, b.id], [{ companyId: parent.id, includeSubsidiaries: true }], a.id)
  const first = await own.listOwnOffices({ pageSize: 2 }), second = await own.listOwnOffices({ pageSize: 2, page: 2 })
  assert.equal(first.total, 3); assert.equal(first.totalPages, 2)
  assert.equal(new Set([...first.items, ...second.items].map(o => o.id)).size, 3)
  assert.equal((await own.listOwnOffices({ q: 'CHILD WEST' })).items[0].id, b.id)
  assert.equal((await own.listOwnOffices({ q: 'Parent' })).total, 1)
  assert.deepEqual((await own.listOwnOffices({ sort: 'code', order: 'desc' })).items.map(o => o.id), [b.id, c.id, a.id])
})
test('forced RLS protects policies and grant rows; functions cannot be used to inspect other users', async () => {
  const policy = await service.getMemberships(staff.id)
  assert.equal(await unscoped.businessOfficePolicy.count(), 0)
  assert.equal(await db.businessOfficePolicy.count(), 0)
  assert.equal(await direct(staff, async () => await db.businessOfficePolicy.count()), 1)
  assert.equal(await direct(peer, async () => await db.businessOfficePolicy.count()), 0)
  assert.equal(await direct(foreignAdmin, async () => await db.businessOfficePolicy.count()), 0)
  await assert.rejects(direct(staff, async () => await db.businessCompanyGrant.create({ data: { tenantId: tenant, userId: staff.id, companyId: sibling.id, includeSubsidiaries: true } })))
  await assert.rejects(direct(staff, async () => await db.businessOfficePolicy.update({ where: { tenantId_userId: { tenantId: tenant, userId: staff.id } }, data: { creationOfficeId: d.id } })))
  assert.deepEqual(await service.getMemberships(staff.id), policy)
  assert.equal((await direct(staff, async () => await db.$queryRaw`SELECT app.business_office_allowed(${tenant},${d.id},${admin.id}) allowed`))[0].allowed, false)
  assert.deepEqual(await direct(staff, async () => await db.$queryRaw`SELECT * FROM app.business_office_choices(${tenant},${admin.id})`), [])
  await assert.rejects(direct(staff, async () => await db.$queryRaw`SELECT app.select_creation_office(${foreign},${foreignOffice.id},0)`))
  const [role] = await db.$queryRaw`SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`
  assert.equal(role.rolsuper, false); assert.equal(role.rolbypassrls, false)
})
test('membership audit is mandatory; SQL preference changes are audited without exposing peers audit rows', async () => {
  const before = await service.getMemberships(staff.id)
  const faulty = new Proxy(db, { get(target, key) { if (key === '$transaction') return fn => target.$transaction(tx => fn(new Proxy(tx, { get(t, k) { if (k === 'auditLog') return { createMany: () => { throw Error('Required audit unavailable') } }; return t[k] } }))); return target[key] } })
  await assert.rejects(createOfficeAccessService(faulty, identity(admin)).saveMemberships(staff.id, { version: before.version, officeIds: [d.id], companies: [], creationOfficeId: d.id }), /Required audit unavailable/)
  assert.deepEqual(await service.getMemberships(staff.id), before)
  const selected = await own.selectCreationOffice({ version: before.version, officeId: b.id })
  const events = await root.auditLog.findMany({ where: { tenantId: tenant, event: 'workspace.creationOffice.updated', actorUserId: staff.id, after: { path: ['version'], equals: selected.version } } })
  assert.equal(events.length, 1); assert.equal(events[0].after.creationOfficeId, b.id)
  assert.ok(await direct(staff, async () => await db.auditLog.count({ where: { tenantId: tenant, event: 'workspace.creationOffice.updated' } })) > 0)
  assert.equal(await direct(peer, async () => await db.auditLog.count({ where: { tenantId: tenant, event: 'workspace.creationOffice.updated' } })), 0)
})
test('preference and its SQL audit event roll back together when audit storage fails', async () => {
  const before = await own.getOwnContext()
  await root.$executeRawUnsafe(`CREATE FUNCTION app.test_office_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='workspace.creationOffice.updated' THEN RAISE EXCEPTION 'Required workspace audit unavailable'; END IF; RETURN NEW; END $$`)
  await root.$executeRawUnsafe('CREATE TRIGGER test_office_audit_failure BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION app.test_office_audit_failure()')
  try {
    await assert.rejects(own.selectCreationOffice({ version: before.version, officeId: a.id }), /Required workspace audit unavailable/)
    assert.deepEqual(await own.getOwnContext(), before)
  } finally {
    await root.$executeRawUnsafe('DROP TRIGGER test_office_audit_failure ON "AuditLog"')
    await root.$executeRawUnsafe('DROP FUNCTION app.test_office_audit_failure()')
  }
})
test('maintenance tenant cleanup preserves other tenants while removing policies and grants atomically', async () => {
  const id = 'office_cleanup_' + randomUUID()
  await root.tenant.create({ data: { id, name: 'Disposable office tenant', slug: id } })
  const user = await root.user.create({ data: { tenantId: id, role: 'ADMIN', email: randomUUID() + '@example.test' } })
  const cleanupDb = client(id)
  const cleanupCompanies = createCompanyService(cleanupDb, identity(user))
  const office = (await cleanupCompanies.listOffices({})).items[0]
  await createOfficeAccessService(cleanupDb, identity(user)).saveMemberships(user.id, { version: 0, creationOfficeId: office.id, officeIds: [office.id], companies: [{ companyId: office.companyId, includeSubsidiaries: true }] })
  await root.$transaction(async tx => {
    await tx.realEstateProjectStatus.deleteMany({ where: { tenantId: id } })
    await tx.realEstatePropertyCategory.deleteMany({ where: { tenantId: id } })
    await tx.realEstateBuyingTimeframe.deleteMany({ where: { tenantId: id } })
    await tx.tenant.delete({ where: { id } })
  })
  for (const model of ['businessOfficePolicy', 'businessOfficeGrant', 'businessCompanyGrant', 'businessCompany', 'businessOffice']) assert.equal(await root[model].count({ where: { tenantId: id } }), 0)
  assert.equal(await root.tenant.count({ where: { id: tenant } }), 1)
})
test('deferred office references still reject cross-tenant rows at commit and leave no partial grants', async () => {
  const before = await save(peer, [], [], null)
  await assert.rejects(root.businessOfficeGrant.create({ data: { tenantId: tenant, userId: peer.id, officeId: foreignOffice.id } }))
  await assert.rejects(root.businessCompanyGrant.create({ data: { tenantId: tenant, userId: peer.id, companyId: foreignOffice.companyId } }))
  await assert.rejects(root.businessOfficePolicy.update({ where: { tenantId_userId: { tenantId: tenant, userId: peer.id } }, data: { creationOfficeId: foreignOffice.id } }))
  assert.deepEqual(await service.getMemberships(peer.id), before)
  assert.ok((await list(admin)).includes(a.id))
})
