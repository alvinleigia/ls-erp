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
const pipelineInput = name => ({ name, stages: [
  { name: "Discovery", kind: "OPEN", probability: 20, color: "#123456", archived: false },
  { name: "Proposal", kind: "OPEN", probability: 60, color: "#345678", archived: false },
  { name: "Won", kind: "WON", probability: 100, color: "#16a34a", archived: false },
  { name: "Lost", kind: "LOST", probability: 0, color: "#dc2626", archived: false },
] })
const pipelineUpdate = pipeline => ({ name: pipeline.name, archived: pipeline.archived, version: pipeline.version,
  stages: pipeline.stages.map(({ id, name, kind, probability, color, archived }) => ({ id, name, kind, probability, color, archived })),
})
const dealInput = (pipeline, contact, owner) => ({ title: "Test opportunity", pipelineId: pipeline.id, stageId: pipeline.stages[0].id, contactId: contact.id, assignedUserId: owner.id, amount: "12345.6789", currency: "INR", expectedCloseOn: "2026-12-01" })
const dealUpdate = deal => ({ title: deal.title, pipelineId: deal.pipelineId, stageId: deal.stageId, contactId: deal.contactId, accountId: deal.accountId || "", assignedUserId: deal.assignedUserId, amount: String(deal.amount), currency: deal.currency, expectedCloseOn: deal.expectedCloseOn.toISOString().slice(0, 10), probability: deal.probability, lossReason: deal.lossReason || "", description: deal.description || "", version: deal.version })
const workInput = (contactId, assignedUserId, extra = {}) => ({ title: "Customer callback", type: "CALL", callDirection: "OUTBOUND", contactId, assignedUserId, dueOn: "2026-10-01", ...extra })
const workUpdate = record => ({ title: record.title, type: record.type, callDirection: record.callDirection, assignedUserId: record.assignedUserId, priority: record.priority, description: record.description || "", dueOn: record.dueOn.toISOString().slice(0, 10), startsAt: record.startsAt?.toISOString() || null, endsAt: record.endsAt?.toISOString() || null, reminderAt: record.reminderAt?.toISOString() || null, status: record.status, version: record.version })
const completionInput = (record, extra = {}) => ({ version: record.version, outcome: "CONNECTED", summary: "Discussed requirements; customer asked for a callback.", occurredAt: new Date(Date.now() - 60000).toISOString(), durationMinutes: 5, ...extra })

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

test("activity reports enforce personal scope, team permissions and tenant isolation", async () => {
  const contact = await manager.createContact({ name: "Reporting scope contact" })
  const pipeline = await manager.createPipeline(pipelineInput("Reporting scope"))
  const deal = await manager.createOpportunity(dealInput(pipeline, contact, staffA))
  await manager.createWork(workInput(contact.id, otherA.id, { opportunityId: deal.id }))
  // Owning a deal makes delegated tasks readable, but does not grant team reporting.
  assert.equal((await staff.activityOverview({})).totals.open, 0)
  assert.equal((await manager.activityOverview({ scope: "team" })).totals.open, 1)
  for (const method of ["activityOverview", "staffActivityReport", "opportunitiesWithoutActivity"]) {
    await assert.rejects(staff[method]({ scope: "team" }), expectStatus(403))
    await assert.rejects(staff[method]({ assignedUserId: otherA.id }), expectStatus(403))
  }
  assert.equal((await second.activityOverview({ scope: "team", assignedUserId: otherA.id })).totals.open, 0)
  assert.equal((await second.staffActivityReport({ scope: "team", assignedUserId: otherA.id })).total, 0)
  await assert.rejects(manager.activityOverview({ scope: "mine", assignedUserId: staffA.id }), expectStatus(400))
})

test("activity report completions and drill-through use inclusive business dates, not occurrence dates", async () => {
  const contact = await manager.createContact({ name: "Reporting boundary contact" })
  const dates = ["2026-01-09T18:29:59.999Z", "2026-01-09T18:30:00.000Z", "2026-01-10T18:29:59.999Z", "2026-01-10T18:30:00.000Z"]
  for (const date of dates) {
    const work = await manager.createWork(workInput(contact.id, staffA.id))
    await staff.completeWork(work.id, completionInput(work, { occurredAt: "2020-01-01T09:00:00Z", outcome: "NO_ANSWER" }))
    await root.crmTask.update({ where: { id: work.id }, data: { completedAt: new Date(date) } })
  }
  const report = await staff.activityOverview({ from: "2026-01-10", through: "2026-01-10" })
  assert.equal(report.totals.completed, 2)
  assert.deepEqual(report.callOutcomes, [{ outcome: "NO_ANSWER", count: 2 }])
  assert.equal(report.byType.find(row => row.type === "CALL").completed, 2)
  const detail = await staff.listWork({ state: "completed", completedFrom: report.from, completedThrough: report.through })
  assert.equal(detail.total, report.totals.completed)
  assert.equal((await staff.activityOverview({ from: report.from, through: report.through, type: "TASK" })).totals.completed, 0)
  const workload = await manager.staffActivityReport({ scope: "team", assignedUserId: staffA.id, from: report.from, through: report.through })
  assert.equal(workload.items[0].completed, 2)
})

