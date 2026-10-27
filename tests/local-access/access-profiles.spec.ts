import { defaultRecordRules } from "@/platform/access/rules"
import { test, expect } from "@playwright/test"
import { seed, login, json, password, assignOffices } from "./fixtures"
import { moduleProfileTemplates } from "@/platform/access/profiles"

test("module profiles compose through user creation and the assignment editor", async ({ browser }, info) => {
  test.setTimeout(150_000)
  const fixture = await seed(), admin = await login(browser, fixture.origin, fixture.users.admin.email)
  let manager: Awaited<ReturnType<typeof login>> | undefined
  try {
    await admin.page.goto("/settings/roles")
    await admin.page.getByRole("button", { name: "New profile", exact: true }).click()
    await admin.page.getByRole("button", { name: "Profile module", exact: true }).click()
    await admin.page.getByRole("menuitemradio", { name: "Inventory", exact: true }).click()
    await admin.page.getByRole("menu").waitFor({ state: "hidden" })
    await admin.page.getByRole("button", { name: "Copy template", exact: true }).click()
    await admin.page.getByRole("menuitemradio", { name: "Inventory Viewer", exact: true }).click()
    await admin.page.getByLabel("Profile name", { exact: true }).fill("Warehouse viewer")
    await expect(admin.page.getByRole("checkbox", { name: "Inventory categories: read", exact: true })).toBeChecked()
    await expect(admin.page.getByRole("checkbox", { name: "Inventory categories: create", exact: true })).not.toBeChecked()
    await admin.page.screenshot({ path: info.outputPath("inventory-profile-desktop.png"), fullPage: true, animations: "disabled" })
    await admin.page.getByRole("button", { name: "Save changes", exact: true }).click()
    await expect(admin.page.getByRole("button", { name: "Warehouse viewer", exact: true })).toBeVisible()
    const viewer = (await json(admin.context, "/api/access/roles?q=Warehouse%20viewer")).items[0]
    const template = (key: string) => moduleProfileTemplates.find(item => item.key === key)!
    const sales = await json(admin.context, "/api/access/roles", 201, "POST", { name: "Sales manager", moduleKey: "crm", permissions: template("crm:manager").permissions })
    const core = await json(admin.context, "/api/access/roles", 201, "POST", { name: "Workspace viewer", moduleKey: "core", permissions: template("core:viewer").permissions })
    const email = `composed-${fixture.slug}@example.test`
    const created = await json(admin.context, "/api/users", 200, "POST", { name: "Composed staff", email, role: "STAFF", password, accessRoleIds: [sales.id, viewer.id], recordRules: defaultRecordRules() })
    const office = (await json(admin.context, "/api/offices")).items[0]
    for (const userId of [fixture.users.admin.id, fixture.users.staff.id, created.user.id]) await assignOffices(admin.context, userId, [office.id], office.id)
    const contact = await json(admin.context, "/api/crm/contacts", 201, "POST", { name: "Profile test customer" })
    const own = await json(admin.context, "/api/crm/enquiries", 201, "POST", { title: "Composed own lead", contactId: contact.id, assignedUserId: created.user.id })
    const other = await json(admin.context, "/api/crm/enquiries", 201, "POST", { title: "Private other lead", contactId: contact.id, assignedUserId: fixture.users.staff.id })
    manager = await login(browser, fixture.origin, email)
    expect((await json(manager.context, "/api/crm/enquiries")).total).toBe(1)
    await json(manager.context, "/api/inventory/categories")
    await json(manager.context, "/api/inventory/categories", 403, "POST", { name: "Unauthorized category" })
    await admin.page.getByRole("button", { name: "Assign profiles", exact: true }).click()
    await admin.page.getByLabel("User", { exact: true }).click()
    await admin.page.getByRole("option", { name: "Composed staff", exact: true }).click()
    const selected = admin.page.getByRole("list", { name: "Selected access profiles" })
    await expect(selected.getByRole("listitem")).toHaveCount(2)
    await admin.page.getByRole("button", { name: "Remove Warehouse viewer", exact: true }).click()
    await admin.page.getByLabel("Add access profile", { exact: true }).click()
    await admin.page.getByRole("option", { name: "Workspace viewer", exact: true }).click()
    await expect(selected.getByRole("listitem")).toHaveCount(2)
    await admin.page.locator("summary").filter({ hasText: /^Enquiries$/ }).click()
    await expect(admin.page.getByRole("button", { name: "Enquiries: read", exact: true })).toHaveText("Own / directly assigned")
    await admin.page.setViewportSize({ width: 390, height: 844 })
    await expect(admin.page.getByText("Access profile saved.", { exact: true })).toHaveCount(0)
    await expect(admin.page.getByRole("button", { name: "Save changes", exact: true })).toBeVisible()
    await admin.page.screenshot({ path: info.outputPath("composed-profiles-mobile.png"), fullPage: true, animations: "disabled" })
    expect(await admin.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await admin.page.getByRole("button", { name: "Save changes", exact: true }).click()
    await expect(admin.page.getByRole("dialog")).toHaveCount(0)
    const assignment = await json(admin.context, `/api/access/users/${created.user.id}`)
    expect(assignment.accessAssignments.map((item: { roleId: string }) => item.roleId).sort()).toEqual([sales.id, core.id].sort())
    expect(assignment.accessPolicy.rules["enquiries.read"]).toBe("OWN")
    expect((await json(manager.context, "/api/crm/enquiries")).total).toBe(1)
    await json(manager.context, "/api/inventory/categories", 403)
    // The shared record view must reflect record limits, not just profile grants.
    const current = await json(admin.context, `/api/access/users/${created.user.id}`)
    await json(admin.context, `/api/access/users/${created.user.id}`, 200, "PATCH", { roleIds: current.accessAssignments.map((item: {roleId:string})=>item.roleId), version: current.accessPolicy.version, rules: {...current.accessPolicy.rules, "enquiries.read":"ALL", "enquiries.edit":"OWN"} })
    await manager.page.goto(`/crm/enquiries/${other.id}`)
    await expect(manager.page.getByRole("heading", {name:"Private other lead",exact:true})).toBeVisible()
    await expect(manager.page.getByRole("button", {name:/^Edit/})).toHaveCount(0)
    await manager.page.screenshot({path:info.outputPath("read-all-edit-own.png"),fullPage:true,animations:"disabled"})
    await manager.page.goto(`/crm/enquiries/${own.id}`)
    await expect(manager.page.getByRole("button", {name:/^Edit/}).first()).toBeVisible()
  } finally { await manager?.context.close(); await admin.context.close(); await fixture.db.end() }
})
