/* eslint-disable @typescript-eslint/no-require-imports */
const { test, before, after } = require("node:test")
const assert = require("node:assert/strict")
const { randomUUID } = require("node:crypto")
const { Pool } = require("pg")
const { PrismaClient } = require("@prisma/client")
const { PrismaPg } = require("@prisma/adapter-pg")
const { createCrmService } = require("../modules/crm/service.ts")
require("../lib/logger.ts").logger.info = () => {}

const rawUrl = process.env.CRM_TEST_DATABASE_URL
if (!rawUrl) throw new Error("CRM_TEST_DATABASE_URL is required; use the dedicated local CRM test database.")
const url = new URL(rawUrl)
if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/ls_salon_crm_test") throw new Error("Refusing to test against a non-local or non-test database.")
const suffix = randomUUID().replaceAll("-", "")
const a = `crm_a_${suffix}`
const b = `crm_b_${suffix}`
const clients = []
function client(tenantId, admin = false) {
  const connection = new URL(rawUrl)
  if (!admin) { connection.username = "crm_test_runtime"; connection.password = "" }
  const pool = new Pool({ connectionString: connection.toString(), max: 4,
    ...(!admin ? { options: `-c app.tenant_id=${tenantId || ""} -c app.rls_bypass=off` } : {}),
  })
  const db = new PrismaClient({ adapter: new PrismaPg(pool, { disposeExternalPool: true }) })
  clients.push(db)
  return db
}
const root = client(null, true)
const dbA = client(a)
const dbB = client(b)
const unscoped = client(null)
let adminA, staffA, otherA, customerA, adminB
let manager, staff, other, second
const enquiryInput = (contactId, assignedUserId) => ({ contactId, assignedUserId, title: "Two bedroom home", source: "Referral", requirements: "Near a school" })
const expectStatus = status => error => error.status === status

before(async () => {
  await root.tenant.createMany({ data: [{ id: a, slug: a, name: "CRM test A" }, { id: b, slug: b, name: "CRM test B" }] })
  async function user(tenantId, role, name) {
    return root.user.create({ data: { tenantId, role, name, email: `${name}-${suffix}@example.test` } })
  }
  adminA = await user(a, "ADMIN", "admin-a")
  staffA = await user(a, "STAFF", "staff-a")
  otherA = await user(a, "STAFF", "other-a")
  customerA = await user(a, "CUSTOMER", "customer-a")
  adminB = await user(b, "ADMIN", "admin-b")
  await root.tenantModule.createMany({ data: [{ tenantId: a, key: "crm", enabled: true }, { tenantId: b, key: "crm", enabled: true }] })
  await root.appSetting.create({ data: { tenantId: a, timeZone: "Asia/Kolkata" } })
  manager = createCrmService(dbA, { tenantId: a, userId: adminA.id })
  staff = createCrmService(dbA, { tenantId: a, userId: staffA.id })
  other = createCrmService(dbA, { tenantId: a, userId: otherA.id })
  second = createCrmService(dbB, { tenantId: b, userId: adminB.id })
})
after(async () => { await Promise.all(clients.map(db => db.$disconnect())) })

test("complete contact, enquiry, note, follow-up and outcome workflow persists audit", async () => {
  const contact = await manager.createContact({ name: "Workflow buyer" })
  const enquiry = await manager.createEnquiry(enquiryInput(contact.id, staffA.id))
  await staff.addNote(enquiry.id, { message: "Asked to call next week." })
  const task = await staff.createTask(enquiry.id, { title: "Call buyer", dueOn: "2026-09-25" })
  await staff.completeTask(task.id)
  const updated = await staff.updateEnquiry(enquiry.id, { title: "Two bedroom home", source: "Referral", requirements: "Near a school", assignedUserId: staffA.id, status: "CLOSED", outcome: "Converted to a site visit", version: 1 })
  assert.equal(updated.status, "CLOSED")
  assert.equal(updated.version, 2)
  const history = await staff.listActivity(enquiry.id, {})
  assert.equal(history.total, 5)
  assert.equal((await staff.listTasks({ due: "completed" }, enquiry.id)).total, 1)
  assert.equal(await root.auditLog.count({ where: { tenantId: a, entityId: enquiry.id } }), 5)
})

test("RLS blocks unscoped and cross-tenant reads even without query filters", async () => {
  const contact = await second.createContact({ name: "Only B" })
  assert.equal(await dbA.crmContact.findUnique({ where: { id: contact.id } }), null)
  assert.equal(await unscoped.crmContact.count(), 0)
  assert.ok((await dbA.crmContact.findMany()).every(row => row.tenantId === a))
  await assert.rejects(manager.getContact(contact.id), expectStatus(404))
  await assert.rejects(manager.createEnquiry(enquiryInput(contact.id, adminA.id)), expectStatus(404))
})

