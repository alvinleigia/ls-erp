import { test, expect } from "@playwright/test"
import { seed, login, json, platformContext } from "./fixtures"
import { defaultRecordRules } from "../../platform/access/rules"

test.describe.configure({ mode: "serial" })
let fixture: Awaited<ReturnType<typeof seed>>, admin: Awaited<ReturnType<typeof login>>, manager: typeof admin, staff: typeof admin, foreign: typeof admin
let contact: { id: string }, lead: { id: string; title: string; version: number }, team: { id: string; version: number }
test.beforeAll(async ({ browser }) => {
  fixture = await seed()
  admin = await login(browser, fixture.origin, fixture.users.admin.email)
  manager = await login(browser, fixture.origin, fixture.users.manager.email)
  staff = await login(browser, fixture.origin, fixture.users.staff.email)
  foreign = await login(browser, fixture.otherOrigin, fixture.users.other.email)
  contact = await json(admin.context, "/api/crm/contacts", 201, "POST", { name: "Boundary customer" })
  lead = await json(admin.context, "/api/crm/enquiries", 201, "POST", { title: "Confidential boundary enquiry", contactId: contact.id, assignedUserId: fixture.users.admin.id })
})
test.afterAll(async () => { for (const actor of [admin, manager, staff, foreign]) await actor?.context.close(); await fixture?.db.end() })
async function sharing(resource: string, id: string, restricted: boolean, grants: { kind: string; id: string; level: string }[]) {
  const before = await json(admin.context, `/api/access/records/${resource}/${id}`)
  return json(admin.context, `/api/access/records/${resource}/${id}`, 200, "PATCH", { version: before.version, restricted, grants })
}
async function rules(userId: string, patch: Record<string, string>) {
  const current = await json(admin.context, `/api/access/users/${userId}`)
  return json(admin.context, `/api/access/users/${userId}`, 200, "PATCH", { roleIds: current.accessAssignments.map((a: { roleId: string }) => a.roleId), version: current.accessPolicy.version, rules: { ...current.accessPolicy.rules, ...patch } })
}
const person = (id: string, level = "READ") => ({ kind: "USER", id, level })

test("Restricted visibility caps tenant-wide managers in details, lists, exports and dashboard", async () => {
  await json(manager.context, `/api/crm/enquiries/${lead.id}`)
  await sharing("enquiries", lead.id, true, [person(fixture.users.staff.id)])
  await json(manager.context, `/api/crm/enquiries/${lead.id}`, 404)
  expect((await json(manager.context, "/api/crm/enquiries?q=Confidential")).total).toBe(0)
  const csv = await manager.context.request.get("/api/crm/enquiries/export")
  expect(csv.status()).toBe(200); expect(await csv.text()).not.toContain(lead.title)
  expect(JSON.stringify(await json(manager.context, "/api/dashboard/summary"))).not.toContain(lead.id)
  expect((await json(staff.context, `/api/crm/enquiries/${lead.id}`)).recordAccess.permissions["enquiries.edit"]).toBe(false)
  await json(staff.context, `/api/crm/enquiries/${lead.id}`, 404, "PATCH", { title: "Denied read-only change", assignedUserId: fixture.users.admin.id, status: "NEW", version: lead.version })
  await json(manager.context, `/api/access/records/enquiries/${lead.id}`, 403)
})

test("Edit sharing supports scoped changes, optimistic versions and immediate revocation", async () => {
  await sharing("enquiries", lead.id, true, [person(fixture.users.staff.id, "EDIT")])
  const before = await json(staff.context, `/api/crm/enquiries/${lead.id}`)
  expect(before.recordAccess.permissions["enquiries.edit"]).toBe(true)
  const input = { title: "Confidential edited enquiry", assignedUserId: fixture.users.admin.id, status: "NEW", version: before.version }
  lead = await json(staff.context, `/api/crm/enquiries/${lead.id}`, 200, "PATCH", input)
  await json(staff.context, `/api/crm/enquiries/${lead.id}`, 409, "PATCH", input)
  await sharing("enquiries", lead.id, true, [])
  await json(staff.context, `/api/crm/enquiries/${lead.id}`, 404)
  const history = await json(admin.context, `/api/reports/audit-logs?event=access.recordSharing.updated`)
  expect(history.total).toBeGreaterThan(0)
})

