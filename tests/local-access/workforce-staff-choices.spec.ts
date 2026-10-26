import { test, expect } from "@playwright/test"
import { seed, login, json } from "./fixtures"

test.use({ actionTimeout: 15_000 })
test("schedule choices follow captured office/dates and preserve selections across search pages", async ({ browser }) => {
  test.setTimeout(150_000)
  const fixture = await seed(), admin = await login(browser, fixture.origin, fixture.users.admin.email)
  try {
    const company = await json(admin.context, "/api/companies", 201, "POST", { name: "Picker browser", code: "PICKER" })
    const a = await json(admin.context, "/api/offices", 201, "POST", { companyId: company.id, name: "East", code: "EAST" })
    const b = await json(admin.context, "/api/offices", 201, "POST", { companyId: company.id, name: "West", code: "WEST" })
    for (const [user, offices] of [[fixture.users.admin.id, [a.id, b.id]], [fixture.users.staff.id, [a.id]]] as const) {
      const current = await json(admin.context, `/api/access/users/${user}/offices`)
      await json(admin.context, `/api/access/users/${user}/offices`, 200, "PATCH", { version: current.version, officeIds: offices, companies: [], creationOfficeId: offices[0] })
    }
    for (const [name, office, end] of [["Access staff", a.id, null], ["West staff", b.id, null], ["Transfer staff", a.id, "2036-02-04"]] as const) {
      const id = name === "Access staff" ? fixture.users.staff.id : fixture.slug + name.replaceAll(" ", "_")
      if (id !== fixture.users.staff.id) {
        await fixture.db.query('INSERT INTO "User"(id,"tenantId",name,email,role,"updatedAt") VALUES($1,$2,$3,$1||\'@example.test\',\'STAFF\',now())', [id, fixture.slug, name])
        await fixture.db.query('INSERT INTO "BusinessOfficePolicy"("tenantId","userId","creationOfficeId","updatedAt") VALUES($1,$2,$3,now())', [fixture.slug, id, office])
        await fixture.db.query('INSERT INTO "BusinessOfficeGrant"("tenantId","userId","officeId") VALUES($1,$2,$3)', [fixture.slug, id, office])
      }
      await fixture.db.query('INSERT INTO "StaffProfile"(id,"userId","updatedAt") VALUES($1,$1,now())', [id])
      await fixture.db.query('INSERT INTO "StaffWorkplacePolicy"("tenantId","staffProfileId",version,"updatedAt") VALUES($1,$2,1,now())', [fixture.slug, id])
      await fixture.db.query('INSERT INTO "StaffWorkplaceAssignment"(id,"tenantId","staffProfileId","officeId","endDate","updatedAt") VALUES($2,$1,$2,$3,$4,now())', [fixture.slug, id, office, end])
    }
    await fixture.db.query('INSERT INTO "User"(id,"tenantId",name,email,role,"updatedAt") SELECT $1||n,$2,\'Paging \'||lpad(n::text,3,\'0\'),$1||n||\'@example.test\',\'STAFF\',now() FROM generate_series(1,105)n', [fixture.slug + "_page_", fixture.slug])
    await fixture.db.query('INSERT INTO "StaffProfile"(id,"userId","updatedAt") SELECT id,id,now() FROM "User" WHERE "tenantId"=$1 AND name LIKE \'Paging %\'', [fixture.slug])
    await fixture.db.query('INSERT INTO "BusinessOfficePolicy"("tenantId","userId","creationOfficeId","updatedAt") SELECT $1,id,$2,now() FROM "User" WHERE "tenantId"=$1 AND name LIKE \'Paging %\'', [fixture.slug, a.id])
    await fixture.db.query('INSERT INTO "BusinessOfficeGrant"("tenantId","userId","officeId") SELECT $1,id,$2 FROM "User" WHERE "tenantId"=$1 AND name LIKE \'Paging %\'', [fixture.slug, a.id])
    await fixture.db.query('INSERT INTO "StaffWorkplacePolicy"("tenantId","staffProfileId",version,"updatedAt") SELECT $1,id,1,now() FROM "User" WHERE "tenantId"=$1 AND name LIKE \'Paging %\'', [fixture.slug])
    await fixture.db.query('INSERT INTO "StaffWorkplaceAssignment"(id,"tenantId","staffProfileId","officeId","updatedAt") SELECT id,$1,id,$2,now() FROM "User" WHERE "tenantId"=$1 AND name LIKE \'Paging %\'', [fixture.slug, a.id])
    const directoryRequests: string[] = []
    admin.page.on("request", r => { if (new URL(r.url()).pathname === "/api/directory") directoryRequests.push(r.url()) })
    await admin.page.goto("/shifts/schedules")
    await admin.page.getByRole("button", { name: "New schedule", exact: true }).click()
    const draft = admin.page.getByRole("dialog", { name: "New shift schedule", exact: true })
    await draft.getByLabel("Assignment start date", { exact: true }).fill("2036-02-04")
    await draft.getByLabel("Assignment end date", { exact: true }).fill("2036-02-05")
    await expect(draft.getByRole("checkbox", { name: "Access staff", exact: true })).toBeVisible()
    await expect(draft.getByRole("checkbox", { name: "West staff", exact: true })).toHaveCount(0)
    const search = draft.getByLabel("Search eligible staff", { exact: true })
    await search.fill("Transfer staff"); await expect(draft.getByText("0 matching staff", { exact: true })).toBeVisible()
    await draft.getByLabel("Assignment end date", { exact: true }).fill("2036-02-04")
    await expect(draft.getByRole("checkbox", { name: "Transfer staff", exact: true })).toBeVisible()
    await search.fill("Access staff"); await draft.getByRole("checkbox", { name: "Access staff", exact: true }).check()
    await search.fill("Paging"); await expect(draft.getByText("105 matching staff", { exact: true })).toBeVisible()
    await expect(draft.getByRole("button", { name: "Access staff - Remove", exact: true })).toBeVisible()
    await draft.getByRole("button", { name: "Next staff choices", exact: true }).click()
    await expect(draft.getByRole("checkbox", { name: "Paging 021", exact: true })).toBeVisible()
    await search.fill("Paging 105"); await draft.getByRole("checkbox", { name: "Paging 105", exact: true }).check()
    await expect(draft.getByRole("button", { name: "Access staff - Remove", exact: true })).toBeVisible()
    await expect(draft.getByRole("button", { name: "Paging 105 - Remove", exact: true })).toBeVisible()
    await admin.page.screenshot({ path: "test-results/local-access/workforce-picker-search.png", fullPage: true })
    const current = await json(admin.context, "/api/workspace/office")
    await json(admin.context, "/api/workspace/office", 200, "PATCH", { version: current.version, officeId: b.id })
    await search.fill("West staff")
    await expect(draft.getByRole("alert")).toContainText("Office context changed")
    await expect(draft.getByRole("checkbox", { name: "West staff", exact: true })).toHaveCount(0)
    await expect(draft.getByRole("button", { name: "Access staff - Remove", exact: true })).toBeVisible()
    await expect(draft.getByRole("button", { name: "Paging 105 - Remove", exact: true })).toBeVisible()
    expect(directoryRequests).toEqual([])
    await admin.page.screenshot({ path: "test-results/local-access/workforce-picker-stale.png", fullPage: true })
  } finally { await admin.context.close(); await fixture.db.end() }
})