test("database rejects cross-tenant writes and relationships", async () => {
  const contact = await second.createContact({ name: "Foreign contact" })
  await assert.rejects(dbA.crmContact.create({ data: { tenantId: b, name: "Blocked", ownerUserId: adminB.id } }))
  await assert.rejects(root.crmEnquiry.create({ data: { tenantId: a, contactId: contact.id, title: "Invalid link", assignedUserId: adminA.id } }))
  await assert.rejects(root.crmContact.create({ data: { tenantId: a, name: "Foreign owner", ownerUserId: adminB.id } }))
  await assert.rejects(manager.createEnquiry(enquiryInput((await manager.createContact({ name: "Local" })).id, adminB.id)), expectStatus(400))
})

test("staff can only see owned contacts and assigned enquiries, including search and tasks", async () => {
  const contact = await manager.createContact({ name: "Restricted buyer" })
  await assert.rejects(staff.getContact(contact.id), expectStatus(404))
  const enquiry = await manager.createEnquiry(enquiryInput(contact.id, staffA.id))
  assert.equal((await staff.getContact(contact.id)).canEdit, false)
  assert.equal((await staff.getEnquiry(enquiry.id)).id, enquiry.id)
  await assert.rejects(other.getEnquiry(enquiry.id), expectStatus(404))
  assert.equal((await other.listEnquiries({ q: "Two bedroom" })).total, 0)
  assert.equal((await other.listContacts({ q: "Restricted buyer" })).total, 0)
  await assert.rejects(other.listActivity(enquiry.id, {}), expectStatus(404))
  const task = await staff.createTask(enquiry.id, { title: "Private follow-up", dueOn: "2026-09-24" })
  await assert.rejects(other.completeTask(task.id), expectStatus(404))
  assert.equal((await other.listTasks({ q: "Private" })).total, 0)
  await assert.rejects(staff.updateContact(contact.id, { name: "Unauthorized", archived: false, version: 1 }), expectStatus(404))
  await assert.rejects(staff.updateEnquiry(enquiry.id, { title: "Reassign", assignedUserId: otherA.id, status: "NEW", version: 1 }), expectStatus(403))
})

test("duplicate identifiers are tenant-scoped and simultaneous creates make one contact", async () => {
  const email = `duplicate-${suffix}@example.test`
  const results = await Promise.allSettled([manager.createContact({ name: "First", email }), manager.createContact({ name: "Second", email: email.toUpperCase() })])
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1)
  assert.equal(results.find(result => result.status === "rejected").reason.status, 409)
  assert.equal(await root.crmContact.count({ where: { tenantId: a, email } }), 1)
  assert.ok((await second.createContact({ name: "Separate business", email })).id)
  await manager.createContact({ name: "Phone", phone: "+91 98765 43210" })
  await assert.rejects(manager.createContact({ name: "Same phone", phone: "+919876543210" }), expectStatus(409))
})

test("archiving preserves contacts and history while preventing new enquiries", async () => {
  const contact = await manager.createContact({ name: "Archive buyer" })
  const enquiry = await manager.createEnquiry(enquiryInput(contact.id, adminA.id))
  await manager.updateContact(contact.id, { name: contact.name, archived: true, version: 1 })
  assert.equal((await manager.listContacts({ q: "Archive buyer" })).total, 0)
  assert.equal((await manager.listContacts({ q: "Archive buyer", archived: "true" })).total, 1)
  assert.equal((await manager.getEnquiry(enquiry.id)).contact.archived, true)
  await assert.rejects(manager.createEnquiry(enquiryInput(contact.id, adminA.id)), expectStatus(404))
})

test("stale updates fail and concurrent task completion records one event", async () => {
  const contact = await manager.createContact({ name: "Concurrency buyer" })
  const enquiry = await manager.createEnquiry(enquiryInput(contact.id, staffA.id))
  const input = { title: "New title", assignedUserId: staffA.id, status: "CONTACTED", version: 1 }
  await manager.updateEnquiry(enquiry.id, input)
  await assert.rejects(manager.updateEnquiry(enquiry.id, input), expectStatus(409))
  const task = await staff.createTask(enquiry.id, { title: "Complete once", dueOn: "2026-09-24" })
  await Promise.all([staff.completeTask(task.id), staff.completeTask(task.id)])
  assert.equal(await root.crmActivity.count({ where: { tenantId: a, enquiryId: enquiry.id, event: "task.completed" } }), 1)
})