test("workload reports count current overdue work regardless of completion period and retain inactive assignees", async () => {
  const { businessDate } = require("../modules/crm/work-time.ts")
  const contact = await manager.createContact({ name: "Reporting backlog contact" })
  const today = businessDate(new Date(), "Asia/Kolkata")
  const before = await staff.activityOverview({ from: "2020-01-01", through: "2020-01-01" })
  await manager.createWork(workInput(contact.id, staffA.id, { dueOn: "2020-01-01" }))
  const task = await manager.createWork(workInput(contact.id, staffA.id, { dueOn: today, type: "TASK", callDirection: null }))
  const cancelled = await manager.createWork(workInput(contact.id, staffA.id, { dueOn: "2020-01-01" }))
  await manager.cancelWork(cancelled.id, { version: 1, reason: "No longer needed" })
  const after = await staff.activityOverview({ from: "2020-01-01", through: "2020-01-01" })
  assert.equal(after.totals.open, before.totals.open + 2)
  assert.equal(after.totals.overdue, before.totals.overdue + 1)
  assert.equal(after.totals.dueToday, before.totals.dueToday + 1)
  assert.equal(after.totals.completed, 0)
  await root.user.update({ where: { id: staffA.id }, data: { status: "SUSPENDED" } })
  try {
    const people = await manager.staffActivityReport({ scope: "team", assignedUserId: staffA.id, type: "TASK" })
    assert.equal(people.items[0].status, "SUSPENDED"); assert.equal(people.items[0].open, 1)
    await assert.rejects(staff.activityOverview({}), expectStatus(403))
  } finally { await root.user.update({ where: { id: staffA.id }, data: { status: "ACTIVE" } }) }
  const page = await manager.staffActivityReport({ scope: "team", pageSize: 1 })
  const next = await manager.staffActivityReport({ scope: "team", pageSize: 1, page: 2 })
  assert.equal(page.total, 3); assert.equal(page.items.length, 1); assert.notEqual(page.items[0].id, next.items[0].id)
  assert.ok((await staff.listWork({ due: "today", type: "TASK" })).items.some(item => item.id === task.id))
})

test("follow-up gaps respect open activity coverage, owner scope, pagination and archive state", async () => {
  const contact = await manager.createContact({ name: "Reporting coverage contact" })
  const pipeline = await manager.createPipeline(pipelineInput("Reporting coverage"))
  const first = await manager.createOpportunity(dealInput(pipeline, contact, staffA))
  const secondDeal = await manager.createOpportunity(dealInput(pipeline, contact, staffA))
  const privateDeal = await manager.createOpportunity(dealInput(pipeline, contact, otherA))
  let gaps = await staff.opportunitiesWithoutActivity({ pageSize: 1 })
  assert.equal(gaps.total, 2); assert.equal(gaps.totalPages, 2)
  assert.notEqual(gaps.items[0].id, (await staff.opportunitiesWithoutActivity({ pageSize: 1, page: 2 })).items[0].id)
  const delegated = await manager.createWork(workInput(contact.id, otherA.id, { opportunityId: first.id, dueOn: "2020-01-01" }))
  gaps = await staff.opportunitiesWithoutActivity({ type: "TASK", from: "2020-01-01", through: "2020-01-01" })
  assert.equal(gaps.total, 1); assert.equal(gaps.items[0].id, secondDeal.id)
  assert.ok(!gaps.items.some(row => row.id === privateDeal.id))
  await manager.cancelWork(delegated.id, { version: 1, reason: "Customer rescheduled" })
  assert.equal((await staff.opportunitiesWithoutActivity({})).total, 2)
  await manager.moveOpportunity(secondDeal.id, { pipelineId: pipeline.id, stageId: pipeline.stages[2].id, version: secondDeal.version })
  assert.equal((await staff.opportunitiesWithoutActivity({})).total, 1)
  await manager.updatePipeline(pipeline.id, { ...pipelineUpdate(pipeline), archived: true })
  assert.equal((await staff.opportunitiesWithoutActivity({})).total, 0)
  assert.equal((await second.opportunitiesWithoutActivity({ scope: "team", assignedUserId: staffA.id })).total, 0)
})

