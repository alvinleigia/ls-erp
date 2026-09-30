/* eslint-disable @typescript-eslint/no-require-imports */
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { Pool } = require('pg')
const { PrismaClient } = require('@prisma/client')
const { TenantPgAdapter } = require('../lib/tenant-pg-adapter.ts')
const { getTenantModules, updateTenantModuleAllowance, updateBusinessModule, provisionTenantModules } = require('../platform/module-service.ts')
const { createCrmService } = require('../modules/crm/service.ts')
const { createRealEstateService } = require('../modules/real-estate/service.ts')
const { tenantModuleSelection, moduleToggleSchema } = require('../platform/module-validation.ts')
require('../lib/logger.ts').logger.info = () => {}
const url = new URL(process.env.CRM_TEST_DATABASE_URL || 'http://invalid')
if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/ls_salon_crm_test') throw Error('Use only the isolated local CRM test database.')
const tenant = `access_${randomUUID()}`, otherTenant = `access_${randomUUID()}`, platform = `access_${randomUUID()}`
const pools = [], clients = []
function client(tenantId, bypass = false) {
  const u = new URL(url); if (!bypass) { u.username = 'crm_test_runtime'; u.password = '' }
  const pool = new Pool({ connectionString: u.toString(), max: 4 }); pools.push(pool)
  const db = new PrismaClient({ adapter: new TenantPgAdapter(pool, { tenantId, bypass }) }); clients.push(db); return db
}
const root = client(undefined, true), db = client(tenant), dbB = client(otherTenant)
let operator, admin, manager, staff, crm, projectService
const status = code => error => error.status === code
const identity = user => ({ tenantId: user.tenantId, userId: user.id })
const allow = (key, allowed = true) => updateTenantModuleAllowance(root, identity(operator), tenant, { key, allowed })
before(async () => {
  process.env.PLATFORM_ADMIN_TENANT_SLUG = platform
  await root.tenant.createMany({ data: [tenant, otherTenant, platform].map(id => ({ id, slug: id, name: id })) })
  const user = (tenantId, role) => root.user.create({ data: { tenantId, role, name: role, email: `${randomUUID()}@example.test` } })
  operator = await user(platform, 'ADMIN'); admin = await user(tenant, 'ADMIN'); manager = await user(tenant, 'MANAGER'); staff = await user(tenant, 'STAFF')
  crm = createCrmService(db, identity(admin)); projectService = createRealEstateService(db, identity(admin))
})
after(async () => {
  for (const db of clients) await db.$disconnect()
  for (const pool of pools) await pool.end()
})

test('missing allowances deny access and provisioning validates dependencies', async () => {
  await assert.rejects(crm.listContacts({}), status(403))
  await assert.rejects(updateBusinessModule(db, identity(admin), { key: 'crm', enabled: true }), status(403))
  await assert.rejects(allow('realEstate'), status(409))
  assert.throws(() => tenantModuleSelection.parse(['paymentPlans']))
  assert.throws(() => tenantModuleSelection.parse(['crm', 'crm']))
  assert.throws(() => moduleToggleSchema.parse({ key: 'crm', enabled: true, allowed: true }))
  await root.$transaction(tx => provisionTenantModules(tx, identity(operator), otherTenant, ['crm', 'salesDocuments']))
  const flags = await root.tenantModule.findMany({ where: { tenantId: otherTenant } })
  assert.deepEqual(flags.filter(row => row.allowed).map(row => row.key).sort(), ['crm', 'salesDocuments'])
  assert.ok(flags.filter(row => row.allowed).every(row => row.enabled))
  await assert.rejects(root.$transaction(tx => provisionTenantModules(tx, identity(admin), tenant, ['crm'])), status(403))
})

