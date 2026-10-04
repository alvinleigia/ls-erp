import { test, expect } from "@playwright/test"
import { seed, login, json, password } from "./fixtures"

test.describe.configure({ mode: "serial" })
let fixture: Awaited<ReturnType<typeof seed>>
let admin: Awaited<ReturnType<typeof login>>, manager: typeof admin, staff: typeof admin, other: typeof admin, platform: typeof admin
let role: { id: string; name: string; version: number; permissions: string[]; crmRecordScope: string }
let team: { id: string; version: number }
let own: { id: string; title: string }, managed: typeof own, hidden: typeof own
let auditId: string
const permissions = ["dashboard.read", "contacts.read", "enquiries.read", "enquiries.edit", "enquiries.export", "salesTeams.read", "auditLogs.read", "inventoryCategories.read"]

test.beforeAll(async ({ browser }) => {
  fixture = await seed()
  admin = await login(browser, fixture.origin, fixture.users.admin.email)
  manager = await login(browser, fixture.origin, fixture.users.manager.email)
  staff = await login(browser, fixture.origin, fixture.users.staff.email)
  other = await login(browser, `http://${fixture.otherSlug}.localhost:3108`, fixture.users.other.email)
  platform = await login(browser, "http://localhost:3108", fixture.users.platform.email)
  role = await json(admin.context, "/api/access/roles", 201, "POST", { name: "Scoped sales manager", permissions, crmRecordScope: "OWN" })
  await json(admin.context, `/api/access/users/${fixture.users.manager.id}`, 200, "PATCH", { roleId: role.id, previousRoleId: null })
  team = await json(admin.context, "/api/crm/sales-teams", 201, "POST", { name: "Local access team" })
  for (const key of ["staff", "manager"]) team = await json(admin.context, `/api/crm/sales-teams/${team.id}/members`, 200, "POST", { userId: fixture.users[key].id, version: team.version })
  async function lead(title: string, owner: string, salesTeamId?: string) {
    const contact = await json(admin.context, "/api/crm/contacts", 201, "POST", { name: title + " buyer" })
    return json(admin.context, "/api/crm/enquiries", 201, "POST", { title, contactId: contact.id, assignedUserId: owner, ...(salesTeamId ? { salesTeamId } : {}) })
  }
  own = await lead("Manager own lead", fixture.users.manager.id)
  managed = await lead("Team assigned lead", fixture.users.staff.id, team.id)
  hidden = await lead("Private outside team", fixture.users.staff.id)
})
test.afterAll(async () => {
  for (const actor of [admin, manager, staff, other, platform]) await actor?.context.close()
  await fixture?.db.end()
})

test("real sign-ins enforce ownership, tenant isolation and explicit team-manager designation", async () => {
  const list = await json(manager.context, "/api/crm/enquiries")
  expect(list.items.map((r: { id: string }) => r.id)).toEqual([own.id])
  await json(manager.context, `/api/crm/enquiries/${managed.id}`, 404)
  await json(other.context, `/api/crm/enquiries/${own.id}`, 404)
  role = await json(admin.context, `/api/access/roles/${role.id}`, 200, "PATCH", { name: role.name, version: role.version, permissions, crmRecordScope: "MANAGED_TEAMS" })
  expect((await json(manager.context, "/api/crm/enquiries")).total).toBe(1)
  team = await json(admin.context, `/api/crm/sales-teams/${team.id}/members`, 200, "POST", { userId: fixture.users.manager.id, version: team.version, isManager: true })
  expect((await json(manager.context, "/api/crm/enquiries")).total).toBe(2)
  await json(manager.context, `/api/crm/enquiries/${hidden.id}`, 404)
  await manager.page.goto("/crm/enquiries")
  await expect(manager.page.getByRole("link", { name: managed.title, exact: true })).toBeVisible()
  await expect(manager.page.getByRole("link", { name: hidden.title, exact: true })).toHaveCount(0)
  await manager.page.screenshot({ path: test.info().outputPath("manager-scoped-leads.png"), fullPage: true, animations: "disabled" })
})