test("failed required audit rolls back the business change", async () => {
  await root.$executeRawUnsafe('ALTER TABLE "AuditLog" ADD CONSTRAINT "crm_test_reject_audit" CHECK (event <> \'crm.contact.created\') NOT VALID')
  try {
    await assert.rejects(manager.createContact({ name: `Rollback ${suffix}` }))
    assert.equal(await root.crmContact.count({ where: { tenantId: a, name: `Rollback ${suffix}` } }), 0)
  } finally { await root.$executeRawUnsafe('ALTER TABLE "AuditLog" DROP CONSTRAINT "crm_test_reject_audit"') }
})

test("disabled CRM, suspended users and customer accounts cannot use the service", async () => {
  await root.tenantModule.update({ where: { tenantId_key: { tenantId: a, key: "crm" } }, data: { enabled: false } })
  await assert.rejects(manager.listContacts({}), expectStatus(403))
  await root.tenantModule.update({ where: { tenantId_key: { tenantId: a, key: "crm" } }, data: { enabled: true } })
  await root.user.update({ where: { id: staffA.id }, data: { status: "SUSPENDED" } })
  await assert.rejects(staff.listContacts({}), expectStatus(403))
  await root.user.update({ where: { id: staffA.id }, data: { status: "ACTIVE" } })
  await assert.rejects(createCrmService(dbA, { tenantId: a, userId: customerA.id }).listContacts({}), expectStatus(403))
})

test("existing salon appointment and customer relationships survive the additive migration", async () => {
  const category = await dbA.serviceCategory.create({ data: { tenantId: a, name: "Hair" } })
  const service = await dbA.service.create({ data: { tenantId: a, categoryId: category.id, name: "Haircut", durationMinutes: 30, priceCents: 2500 } })
  const profile = await dbA.staffProfile.create({ data: { userId: staffA.id } })
  const appointment = await dbA.appointment.create({ data: { tenantId: a, staffProfileId: profile.id, customerId: customerA.id, serviceId: service.id, startAt: new Date("2026-10-01T10:00:00Z"), endAt: new Date("2026-10-01T10:30:00Z") } })
  const order = await dbA.appointmentOrder.create({ data: { tenantId: a, customerId: customerA.id, appointmentDate: new Date("2026-10-01"), appointmentStartAt: appointment.startAt, totalCents: 2500 } })
  assert.equal((await dbA.appointment.findUnique({ where: { id: appointment.id }, include: { customer: true } })).customer.id, customerA.id)
  assert.equal(order.totalCents, 2500)
  assert.equal(await dbB.appointment.count({ where: { id: appointment.id } }), 0)
})

test("accounts support multiple contacts and contacts support multiple accounts with idempotent linking", async () => {
  const company = await manager.createAccount({ name: "Example Developments", website: "https://example.test", email: "SALES@EXAMPLE.TEST" })
  const secondCompany = await manager.createAccount({ name: "Another Business" })
  const first = await manager.createContact({ name: "First director" })
  const secondContact = await manager.createContact({ name: "Second director" })
  await Promise.all([manager.linkContactAccount(first.id, { accountId: company.id }), manager.linkContactAccount(first.id, { accountId: company.id })])
  await manager.linkContactAccount(secondContact.id, { accountId: company.id })
  await manager.linkContactAccount(first.id, { accountId: secondCompany.id })
  assert.equal((await manager.listAccountContacts(company.id, {})).total, 2)
  assert.equal((await manager.listContactAccounts(first.id, {})).total, 2)
  const onePage = await manager.listAccountContacts(company.id, { pageSize: 1 })
  assert.equal(onePage.items.length, 1)
  assert.equal(onePage.totalPages, 2)
  assert.equal(await root.auditLog.count({ where: { tenantId: a, entityId: first.id, event: "crm.contact.account.linked" } }), 2)
  assert.equal(company.email, "sales@example.test")
  // Equal display names are not proof of identical legal/business entities.
  assert.ok((await manager.createAccount({ name: company.name })).id !== company.id)
})

test("account visibility never grants access to otherwise hidden contacts", async () => {
  const company = await manager.createAccount({ name: "Restricted Company" })
  const visible = await staff.createContact({ name: "Staff owned" })
  const hidden = await manager.createContact({ name: "Manager private" })
  await assert.rejects(staff.linkContactAccount(visible.id, { accountId: company.id }), expectStatus(404))
  await manager.linkContactAccount(visible.id, { accountId: company.id })
  await manager.linkContactAccount(hidden.id, { accountId: company.id })
  assert.equal((await staff.getAccount(company.id)).canEdit, false)
  const contacts = await staff.listAccountContacts(company.id, {})
  assert.equal(contacts.total, 1)
  assert.equal(contacts.items[0].id, visible.id)
  assert.equal((await staff.listAccountContacts(company.id, { q: hidden.name })).total, 0)
  assert.equal((await other.listAccounts({ q: company.name })).total, 0)
  await assert.rejects(other.listAccountContacts(company.id, {}), expectStatus(404))
  await assert.rejects(staff.getContact(hidden.id), expectStatus(404))
  await assert.rejects(staff.updateAccount(company.id, { name: "Not allowed", archived: false, version: 1 }), expectStatus(404))
  await assert.rejects(staff.unlinkContactAccount(hidden.id, company.id), expectStatus(404))
  await staff.unlinkContactAccount(visible.id, company.id)
  await staff.unlinkContactAccount(visible.id, company.id)
  await assert.rejects(staff.getAccount(company.id), expectStatus(404))
  assert.equal(await root.auditLog.count({ where: { tenantId: a, entityId: visible.id, event: "crm.contact.account.unlinked" } }), 1)
  assert.equal((await manager.listAccountContacts(company.id, {})).total, 1)
})