test('platform grants and tenant toggles are separate, current-user checked and audited', async () => {
  await assert.rejects(updateTenantModuleAllowance(root, identity(admin), tenant, { key: 'crm', allowed: true }), status(403))
  await assert.rejects(getTenantModules(root, identity(manager), tenant), status(403))
  await assert.rejects(getTenantModules(root, identity(operator), platform), status(404))
  await allow('crm')
  const row = (await getTenantModules(root, identity(operator), tenant)).modules.find(row => row.key === 'crm')
  assert.equal(row.allowed, true); assert.equal(row.enabled, true)
  const contact = await crm.createContact({ name: 'Preserve this contact' })
  await assert.rejects(updateBusinessModule(db, identity(manager), { key: 'crm', enabled: false }), status(403))
  await assert.rejects(updateBusinessModule(db, identity(staff), { key: 'crm', enabled: false }), status(403))
  await updateBusinessModule(db, identity(admin), { key: 'crm', enabled: false })
  await allow('crm') // repeated platform grant must not override the tenant choice
  await assert.rejects(crm.getContact(contact.id), status(403))
  await updateBusinessModule(db, identity(admin), { key: 'crm', enabled: true })
  await allow('crm', false)
  await assert.rejects(updateBusinessModule(db, identity(admin), { key: 'crm', enabled: true }), status(403))
  await assert.rejects(crm.getContact(contact.id), status(403))
  await allow('crm')
  assert.equal((await crm.getContact(contact.id)).name, 'Preserve this contact')
  const audit = await root.auditLog.findFirst({ where: { tenantId: tenant, event: 'module.allowance.updated', after: { path: ['allowed'], equals: false } } })
  assert.equal(audit.actorUserId, operator.id); assert.equal(audit.before.allowed, true); assert.equal(audit.after.enabled, false)
  await root.user.update({ where: { id: operator.id }, data: { role: 'STAFF' } })
  await assert.rejects(allow('realEstate'), status(403))
  await root.user.update({ where: { id: operator.id }, data: { role: 'ADMIN', status: 'SUSPENDED' } })
  await assert.rejects(getTenantModules(root, identity(operator), tenant), status(403))
  await root.user.update({ where: { id: operator.id }, data: { status: 'ACTIVE' } })
})

test('dependency allowance does not override tenant activation and revocation blocks project APIs', async () => {
  await updateBusinessModule(db, identity(admin), { key: 'crm', enabled: false })
  await allow('realEstate')
  const flags = (await getTenantModules(root, identity(operator), tenant)).modules
  assert.equal(flags.find(row => row.key === 'realEstate').allowed, true)
  assert.equal(flags.find(row => row.key === 'realEstate').enabled, false)
  await assert.rejects(updateBusinessModule(db, identity(admin), { key: 'realEstate', enabled: true }), status(409))
  await updateBusinessModule(db, identity(admin), { key: 'crm', enabled: true })
  await updateBusinessModule(db, identity(admin), { key: 'realEstate', enabled: true })
  assert.equal((await projectService.listProjects({})).total, 0)
  await allow('realEstate', false)
  await assert.rejects(projectService.listProjects({}), status(403))
  await allow('salesDocuments'); await allow('paymentPlans')
  await assert.rejects(allow('salesDocuments', false), status(409))
  await updateBusinessModule(db, identity(admin), { key: 'paymentPlans', enabled: false })
  await assert.rejects(allow('salesDocuments', false), status(409)) // disabled still allowed
  await allow('paymentPlans', false); await allow('salesDocuments', false)
})

test('tenant isolation, database constraint, audit rollback and concurrent changes', async () => {
  await assert.rejects(updateBusinessModule(dbB, identity(admin), { key: 'crm', enabled: false }), status(403))
  assert.equal(await dbB.tenantModule.count({ where: { tenantId: tenant } }), 0)
  await assert.rejects(root.tenantModule.update({ where: { tenantId_key: { tenantId: tenant, key: 'salesDocuments' } }, data: { enabled: true } }))
  const broken = { $transaction: (fn, options) => root.$transaction(tx => fn(new Proxy(tx, { get(target, key) { if (key === 'auditLog') return { create: async () => { throw Error('audit unavailable') } }; return target[key] } })), options) }
  await assert.rejects(updateTenantModuleAllowance(broken, identity(operator), tenant, { key: 'crm', allowed: false }), /audit unavailable/)
  assert.equal((await getTenantModules(root, identity(operator), tenant)).modules.find(row => row.key === 'crm').enabled, true)
  await allow('realEstate')
  await updateBusinessModule(db, identity(admin), { key: 'realEstate', enabled: false })
  const results = await Promise.allSettled([allow('realEstate', false), updateBusinessModule(db, identity(admin), { key: 'realEstate', enabled: true })])
  assert.ok(results.some(result => result.status === 'fulfilled'))
  const row = await root.tenantModule.findUnique({ where: { tenantId_key: { tenantId: tenant, key: 'realEstate' } } })
  assert.equal(row.allowed, false); assert.equal(row.enabled, false)
  await Promise.allSettled([allow('crm', false), allow('realEstate')])
  const flags = await root.tenantModule.findMany({ where: { tenantId: tenant } })
  assert.ok(!flags.find(row => row.key === 'realEstate').allowed || flags.find(row => row.key === 'crm').allowed)
})
