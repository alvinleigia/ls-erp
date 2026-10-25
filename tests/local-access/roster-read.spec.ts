import { test, expect } from "@playwright/test"
import { seed, login, json, assignProfiles } from "./fixtures"
test.use({ actionTimeout: 15_000 })

test("roster uses scoped neutral hours, masks transfer dates and clears revoked offices", async ({ browser }) => {
  test.setTimeout(150_000)
  const fixture = await seed(), admin = await login(browser, fixture.origin, fixture.users.admin.email)
  let reader: typeof admin | undefined
  const westUser = fixture.slug + "_west", transferUser = fixture.slug + "_transfer", profile = fixture.slug + "_profile", westProfile = fixture.slug + "_west_profile", transferProfile = fixture.slug + "_transfer_profile", role = fixture.slug + "_roster_reader"
  try {
    await fixture.db.query('UPDATE "AppSetting" SET "timeZone"=\'UTC\',"timeFormat"=\'H24\' WHERE "tenantId"=$1', [fixture.slug])
    const company = await json(admin.context, "/api/companies", 201, "POST", { name: "Roster browser", code: "ROSTER" })
    const a = await json(admin.context, "/api/offices", 201, "POST", { companyId: company.id, name: "East", code: "EAST" })
    const b = await json(admin.context, "/api/offices", 201, "POST", { companyId: company.id, name: "West", code: "WEST" })
    for (const [id, name] of [[westUser, "West worker"], [transferUser, "Transfer worker"]]) await fixture.db.query('INSERT INTO "User"(id,"tenantId",name,email,role,"updatedAt") VALUES($1,$2,$3,$4,\'STAFF\',now())', [id, fixture.slug, name, id + "@example.test"])
    for (const [user, offices] of [[fixture.users.admin.id, [a.id, b.id]], [fixture.users.manager.id, [a.id]], [fixture.users.staff.id, [a.id]], [westUser, [b.id]], [transferUser, [a.id, b.id]]] as const) {
      const current = await json(admin.context, `/api/access/users/${user}/offices`)
      await json(admin.context, `/api/access/users/${user}/offices`, 200, "PATCH", { version: current.version, officeIds: offices, companies: [], creationOfficeId: offices[0] })
    }
    for (const [id, user, office] of [[profile, fixture.users.staff.id, a.id], [westProfile, westUser, b.id], [transferProfile, transferUser, a.id]]) {
      await fixture.db.query('INSERT INTO "StaffProfile"(id,"userId","schedulingMode","updatedAt") VALUES($1,$2,\'FLEXIBLE\',now())', [id, user])
      await fixture.db.query('INSERT INTO "StaffWorkplacePolicy"("tenantId","staffProfileId",version,"updatedAt") VALUES($1,$2,1,now())', [fixture.slug, id])
      await fixture.db.query('INSERT INTO "StaffWorkplaceAssignment"(id,"tenantId","staffProfileId","officeId","updatedAt") VALUES($2,$1,$2,$3,now())', [fixture.slug, id, office])
    }
    await fixture.db.query('INSERT INTO "TenantAccessRole"(id,"tenantId",name,"nameKey",permissions,"updatedAt") VALUES($1,$2,\'Roster reader\',\'roster reader\',ARRAY[\'shiftRoster.read\'],now())', [role, fixture.slug])
    const access = await json(admin.context, `/api/access/users/${fixture.users.manager.id}`)
    await assignProfiles(admin.context, fixture.users.manager.id, [role], { rules: { ...access.accessPolicy.rules, "shiftRoster.read": "ALL" } })
    reader = await login(browser, fixture.origin, fixture.users.manager.email)
    const directoryRequests: string[] = []
    reader.page.on("request", request => { if (new URL(request.url()).pathname === "/api/directory") directoryRequests.push(request.url()) })
    await reader.page.goto("/shifts/roster")
    await expect(reader.page.getByRole("row").filter({ hasText: "Access staff" })).toBeVisible()
    const next = reader.page.waitForResponse(r => new URL(r.url()).pathname === "/api/shifts/roster" && r.request().method() === "GET")
    await reader.page.getByRole("button", { name: "Next week", exact: true }).click()
    const url = new URL((await next).url()), first = url.searchParams.get("startDate")!, last = url.searchParams.get("endDate")!
    const transfer = new Date(first); transfer.setUTCDate(transfer.getUTCDate() + 2)
    const before = new Date(transfer); before.setUTCDate(before.getUTCDate() - 1)
    await fixture.db.query('UPDATE "StaffWorkplaceAssignment" SET "endDate"=$1 WHERE id=$2', [before.toISOString().slice(0, 10), transferProfile])
    await fixture.db.query('INSERT INTO "StaffWorkplaceAssignment"(id,"tenantId","staffProfileId","officeId","startDate","updatedAt") VALUES($1,$2,$3,$4,$5,now())', [transferProfile + "_next", fixture.slug, transferProfile, b.id, transfer.toISOString().slice(0, 10)])
    const days = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"].map(day => ({ day, isOff: false, slots: [{ startTime: "09:00", endTime: "17:00", breaks: [{ startTime: "12:00", endTime: "13:00" }] }] }))
    await json(admin.context, "/api/shifts/flexible-patterns", 200, "PUT", { staffId: fixture.users.staff.id, name: "Private configuration name", validFrom: first, validTo: last, cycleLengthWeeks: 1, isActive: true, weeks: [{ weekIndex: 1, days }] })
    const loaded = reader.page.waitForResponse(r => new URL(r.url()).pathname === "/api/shifts/roster")
    await reader.page.getByRole("button", { name: "Refresh roster", exact: true }).click(); expect((await loaded).status()).toBe(200)
    const row = reader.page.getByRole("row").filter({ hasText: "Access staff" })
    await expect(row.getByText("Working hours", { exact: true })).toHaveCount(7)
    await expect(row).toContainText("49h")
    await expect(reader.page.getByText("Private configuration name", { exact: true })).toHaveCount(0)
    await expect(reader.page.getByRole("row").filter({ hasText: "West worker" })).toHaveCount(0)
    await expect(reader.page.getByRole("row").filter({ hasText: "Transfer worker" })).toContainText("Outside your offices")
    await row.getByRole("cell").nth(1).click(); await expect(reader.page.getByRole("dialog")).toHaveCount(0)
    await reader.page.screenshot({ path: "test-results/local-access/roster-read-hours.png", fullPage: true })
    await reader.page.getByLabel("Search roster staff", { exact: true }).fill("Access staff")
    await expect(reader.page.getByRole("row").filter({ hasText: "Transfer worker" })).toHaveCount(0)
    const response = await json(reader.context, `/api/shifts/roster?startDate=${first}&endDate=${last}&q=${encodeURIComponent("Access staff")}`)
    expect(response.items).toHaveLength(1); expect(JSON.stringify(response)).not.toContain("Private configuration name")
    expect(directoryRequests).toEqual([])
    await fixture.db.query('INSERT INTO "User"(id,"tenantId",name,email,role,"updatedAt") SELECT $1||n,$2,\'Paging \'||lpad(n::text,3,\'0\'),$1||n||\'@example.test\',\'STAFF\',now() FROM generate_series(1,107)n', [fixture.slug + "_page_", fixture.slug])
    await fixture.db.query('INSERT INTO "StaffProfile"(id,"userId","schedulingMode","updatedAt") SELECT id,id,\'FLEXIBLE\',now() FROM "User" WHERE "tenantId"=$1 AND name LIKE \'Paging %\'', [fixture.slug])
    await fixture.db.query('INSERT INTO "StaffWorkplacePolicy"("tenantId","staffProfileId",version,"updatedAt") SELECT $1,p.id,1,now() FROM "StaffProfile" p JOIN "User" u ON u.id=p."userId" WHERE u."tenantId"=$1 AND u.name LIKE \'Paging %\'', [fixture.slug])
    await fixture.db.query('INSERT INTO "StaffWorkplaceAssignment"(id,"tenantId","staffProfileId","officeId","updatedAt") SELECT p.id,$1,p.id,$2,now() FROM "StaffProfile" p JOIN "User" u ON u.id=p."userId" WHERE u."tenantId"=$1 AND u.name LIKE \'Paging %\'', [fixture.slug, a.id])
    await reader.page.getByLabel("Search roster staff", { exact: true }).fill("Paging")
    await expect(reader.page.getByRole("row").filter({ hasText: /Paging/ })).toHaveCount(100)
    await reader.page.getByRole("button", { name: "Next staff page", exact: true }).click()
    await expect(reader.page.getByRole("row").filter({ hasText: "Paging 107" })).toBeVisible()
    await expect(reader.page.getByRole("row").filter({ hasText: /Paging/ })).toHaveCount(7)
    await reader.page.getByLabel("Search roster staff", { exact: true }).fill("Access staff")
    await expect(reader.page.getByRole("row").filter({ hasText: "Access staff" })).toBeVisible()
    await fixture.db.query('DELETE FROM "BusinessOfficeGrant" WHERE "tenantId"=$1 AND "userId"=$2', [fixture.slug, fixture.users.manager.id])
    await reader.page.getByRole("button", { name: "Refresh roster", exact: true }).click()
    await expect(reader.page.getByText("No permitted staff match this date range and search.", { exact: true })).toBeVisible()
    await expect(reader.page.getByRole("row").filter({ hasText: "Access staff" })).toHaveCount(0)
    await reader.page.screenshot({ path: "test-results/local-access/roster-read-revoked.png", fullPage: true })
  } finally { await reader?.context.close(); await admin.context.close(); await fixture.db.end() }
})