test("manager edits preserve ownership and identify the actual actor in audit history", async () => {
  const before = await json(manager.context, `/api/crm/enquiries/${managed.id}`)
  const after = await json(manager.context, `/api/crm/enquiries/${managed.id}`, 200, "PATCH", {
    title: "Team lead reviewed", assignedUserId: before.assignedUserId,
    salesTeamId: before.salesTeamId, status: before.status, version: before.version,
  })
  expect(after.assignedUserId).toBe(fixture.users.staff.id)
  const audit = await json(admin.context, `/api/reports/audit-logs?entityId=${managed.id}&event=crm.enquiry.updated`)
  expect(audit.items).toHaveLength(1)
  expect(audit.items[0].actorUserId).toBe(fixture.users.manager.id)
  auditId = audit.items[0].id
  await json(manager.context, `/api/reports/audit-logs/${auditId}`, 404)
  const detail = await json(admin.context, `/api/reports/audit-logs/${auditId}`)
  expect(JSON.stringify(detail)).toContain("Team lead reviewed")
})

test("role updates revoke a live session and stale role saves cannot overwrite newer permissions", async () => {
  const updated = { name: role.name, permissions: ["dashboard.read"], crmRecordScope: role.crmRecordScope, version: role.version }
  const results = await Promise.all([admin.context.request.patch(`/api/access/roles/${role.id}`, { data: updated }), admin.context.request.patch(`/api/access/roles/${role.id}`, { data: updated })])
  expect(results.map(r => r.status()).sort()).toEqual([200, 409])
  role = await json(admin.context, `/api/access/roles/${role.id}`)
  await json(manager.context, "/api/crm/enquiries", 403)
  await manager.page.reload()
  await expect(manager.page.getByRole("heading", { name: "Access unavailable", exact: true })).toBeVisible()
  await expect(manager.page.getByRole("link", { name: "Team lead reviewed", exact: true })).toHaveCount(0)
  role = await json(admin.context, `/api/access/roles/${role.id}`, 200, "PATCH", { name: role.name, permissions, crmRecordScope: "MANAGED_TEAMS", version: role.version })
  expect((await json(manager.context, "/api/crm/enquiries")).total).toBe(2)
  team = await json(admin.context, `/api/crm/sales-teams/${team.id}/members`, 200, "POST", { userId: fixture.users.manager.id, version: team.version, isManager: false })
  await json(manager.context, `/api/crm/enquiries/${managed.id}`, 404)
})

test("operational module disabling denies APIs and views while reactivation preserves data", async () => {
  await json(admin.context, "/api/inventory/categories", 201, "POST", { name: "Retained category", status: "ACTIVE", sortOrder: 0 })
  const endpoints: [string, string][] = [["inventory", "/api/inventory/categories"], ["services", "/api/services"], ["appointments", "/api/appointments"], ["leaves", "/api/leaves/requests"], ["shifts", "/api/shifts/templates"]]
  for (const [key, endpoint] of endpoints) {
    await json(admin.context, "/api/modules", 200, "PATCH", { key, enabled: false })
    await json(admin.context, endpoint, 403)
    await json(staff.context, endpoint, 403)
    if (key === "inventory") {
      await admin.page.goto("/inventory/categories")
      await expect(admin.page.getByRole("heading", { name: "Inventory is not enabled", exact: true })).toBeVisible()
    }
    await json(admin.context, "/api/modules", 200, "PATCH", { key, enabled: true })
    await json(admin.context, endpoint)
  }
  expect((await json(admin.context, "/api/inventory/categories?q=Retained%20category")).items).toHaveLength(1)
  await json(staff.context, "/api/modules", 403, "PATCH", { key: "inventory", enabled: false })
})