test("account ownership does not expose a linked contact to its owner", async () => {
  const company = await staff.createAccount({ name: "Salesperson Company" })
  const privateContact = await manager.createContact({ name: "Unrelated contact" })
  await manager.linkContactAccount(privateContact.id, { accountId: company.id })
  assert.equal((await staff.listAccountContacts(company.id, {})).total, 0)
  assert.equal((await staff.getAccount(company.id)).canEdit, true)
  await assert.rejects(staff.listContactAccounts(privateContact.id, {}), expectStatus(404))
})

test("account and relationship RLS and foreign keys prevent cross-tenant access", async () => {
  const company = await second.createAccount({ name: "Foreign Company" })
  const foreignContact = await second.createContact({ name: "Foreign director" })
  await second.linkContactAccount(foreignContact.id, { accountId: company.id })
  const contact = await manager.createContact({ name: "Local director" })
  assert.equal(await dbA.crmAccount.findUnique({ where: { id: company.id } }), null)
  assert.equal(await dbA.crmAccountContact.count({ where: { accountId: company.id } }), 0)
  assert.equal(await unscoped.crmAccount.count(), 0)
  assert.equal(await unscoped.crmAccountContact.count(), 0)
  await assert.rejects(manager.linkContactAccount(contact.id, { accountId: company.id }), expectStatus(404))
  await assert.rejects(root.crmAccountContact.create({ data: { tenantId: a, contactId: contact.id, accountId: company.id } }))
  await assert.rejects(dbA.crmAccount.create({ data: { tenantId: b, name: "Wrong tenant", ownerUserId: adminB.id } }))
  await manager.unlinkContactAccount(contact.id, company.id)
  assert.equal(await dbB.crmAccountContact.count({ where: { accountId: company.id } }), 1)
})

test("archived accounts keep relationships, reject new links and protect against stale edits", async () => {
  const company = await manager.createAccount({ name: "Archive Company" })
  const first = await manager.createContact({ name: "Existing association" })
  const next = await manager.createContact({ name: "New association" })
  await manager.linkContactAccount(first.id, { accountId: company.id })
  await manager.updateAccount(company.id, { name: company.name, archived: true, version: 1 })
  await assert.rejects(manager.updateAccount(company.id, { name: "Stale", archived: false, version: 1 }), expectStatus(409))
  assert.equal((await manager.listAccounts({ q: company.name })).total, 0)
  assert.equal((await manager.listAccounts({ q: company.name, archived: "true" })).total, 1)
  assert.equal((await manager.listContactAccounts(first.id, {})).items[0].archived, true)
  await assert.rejects(manager.linkContactAccount(next.id, { accountId: company.id }), expectStatus(409))
  await manager.updateAccount(company.id, { name: company.name, archived: false, version: 2 })
  await manager.linkContactAccount(next.id, { accountId: company.id })
  assert.equal((await manager.listAccountContacts(company.id, {})).total, 2)
})

test("a failed relationship audit rolls back the association", async () => {
  const company = await manager.createAccount({ name: "Audit Company" })
  const contact = await manager.createContact({ name: "Audit association" })
  await root.$executeRawUnsafe('ALTER TABLE "AuditLog" ADD CONSTRAINT "crm_test_reject_link_audit" CHECK (event <> \'crm.contact.account.linked\') NOT VALID')
  try {
    await assert.rejects(manager.linkContactAccount(contact.id, { accountId: company.id }))
    assert.equal(await root.crmAccountContact.count({ where: { tenantId: a, accountId: company.id, contactId: contact.id } }), 0)
    assert.equal(await root.auditLog.count({ where: { tenantId: a, entityId: company.id, event: "crm.account.contact.linked" } }), 0)
  } finally { await root.$executeRawUnsafe('ALTER TABLE "AuditLog" DROP CONSTRAINT "crm_test_reject_link_audit"') }
})
