import { test, expect } from "@playwright/test"
import { seed, login, json, assignProfiles } from "./fixtures"

test("hidden leave and bookings block authenticated scheduling without revealing private details", async ({ browser }) => {
  const fixture = await seed(), admin = await login(browser, fixture.origin, fixture.users.admin.email)
  let staff: Awaited<ReturnType<typeof login>> | undefined
  const profile = `${fixture.slug}_busy_profile`, definition = `${fixture.slug}_private_definition`, leave = `availability_hidden_${fixture.slug}`, service = `${fixture.slug}_busy_service`, customer = `${fixture.slug}_busy_customer`
  try {
    const roleIds = (await fixture.db.query('SELECT "roleId" FROM "TenantRoleAssignment" WHERE "tenantId"=$1 AND "userId"=$2', [fixture.slug, fixture.users.staff.id])).rows.map(row => row.roleId)
    const current = await json(admin.context, `/api/access/users/${fixture.users.staff.id}`)
    await assignProfiles(admin.context, fixture.users.staff.id, roleIds, { rules: { ...current.accessPolicy.rules, "appointments.read": "ALL", "appointments.create": "ALL", "services.read": "ALL" } })
    await fixture.db.query('INSERT INTO "StaffProfile"(id,"userId","schedulingMode","updatedAt") VALUES($1,$2,\'FLEXIBLE\',now())', [profile, fixture.users.staff.id])
    await fixture.db.query('INSERT INTO "User"(id,"tenantId",email,name,role,"updatedAt") VALUES($1,$2,$3,\'Availability customer\',\'CUSTOMER\',now())', [customer, fixture.slug, `busy-customer@${fixture.slug}.test`])
    await fixture.db.query('INSERT INTO "LeaveDefinition"(id,"tenantId",code,name,"leaveType","updatedAt") VALUES($1,$2,\'PRIVATE_CODE\',\'Private leave classification\',\'PAID\',now())', [definition, fixture.slug])
    await fixture.db.query('INSERT INTO "LeaveRequest"(id,"tenantId","staffProfileId","leaveDefinitionId","startDate","endDate","daysCount",status,reason,"updatedAt") VALUES($1,$2,$3,$4,\'2035-01-10\',\'2035-01-11\',2,\'APPROVED\',\'Private medical reason\',now())', [leave, fixture.slug, profile, definition])
    await fixture.db.query('INSERT INTO "ServiceCategory"(id,"tenantId",name,"updatedAt") VALUES($1,$2,\'Busy checks\',now())', [service + "_category", fixture.slug])
    await fixture.db.query('INSERT INTO "Service"(id,"tenantId","categoryId",name,"durationMinutes","priceCents","updatedAt") VALUES($1,$2,$3,\'Consultation\',60,1000,now())', [service, fixture.slug, service + "_category"])
    for (const date of ["2035-01-10", "2035-01-11", "2035-01-12"]) await fixture.db.query('INSERT INTO "StaffFlexibleAvailability"(id,"staffProfileId",date,"startTime","endTime","updatedAt") VALUES($1,$2,$3,\'09:00\',\'17:00\',now())', [profile + date, profile, date])
    // Simulate the source visibility that upcoming office RLS will impose.
    await fixture.db.query('CREATE POLICY test_browser_leave_privacy ON "LeaveRequest" AS RESTRICTIVE FOR SELECT USING (id NOT LIKE \'availability_hidden_%\')')
    staff = await login(browser, fixture.origin, fixture.users.staff.email)
    await json(staff.context, `/api/leaves/requests/${leave}`, 404)
    await json(admin.context, "/api/modules", 200, "PATCH", { key: "leaves", enabled: false })
    const input = { customerId: customer, serviceId: service, staffId: fixture.users.staff.id, startAt: "2035-01-10T10:00:00Z" }
    const unavailable = await json(staff.context, "/api/appointments/availability", 200, "POST", input)
    expect(unavailable).toEqual({ available: false, reason: "Staff member is unavailable on this date." })
    const failed = await json(staff.context, "/api/appointments", 409, "POST", input)
    expect(failed.error).toBe("Staff member is unavailable on this date.")
    for (const secret of ["PRIVATE_CODE", "Private leave classification", "Private medical reason", leave]) expect(JSON.stringify({ unavailable, failed })).not.toContain(secret)
    const free = { ...input, startAt: "2035-01-12T10:00:00Z" }
    expect(await json(staff.context, "/api/appointments/availability", 200, "POST", free)).toEqual({ available: true })
    const created = await json(staff.context, "/api/appointments", 201, "POST", free)
    expect(created.appointment.id).toBeTruthy()
    const policy = await fixture.db.query("SELECT format('CREATE POLICY test_browser_booking_privacy ON \"Appointment\" AS RESTRICTIVE FOR SELECT USING (id<>%L)', $1::text) statement", [created.appointment.id])
    await fixture.db.query(policy.rows[0].statement)
    await json(staff.context, `/api/appointments/${created.appointment.id}`, 404)
    const occupied = await json(staff.context, "/api/appointments/availability", 200, "POST", free)
    expect(occupied).toEqual({ available: false, reason: "Staff member already has an appointment in this time range." })
    const duplicate = await json(staff.context, "/api/appointments", 409, "POST", free)
    expect(duplicate.error).toBe(occupied.reason)
    expect(JSON.stringify({ occupied, duplicate })).not.toContain(created.appointment.id)
    const plan = await json(admin.context, "/api/shifts/flexible-slots", 409, "POST", { staffId: fixture.users.staff.id, date: "2035-01-12", slots: [{ startTime: "09:00", endTime: "10:00" }] })
    expect(plan.conflicts).toEqual([])
    expect(plan.conflictCount).toBe(1)
    expect((await fixture.db.query('SELECT "endTime" FROM "StaffFlexibleAvailability" WHERE id=$1', [profile + "2035-01-12"])).rows[0].endTime).toBe("17:00")
    expect((await fixture.db.query('SELECT count(*)::int n FROM "Appointment" WHERE "tenantId"=$1', [fixture.slug])).rows[0].n).toBe(1)
    expect((await fixture.db.query('SELECT reason FROM "LeaveRequest" WHERE id=$1', [leave])).rows[0].reason).toBe("Private medical reason")
    await json(admin.context, `/api/users/${fixture.users.staff.id}`, 200, "PATCH", { status: "SUSPENDED" })
    await json(staff.context, "/api/appointments/availability", 403, "POST", free)
  } finally {
    await fixture.db.query('DROP POLICY IF EXISTS test_browser_booking_privacy ON "Appointment"')
    await fixture.db.query('DROP POLICY IF EXISTS test_browser_leave_privacy ON "LeaveRequest"')
    await staff?.context.close(); await admin.context.close(); await fixture.db.end()
  }
})