test("user and team grants combine; team membership removal takes effect in the current session", async () => {
  team = await json(admin.context, "/api/teams", 201, "POST", { name: "Shared boundary team" })
  team = await json(admin.context, `/api/teams/${team.id}/members`, 200, "POST", { userId: fixture.users.staff.id, version: team.version })
  await sharing("enquiries", lead.id, true, [person(fixture.users.staff.id), { kind: "TEAM", id: team.id, level: "EDIT" }])
  expect((await json(staff.context, `/api/crm/enquiries/${lead.id}`)).recordAccess.permissions["enquiries.edit"]).toBe(true)
  await json(admin.context, `/api/teams/${team.id}/members`, 200, "POST", { userId: fixture.users.staff.id, version: team.version, remove: true })
  expect((await json(staff.context, `/api/crm/enquiries/${lead.id}`)).recordAccess.permissions["enquiries.edit"]).toBe(false)
  await sharing("enquiries", lead.id, true, [])
  await json(staff.context, `/api/crm/enquiries/${lead.id}`, 404)
})

test("sharing cannot bypass missing profile actions or a None rule", async () => {
  await sharing("enquiries", lead.id, true, [person(fixture.users.staff.id, "EDIT")])
  await rules(fixture.users.staff.id, { "enquiries.edit": "NONE" })
  expect((await json(staff.context, `/api/crm/enquiries/${lead.id}`)).recordAccess.permissions["enquiries.edit"]).toBe(false)
  await json(staff.context, `/api/crm/enquiries/${lead.id}`, 403, "PATCH", { title: lead.title, assignedUserId: fixture.users.admin.id, status: "NEW", version: lead.version })
  await rules(fixture.users.staff.id, { "enquiries.read": "NONE" })
  await json(staff.context, `/api/crm/enquiries/${lead.id}`, 403)
  const assignment = await json(admin.context, `/api/access/users/${fixture.users.staff.id}`)
  await json(admin.context, `/api/access/users/${fixture.users.staff.id}`, 200, "PATCH", { roleIds: [], version: assignment.accessPolicy.version, rules: defaultRecordRules() })
  await json(staff.context, `/api/crm/enquiries/${lead.id}`, 403)
  const denied = await json(admin.context, `/api/access/users/${fixture.users.staff.id}`)
  await json(admin.context, `/api/access/users/${fixture.users.staff.id}`, 200, "PATCH", { roleIds: [fixture.profileId], version: denied.accessPolicy.version, rules: defaultRecordRules() })
})

test("a private contact remains a source boundary even when its enquiry is shared", async () => {
  await sharing("contacts", contact.id, true, [])
  await json(staff.context, `/api/crm/enquiries/${lead.id}`, 404)
  await sharing("contacts", contact.id, true, [person(fixture.users.staff.id)])
  await json(staff.context, `/api/crm/enquiries/${lead.id}`)
  await sharing("contacts", contact.id, false, [])
})

test("cross-tenant reads, writes and sharing administration are denied", async () => {
  for (const path of [`/api/crm/enquiries/${lead.id}`, `/api/crm/contacts/${contact.id}`, `/api/teams/${team.id}`, `/api/access/records/enquiries/${lead.id}`]) await json(foreign.context, path, 404)
  await json(foreign.context, `/api/crm/enquiries/${lead.id}`, 404, "PATCH", { title: "Foreign mutation", assignedUserId: fixture.users.other.id, status: "NEW", version: lead.version })
  const before = await json(admin.context, `/api/access/records/enquiries/${lead.id}`)
  await json(admin.context, `/api/access/records/enquiries/${lead.id}`, 400, "PATCH", { version: before.version, restricted: true, grants: [person(fixture.users.other.id)] })
  await json(admin.context, `/api/access/records/enquiries/${lead.id}`, 409, "PATCH", { version: 0, restricted: false, grants: [] })
  await json(staff.context, `/api/access/records/enquiries/${lead.id}`, 403)
  await json(manager.context, "/api/tenants", 403)
  const hidden = await fixture.db.query('SELECT count(*)::int n FROM "CrmEnquiry" WHERE "tenantId"=$1', [fixture.otherSlug])
  expect(hidden.rows[0].n).toBe(0)
})

