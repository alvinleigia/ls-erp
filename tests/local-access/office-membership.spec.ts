import { test, expect } from "@playwright/test"
import { seed, login, json } from "./fixtures"

test("authenticated office APIs enforce explicit memberships and fresh revocation", async ({ browser }) => {
  test.setTimeout(150_000)
  const fixture = await seed(), admin = await login(browser, fixture.origin, fixture.users.admin.email)
  let staff: Awaited<ReturnType<typeof login>> | undefined
  let other: Awaited<ReturnType<typeof login>> | undefined
  try {
    const parent = await json(admin.context, "/api/companies", 201, "POST", { name: "Office API parent", code: "OFFICE_PARENT" })
    const child = await json(admin.context, "/api/companies", 201, "POST", { name: "Office API child", code: "OFFICE_CHILD", parentId: parent.id })
    const a = await json(admin.context, "/api/offices", 201, "POST", { name: "East office", code: "EAST", companyId: parent.id })
    const b = await json(admin.context, "/api/offices", 201, "POST", { name: "West office", code: "WEST", companyId: child.id })
    const path = `/api/access/users/${fixture.users.staff.id}/offices`
    expect((await json(admin.context, path)).version).toBe(0)
    const first = await json(admin.context, path, 200, "PATCH", { version: 0, creationOfficeId: a.id, officeIds: [], companies: [{ companyId: parent.id, includeSubsidiaries: false }] })
    staff = await login(browser, fixture.origin, fixture.users.staff.email)
    expect((await json(staff.context, "/api/workspace/offices")).items.map((o: { id: string }) => o.id)).toEqual([a.id])
    await json(staff.context, path, 403)
    await json(staff.context, "/api/workspace/office", 403, "PATCH", { version: first.version, officeId: b.id })
    const broader = await json(admin.context, path, 200, "PATCH", { version: first.version, creationOfficeId: a.id, officeIds: [], companies: [{ companyId: parent.id, includeSubsidiaries: true }] })
    expect((await json(staff.context, "/api/workspace/offices")).total).toBe(2)
    const selected = await json(staff.context, "/api/workspace/office", 200, "PATCH", { version: broader.version, officeId: b.id })
    expect((await json(staff.context, "/api/workspace/office")).creationOffice.id).toBe(b.id)
    await json(admin.context, path, 409, "PATCH", { version: broader.version, creationOfficeId: null, officeIds: [], companies: [] })
    const revoked = await json(admin.context, path, 200, "PATCH", { version: selected.version, creationOfficeId: null, officeIds: [], companies: [] })
    expect((await json(staff.context, "/api/workspace/offices")).total).toBe(0)
    expect((await json(staff.context, "/api/workspace/office")).creationOffice).toBeNull()
    await json(staff.context, "/api/workspace/office", 403, "PATCH", { version: revoked.version, officeId: a.id })
    other = await login(browser, `http://${fixture.otherSlug}.localhost:3108`, fixture.users.other.email)
    const foreign = (await json(other.context, "/api/offices")).items[0]
    await json(admin.context, path, 400, "PATCH", { version: revoked.version, creationOfficeId: foreign.id, officeIds: [foreign.id], companies: [] })
    await json(other.context, path, 404)
    await json(admin.context, path, 400, "PATCH", { version: revoked.version, creationOfficeId: null, officeIds: [a.id, a.id], companies: [] })
    await json(admin.context, `/api/users/${fixture.users.staff.id}`, 200, "PATCH", { status: "SUSPENDED" })
    await json(staff.context, "/api/workspace/offices", 403)
    await json(admin.context, `/api/users/${fixture.users.staff.id}`, 200, "PATCH", { status: "ACTIVE" })
    expect((await json(staff.context, "/api/workspace/offices")).total).toBe(0)
  } finally { await other?.context.close(); await staff?.context.close(); await admin.context.close(); await fixture.db.end() }
})
