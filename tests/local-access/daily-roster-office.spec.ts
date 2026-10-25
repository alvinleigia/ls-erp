import { test, expect } from "@playwright/test"
import { seed, login, json } from "./fixtures"
test.use({ actionTimeout: 15_000 })

test("daily override drafts capture offices while saved dates retain their source office", async ({ browser }) => {
  test.setTimeout(150_000)
  const fixture = await seed(), admin = await login(browser, fixture.origin, fixture.users.admin.email)
  let manager: typeof admin | undefined
  const westStaff = fixture.slug + "_west", eastProfile = fixture.slug + "_east_profile", westProfile = fixture.slug + "_west_profile"
  try {
    await fixture.db.query('UPDATE "AppSetting" SET "timeZone"=\'UTC\' WHERE "tenantId"=$1', [fixture.slug])
    const company = await json(admin.context, "/api/companies", 201, "POST", { name: "Daily browser", code: "DAILY" })
    const east = await json(admin.context, "/api/offices", 201, "POST", { companyId: company.id, name: "East", code: "EAST" })
    const west = await json(admin.context, "/api/offices", 201, "POST", { companyId: company.id, name: "West", code: "WEST" })
    await fixture.db.query('INSERT INTO "User"(id,"tenantId",name,email,role,"updatedAt") VALUES($1,$2,\'West staff\',$3,\'STAFF\',now())', [westStaff, fixture.slug, westStaff + "@example.test"])
    for (const [user, offices] of [[fixture.users.admin.id, [east.id, west.id]], [fixture.users.staff.id, [east.id]], [fixture.users.manager.id, [east.id]], [westStaff, [west.id]]] as const) {
      const current = await json(admin.context, `/api/access/users/${user}/offices`)
      await json(admin.context, `/api/access/users/${user}/offices`, 200, "PATCH", { version: current.version, officeIds: offices, companies: [], creationOfficeId: offices[0] })
    }
    for (const [id, user, office] of [[eastProfile, fixture.users.staff.id, east.id], [westProfile, westStaff, west.id]]) {
      await fixture.db.query('INSERT INTO "StaffProfile"(id,"userId","schedulingMode","updatedAt") VALUES($1,$2,\'FLEXIBLE\',now())', [id, user])
      await fixture.db.query('INSERT INTO "StaffWorkplacePolicy"("tenantId","staffProfileId",version,"updatedAt") VALUES($1,$2,1,now())', [fixture.slug, id])
      await fixture.db.query('INSERT INTO "StaffWorkplaceAssignment"(id,"tenantId","staffProfileId","officeId","updatedAt") VALUES($2,$1,$2,$3,now())', [fixture.slug, id, office])
    }
    async function select(officeId: string) {
      const current = await json(admin.context, "/api/workspace/office")
      await json(admin.context, "/api/workspace/office", 200, "PATCH", { version: current.version, officeId })
    }
    const input = (staffId: string) => ({ staffId, date: "2036-02-04", slots: [{ startTime: "09:00", endTime: "17:00" }] })
    const original = (await json(admin.context, "/api/shifts/flexible-slots", 200, "POST", input(fixture.users.staff.id))).items[0]
    await select(west.id)
    const westSlot = (await json(admin.context, "/api/shifts/flexible-slots", 200, "POST", input(westStaff))).items[0]
    await select(east.id)
    await admin.page.goto("/shifts/roster")
    await admin.page.getByRole("button", { name: "Next week", exact: true }).click()
    async function open() {
      const captured = admin.page.waitForResponse(r => new URL(r.url()).pathname === "/api/workspace/office" && r.request().method() === "GET")
      await admin.page.getByRole("row").filter({ hasText: "Access staff" }).getByRole("cell").nth(2).click()
      await captured
      const draft = admin.page.getByRole("dialog", { name: "Edit flexible availability", exact: true })
      await draft.getByLabel("Mode", { exact: true }).click()
      await admin.page.getByRole("menuitemradio", { name: "Template/Unavailable override", exact: true }).click()
      return admin.page.getByRole("dialog", { name: "Change shift", exact: true })
    }
    async function save(status: number) {
      const response = admin.page.waitForResponse(r => new URL(r.url()).pathname === "/api/shifts/overrides" && r.request().method() === "POST", { timeout: 20_000 })
      await admin.page.getByRole("button", { name: "Save override", exact: true }).click()
      const result = await response; expect(result.status()).toBe(status); return result
    }
    let draft = await open()
    const date = await draft.getByLabel("Start date", { exact: true }).inputValue()
    await draft.getByLabel("End date", { exact: true }).fill(date)
    await draft.getByRole("checkbox", { name: "Mark as unavailable", exact: true }).check()
    await select(west.id)
    const stale = await save(409); expect(stale.request().headers()["x-office-id"]).toBe(east.id)
    await expect(admin.page.getByText("Office context changed; reload the creation form.", { exact: true })).toBeVisible()
    await expect(draft.getByLabel("End date", { exact: true })).toHaveValue(date)
    const range = `?staffIds=${fixture.users.staff.id}&startDate=${date}&endDate=${date}`
    expect((await json(admin.context, "/api/shifts/overrides" + range)).items).toEqual([])
    await draft.getByRole("button", { name: "Cancel", exact: true }).click()
    await select(east.id)
    draft = await open()
    await draft.getByLabel("End date", { exact: true }).fill(date)
    await draft.getByRole("checkbox", { name: "Mark as unavailable", exact: true }).check()
    await save(200); await expect(draft).toBeHidden()
    const saved = (await json(admin.context, "/api/shifts/overrides" + range)).items[0]
    expect(saved.officeId).toBe(east.id)
    await select(west.id)
    draft = await open()
    await expect(draft).toContainText("Office: Daily browser / East")
    await draft.getByLabel("End date", { exact: true }).fill(date)
    await draft.getByRole("checkbox", { name: "Mark as unavailable", exact: true }).check()
    await admin.page.screenshot({ path: "test-results/local-access/daily-office-form.png", fullPage: true })
    await save(200); await expect(draft).toBeHidden()
    expect((await json(admin.context, "/api/shifts/overrides" + range)).items[0].id).toBe(saved.id)
    const edited = (await json(admin.context, "/api/shifts/flexible-slots", 200, "POST", { ...input(fixture.users.staff.id), slots: [{ startTime: "08:00", endTime: "18:00" }] })).items[0]
    expect(edited.id).toBe(original.id); expect(edited.officeId).toBe(east.id)
    manager = await login(browser, fixture.origin, fixture.users.manager.email)
    expect((await json(manager.context, "/api/shifts/flexible-slots?staffIds=" + westStaff + "&startDate=2036-02-04&endDate=2036-02-04")).items).toEqual([])
    expect((await json(manager.context, "/api/shifts/overrides" + range)).items[0].officeId).toBe(east.id)
    await manager.page.goto("/shifts/roster")
    await manager.page.getByRole("button", { name: "Next week", exact: true }).click()
    await expect(manager.page.getByRole("row").filter({ hasText: "Access staff" }).getByRole("cell", { name: "Unavailable", exact: true })).toBeVisible()
    await manager.page.screenshot({ path: "test-results/local-access/daily-office-roster.png", fullPage: true })
    const audits = (await fixture.db.query('SELECT metadata,before,after FROM "AuditLog" WHERE "tenantId"=$1 AND "entityType"=\'shiftRoster\' AND metadata->>\'officeFamily\'=\'dailyRoster\'', [fixture.slug])).rows
    expect(audits.length).toBeGreaterThan(0)
    for (const audit of audits) expect([...audit.before, ...audit.after].every(row => row.officeId === audit.metadata.officeId)).toBe(true)
    expect(westSlot.officeId).toBe(west.id)
  } finally { await manager?.context.close(); await admin.context.close(); await fixture.db.end() }
})