test("subprojects inherit parent privacy and source actions remain independent", async () => {
  const parent = await json(admin.context, "/api/real-estate/projects", 201, "POST", { name: "Private boundary project", code: "PRIVATE-R9" })
  const child = await json(admin.context, "/api/real-estate/projects", 201, "POST", { name: "Private boundary subproject", code: "PRIVATE-R9-A", parentId: parent.id })
  await sharing("projects", parent.id, true, [person(fixture.users.staff.id)])
  await json(manager.context, `/api/real-estate/projects/${parent.id}`, 404)
  await json(manager.context, `/api/real-estate/projects/${child.id}`, 404)
  const visible = await json(staff.context, `/api/real-estate/projects/${child.id}`)
  expect(visible.recordAccess.permissions["projects.edit"]).toBe(false)
  const inherited = await json(admin.context, `/api/access/records/projects/${child.id}`)
  expect(inherited.inherited).toBe(true); expect(inherited.recordId).toBe(parent.id)
})

test("every business module enforces deactivation and dashboard sections follow current activation", async () => {
  const endpoints: Record<string, string> = { receivables: "/api/receivables", salesOrders: "/api/sales-orders", catalog: "/api/catalog/items", leaves: "/api/leaves/definitions", shifts: "/api/shifts/templates", appointments: "/api/appointments", services: "/api/services", inventory: "/api/inventory/categories", realEstate: "/api/real-estate/projects", salesDocuments: "/api/crm/quotation-templates", crm: "/api/crm/enquiries" }
  const order = ["receivables", "salesOrders", "paymentPlans", "salesDocuments", "realEstate", "crm", "catalog", "leaves", "shifts", "appointments", "services", "inventory"]
  try {
    for (const key of order) { await json(admin.context, "/api/modules", 200, "PATCH", { key, enabled: false }); if (endpoints[key]) await json(admin.context, endpoints[key], 403) }
    const dashboard = await json(admin.context, "/api/dashboard/summary")
    expect(dashboard).toBeTruthy()
  } finally { for (const key of [...order].reverse()) await json(admin.context, "/api/modules", 200, "PATCH", { key, enabled: true }) }
  await json(admin.context, `/api/crm/enquiries/${lead.id}`)
})

test("platform allowance, suspension and reactivation enforce boundaries without losing data", async () => {
  const platform = await platformContext()
  try {
    await json(platform, `/api/tenants/${fixture.slug}/modules`, 200, "PATCH", { key: "inventory", allowed: false })
    await json(admin.context, "/api/inventory/categories", 403)
    await json(admin.context, "/api/modules", 403, "PATCH", { key: "inventory", enabled: true })
    await json(platform, `/api/tenants/${fixture.slug}/modules`, 200, "PATCH", { key: "inventory", allowed: true })
    await json(admin.context, "/api/modules", 200, "PATCH", { key: "inventory", enabled: true })
    await json(platform, `/api/tenants/${fixture.slug}`, 200, "PATCH", { status: "SUSPENDED" })
    expect((await admin.context.request.get(`/api/crm/enquiries/${lead.id}`)).status()).toBeGreaterThanOrEqual(400)
    await json(platform, `/api/tenants/${fixture.slug}`, 200, "PATCH", { status: "ACTIVE" })
    expect((await json(admin.context, `/api/crm/enquiries/${lead.id}`)).id).toBe(lead.id)
  } finally {
    const restored = await platform.patch(`/api/tenants/${fixture.slug}`, { data: { status: "ACTIVE" } })
    expect([200, 409]).toContain(restored.status())
    await platform.dispose()
  }
})