test("All scope stays tenant-bound and cannot elevate a staff account or bypass action permissions", async () => {
  role = await json(admin.context, `/api/access/roles/${role.id}`, 200, "PATCH", { name: role.name, permissions, crmRecordScope: "ALL", version: role.version })
  expect((await json(manager.context, "/api/crm/enquiries")).total).toBe(3)
  const readonly = await json(admin.context, "/api/access/roles", 201, "POST", { name: "Staff read-only", permissions: ["contacts.read", "enquiries.read"], crmRecordScope: "ALL" })
  await json(admin.context, `/api/access/users/${fixture.users.staff.id}`, 200, "PATCH", { roleId: readonly.id, previousRoleId: null })
  expect((await json(staff.context, "/api/crm/enquiries")).total).toBe(2)
  await json(staff.context, `/api/crm/enquiries/${own.id}`, 404)
  await json(staff.context, "/api/crm/contacts", 403, "POST", { name: "Forbidden creation" })
  await json(staff.context, "/api/access/roles", 403)
  await json(admin.context, `/api/access/users/${fixture.users.admin.id}`, 409, "PATCH", { roleId: readonly.id, previousRoleId: null })
  await staff.page.goto(`/crm/enquiries/${managed.id}`)
  await expect(staff.page.getByRole("heading", { name: "Team lead reviewed", exact: true })).toBeVisible()
  await expect(staff.page.getByRole("button", { name: /Edit enquiry|Save enquiry/ })).toHaveCount(0)
  await staff.page.screenshot({ path: test.info().outputPath("staff-readonly-enquiry.png"), fullPage: true, animations: "disabled" })
})

test("platform allowances cap tenant activation without giving the platform business-data access", async () => {
  const path = `/api/tenants/${fixture.slug}/modules`
  await json(admin.context, path, 403, "PATCH", { key: "inventory", allowed: false })
  await json(platform.context, "/api/crm/enquiries", 403)
  await json(platform.context, path, 200, "PATCH", { key: "inventory", allowed: false })
  await json(admin.context, "/api/inventory/categories", 403)
  await json(admin.context, "/api/modules", 403, "PATCH", { key: "inventory", enabled: true })
  await json(platform.context, path, 200, "PATCH", { key: "inventory", allowed: true })
  await json(admin.context, "/api/modules", 200, "PATCH", { key: "inventory", enabled: false })
  await json(platform.context, path, 200, "PATCH", { key: "inventory", allowed: true })
  await json(admin.context, "/api/inventory/categories", 403)
  await json(admin.context, "/api/modules", 200, "PATCH", { key: "inventory", enabled: true })
  expect((await json(admin.context, "/api/inventory/categories?q=Retained%20category")).items).toHaveLength(1)
  const events = await json(admin.context, `/api/reports/audit-logs?event=module.allowance.updated&actorUserId=${fixture.users.platform.id}`)
  expect(events.total).toBeGreaterThanOrEqual(2)
})

test("CRM dependency controls prevent partial activation and retain existing records", async () => {
  await json(admin.context, "/api/modules", 409, "PATCH", { key: "crm", enabled: false })
  for (const key of ["paymentPlans", "salesDocuments", "realEstate", "crm"]) await json(admin.context, "/api/modules", 200, "PATCH", { key, enabled: false })
  await json(manager.context, "/api/crm/enquiries", 403)
  await json(staff.context, `/api/crm/enquiries/${managed.id}`, 403)
  await json(admin.context, "/api/modules", 409, "PATCH", { key: "realEstate", enabled: true })
  for (const key of ["crm", "realEstate", "salesDocuments", "paymentPlans"]) await json(admin.context, "/api/modules", 200, "PATCH", { key, enabled: true })
  expect((await json(manager.context, "/api/crm/enquiries")).total).toBe(3)
})

