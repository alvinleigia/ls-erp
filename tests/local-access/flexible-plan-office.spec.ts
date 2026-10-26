import { test, expect } from "@playwright/test"
import { seed, login, json } from "./fixtures"
test.use({ actionTimeout: 15_000 })

test("recurring forms retain office snapshots and office-scoped readers see only their plans", async ({ browser }) => {
  test.setTimeout(150_000)
  const fixture = await seed(), admin = await login(browser, fixture.origin, fixture.users.admin.email)
  let manager: typeof admin | undefined
  const westStaff = fixture.slug + "_west_staff", eastProfile = fixture.slug + "_east_profile", westProfile = fixture.slug + "_west_profile"
  try {
    const company = await json(admin.context, "/api/companies", 201, "POST", { name: "Flexible browser", code: "FLEX" })
    const a = await json(admin.context, "/api/offices", 201, "POST", { companyId: company.id, name: "East", code: "EAST" })
    const b = await json(admin.context, "/api/offices", 201, "POST", { companyId: company.id, name: "West", code: "WEST" })
    await fixture.db.query('INSERT INTO "User"(id,"tenantId",name,email,role,"updatedAt") VALUES($1,$2,\'West staff\',$3,\'STAFF\',now())', [westStaff, fixture.slug, westStaff + "@example.test"])
    for (const [id, offices] of [[fixture.users.admin.id, [a.id, b.id]], [fixture.users.staff.id, [a.id]], [fixture.users.manager.id, [a.id]], [westStaff, [b.id]]] as const) {
      const current = await json(admin.context, `/api/access/users/${id}/offices`)
      await json(admin.context, `/api/access/users/${id}/offices`, 200, "PATCH", { version: current.version, officeIds: offices, companies: [], creationOfficeId: offices[0] })
    }
    for (const [id, user, office] of [[eastProfile, fixture.users.staff.id, a.id], [westProfile, westStaff, b.id]]) {
      await fixture.db.query('INSERT INTO "StaffProfile"(id,"userId","schedulingMode","updatedAt") VALUES($1,$2,\'FLEXIBLE\',now())', [id, user])
      await fixture.db.query('INSERT INTO "StaffWorkplacePolicy"("tenantId","staffProfileId",version,"updatedAt") VALUES($1,$2,1,now())', [fixture.slug, id])
      await fixture.db.query('INSERT INTO "StaffWorkplaceAssignment"(id,"tenantId","staffProfileId","officeId","updatedAt") VALUES($2,$1,$2,$3,now())', [fixture.slug, id, office])
    }
    const days = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"].map(day => ({ day, isOff: true, slots: [] }))
    const weekly = await json(admin.context, "/api/shifts/flexible-week-plans", 200, "PUT", { staffId: fixture.users.staff.id, weekStartDate: "2036-02-04", days })
    expect(weekly.item.officeId).toBe(a.id)
    async function fill(staff: string, name: string) {
      const captured = admin.page.waitForResponse(r => new URL(r.url()).pathname === "/api/workspace/office" && r.request().method() === "GET")
      await admin.page.getByRole("button", { name: "New recurring plan", exact: true }).click()
      await captured
      const draft = admin.page.getByRole("dialog", { name: "New recurring plan", exact: true })
      await draft.getByLabel("Staff", { exact: true }).click()
      await admin.page.getByRole("option", { name: staff, exact: true }).click()
      await draft.getByLabel("Pattern name", { exact: true }).fill(name)
      await draft.getByLabel("Valid from", { exact: true }).fill("2036-02-04")
      await draft.getByLabel("Valid to", { exact: true }).fill("2036-02-24")
      await expect(draft.getByRole("checkbox")).toHaveCount(7)
      for (const checkbox of await draft.getByRole("checkbox").all()) await checkbox.check()
    }
    async function save(status: number) {
      const response = admin.page.waitForResponse(r => new URL(r.url()).pathname === "/api/shifts/flexible-patterns" && r.request().method() === "PUT", { timeout: 20_000 })
      await admin.page.getByRole("button", { name: "Create pattern", exact: true }).click()
      const result = await response; expect(result.status()).toBe(status); return result
    }
    await admin.page.goto("/shifts/recurring")
    await fill("Access staff", "Stale east draft")
    const selected = await json(admin.context, "/api/workspace/office")
    await json(admin.context, "/api/workspace/office", 200, "PATCH", { version: selected.version, officeId: b.id })
    const stale = await save(409)
    expect(stale.request().headers()["x-office-id"]).toBe(a.id)
    await expect(admin.page.getByRole("dialog", { name: "New recurring plan", exact: true })).toContainText("Office context changed; reload the creation form.")
    await expect(admin.page.getByLabel("Pattern name", { exact: true })).toHaveValue("Stale east draft")
    expect((await json(admin.context, "/api/shifts/flexible-patterns/list")).total).toBe(0)
    admin.page.once("dialog", dialog => dialog.accept()); await admin.page.reload()
    await fill("West staff", "West browser plan")
    await admin.page.getByLabel("Pattern name", { exact: true }).scrollIntoViewIfNeeded()
    await admin.page.screenshot({ path: "test-results/local-access/flexible-office-form.png", fullPage: true })
    await save(200)
    const west = (await json(admin.context, "/api/shifts/flexible-patterns/list")).items[0]
    expect(west.officeId).toBe(b.id)
    await expect(admin.page.getByRole("row").filter({ hasText: "West browser plan" })).toContainText("Flexible browser / West")
    const current = await json(admin.context, "/api/workspace/office")
    await json(admin.context, "/api/workspace/office", 200, "PATCH", { version: current.version, officeId: a.id })
    const east = (await json(admin.context, "/api/shifts/flexible-patterns", 200, "PUT", { staffId: fixture.users.staff.id, name: "East browser plan", cycleLengthWeeks: 1, validFrom: "2036-02-04", validTo: "2036-02-24", isActive: true, weeks: [{ weekIndex: 1, days }] })).item
    manager = await login(browser, fixture.origin, fixture.users.manager.email)
    await manager.page.goto("/shifts/recurring")
    await expect(manager.page.getByRole("button", { name: "East browser plan", exact: true })).toBeVisible()
    await expect(manager.page.getByText("West browser plan", { exact: true })).toHaveCount(0)
    await manager.page.screenshot({ path: "test-results/local-access/flexible-office-list.png", fullPage: true })
    await manager.page.getByRole("button", { name: "East browser plan", exact: true }).click()
    await expect(manager.page.getByRole("dialog")).toContainText("Flexible browser / East")
    await json(manager.context, `/api/shifts/flexible-patterns/${west.id}`, 404)
    const office = await json(admin.context, "/api/workspace/office")
    await json(admin.context, "/api/workspace/office", 200, "PATCH", { version: office.version, officeId: b.id })
    const copied = await json(admin.context, `/api/shifts/flexible-patterns/${east.id}/clone`, 200, "POST", { targetStaffId: westStaff, name: "West copy", validFrom: "2037-01-05", validTo: "2037-01-11", activate: true })
    expect((await json(admin.context, `/api/shifts/flexible-patterns/${copied.id}`)).item.officeId).toBe(b.id)
    const audit = (await fixture.db.query('SELECT before,after,metadata FROM "AuditLog" WHERE "entityId"=$1', [copied.id])).rows[0]
    expect(audit.before).toBeNull(); expect(audit.metadata.officeId).toBe(b.id)
    expect(JSON.stringify(audit)).not.toContain(east.id)
  } finally { await manager?.context.close(); await admin.context.close(); await fixture.db.end() }
})
