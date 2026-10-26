import { test, expect } from "@playwright/test"
import { seed, login, json } from "./fixtures"

test("booking forms capture office, retain source office and hide other offices after real sign-in", async ({ browser }) => {
  test.setTimeout(150_000)
  const f = await seed(), admin = await login(browser, f.origin, f.users.admin.email)
  let manager: typeof admin | undefined
  let staffDirectoryRequests = 0
  await admin.page.route("**/api/directory?**", route => { if (new URL(route.request().url()).searchParams.get("role") === "STAFF") { staffDirectoryRequests++; return route.fulfill({ status: 403, json: { error: "Generic staff directory not delegated." } }) } return route.continue() })
  try {
    const company = await json(admin.context, "/api/companies", 201, "POST", { name: "Booking browser", code: "BOOKING" })
    const east = await json(admin.context, "/api/offices", 201, "POST", { companyId: company.id, name: "East", code: "EAST" })
    const west = await json(admin.context, "/api/offices", 201, "POST", { companyId: company.id, name: "West", code: "WEST" })
    for (const [user, offices] of [[f.users.admin, [east.id, west.id]], [f.users.staff, [east.id]], [f.users.manager, [east.id]]] as const) {
      const current = await json(admin.context, `/api/access/users/${user.id}/offices`)
      await json(admin.context, `/api/access/users/${user.id}/offices`, 200, "PATCH", { version: current.version, officeIds: offices, companies: [], creationOfficeId: east.id })
    }
    const customer = f.slug + "_customer", service = f.slug + "_service", profile = f.slug + "_profile", staffB = f.slug + "_west_staff"
    await f.db.query('UPDATE "AppSetting" SET "timeZone"=\'UTC\' WHERE "tenantId"=$1', [f.slug])
    for (const [id, role, name] of [[customer, "CUSTOMER", "Booking customer"], [staffB, "STAFF", "West staff"]]) await f.db.query('INSERT INTO "User"(id,"tenantId",email,name,role,"updatedAt") VALUES($1,$2,$1||\'@example.test\',$3,$4,now())', [id, f.slug, name, role])
    await f.db.query('INSERT INTO "BusinessOfficePolicy"("tenantId","userId","creationOfficeId",version,"updatedAt") VALUES($1,$2,$3,1,now())', [f.slug, staffB, west.id])
    await f.db.query('INSERT INTO "BusinessOfficeGrant"("tenantId","userId","officeId") VALUES($1,$2,$3)', [f.slug, staffB, west.id])
    for (const [id, user, office] of [[profile, f.users.staff.id, east.id], [profile + "B", staffB, west.id]]) {
      await f.db.query('INSERT INTO "StaffProfile"(id,"userId","schedulingMode","updatedAt") VALUES($1,$2,\'FLEXIBLE\',now())', [id, user])
      await f.db.query('INSERT INTO "StaffWorkplacePolicy"("tenantId","staffProfileId",version,"updatedAt") VALUES($1,$2,1,now())', [f.slug, id])
      await f.db.query('INSERT INTO "StaffWorkplaceAssignment"(id,"tenantId","staffProfileId","officeId","updatedAt") VALUES($1,$2,$1,$3,now())', [id, f.slug, office])
    }
    await f.db.query('INSERT INTO "ServiceCategory"(id,"tenantId",name,"updatedAt") VALUES($1,$2,\'Consultation category\',now())', [service, f.slug])
    await f.db.query('INSERT INTO "Service"(id,"tenantId","categoryId",name,"durationMinutes","priceCents","updatedAt") VALUES($1,$2,$1,\'Office consultation\',60,5000,now())', [service, f.slug])
    async function fill() {
      const captured = admin.page.waitForResponse(r => new URL(r.url()).pathname === "/api/workspace/office" && r.request().method() === "GET")
      await admin.page.goto("/appointments/new"); await captured
      await admin.page.getByLabel("Customer", { exact: true }).click()
      await admin.page.getByRole("option", { name: /Booking customer/ }).click()
      await admin.page.getByLabel("Date", { exact: true }).fill("2036-02-05")
      await admin.page.getByLabel("Service", { exact: true }).click()
      await admin.page.getByRole("option", { name: "Office consultation (60m)", exact: true }).click()
      await admin.page.getByLabel("Attendant", { exact: true }).click()
      await admin.page.getByRole("option", { name: "Access staff", exact: true }).click()
      await expect(admin.page.getByRole("button", { name: "Save draft", exact: true })).toBeEnabled()
    }
    async function selectOffice(officeId: string) {
      const current = await json(admin.context, "/api/workspace/office")
      await json(admin.context, "/api/workspace/office", 200, "PATCH", { version: current.version, officeId })
    }
    await fill(); await selectOffice(west.id)
    const stale = admin.page.waitForResponse(r => new URL(r.url()).pathname === "/api/appointments/orders" && r.request().method() === "POST")
    await admin.page.getByRole("button", { name: "Save draft", exact: true }).click()
    const denied = await stale
    expect(denied.status()).toBe(409); expect(denied.request().headers()["x-office-id"]).toBe(east.id)
    await expect(admin.page.getByRole("main").getByRole("alert")).toHaveText("Office context changed; reload the creation form.")
    expect((await json(admin.context, "/api/appointments/orders")).total).toBe(0)
    await admin.page.screenshot({ path: "test-results/local-access/appointment-office-stale.png", fullPage: true })
    await selectOffice(east.id)
    admin.page.once("dialog", dialog => dialog.accept())
    await fill()
    const saved = admin.page.waitForResponse(r => new URL(r.url()).pathname === "/api/appointments/orders" && r.request().method() === "POST")
    await admin.page.getByRole("button", { name: "Save draft", exact: true }).click()
    const result = await saved; expect(result.status()).toBe(201)
    const order = (await result.json()).order
    await expect(admin.page).toHaveURL(new RegExp(`/appointments/${order.id}/edit$`))
    await expect(admin.page.getByText("Office: Booking browser / East", { exact: true })).toBeVisible()
    await selectOffice(west.id)
    const hidden = (await json(admin.context, "/api/appointments/orders", 201, "POST", { customerId: customer, appointmentDate: "2036-02-06", appointmentStartTime: "10:00", appointmentStartAt: "2036-02-06T10:00:00Z", status: "DRAFT", lines: [{ serviceId: service, staffId: staffB, quantity: 1, durationMinutes: 60, unitPriceCents: 5000, discountType: "NONE", discountValue: 0, taxIds: [], taxMode: "EXCLUSIVE" }], coupons: [], productLines: [] })).order
    await admin.page.getByRole("button", { name: "Edit booking", exact: true }).click()
    await admin.page.getByLabel("Internal note", { exact: true }).fill("Saved in original East office")
    const edited = admin.page.waitForResponse(r => new URL(r.url()).pathname === `/api/appointments/orders/${order.id}` && r.request().method() === "PATCH")
    await admin.page.getByRole("dialog").getByRole("button", { name: "Save draft", exact: true }).click()
    expect((await edited).status()).toBe(200)
    const retained = (await json(admin.context, `/api/appointments/orders/${order.id}`)).order
    expect(retained.officeId).toBe(east.id); expect(retained.totalCents).toBe(order.totalCents)
    manager = await login(browser, f.origin, f.users.manager.email)
    expect((await json(manager.context, "/api/appointments/orders")).items.map((x: { id: string }) => x.id)).toEqual([order.id])
    await json(manager.context, `/api/appointments/orders/${hidden.id}`, 404)
    expect((await manager.context.request.get(`/api/appointments/orders/${hidden.id}/invoice`)).status()).toBe(404)
    await manager.page.goto(`/appointments/${order.id}/edit`)
    await expect(manager.page.getByText("Office: Booking browser / East", { exact: true })).toBeVisible()
    await expect(manager.page.getByText("Saved in original East office", { exact: true })).toBeVisible()
    await manager.page.screenshot({ path: "test-results/local-access/appointment-office-source.png", fullPage: true })
    expect(staffDirectoryRequests).toBe(0)
    await f.db.query(`UPDATE "StaffWorkplaceAssignment" SET "endDate"='2036-02-04' WHERE "staffProfileId"=$1`, [profile])
    await manager.page.getByRole("button", { name: "Edit booking", exact: true }).click()
    await expect(manager.page.getByLabel("Attendant", { exact: true })).toContainText("Access staff")
    await expect(manager.page.getByText(/Saved or unavailable selection; changing the assignment requires current office and date coverage\./)).toBeVisible()
    await manager.page.getByLabel("Attendant", { exact: true }).scrollIntoViewIfNeeded()
    await manager.page.screenshot({ path: "test-results/local-access/appointment-retained-staff.png", fullPage: true })
    await manager.page.getByLabel("Internal note", { exact: true }).fill("Retained staff after transfer")
    const noted = manager.page.waitForResponse(r => new URL(r.url()).pathname === `/api/appointments/orders/${order.id}` && r.request().method() === "PATCH")
    await manager.page.getByRole("dialog").getByRole("button", { name: "Save draft", exact: true }).click()
    expect((await noted).status()).toBe(200)
    expect((await json(manager.context, `/api/appointments/orders/${order.id}`)).order.lines[0].staffProfile.user.id).toBe(f.users.staff.id)
    // Historical source visibility must not depend on today's assignment eligibility.
    for (const [id, staff, office] of [["east", profile, east.id], ["west", profile + "B", west.id]]) await f.db.query(`INSERT INTO "Appointment"(id,"tenantId","officeId","staffProfileId","customerId","serviceId","startAt","endAt","updatedAt") VALUES($1,$2,$3,$4,$5,$6,'2036-02-05 10:00','2036-02-05 11:00',now())`, [f.slug + id, f.slug, office, staff, customer, service])
    await admin.page.goto("/appointments")
    await admin.page.getByRole("button", { name: /^Filters/ }).click()
    await admin.page.getByLabel("Office filter", { exact: true }).click()
    await admin.page.getByRole("option", { name: "West / Booking browser", exact: true }).click()
    await expect(admin.page.getByRole("cell", { name: "Booking browser / West", exact: true })).toBeVisible()
    await expect(admin.page.getByRole("cell", { name: "Booking browser / East", exact: true })).toHaveCount(0)
    await admin.page.getByLabel("Staff filter", { exact: true }).click()
    await admin.page.getByRole("option", { name: "West staff", exact: true }).click()
    await admin.page.getByLabel("Office filter", { exact: true }).click()
    await admin.page.getByRole("option", { name: "East / Booking browser", exact: true }).click()
    await expect(admin.page.getByLabel("Staff filter", { exact: true })).toContainText("All staff")
    await expect(admin.page.getByRole("cell", { name: "Booking browser / East", exact: true })).toBeVisible()
    await expect(admin.page.getByRole("cell", { name: "Booking browser / West", exact: true })).toHaveCount(0)
    await expect(admin.page.getByLabel("Office filter", { exact: true })).toContainText("East / Booking browser")
    await admin.page.screenshot({ path: "test-results/local-access/appointment-office-filters.png", fullPage: true })

  } finally { await manager?.context.close(); await admin.context.close(); await f.db.end() }
})
