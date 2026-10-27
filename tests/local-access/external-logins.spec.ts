import { test, expect } from "@playwright/test"
import { seed, login, json, password, assignOffices } from "./fixtures"
import { defaultRecordRules } from "@/platform/access/rules"
import { allPermissions } from "@/platform/access/catalog"

test("external business login uses explicit grants, stays outside employee workflows and is blocked by collaborator archive", async ({ browser }) => {
  test.setTimeout(150_000)
  const f = await seed(), admin = await login(browser, f.origin, f.users.admin.email)
  let external: typeof admin | undefined, restored: typeof admin | undefined
  const rejected = await browser.newContext({ baseURL: f.origin })
  try {
    const office = (await json(admin.context, "/api/offices")).items[0]
    await assignOffices(admin.context, f.users.admin.id, [office.id], office.id)
    const collaborator = await json(admin.context, "/api/collaborators", 201, "POST", { name: "Login partner", code: "LOGIN", supervisorUserId: f.users.manager.id })
    const role = await json(admin.context, "/api/access/roles", 201, "POST", { name: "Explicit partner grants", permissions: allPermissions })
    const rules = defaultRecordRules();rules["enquiries.read"] = "OWN";rules["contacts.read"] = "ALL"
    const email = `partner@${f.slug}.test`, user = (await json(admin.context, "/api/users", 200, "POST", { name: "External partner account", email, password, role: "STAFF", collaboratorId: collaborator.id, accessRoleIds: [role.id], recordRules: rules, officeAccess: { officeIds: [office.id], companies: [], creationOfficeId: office.id } })).user
    const contact = await json(admin.context, "/api/crm/contacts", 201, "POST", { name: "Partner contact" })
    const lead = await json(admin.context, "/api/crm/enquiries", 201, "POST", { title: "Partner assigned lead", contactId: contact.id, assignedUserId: user.id })
    await json(admin.context, "/api/crm/enquiries", 201, "POST", { title: "Internal enquiry", contactId: contact.id, assignedUserId: f.users.admin.id })
    external = await login(browser, f.origin, email);await external.page.goto("/crm/enquiries")
    await expect(external.page.getByRole("link", { name: "Partner assigned lead", exact: true })).toBeVisible()
    await expect(external.page.getByRole("link", { name: "Internal enquiry", exact: true })).toHaveCount(0)
    await json(external.context, "/api/users", 403);await json(external.context, "/api/shifts/workplaces?staffId=" + user.id, 403)
    const modules = await json(external.context, "/api/modules")
    expect(modules.permissions).not.toContain("users.read");expect(modules.permissions).not.toContain("shiftRoster.read");expect(modules.permissions).not.toContain("leaveRequests.read")
    await admin.page.goto(`/users/${user.id}`);await expect(admin.page.getByRole("heading", { name: "External partner account", exact: true })).toBeVisible()
    await expect(admin.page.getByRole("button", { name: "Staff profile", exact: true })).toHaveCount(0)
    await admin.page.goto(`/users/${user.id}/staff`);await expect(admin.page.getByText("This user is not eligible for a staff profile.", { exact: true })).toBeVisible()
    await admin.page.goto(`/users/collaborators/${collaborator.id}`);await expect(admin.page.getByLabel("Collaborator name", { exact: true })).toHaveValue("Login partner")
    await admin.page.getByRole("checkbox", { name: "Archived", exact: true }).check();await admin.page.getByRole("button", { name: "Save changes", exact: true }).click()
    await expect(admin.page.getByRole("heading", { name: "External collaborators", exact: true })).toBeVisible()
    await json(external.context, `/api/crm/enquiries/${lead.id}`, 403)
    await external.page.reload();await expect(external.page).toHaveURL(/auth\/signin/)
    const page = await rejected.newPage();await page.goto("/auth/signin");await page.getByLabel("Email", { exact: true }).fill(email);await page.getByLabel("Password", { exact: true }).fill(password);await page.getByRole("button", { name: "Sign in", exact: true }).click()
    await expect(page.getByText("Invalid email or password.", { exact: true })).toBeVisible()
    const archived = await json(admin.context, `/api/collaborators/${collaborator.id}`)
    await json(admin.context, `/api/collaborators/${collaborator.id}`, 200, "PATCH", { version: archived.version, archived: false })
    expect((await json(admin.context, `/api/collaborators/${collaborator.id}/logins`)).items[0].status).toBe("SUSPENDED")
    await json(admin.context, `/api/users/${user.id}`, 200, "PATCH", { status: "ACTIVE" })
    restored = await login(browser, f.origin, email);await json(restored.context, `/api/crm/enquiries/${lead.id}`)
    expect((await f.db.query('SELECT count(*)::int n FROM "StaffProfile" WHERE "userId"=$1', [user.id])).rows[0].n).toBe(0)
  } finally { await restored?.context.close();await external?.context.close();await rejected.close();await admin.context.close();await f.db.end() }
})

test("external invitation sets up a distinct login once and archive permanently expires pending links", async ({ browser }) => {
  test.setTimeout(90_000)
  const f = await seed(), admin = await login(browser, f.origin, f.users.admin.email), publicContext = await browser.newContext({ baseURL: f.origin })
  try {
    const collaborator = await json(admin.context, "/api/collaborators", 201, "POST", { name: "Invited agency", code: "INVITED", supervisorUserId: f.users.manager.id })
    const email = `invited-partner@${f.slug}.test`
    const invite = await json(admin.context, "/api/invites", 201, "POST", { email, role: "STAFF", delivery: "LINK", collaboratorId: collaborator.id })
    const page = await publicContext.newPage();await page.goto(invite.inviteUrl)
    await page.getByLabel("Full name", { exact: true }).fill("Invited external login");await page.getByLabel("Password", { exact: true }).fill(password);await page.getByRole("button", { name: "Create account", exact: true }).click()
    await page.getByRole("button", { name: "Go to sign in", exact: true }).click();await expect(page).toHaveURL(/auth\/signin/)
    const linked = await json(admin.context, `/api/collaborators/${collaborator.id}/logins`);expect(linked.total).toBe(1);expect(linked.items[0].email).toBe(email)
    const pending = await json(admin.context, "/api/invites", 201, "POST", { email: `pending-partner@${f.slug}.test`, role: "STAFF", delivery: "LINK", collaboratorId: collaborator.id })
    const archived = await json(admin.context, `/api/collaborators/${collaborator.id}`, 200, "PATCH", { version: collaborator.version, archived: true })
    await json(admin.context, `/api/collaborators/${collaborator.id}`, 200, "PATCH", { version: archived.version, archived: false })
    await page.goto(pending.inviteUrl);await page.getByLabel("Password", { exact: true }).fill(password);await page.getByRole("button", { name: "Create account", exact: true }).click()
    await expect(page.getByText("Invitation is invalid or expired. Ask your administrator for a new invitation.", { exact: true })).toBeVisible()
  } finally { await publicContext.close();await admin.context.close();await f.db.end() }
})