test("activity upgrade preserves existing follow-up IDs, dates, completion and inherited ownership", { skip: process.env.CRM_TEST_EXPECT_UPGRADE_FIXTURE !== "1" }, async () => {
  const rows = await root.crmTask.findMany({ where: { tenantId: "crm_upgrade" }, orderBy: { id: "asc" } })
  assert.deepEqual(rows.map(row => row.id), ["crm_upgrade_done", "crm_upgrade_open"])
  assert.equal(rows[0].status, "COMPLETED"); assert.equal(rows[0].completedAt.toISOString(), "2026-09-21T10:00:00.000Z")
  assert.equal(rows[1].status, "OPEN"); assert.equal(rows[1].dueOn.toISOString().slice(0, 10), "2026-09-25")
  for (const row of rows) { assert.equal(row.contactId, "crm_upgrade_contact"); assert.equal(row.assignedUserId, "crm_upgrade_user"); assert.equal(row.followParentAssignment, true); assert.equal(row.createdByUserId, null) }
})

test("delegated activities grant contact context without exposing private opportunity fields", async () => {
  const contact = await manager.createContact({ name: "Delegated customer" })
  const pipeline = await manager.createPipeline(pipelineInput("Delegation sales"))
  const deal = await manager.createOpportunity(dealInput(pipeline, contact, adminA))
  const task = await manager.createWork(workInput(contact.id, staffA.id, { opportunityId: deal.id, description: "Ask about requirements" }))
  const visible = await staff.getWork(task.id)
  assert.equal(visible.canEdit, true); assert.equal(visible.parent, null); assert.equal(visible.opportunityId, null)
  assert.equal((await staff.getContact(contact.id)).canEdit, false)
  await assert.rejects(staff.getOpportunity(deal.id), expectStatus(404))
  await assert.rejects(other.getWork(task.id), expectStatus(404))
  await assert.rejects(staff.updateContact(contact.id, { name: "Forbidden", version: 1, archived: false }), expectStatus(404))
  await manager.updateWork(task.id, { ...workUpdate(task), assignedUserId: otherA.id })
  await assert.rejects(staff.getWork(task.id), expectStatus(404))
  await assert.rejects(staff.getContact(contact.id), expectStatus(404))
  assert.equal((await other.getWork(task.id)).canEdit, true)
})

test("legacy application writes remain valid during the activity rollout", async () => {
  const contact = await manager.createContact({ name: "Rolling upgrade customer" })
  const enquiry = await manager.createEnquiry({ ...enquiryInput(contact.id, staffA.id), title: "Rolling upgrade enquiry" })
  const id = `old_client_${suffix}`
  await dbA.$executeRawUnsafe('INSERT INTO "CrmTask" (id,"tenantId","enquiryId",title,"dueOn") VALUES ($1,$2,$3,$4,$5::date)', id, a, enquiry.id, "Old client task", "2026-10-01")
  const task = await root.crmTask.findUniqueOrThrow({ where: { id } })
  assert.equal(task.contactId, contact.id); assert.equal(task.assignedUserId, staffA.id); assert.equal(task.followParentAssignment, true)
  await dbA.$executeRawUnsafe('UPDATE "CrmEnquiry" SET "assignedUserId"=$1 WHERE id=$2 AND "tenantId"=$3', otherA.id, enquiry.id, a)
  assert.equal((await other.getWork(id)).assignedUserId, otherA.id)
  await dbA.$executeRawUnsafe('UPDATE "CrmTask" SET "completedAt"=NOW() WHERE id=$1 AND "tenantId"=$2', id, a)
  assert.equal((await other.getWork(id)).status, "COMPLETED")
})

