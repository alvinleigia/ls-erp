import { test, expect } from "@playwright/test"
import { seed, login, json } from "./fixtures"

test("schedule drafts retain captured office identity and office defaults follow dated workplaces", async ({ browser }) => {
  test.setTimeout(150_000)
  const fixture = await seed(), admin = await login(browser, fixture.origin, fixture.users.admin.email)
  let manager: typeof admin | undefined
  try {
    const company = await json(admin.context, "/api/companies", 201, "POST", { name: "Schedule browser", code: "SCHEDULE" })
    const a = await json(admin.context, "/api/offices", 201, "POST", { companyId: company.id, name: "East", code: "EAST" })
    const b = await json(admin.context, "/api/offices", 201, "POST", { companyId: company.id, name: "West", code: "WEST" })
    for (const [user, offices] of [[fixture.users.admin, [a.id, b.id]], [fixture.users.staff, [a.id, b.id]], [fixture.users.manager, [a.id]]] as const) {
      const current = await json(admin.context, `/api/access/users/${user.id}/offices`)
      await json(admin.context, `/api/access/users/${user.id}/offices`, 200, "PATCH", { version: current.version, officeIds: offices, companies: [], creationOfficeId: a.id })
    }
    const profile = fixture.slug + "_schedule_profile", template = profile + "_template"
    await fixture.db.query('INSERT INTO "StaffProfile"(id,"userId","updatedAt") VALUES($1,$2,now())', [profile, fixture.users.staff.id])
    await fixture.db.query('INSERT INTO "StaffWorkplacePolicy"("tenantId","staffProfileId",version,"updatedAt") VALUES($1,$2,1,now())', [fixture.slug, profile])
    await fixture.db.query('INSERT INTO "StaffWorkplaceAssignment"(id,"tenantId","staffProfileId","officeId","updatedAt") VALUES($1,$2,$1,$3,now())', [profile, fixture.slug, a.id])
    await fixture.db.query('INSERT INTO "ShiftTemplate"(id,"tenantId",name,"startTime","endTime","updatedAt") VALUES($1,$2,\'Office working day\',\'09:00\',\'17:00\',now())', [template, fixture.slug])
    async function fill(name: string) {
      const captured = admin.page.waitForResponse(r => new URL(r.url()).pathname === "/api/workspace/office" && r.request().method() === "GET")
      await admin.page.getByRole("button", { name: "New schedule", exact: true }).click()
      await captured
      const draft = admin.page.getByRole("dialog", { name: "New shift schedule", exact: true })
      await draft.getByLabel("Schedule name", { exact: true }).fill(name)
      await draft.getByLabel("Make this the default schedule", { exact: true }).check()
      await draft.getByLabel("Start date", { exact: true }).fill("2030-01-01")
      await draft.getByLabel("Shift template 1", { exact: true }).click()
      await admin.page.getByRole("option", { name: "Office working day", exact: true }).click()
      await expect(draft.getByLabel("Shift template 1", { exact: true })).toHaveAttribute("aria-expanded", "false")
    }
    async function save(status: number) {
      const response = admin.page.waitForResponse(r => new URL(r.url()).pathname === "/api/shifts/schedules" && r.request().method() === "POST", { timeout: 20_000 })
      await admin.page.getByRole("button", { name: "Create schedule", exact: true }).click()
      const result = await response
      expect(result.status()).toBe(status)
      return result
    }
    await admin.page.goto("/shifts/schedules")
    await fill("Stale east draft")
    const selected = await json(admin.context, "/api/workspace/office")
    await json(admin.context, "/api/workspace/office", 200, "PATCH", { version: selected.version, officeId: b.id })
    const denied = await save(409)
    expect(denied.request().headers()["x-office-id"]).toBe(a.id)
    await expect(admin.page.getByRole("alert")).toHaveText("Office context changed; reload the creation form.")
    await expect(admin.page.getByLabel("Schedule name", { exact: true })).toHaveValue("Stale east draft")
    expect((await json(admin.context, "/api/shifts/schedules")).total).toBe(0)
    admin.page.once("dialog", dialog => dialog.accept())
    await admin.page.reload()
    await fill("West office default")
    await save(200)
    const west = (await json(admin.context, "/api/shifts/schedules")).items.find((row: { name: string }) => row.name === "West office default")
    expect(west.officeId).toBe(b.id)
    await expect(admin.page.getByRole("cell").filter({ hasText: "West office default" })).toContainText("Schedule browser / West")
    const changed = await json(admin.context, "/api/workspace/office")
    await json(admin.context, "/api/workspace/office", 200, "PATCH", { version: changed.version, officeId: a.id })
    await fill("East office default")
    await expect(admin.page.getByText("Shift schedule created.", { exact: true })).toBeHidden()
    await admin.page.getByLabel("Schedule name", { exact: true }).scrollIntoViewIfNeeded()
    await admin.page.screenshot({ path: "test-results/local-access/schedule-office-form.png", fullPage: true })
    await save(200)
    const east = (await json(admin.context, "/api/shifts/schedules")).items.find((row: { name: string }) => row.name === "East office default")
    expect(east.officeId).toBe(a.id)
    await expect(admin.page.getByRole("cell").filter({ hasText: "East office default" })).toContainText("Schedule browser / East")
    await json(admin.context, "/api/shifts/workplaces", 200, "POST", { action: "assign", staffId: fixture.users.staff.id, version: 1, fromId: profile, officeId: b.id, startsOn: "2036-03-01" })
    const choices = await json(admin.context, `/api/shifts/assignments?staffIds=${fixture.users.staff.id}&startDate=2036-02-28&endDate=2036-03-03`)
    expect(choices.defaults.find((day: { date: string }) => day.date === "2036-02-28").scheduleId).toBe(east.id)
    expect(choices.defaults.find((day: { date: string }) => day.date === "2036-03-03").scheduleId).toBe(west.id)
    manager = await login(browser, fixture.origin, fixture.users.manager.email)
    await manager.page.goto("/shifts/schedules")
    await expect(manager.page.getByText("East office default", { exact: true })).toBeVisible()
    await expect(manager.page.getByText("West office default", { exact: true })).toHaveCount(0)
    expect((await json(manager.context, `/api/shifts/assignments?staffIds=${fixture.users.staff.id}&startDate=2036-03-03&endDate=2036-03-03`)).defaults).toEqual([])
    await manager.page.screenshot({ path: "test-results/local-access/schedule-office-list.png", fullPage: true })
    // A saved historic rotation anchor must remain editable without resetting it
    // to today or letting the browser's native minimum-date validation block Save.
    await fixture.db.query('UPDATE "ShiftSchedule" SET "startDate"=\'2020-01-01\' WHERE id=$1', [east.id])
    await manager.page.reload()
    await manager.page.getByRole("button", { name: "Record actions", exact: true }).click()
    await manager.page.getByRole("menuitem", { name: "Edit", exact: true }).click()
    await expect(manager.page.getByRole("dialog", { name: "Edit shift schedule", exact: true }).getByLabel("Start date", { exact: true })).toHaveValue("2020-01-01")
    await manager.page.getByLabel("Schedule name", { exact: true }).fill("Renamed historic east")
    const edited = manager.page.waitForResponse(r => new URL(r.url()).pathname === `/api/shifts/schedules/${east.id}` && r.request().method() === "PATCH")
    await manager.page.getByRole("button", { name: "Save changes", exact: true }).click()
    expect((await edited).status()).toBe(200)
    expect((await fixture.db.query('SELECT "startDate"::text d FROM "ShiftSchedule" WHERE id=$1', [east.id])).rows[0].d).toBe("2020-01-01")
  } finally { await manager?.context.close(); await admin.context.close(); await fixture.db.end() }
})
