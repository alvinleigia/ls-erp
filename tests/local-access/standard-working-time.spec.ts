import { test, expect } from "@playwright/test"
import { seed, login, json, assignProfiles, assignOffices } from "./fixtures"

test("hidden standard assignments constrain booking and shared-template edits without granting source access", async ({ browser }) => {
  test.setTimeout(150_000)
  const fixture = await seed(), admin = await login(browser, fixture.origin, fixture.users.admin.email)
  let scheduler: typeof admin | undefined
  const profile = fixture.slug + "_standard_profile", customer = fixture.slug + "_customer", service = fixture.slug + "_service", template = fixture.slug + "_late", hidden = "standard_browser_hidden_" + fixture.slug
  try {
    const office = (await fixture.db.query('SELECT id FROM "BusinessOffice" WHERE "tenantId"=$1 AND "isInitial"', [fixture.slug])).rows[0]
    await assignOffices(admin.context, fixture.users.admin.id, [office.id], office.id)
    await assignOffices(admin.context, fixture.users.staff.id, [office.id], office.id)
    const access = await json(admin.context, `/api/access/users/${fixture.users.staff.id}`)
    const roles = (await fixture.db.query('SELECT "roleId" FROM "TenantRoleAssignment" WHERE "userId"=$1', [fixture.users.staff.id])).rows.map(row => row.roleId)
    await assignProfiles(admin.context, fixture.users.staff.id, roles, { rules: { ...access.accessPolicy.rules, "appointments.read": "ALL", "appointments.create": "ALL", "services.read": "ALL", "shiftSchedules.read": "NONE", "shiftTemplates.read": "NONE" } })
    await fixture.db.query('UPDATE "AppSetting" SET "timeZone"=\'UTC\' WHERE "tenantId"=$1', [fixture.slug])
    await fixture.db.query('INSERT INTO "StaffProfile"(id,"userId","updatedAt") VALUES($1,$2,now())', [profile, fixture.users.staff.id])
    await fixture.db.query('INSERT INTO "StaffWorkplacePolicy"("tenantId","staffProfileId",version,"updatedAt") VALUES($1,$2,1,now())', [fixture.slug, profile])
    await fixture.db.query('INSERT INTO "StaffWorkplaceAssignment"(id,"tenantId","staffProfileId","officeId","updatedAt") SELECT $2,$1,$2,id,now() FROM "BusinessOffice" WHERE "tenantId"=$1 AND "isInitial"', [fixture.slug, profile])
    await fixture.db.query('INSERT INTO "User"(id,"tenantId",email,role,"updatedAt") VALUES($1,$2,$3,\'CUSTOMER\',now())', [customer, fixture.slug, `${customer}@example.test`])
    await fixture.db.query('INSERT INTO "ServiceCategory"(id,"tenantId",name,"updatedAt") VALUES($1,$2,$1,now())', [service, fixture.slug])
    await fixture.db.query('INSERT INTO "Service"(id,"tenantId","categoryId",name,"durationMinutes","priceCents","updatedAt") VALUES($1,$2,$1,\'Working-time consultation\',60,1000,now())', [service, fixture.slug])
    for (const [id, start, end] of [[template, "12:00", "20:00"], [template + "_default", "09:00", "17:00"]]) await fixture.db.query('INSERT INTO "ShiftTemplate"(id,"tenantId",name,"startTime","endTime","updatedAt") VALUES($1,$2,$1,$3,$4,now())', [id, fixture.slug, start, end])
    for (const [id, isDefault, source] of [[hidden, false, template], [hidden + "_visible", true, template + "_default"]] as const) {
      await fixture.db.query('INSERT INTO "ShiftSchedule"(id,"tenantId","officeId",name,"isDefault","startDate","weekOffDay1","weekOff2Weeks","updatedAt") VALUES($1,$2,(SELECT id FROM "BusinessOffice" WHERE "tenantId"=$2 AND "isInitial"),$1,$3,\'2035-01-01\',\'SUNDAY\',ARRAY[]::integer[],now())', [id, fixture.slug, isDefault])
      await fixture.db.query('INSERT INTO "ShiftScheduleBlock"(id,"scheduleId","templateId","repeatDays") VALUES($1,$1,$2,1)', [id, source])
    }
    await fixture.db.query('INSERT INTO "StaffScheduleAssignment"(id,"staffProfileId","scheduleId","startDate","updatedAt") VALUES($1,$2,$1,\'2035-01-01\',now())', [hidden, profile])
    await fixture.db.query('CREATE POLICY test_browser_standard_privacy ON "ShiftSchedule" AS RESTRICTIVE FOR SELECT USING(id NOT LIKE \'standard_browser_hidden_%\' OR id LIKE \'%_visible\')')
    await fixture.db.query('CREATE POLICY test_browser_standard_privacy ON "StaffScheduleAssignment" AS RESTRICTIVE FOR SELECT USING(id NOT LIKE \'standard_browser_hidden_%\')')
    scheduler = await login(browser, fixture.origin, fixture.users.staff.email)
    await json(scheduler.context, "/api/shifts/schedules", 403)
    const input = { customerId: customer, serviceId: service, staffId: fixture.users.staff.id, startAt: "2036-02-04T10:00:00Z" }
    const outside = await json(scheduler.context, "/api/appointments/availability", 200, "POST", input)
    expect(outside.available).toBe(false); expect(outside.reason).toContain("outside staff working hours")
    await json(scheduler.context, "/api/appointments", 409, "POST", input)
    await json(admin.context, "/api/modules", 200, "PATCH", { key: "shifts", enabled: false })
    const valid = { ...input, startAt: "2036-02-04T18:00:00Z" }
    expect(await json(scheduler.context, "/api/appointments/availability", 200, "POST", valid)).toEqual({ available: true })
    await json(scheduler.context, "/api/appointments", 201, "POST", valid)
    await json(admin.context, "/api/modules", 200, "PATCH", { key: "shifts", enabled: true })
    const blocked = await json(admin.context, `/api/shifts/templates/${template}`, 409, "PATCH", { name: "Late shift", startTime: "12:00", endTime: "17:00", breaks: [] })
    expect(blocked.error).toContain("conflicts with existing appointments")
    expect((await fixture.db.query('SELECT "endTime" FROM "ShiftTemplate" WHERE id=$1', [template])).rows[0].endTime).toBe("20:00")
    for (const secret of [hidden, template]) expect(JSON.stringify({ outside, blocked })).not.toContain(secret)
    await json(admin.context, `/api/users/${fixture.users.staff.id}`, 200, "PATCH", { status: "SUSPENDED" })
    await json(scheduler.context, "/api/appointments/availability", 403, "POST", valid)
  } finally {
    await fixture.db.query('DROP POLICY IF EXISTS test_browser_standard_privacy ON "ShiftSchedule"; DROP POLICY IF EXISTS test_browser_standard_privacy ON "StaffScheduleAssignment"')
    await scheduler?.context.close(); await admin.context.close(); await fixture.db.end()
  }
})