test("contact interaction history shares summaries while keeping private instructions and deal notes scoped", async () => {
  const contact = await manager.createContact({ name: "Interaction handoff" })
  const pipeline = await manager.createPipeline(pipelineInput("Private history"))
  const deal = await manager.createOpportunity(dealInput(pipeline, contact, adminA))
  await manager.addOpportunityNote(deal.id, { message: "Private negotiation note" })
  const past = await manager.createWork(workInput(contact.id, adminA.id, { opportunityId: deal.id, description: "Private instructions", completion: { summary: "Customer prefers afternoon calls.", outcome: "NO_ANSWER", occurredAt: new Date().toISOString() } }))
  const task = await manager.createWork(workInput(contact.id, staffA.id))
  const feed = await staff.listContactInteractions(contact.id, {})
  assert.equal(feed.total, 1); assert.equal(feed.items[0].summary, "Customer prefers afternoon calls.")
  assert.equal(feed.items[0].description, undefined); assert.equal(feed.items[0].opportunityId, undefined)
  await assert.rejects(staff.getWork(past.id), expectStatus(404))
  await assert.rejects(staff.listOpportunityActivity(deal.id, {}), expectStatus(404))
  await staff.completeWork(task.id, completionInput(task))
  await assert.rejects(staff.listContactInteractions(contact.id, {}), expectStatus(404))
  assert.equal((await staff.getWork(task.id)).summary, completionInput(task).summary)
})

test("completion and scheduling the next callback are atomic and concurrent requests create one follow-up", async () => {
  const contact = await manager.createContact({ name: "Next callback buyer" })
  const task = await manager.createWork(workInput(contact.id, staffA.id))
  const followUp = { title: "Try again tomorrow", type: "CALL", callDirection: "OUTBOUND", assignedUserId: staffA.id, dueOn: "2026-10-02" }
  const results = await Promise.allSettled([staff.completeWork(task.id, completionInput(task, { outcome: "NO_ANSWER", followUp })), staff.completeWork(task.id, completionInput(task, { outcome: "NO_ANSWER", followUp }))])
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1)
  assert.equal(await root.crmTask.count({ where: { tenantId: a, followUpOfId: task.id } }), 1)
  assert.equal((await staff.listWork({ contactId: contact.id })).total, 1)
  assert.equal((await staff.listContactInteractions(contact.id, {})).items[0].outcome, "NO_ANSWER")
  await assert.rejects(staff.completeTask(task.id), expectStatus(404))
  await assert.rejects(staff.updateWork(task.id, workUpdate(task)), expectStatus(409))
})

test("in-app reminders support snooze, dismiss, reschedule reset and assignee-only actions", async () => {
  const contact = await manager.createContact({ name: "Reminder contact" })
  const task = await manager.createWork(workInput(contact.id, staffA.id, { reminderAt: new Date(Date.now() - 60000).toISOString() }))
  assert.equal((await staff.listWork({ due: "reminders", contactId: contact.id })).total, 1)
  await assert.rejects(manager.updateWorkReminder(task.id, { version: 1, action: "DISMISS" }), expectStatus(403))
  await staff.updateWorkReminder(task.id, { version: 1, action: "SNOOZE", minutes: 15 })
  assert.equal((await staff.listWork({ due: "reminders", contactId: contact.id })).total, 0)
  const snoozed = await staff.getWork(task.id)
  await staff.updateWork(task.id, { ...workUpdate(snoozed), dueOn: "2026-10-03" })
  assert.equal((await staff.listWork({ due: "reminders", contactId: contact.id })).total, 1)
  const reset = await staff.getWork(task.id)
  await staff.updateWorkReminder(task.id, { version: reset.version, action: "DISMISS" })
  assert.equal((await staff.listWork({ due: "reminders", contactId: contact.id })).total, 0)
  assert.equal((await staff.listWork({ contactId: contact.id })).total, 1)
})

test("calendar date ranges and business dates correctly include timed and all-day work", async () => {
  const contact = await manager.createContact({ name: "Calendar contact" })
  await manager.createWork(workInput(contact.id, staffA.id, { startsAt: "2026-10-01T18:00:00Z", endsAt: "2026-10-01T20:00:00Z" }))
  await manager.createWork(workInput(contact.id, staffA.id, { dueOn: "2026-10-02" }))
  const nextDay = await staff.listWork({ contactId: contact.id, from: "2026-10-02", to: "2026-10-03" })
  assert.equal(nextDay.total, 2); assert.equal(nextDay.timeZone, "Asia/Kolkata")
  await assert.rejects(manager.createWork(workInput(contact.id, staffA.id, { startsAt: "2026-10-01T20:00:00Z", endsAt: "2026-10-01T21:00:00Z" })), expectStatus(400))
})

