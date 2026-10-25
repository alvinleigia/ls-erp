import { test, expect } from "@playwright/test"
import { seed, login, json, password } from "./fixtures"

test("new account office grants survive real login and bound its creation context", async ({ browser }) => {
  test.setTimeout(120_000)
  const fixture = await seed(), admin = await login(browser, fixture.origin, fixture.users.admin.email)
  let created: Awaited<ReturnType<typeof login>> | undefined
  let platform: Awaited<ReturnType<typeof login>> | undefined
  let tenantAdmin: Awaited<ReturnType<typeof login>> | undefined
  try {
    const company = (await json(admin.context, "/api/companies")).items[0]
    const east = await json(admin.context, "/api/offices", 201, "POST", { name: "Provision east", code: "PROVISION_EAST", companyId: company.id })
    const west = await json(admin.context, "/api/offices", 201, "POST", { name: "Provision west", code: "PROVISION_WEST", companyId: company.id })
    const roleIds = (await fixture.db.query('SELECT "roleId" FROM "TenantRoleAssignment" WHERE "tenantId"=$1 AND "userId"=$2', [fixture.slug, fixture.users.staff.id])).rows.map(row => row.roleId)
    const email = `provisioned@${fixture.slug}.test`
    const { user } = await json(admin.context, "/api/users", 200, "POST", { name: "Provisioned staff", email, password, role: "STAFF", accessRoleIds: roleIds, officeAccess: { creationOfficeId: east.id, officeIds: [east.id], companies: [] } })
    created = await login(browser, fixture.origin, email)
    expect((await json(created.context, "/api/workspace/offices")).items.map((office: { id: string }) => office.id)).toEqual([east.id])
    const context = await json(created.context, "/api/workspace/office")
    expect(context.creationOffice.id).toBe(east.id)
    await json(created.context, "/api/workspace/office", 403, "PATCH", { officeId: west.id, version: context.version })
    const contact = await json(created.context, "/api/crm/contacts", 201, "POST", { name: "Office provisioning customer" })
    const enquiry = await json(created.context, "/api/crm/enquiries", 201, "POST", { title: "Provisioned office enquiry", contactId: contact.id, assignedUserId: user.id })
    const saved = (await fixture.db.query('SELECT "officeId" FROM "CrmEnquiry" WHERE id=$1', [enquiry.id])).rows[0]
    expect(saved.officeId).toBe(east.id)
    await created.page.goto(`/crm/enquiries/${enquiry.id}`)
    await expect(created.page.getByRole("heading", { name: "Provisioned office enquiry", exact: true })).toBeVisible()
    const membership = await json(admin.context, `/api/access/users/${user.id}/offices`)
    await json(admin.context, `/api/access/users/${user.id}/offices`, 200, "PATCH", { version: membership.version, creationOfficeId: null, officeIds: [], companies: [] })
    await json(created.context, `/api/crm/enquiries/${enquiry.id}`, 404)
    expect((await json(created.context, "/api/workspace/office")).creationOffice).toBeNull()

    platform = await login(browser, "http://localhost:3108", fixture.users.platform.email)
    const slug = fixture.slug + "-provisioned", adminEmail = `tenant-admin@${slug}.test`
    const tenant = await json(platform.context, "/api/tenants", 201, "POST", { name: "Provisioned business", slug, adminName: "New tenant admin", adminEmail, adminPassword: password, modules: ["crm"] })
    tenantAdmin = await login(browser, `http://${slug}.localhost:3108`, adminEmail)
    const office = await json(tenantAdmin.context, "/api/workspace/office")
    expect(office.creationOffice.id).toBeTruthy()
    const newContact = await json(tenantAdmin.context, "/api/crm/contacts", 201, "POST", { name: "New tenant customer" })
    const newEnquiry = await json(tenantAdmin.context, "/api/crm/enquiries", 201, "POST", { title: "New tenant initial office", contactId: newContact.id, assignedUserId: tenant.admin.id })
    expect((await fixture.db.query('SELECT "officeId" FROM "CrmEnquiry" WHERE id=$1', [newEnquiry.id])).rows[0].officeId).toBe(office.creationOffice.id)
  } finally { await tenantAdmin?.context.close(); await platform?.context.close(); await created?.context.close(); await admin.context.close(); await fixture.db.end() }
})