test("audit snapshots are redacted, read-only and cleared when access is revoked", async () => {
  const id = `${fixture.slug}_audit`
  await fixture.db.query('INSERT INTO "AuditLog" (id,"tenantId",event,"entityType","entityId","actorUserId",before,after) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [id, fixture.slug, "inventory.inventoryCategories.edit", "InventoryCategory", "synthetic-history", fixture.users.admin.id, { name: "Before", password: "synthetic-secret-before" }, { name: "After", password: "synthetic-secret-after" }])
  const detail = await json(manager.context, `/api/reports/audit-logs/${id}`)
  expect(JSON.stringify(detail)).toContain("[redacted]")
  expect(JSON.stringify(detail)).not.toContain("synthetic-secret")
  await manager.page.setViewportSize({ width: 390, height: 844 })
  await manager.page.goto("/reports/audit-logs")
  await manager.page.getByRole("button", { name: "Filters", exact: true }).click()
  await manager.page.getByLabel("Record ID", { exact: true }).fill("synthetic-history")
  await manager.page.keyboard.press("Escape")
  await expect(manager.page.getByRole("button", { name: "View", exact: true })).toHaveCount(1)
  await manager.page.getByRole("button", { name: "View", exact: true }).click()
  await expect(manager.page.getByRole("region", { name: "Changed fields", exact: true })).toContainText("After")
  await manager.page.getByText("Recorded snapshots", { exact: true }).click()
  await expect(manager.page.getByRole("region", { name: "After", exact: true })).toContainText("[redacted]")
  await manager.page.screenshot({ path: test.info().outputPath("real-audit-mobile.png"), animations: "disabled" })
  await json(admin.context, "/api/modules", 200, "PATCH", { key: "inventory", enabled: false })
  await manager.page.getByRole("button", { name: "Reload entry", exact: true }).click()
  await expect(manager.page.getByRole("region", { name: "Changed fields", exact: true })).toHaveCount(0)
  await json(manager.context, `/api/reports/audit-logs/${id}`, 404)
  await json(admin.context, "/api/modules", 200, "PATCH", { key: "inventory", enabled: true })
})

test("deactivated accounts cannot keep using an existing authenticated session", async () => {
  await fixture.db.query('UPDATE "User" SET status=\'SUSPENDED\' WHERE id=$1 AND "tenantId"=$2', [fixture.users.manager.id, fixture.slug])
  const response = await manager.context.request.get("/api/crm/enquiries")
  expect([401, 403]).toContain(response.status())
  await manager.page.goto("/crm/enquiries")
  await expect(manager.page).toHaveURL(/\/auth\/signin$/)
  await expect(manager.page.getByLabel("Email", { exact: true })).toBeVisible()
  await expect(manager.page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled()
  expect((await (await manager.context.request.get("/api/auth/session")).json())?.user).toBeUndefined()
  await manager.page.getByLabel("Email", { exact: true }).fill(fixture.users.manager.email)
  await manager.page.getByLabel("Password", { exact: true }).fill(password)
  await manager.page.getByRole("button", { name: "Sign in", exact: true }).click()
  await expect(manager.page.getByText("Invalid email or password.", { exact: true })).toBeVisible()
  await manager.page.getByLabel("Email", { exact: true }).fill(fixture.users.staff.email)
  await manager.page.getByRole("button", { name: "Sign in", exact: true }).click()
  await expect(manager.page).toHaveURL(/\/dashboard$/)
  expect((await (await manager.context.request.get("/api/auth/session")).json()).user.email).toBe(fixture.users.staff.email)
})

test("tenant-switch recovery clears the old session and leaves a usable sign-in form", async () => {
  await admin.page.goto("/auth/signin?switchTenant=1")
  await expect(admin.page.getByLabel("Email", { exact: true })).toBeVisible()
  await expect(admin.page).toHaveURL(/\/auth\/signin$/)
  expect((await (await admin.context.request.get("/api/auth/session")).json())?.user).toBeUndefined()
})