test("cancellation retains history, removes reminders, and requires editable ownership", async () => {
  const contact = await staff.createContact({ name: "Cancel contact" })
  const task = await manager.createWork(workInput(contact.id, otherA.id, { reminderAt: new Date().toISOString() }))
  assert.equal((await staff.getWork(task.id)).canEdit, false)
  await assert.rejects(staff.cancelWork(task.id, { version: 1, reason: "Unauthorized" }), expectStatus(403))
  await other.cancelWork(task.id, { version: 1, reason: "Customer cancelled" })
  assert.equal((await other.listWork({ contactId: contact.id })).total, 0)
  assert.equal((await other.listWork({ contactId: contact.id, state: "cancelled" })).total, 1)
  await other.addWorkNote(task.id, { message: "Will reconnect next month." })
  assert.equal((await other.listWorkHistory(task.id, {})).total, 3)
})

test("activity audit failures roll back completion, summary and its next follow-up", async () => {
  const contact = await manager.createContact({ name: "Work rollback" })
  const task = await manager.createWork(workInput(contact.id, staffA.id))
  await root.$executeRawUnsafe('ALTER TABLE "AuditLog" ADD CONSTRAINT "crm_test_reject_work_audit" CHECK (event <> \'crm.work.completed\') NOT VALID')
  try {
    await assert.rejects(staff.completeWork(task.id, completionInput(task, { followUp: { title: "Next", type: "TASK", assignedUserId: staffA.id, dueOn: "2026-10-02" } })))
    assert.equal((await staff.getWork(task.id)).status, "OPEN")
    assert.equal(await root.crmTask.count({ where: { followUpOfId: task.id } }), 0)
    assert.equal((await staff.listContactInteractions(contact.id, {})).total, 0)
    assert.equal((await staff.listWorkHistory(task.id, {})).total, 1)
  } finally { await root.$executeRawUnsafe('ALTER TABLE "AuditLog" DROP CONSTRAINT "crm_test_reject_work_audit"') }
})

test("activity relations prevent mismatched contacts, foreign assignees and cross-tenant raw writes", async () => {
  const contact = await manager.createContact({ name: "Work FK contact" })
  const wrong = await manager.createContact({ name: "Wrong customer" })
  const foreign = await second.createContact({ name: "Foreign work customer" })
  const pipeline = await manager.createPipeline(pipelineInput("Work FK"))
  const deal = await manager.createOpportunity(dealInput(pipeline, contact, adminA))
  const task = await manager.createWork(workInput(contact.id, staffA.id, { opportunityId: deal.id }))
  await assert.rejects(manager.createWork(workInput(wrong.id, staffA.id, { opportunityId: deal.id })), expectStatus(404))
  await assert.rejects(manager.createWork(workInput(contact.id, adminB.id)), expectStatus(400))
  await assert.rejects(root.crmTask.update({ where: { id: task.id }, data: { contactId: wrong.id } }))
  await assert.rejects(root.crmTask.update({ where: { id: task.id }, data: { assignedUserId: adminB.id } }))
  await assert.rejects(dbA.crmTask.create({ data: { title: "Bad", tenantId: b, contactId: foreign.id, assignedUserId: adminB.id, dueOn: new Date() } }))
  await assert.rejects(root.crmTaskEvent.create({ data: { tenantId: b, taskId: task.id, actorUserId: adminB.id, event: "Bad", message: "Bad" } }))
  assert.equal(await unscoped.crmTask.count(), 0); assert.equal(await unscoped.crmTaskEvent.count(), 0)
  await assert.rejects(manager.updateOpportunity(deal.id, { ...dealUpdate(deal), contactId: wrong.id }), expectStatus(409))
  await assert.rejects(root.crmOpportunity.update({ where: { id: deal.id }, data: { contactId: wrong.id } }))
})

test("legacy follow-ups retain inherited ownership while explicit staff activities keep their assignee", async () => {
  const contact = await manager.createContact({ name: "Inherited follow-up" })
  const enquiry = await manager.createEnquiry({ ...enquiryInput(contact.id, staffA.id), title: "Inherited ownership enquiry" })
  const legacy = await staff.createTask(enquiry.id, { title: "Legacy task", dueOn: "2026-10-01" })
  const explicit = await manager.createWork(workInput(contact.id, staffA.id, { enquiryId: enquiry.id }))
  await manager.updateEnquiry(enquiry.id, { title: enquiry.title, assignedUserId: otherA.id, version: 1, status: "NEW" })
  assert.equal((await other.getWork(legacy.id)).assignedUserId, otherA.id)
  assert.equal((await staff.getWork(explicit.id)).assignedUserId, staffA.id)
  await assert.rejects(other.completeWork(explicit.id, completionInput(explicit)), expectStatus(403))
})

