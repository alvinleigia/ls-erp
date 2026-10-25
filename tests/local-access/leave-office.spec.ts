import { test, expect } from "@playwright/test"
import { seed, login, json, assignProfiles } from "./fixtures"

test("leave forms retain captured office identity and private history stays scoped after transfer", async ({ browser }) => {
  test.setTimeout(150_000)
  const fixture = await seed(), admin = await login(browser, fixture.origin, fixture.users.admin.email)
  let staff: Awaited<ReturnType<typeof login>> | undefined, manager: typeof staff
  try {
    const company = await json(admin.context, "/api/companies", 201, "POST", { name: "Leave browser offices", code: "LEAVE" })
    const a = await json(admin.context, "/api/offices", 201, "POST", { companyId: company.id, name: "East", code: "EAST" })
    const b = await json(admin.context, "/api/offices", 201, "POST", { companyId: company.id, name: "West", code: "WEST" })
    const memberPath = `/api/access/users/${fixture.users.staff.id}/offices`
    await json(admin.context, memberPath, 200, "PATCH", { version: 0, officeIds: [a.id, b.id], companies: [], creationOfficeId: a.id })
    await json(admin.context, `/api/access/users/${fixture.users.manager.id}/offices`, 200, "PATCH", { version: 0, officeIds: [a.id], companies: [], creationOfficeId: a.id })
    const access = await json(admin.context, `/api/access/users/${fixture.users.staff.id}`)
    const roleIds = (await fixture.db.query('SELECT "roleId" FROM "TenantRoleAssignment" WHERE "tenantId"=$1 AND "userId"=$2', [fixture.slug, fixture.users.staff.id])).rows.map(row => row.roleId)
    await assignProfiles(admin.context, fixture.users.staff.id, roleIds, { rules: { ...access.accessPolicy.rules, "shiftRoster.read": "ALL" } })
    const profile = `${fixture.slug}_leave_profile`, definition = `${fixture.slug}_leave_definition`
    await fixture.db.query('INSERT INTO "StaffProfile"(id,"userId","managerUserId","schedulingMode","updatedAt") VALUES($1,$2,$3,\'FLEXIBLE\',now())', [profile, fixture.users.staff.id, fixture.users.manager.id])
    await fixture.db.query('INSERT INTO "StaffWorkplacePolicy"("tenantId","staffProfileId",version,"updatedAt") VALUES($1,$2,1,now())', [fixture.slug, profile])
    await fixture.db.query('INSERT INTO "StaffWorkplaceAssignment"(id,"tenantId","staffProfileId","officeId","updatedAt") VALUES($2,$1,$2,$3,now())', [fixture.slug, profile, a.id])
    await fixture.db.query('INSERT INTO "LeaveDefinition"(id,"tenantId",code,name,"leaveType","updatedAt") VALUES($1,$2,\'NATIVE\',\'Native office leave\',\'PAID\',now())', [definition, fixture.slug])
    await fixture.db.query('INSERT INTO "LeaveGroup"(id,"tenantId",code,name,"assignmentMode","updatedAt") VALUES($1,$2,\'ALL\',\'All staff\',\'ALL_STAFF\',now())', [definition, fixture.slug])
    await fixture.db.query('INSERT INTO "LeaveGroupLeave"(id,"leaveGroupId","leaveDefinitionId") VALUES($1,$1,$1)', [definition])
    staff = await login(browser, fixture.origin, fixture.users.staff.email)
    manager = await login(browser, fixture.origin, fixture.users.manager.email)
    await staff.page.goto("/leaves/requests")
    async function fillRequest() {
      const captured = staff!.page.waitForResponse(response => new URL(response.url()).pathname === "/api/workspace/office" && response.request().method() === "GET")
      await staff!.page.getByRole("button", { name: "Apply leave", exact: true }).click()
      await captured
      await staff!.page.getByLabel("Leave type", { exact: true }).click()
      await staff!.page.getByRole("option", { name: "NATIVE - Native office leave", exact: true }).click()
      await staff!.page.getByLabel("Start date", { exact: true }).fill("2036-01-07")
      await staff!.page.getByLabel("End date", { exact: true }).fill("2036-01-07")
      await staff!.page.getByLabel("Reason", { exact: true }).fill("Private browser request")
    }
    await fillRequest()
    const context = await json(staff.context, "/api/workspace/office")
    await json(staff.context, "/api/workspace/office", 200, "PATCH", { version: context.version, officeId: b.id })
    const stale = staff.page.waitForResponse(response => new URL(response.url()).pathname === "/api/leaves/requests" && response.request().method() === "POST")
    await staff.page.getByRole("button", { name: "Submit request", exact: true }).click()
    const denied = await stale
    expect(denied.status()).toBe(409)
    expect(denied.request().headers()["x-office-id"]).toBe(a.id)
    await expect(staff.page.getByRole("alert")).toHaveText("Office context changed; reload the creation form.")
    expect((await fixture.db.query('SELECT count(*)::int n FROM "LeaveRequest" WHERE "tenantId"=$1', [fixture.slug])).rows[0].n).toBe(0)
    staff.page.once("dialog", dialog => dialog.accept())
    await staff.page.reload()
    await fillRequest()
    const saved = staff.page.waitForResponse(response => new URL(response.url()).pathname === "/api/leaves/requests" && response.request().method() === "POST")
    await staff.page.getByRole("button", { name: "Submit request", exact: true }).click()
    const response = await saved
    expect(response.status()).toBe(201)
    await expect(staff.page.getByText("Private browser request", { exact: true })).toBeVisible()
    const record = (await json(staff.context, "/api/leaves/requests?mineOnly=true")).items[0]
    expect(record.officeId).toBe(b.id)
    await json(manager.context, `/api/leaves/requests/${record.id}`, 404)
    const current = await json(admin.context, memberPath)
    await json(admin.context, memberPath, 200, "PATCH", { version: current.version, officeIds: [a.id], companies: [], creationOfficeId: a.id })
    expect((await json(staff.context, `/api/leaves/requests/${record.id}`)).item.officeId).toBe(b.id)
    const leave = `${fixture.slug}_past_leave`
    await fixture.db.query('INSERT INTO "LeaveRequest"(id,"tenantId","officeId","staffProfileId","leaveDefinitionId","startDate","endDate","daysCount",status,reason,"updatedAt") VALUES($1,$2,$3,$4,$5,\'2020-01-06\',\'2020-01-06\',1,\'APPROVED\',\'Private browser history\',now())', [leave, fixture.slug, b.id, profile, definition])
    const path = `/api/shifts/history?startDate=2020-01-06&endDate=2020-01-06&staffIds=${fixture.users.staff.id}`
    const generic = (await json(manager.context, path)).items[0]
    expect(generic.source).toBe("UNAVAILABLE"); expect(generic.leaveReason).toBeNull()
    const own = (await json(staff.context, path)).items[0]
    expect(own.source).toBe("LEAVE"); expect(own.leaveReason).toBe("Private browser history")
    await expect(staff.page.getByText("Private browser request", { exact: true })).toBeVisible()
    await staff.page.screenshot({ path: "test-results/local-access/leave-office-request.png", fullPage: true })
  } finally {
    await staff?.context.close(); await manager?.context.close(); await admin.context.close(); await fixture.db.end()
  }
})