test("tenant-day frozen evidence is shown when the browser still considers that date today", async ({ browser }) => {
  const fixture = await seed(), admin = await login(browser, fixture.origin, fixture.users.admin.email, "Pacific/Honolulu")
  const profile = fixture.slug + "_saved"
  try {
    await fixture.db.query('UPDATE "AppSetting" SET "timeZone"=\'Pacific/Kiritimati\' WHERE "tenantId"=$1', [fixture.slug])
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Kiritimati", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date())
    const get = (key: string) => parts.find(part => part.type === key)!.value
    const day = new Date(`${get("year")}-${get("month")}-${get("day")}T00:00:00Z`); day.setUTCDate(day.getUTCDate() - 1)
    const key = day.toISOString().slice(0, 10)
    await fixture.db.query('INSERT INTO "StaffProfile"(id,"userId","schedulingMode","updatedAt") VALUES($1,$2,\'FLEXIBLE\',now())', [profile, fixture.users.staff.id])
    await fixture.db.query('INSERT INTO "StaffWorkplacePolicy"("tenantId","staffProfileId",version,"updatedAt") VALUES($1,$2,1,now())', [fixture.slug, profile])
    await fixture.db.query('INSERT INTO "StaffWorkplaceAssignment"(id,"tenantId","staffProfileId","officeId","updatedAt") SELECT $2,$1,$2,id,now() FROM "BusinessOffice" WHERE "tenantId"=$1 AND "isInitial"', [fixture.slug, profile])
    await fixture.db.query('INSERT INTO "StaffRosterHistoryDay"(id,"tenantId","officeId","staffProfileId",date,source,"templateName","startTime","endTime","paidMinutes","updatedAt") SELECT $2,$1,id,$2,$3,\'SCHEDULE\',\'Saved tenant day\',\'08:00\',\'16:00\',333,now() FROM "BusinessOffice" WHERE "tenantId"=$1 AND "isInitial"', [fixture.slug, profile, key])
    const read = async () => (await fixture.db.query('SELECT to_jsonb(h) row FROM "StaffRosterHistoryDay" h WHERE id=$1', [profile])).rows[0].row
    const before = await read()
    await admin.page.goto("/shifts/roster")
    await expect(admin.page.getByRole("row").filter({ hasText: "Access staff" })).toContainText("Saved tenant day")
    const data = await json(admin.context, `/api/shifts/roster?startDate=${key}&endDate=${key}`)
    expect(data.days[0].frozen).toBe(true); expect(data.days[0].paidMinutes).toBe(333)
    expect(await read()).toEqual(before)
    await admin.page.screenshot({ path: "test-results/local-access/roster-read-tenant-day.png", fullPage: true })
  } finally { await admin.context.close(); await fixture.db.end() }
})