test("pipelines are configurable, tenant scoped and manager controlled with versioned updates", async () => {
  await assert.rejects(staff.createPipeline(pipelineInput("Unauthorized")), expectStatus(403))
  const pipeline = await manager.createPipeline(pipelineInput("Property sales"))
  assert.equal((await staff.getPipeline(pipeline.id)).canManage, false)
  await assert.rejects(second.getPipeline(pipeline.id), expectStatus(404))
  await assert.rejects(staff.updatePipeline(pipeline.id, pipelineUpdate(pipeline)), expectStatus(403))
  const input = pipelineUpdate(pipeline)
  input.stages.reverse(); input.stages[0].name = "Not proceeding"
  const updated = await manager.updatePipeline(pipeline.id, input)
  assert.equal(updated.stages[0].name, "Not proceeding")
  assert.equal(updated.version, 2)
  await assert.rejects(manager.updatePipeline(pipeline.id, input), expectStatus(409))
  const foreign = await second.createPipeline(pipelineInput("Foreign stages"))
  await assert.rejects(manager.updatePipeline(pipeline.id, { ...pipelineUpdate(updated), stages: [...pipelineUpdate(updated).stages, { ...pipelineUpdate(foreign).stages[0], name: "Foreign stage" }] }), expectStatus(400))
})

test("opportunities preserve exact values, use stage probabilities, and require loss reasons", async () => {
  const pipeline = await manager.createPipeline(pipelineInput("Close flow"))
  const contact = await manager.createContact({ name: "Close flow buyer" })
  const deal = await manager.createOpportunity(dealInput(pipeline, contact, staffA))
  assert.equal(deal.amount.toString(), "12345.6789")
  assert.equal(deal.probability, 20)
  assert.equal(deal.closedAt, null)
  const moved = await staff.moveOpportunity(deal.id, { pipelineId: pipeline.id, stageId: pipeline.stages[1].id, version: 1 })
  assert.equal(moved.probability, 60)
  await assert.rejects(staff.moveOpportunity(deal.id, { pipelineId: pipeline.id, stageId: pipeline.stages[3].id, version: 2 }), expectStatus(400))
  const lost = await staff.moveOpportunity(deal.id, { pipelineId: pipeline.id, stageId: pipeline.stages[3].id, version: 2, lossReason: "Budget changed" })
  assert.equal(lost.probability, 0); assert.ok(lost.closedAt); assert.equal(lost.lossReason, "Budget changed")
  const reopened = await staff.moveOpportunity(deal.id, { pipelineId: pipeline.id, stageId: pipeline.stages[0].id, version: 3 })
  assert.equal(reopened.closedAt, null); assert.equal(reopened.lossReason, null)
  const won = await staff.updateOpportunity(deal.id, { ...dealUpdate(reopened), stageId: pipeline.stages[2].id, probability: 20 })
  assert.equal(won.probability, 100); assert.ok(won.closedAt)
  await staff.addOpportunityNote(deal.id, { message: "Contract signed" })
  const activity = await staff.listOpportunityActivity(deal.id, { pageSize: 2 })
  assert.equal(activity.total, 6); assert.equal(activity.items.length, 2)
  assert.ok((await staff.listOpportunityActivity(deal.id, {})).items.some(item => item.message.includes("Budget changed")))
  assert.equal(await root.auditLog.count({ where: { tenantId: a, entityId: deal.id } }), 6)
})

test("opportunity assignment grants only required contact and account access and revokes it on reassignment", async () => {
  const pipeline = await manager.createPipeline(pipelineInput("Assignment"))
  const contact = await manager.createContact({ name: "Deal assigned contact" })
  const company = await manager.createAccount({ name: "Deal assigned company" })
  const privateContact = await manager.createContact({ name: "Unrelated company person" })
  await manager.linkContactAccount(privateContact.id, { accountId: company.id })
  const deal = await manager.createOpportunity({ ...dealInput(pipeline, contact, staffA), accountId: company.id })
  assert.equal((await staff.getContact(contact.id)).canEdit, false)
  assert.equal((await staff.getAccount(company.id)).canEdit, false)
  assert.equal((await staff.listAccountContacts(company.id, {})).total, 0)
  await assert.rejects(other.getOpportunity(deal.id), expectStatus(404))
  await assert.rejects(other.listOpportunityActivity(deal.id, {}), expectStatus(404))
  assert.equal((await other.listOpportunities({ pipelineId: pipeline.id })).total, 0)
  assert.equal((await staff.listOpportunities({ pipelineId: pipeline.id, assignedUserId: otherA.id })).total, 0)
  await assert.rejects(staff.updateOpportunity(deal.id, { ...dealUpdate(deal), assignedUserId: otherA.id }), expectStatus(403))
  await manager.updateOpportunity(deal.id, { ...dealUpdate(deal), assignedUserId: otherA.id })
  await assert.rejects(staff.getOpportunity(deal.id), expectStatus(404))
  await assert.rejects(staff.getContact(contact.id), expectStatus(404))
  await assert.rejects(staff.getAccount(company.id), expectStatus(404))
  assert.equal((await other.getOpportunity(deal.id)).id, deal.id)
  await assert.rejects(staff.createOpportunity(dealInput(pipeline, contact, staffA)), expectStatus(404))
})