test("editing retains a former assignee and the saved source office after workspace changes", async ({ browser }) => {
  test.setTimeout(90_000)
  const fixture = await seed(), admin = await login(browser, fixture.origin, fixture.users.admin.email)
  const profile = fixture.slug + "_saved_profile", schedule = fixture.slug + "_saved_schedule", template = fixture.slug + "_template"
  try {
    const initial = (await fixture.db.query('SELECT id FROM "BusinessOffice" WHERE "tenantId"=$1 AND "isInitial"', [fixture.slug])).rows[0]
    const company = await json(admin.context, "/api/companies", 201, "POST", { name: "Other office", code: "OTHER" })
    const west = await json(admin.context, "/api/offices", 201, "POST", { companyId: company.id, name: "West", code: "WEST" })
    const current = await json(admin.context, `/api/access/users/${fixture.users.admin.id}/offices`)
    await json(admin.context, `/api/access/users/${fixture.users.admin.id}/offices`, 200, "PATCH", { version: current.version, officeIds: [initial.id, west.id], companies: [], creationOfficeId: west.id })
    await fixture.db.query('INSERT INTO "StaffProfile"(id,"userId","updatedAt") VALUES($1,$2,now())', [profile, fixture.users.staff.id])
    await fixture.db.query('INSERT INTO "StaffWorkplacePolicy"("tenantId","staffProfileId",version,"updatedAt") VALUES($1,$2,1,now())', [fixture.slug, profile])
    await fixture.db.query('INSERT INTO "StaffWorkplaceAssignment"(id,"tenantId","staffProfileId","officeId","updatedAt") VALUES($2,$1,$2,$3,now())', [fixture.slug, profile, west.id])
    await fixture.db.query('INSERT INTO "ShiftTemplate"(id,"tenantId",name,"startTime","endTime","updatedAt") VALUES($1,$2,\'Saved working day\',\'09:00\',\'17:00\',now())', [template, fixture.slug])
    await fixture.db.query('INSERT INTO "ShiftSchedule"(id,"tenantId","officeId",name,"startDate","weekOffDay1","weekOff2Weeks","updatedAt") VALUES($1,$2,$3,\'Saved shift\',\'2036-02-04\',\'SUNDAY\',ARRAY[]::integer[],now())', [schedule, fixture.slug, initial.id])
    await fixture.db.query('INSERT INTO "ShiftScheduleBlock"(id,"scheduleId","templateId","repeatDays") VALUES($1,$1,$2,1)', [schedule, template])
    await fixture.db.query('INSERT INTO "StaffScheduleAssignment"(id,"staffProfileId","scheduleId","startDate","updatedAt") VALUES($1,$2,$1,\'2036-02-04\',now())', [schedule, profile])
    await fixture.db.query('UPDATE "User" SET status=\'ARCHIVED\' WHERE id=$1', [fixture.users.staff.id])
    const assignment = async () => (await fixture.db.query('SELECT to_jsonb(a) row FROM "StaffScheduleAssignment" a WHERE id=$1', [schedule])).rows[0].row
    const before = await assignment()
    await admin.page.goto("/shifts/schedules")
    await admin.page.getByRole("row").filter({ hasText: "Saved shift" }).getByRole("button", { name: "Record actions", exact: true }).click()
    await admin.page.getByRole("menuitem", { name: "Edit", exact: true }).click()
    const draft = admin.page.getByRole("dialog", { name: "Edit shift schedule", exact: true })
    await expect(draft.getByRole("checkbox", { name: /Access staff/ })).toBeChecked()
    await draft.getByLabel("Schedule name", { exact: true }).fill("Renamed saved shift")
    await admin.page.screenshot({ path: "test-results/local-access/workforce-picker-retained.png", fullPage: true })
    const response = admin.page.waitForResponse(r => new URL(r.url()).pathname === `/api/shifts/schedules/${schedule}` && r.request().method() === "PATCH")
    await draft.getByRole("button", { name: "Save changes", exact: true }).click()
    expect((await response).status()).toBe(200)
    await expect(draft).toBeHidden()
    expect(await assignment()).toEqual(before)
    expect((await fixture.db.query('SELECT "officeId" FROM "ShiftSchedule" WHERE id=$1', [schedule])).rows[0].officeId).toBe(initial.id)
  } finally { await admin.context.close(); await fixture.db.end() }
})