test("enquiry conversion is idempotent under concurrent requests and preserves history and follow-ups", async () => {
  const pipeline = await manager.createPipeline(pipelineInput("Conversion"))
  const contact = await manager.createContact({ name: "Convert buyer" })
  const enquiry = await manager.createEnquiry(enquiryInput(contact.id, staffA.id))
  await staff.createTask(enquiry.id, { title: "Existing follow-up", dueOn: "2026-10-01" })
  const data = { ...dealInput(pipeline, contact, staffA), enquiryId: enquiry.id }
  const results = await Promise.all([staff.createOpportunity(data), staff.createOpportunity(data)])
  assert.equal(results[0].id, results[1].id)
  assert.equal((await staff.getEnquiry(enquiry.id)).opportunity.id, results[0].id)
  assert.equal((await staff.listTasks({}, enquiry.id)).total, 1)
  assert.equal(await root.crmActivity.count({ where: { enquiryId: enquiry.id, event: "crm.enquiry.converted" } }), 1)
  assert.equal((await staff.getEnquiry(enquiry.id)).status, "NEW")
  await assert.rejects(other.createOpportunity(data), expectStatus(404))
  const own = await staff.createContact({ name: "Another contact" })
  await assert.rejects(staff.updateOpportunity(results[0].id, { ...dealUpdate(results[0]), contactId: own.id }), expectStatus(409))
})

test("pipeline/stage archiving preserves deals, prevents new entries, and allows moving out", async () => {
  const pipeline = await manager.createPipeline(pipelineInput("Archive stages"))
  const contact = await manager.createContact({ name: "Archive stage buyer" })
  const deal = await manager.createOpportunity(dealInput(pipeline, contact, staffA))
  const invalid = pipelineUpdate(pipeline); invalid.stages[0].kind = "WON"; invalid.stages[0].probability = 100
  await assert.rejects(manager.updatePipeline(pipeline.id, invalid), expectStatus(409))
  const archive = pipelineUpdate(pipeline); archive.stages[0].archived = true
  const archived = await manager.updatePipeline(pipeline.id, archive)
  assert.equal((await manager.getOpportunity(deal.id)).stage.archived, true)
  await assert.rejects(manager.createOpportunity(dealInput(archived, contact, staffA)), expectStatus(409))
  const withoutStage = pipelineUpdate(archived); withoutStage.stages.shift()
  await assert.rejects(manager.updatePipeline(pipeline.id, withoutStage), expectStatus(409))
  const otherPipeline = await manager.createPipeline(pipelineInput("Move destination"))
  const moved = await staff.moveOpportunity(deal.id, { pipelineId: otherPipeline.id, stageId: otherPipeline.stages[0].id, version: 1 })
  assert.equal(moved.pipelineId, otherPipeline.id)
  await manager.updatePipeline(pipeline.id, { ...pipelineUpdate(archived), archived: true })
  await assert.rejects(staff.moveOpportunity(deal.id, { pipelineId: pipeline.id, stageId: pipeline.stages[1].id, version: 2 }), expectStatus(409))
  assert.equal((await manager.listPipelines({ q: "Archive stages", archived: "true" })).total, 1)
})

test("concurrent moves and stale edits cannot overwrite another salesperson change", async () => {
  const pipeline = await manager.createPipeline(pipelineInput("Concurrent moves"))
  const contact = await manager.createContact({ name: "Concurrent deal buyer" })
  const deal = await manager.createOpportunity(dealInput(pipeline, contact, staffA))
  const results = await Promise.allSettled([1, 2].map(index => staff.moveOpportunity(deal.id, { pipelineId: pipeline.id, stageId: pipeline.stages[index].id, version: 1 })))
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1)
  assert.equal(results.find(result => result.status === "rejected").reason.status, 409)
  await assert.rejects(staff.updateOpportunity(deal.id, { ...dealUpdate(deal), title: "Stale title" }), expectStatus(409))
  assert.equal(await root.crmOpportunityActivity.count({ where: { opportunityId: deal.id } }), 2)
})

test("sales tables enforce RLS, tenant composite foreign keys and stage/pipeline integrity", async () => {
  const pipeline = await manager.createPipeline(pipelineInput("FK local"))
  const foreign = await second.createPipeline(pipelineInput("FK foreign"))
  const contact = await manager.createContact({ name: "FK buyer" })
  const otherContact = await second.createContact({ name: "Foreign buyer" })
  const localDeal = await manager.createOpportunity(dealInput(pipeline, contact, staffA))
  const foreignDeal = await second.createOpportunity(dealInput(foreign, otherContact, adminB))
  for (const table of ["crmPipeline", "crmStage", "crmOpportunity", "crmOpportunityActivity"]) {
    assert.equal(await unscoped[table].count(), 0)
    assert.equal(await dbA[table].count({ where: { tenantId: b } }), 0)
  }
  await assert.rejects(manager.moveOpportunity(localDeal.id, { pipelineId: pipeline.id, stageId: foreign.stages[0].id, version: 1 }), expectStatus(404))
  await assert.rejects(root.crmOpportunity.update({ where: { id: localDeal.id }, data: { stageId: foreign.stages[0].id } }))
  await assert.rejects(root.crmOpportunity.update({ where: { id: localDeal.id }, data: { contactId: otherContact.id } }))
  await assert.rejects(root.crmOpportunity.update({ where: { id: localDeal.id }, data: { assignedUserId: adminB.id } }))
  await assert.rejects(dbA.crmOpportunity.updateMany({ where: { id: localDeal.id }, data: { tenantId: b } }))
  await assert.rejects(root.crmOpportunityActivity.create({ data: { tenantId: a, opportunityId: foreignDeal.id, actorUserId: adminA.id, event: "bad", message: "bad" } }))
  await assert.rejects(root.crmOpportunity.update({ where: { id: localDeal.id }, data: { amount: "-1" } }))
  const another = await manager.createPipeline(pipelineInput("FK same tenant"))
  await assert.rejects(root.crmOpportunity.update({ where: { id: localDeal.id }, data: { stageId: another.stages[0].id } }))
})

test("sales audit failure rolls back the move and its history", async () => {
  const pipeline = await manager.createPipeline(pipelineInput("Audit rollback"))
  const contact = await manager.createContact({ name: "Audit deal buyer" })
  const deal = await manager.createOpportunity(dealInput(pipeline, contact, staffA))
  await root.$executeRawUnsafe('ALTER TABLE "AuditLog" ADD CONSTRAINT "crm_test_reject_move_audit" CHECK (event <> \'crm.opportunity.stage.changed\') NOT VALID')
  try {
    await assert.rejects(staff.moveOpportunity(deal.id, { pipelineId: pipeline.id, stageId: pipeline.stages[1].id, version: 1 }))
    const unchanged = await staff.getOpportunity(deal.id)
    assert.equal(unchanged.version, 1); assert.equal(unchanged.stageId, deal.stageId)
    assert.equal((await staff.listOpportunityActivity(deal.id, {})).total, 1)
  } finally { await root.$executeRawUnsafe('ALTER TABLE "AuditLog" DROP CONSTRAINT "crm_test_reject_move_audit"') }
})

test("opportunity filters and pagination cover the full dataset and never mix currencies", async () => {
  const pipeline = await manager.createPipeline(pipelineInput("Paged board"))
  const contact = await manager.createContact({ name: "Paged buyer" })
  for (let i = 0; i < 4; i++) await manager.createOpportunity({ ...dealInput(pipeline, contact, staffA), title: `Paged ${i}`, currency: i % 2 ? "USD" : "INR" })
  const first = await staff.listOpportunities({ pipelineId: pipeline.id, stageId: pipeline.stages[0].id, pageSize: 2, sort: "title", order: "asc" })
  const next = await staff.listOpportunities({ pipelineId: pipeline.id, stageId: pipeline.stages[0].id, pageSize: 2, page: 2, sort: "title", order: "asc" })
  assert.equal(first.total, 4); assert.equal(first.totalPages, 2)
  assert.equal(new Set([...first.items, ...next.items].map(item => item.id)).size, 4)
  assert.deepEqual(first.items.map(item => item.currency), ["INR", "USD"])
  assert.equal((await staff.listOpportunities({ pipelineId: pipeline.id, kind: "WON" })).total, 0)
  assert.equal((await staff.listOpportunities({ pipelineId: pipeline.id, q: "Paged 2" })).total, 1)
})

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
  await assert.rejects(manager.activityOverview({}), expectStatus(403))
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
