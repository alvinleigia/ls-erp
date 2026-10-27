import { test, expect, type Page } from "@playwright/test"
import { seed, login, json, password } from "./fixtures"
test.use({ actionTimeout: 15_000 })

async function pick(page: Page, label: string, name: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click()
  await page.getByPlaceholder("Type to search...").fill(name)
  await page.getByRole("option", { name: new RegExp(name) }).click()
  await expect(page.getByRole("listbox")).toHaveCount(0)
}
async function definitions(context: Awaited<ReturnType<typeof login>>["context"], managerId: string) {
  const partner = await json(context, "/api/collaborators", 201, "POST", { name: "UI Agency", code: "UI_AGENCY", supervisorUserId: managerId })
  const business = await json(context, "/api/access/roles", 201, "POST", { name: "UI Business viewer", permissions: ["dashboard.read", "contacts.read", "enquiries.read"] })
  await json(context, "/api/access/roles", 201, "POST", { name: "UI Employee only", permissions: ["shiftRoster.read", "leaveRequests.read"] })
  return { partner, business }
}
async function credentials(page: Page, name: string, email: string) {
  const dialog = page.getByRole("dialog", { name: "Create external login", exact: true })
  await dialog.getByLabel("Full name", { exact: true }).fill(name)
  await dialog.getByLabel("Login email", { exact: true }).fill(email)
  await dialog.getByLabel("Temporary password", { exact: true }).fill(password)
  return dialog
}

test("partner login screens create bounded accounts and reuse profile, office and conditional lifecycle controls", async ({ browser }) => {
  test.setTimeout(240_000)
  const f = await seed(), admin = await login(browser, f.origin, f.users.admin.email), page = admin.page
  let external: typeof admin | undefined
  try {
    const { partner, business } = await definitions(admin.context, f.users.manager.id)
    const company = (await json(admin.context, "/api/companies")).items[0], first = (await json(admin.context, "/api/offices")).items[0]
    const west = await json(admin.context, "/api/offices", 201, "POST", { name: "UI West", code: "UI_WEST", companyId: company.id })
    await page.goto("/users/collaborators");await page.getByRole("row").filter({ hasText: "UI Agency" }).getByRole("link", { name: "Manage logins", exact: true }).click()
    await page.getByRole("button", { name: "Create login", exact: true }).click()
    const email = `ui-partner@${f.slug}.test`, dialog = await credentials(page, "UI Partner login", email)
    await dialog.getByRole("combobox", { name: "Add access profile", exact: true }).click();await page.getByPlaceholder("Type to search...").fill("UI Employee only")
    await expect(page.getByRole("option")).toHaveCount(0);await expect(page.getByText("No matching records.", { exact: true })).toBeVisible();await page.keyboard.press("Escape")
    await pick(page, "Add access profile", "UI Business viewer")
    await dialog.locator("summary").filter({ hasText: /^Record access limits$/ }).click()
    await expect(dialog.locator("summary").filter({ hasText: /^Roster and daily overrides$/ })).toHaveCount(0)
    await expect(dialog.locator("summary").filter({ hasText: /^User directory/ })).toHaveCount(0)
    await pick(page, "Add specific office", "Main office");await pick(page, "Creation office", "Main office")
    await expect(dialog.getByRole("button", { name: "Create login", exact: true })).toBeEnabled();await dialog.getByRole("button", { name: "Create login", exact: true }).click()
    const row = page.getByRole("row").filter({ hasText: email });await expect(row).toContainText("ACTIVE")
    const user = (await json(admin.context, `/api/collaborators/${partner.id}/logins?q=${encodeURIComponent(email)}`)).items[0]
    expect(user.collaboratorId).toBe(partner.id)
    external = await login(browser, f.origin, email);await json(external.context, "/api/crm/enquiries");await json(external.context, "/api/users", 403)
    await row.getByRole("button", { name: "Access profiles", exact: true }).click()
    const assignment = page.getByRole("dialog", { name: "Assign access profiles", exact: true })
    await expect(assignment.getByLabel("User", { exact: true })).toHaveAttribute("readonly", "")
    await assignment.getByRole("button", { name: "Remove UI Business viewer", exact: true }).click();await assignment.getByRole("button", { name: "Save changes", exact: true }).click();await expect(assignment).toHaveCount(0)
    await json(external.context, "/api/crm/enquiries", 403)
    await row.getByRole("button", { name: "Access profiles", exact: true }).click();await pick(page, "Add access profile", "UI Business viewer")
    const latest = await json(admin.context, `/api/access/users/${user.id}`)
    await json(admin.context, `/api/access/users/${user.id}`, 200, "PATCH", { version: latest.accessPolicy.version, roleIds: [], rules: { ...latest.accessPolicy.rules, "enquiries.read": "NONE" } })
    await assignment.getByRole("button", { name: "Save changes", exact: true }).click()
    await expect(assignment.getByRole("alert").filter({ hasText: /changed/ })).toBeVisible();await expect(assignment.getByRole("list", { name: "Selected access profiles" })).toContainText("UI Business viewer")
    await expect(assignment.getByRole("button", { name: "Save changes", exact: true })).toBeDisabled();await assignment.getByRole("button", { name: "Reload saved access", exact: true }).click()
    await expect(assignment.getByText("No profiles selected. Business access stays disabled until profiles are assigned.", { exact: true })).toBeVisible()
    await pick(page, "Add access profile", "UI Business viewer")
    await assignment.locator("summary").filter({ hasText: /^Enquiries$/ }).click();await assignment.getByRole("button", { name: "Enquiries: read", exact: true }).click();await page.getByRole("menuitemradio", { name: "Own / directly assigned", exact: true }).click()
    await assignment.getByRole("button", { name: "Save changes", exact: true }).click();await expect(assignment).toHaveCount(0)
    await json(external.context, "/api/crm/enquiries")
    await row.getByRole("button", { name: "Office access", exact: true }).click()
    const offices = page.getByRole("dialog", { name: "Office access", exact: true });await pick(page, "Add specific office", "UI West");await offices.getByRole("button", { name: "Save office access", exact: true }).click();await expect(offices).toHaveCount(0)
    const grants = await json(admin.context, `/api/access/users/${user.id}/offices`);expect(grants.offices.map((x: { officeId: string }) => x.officeId).sort()).toEqual([first.id, west.id].sort())
    await row.getByRole("button", { name: "Suspend", exact: true }).click();await page.getByRole("dialog", { name: "Suspend login?", exact: true }).getByRole("button", { name: "Cancel", exact: true }).click()
    await json(external.context, "/api/crm/enquiries")
    await row.getByRole("button", { name: "Suspend", exact: true }).click();await page.getByRole("button", { name: "Suspend login", exact: true }).click();await expect(row).toContainText("SUSPENDED");await json(external.context, "/api/crm/enquiries", 403)
    await row.getByRole("button", { name: "Activate", exact: true }).click();await page.getByRole("button", { name: "Activate login", exact: true }).click();await expect(row).toContainText("ACTIVE")
    await row.getByRole("button", { name: "Suspend", exact: true }).click()
    await json(admin.context, `/api/users/${user.id}`, 200, "PATCH", { status: "ARCHIVED", expectedStatus: "ACTIVE" })
    await page.getByRole("button", { name: "Suspend login", exact: true }).click();await expect(page.getByText("Account status changed. Refresh before retrying.", { exact: true })).toBeVisible();await expect(row).toContainText("ARCHIVED")
    await row.getByRole("button", { name: "Activate", exact: true }).click();await page.getByRole("button", { name: "Activate login", exact: true }).click();await expect(row).toContainText("ACTIVE")
    await page.screenshot({ path: "test-results/local-access/partner-logins-desktop.png", fullPage: true, animations: "disabled" })
    await page.goto(`/users/${user.id}`);await expect(page.getByText("External collaborator", { exact: true })).toBeVisible();await expect(page.getByText("Reporting manager", { exact: true })).toHaveCount(0)
    await page.getByRole("button", { name: "Collaborator logins", exact: true }).click();await page.getByRole("button", { name: "Create login", exact: true }).click();await page.setViewportSize({ width: 390, height: 844 })
    const mobile = page.getByRole("dialog", { name: "Create external login", exact: true });await mobile.getByLabel("Full name", { exact: true }).fill("Unsaved external login")
    await expect(mobile.getByRole("button", { name: "Create login", exact: true })).toBeInViewport({ ratio: 1 });expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: "test-results/local-access/partner-login-mobile.png", fullPage: false, animations: "disabled" })
    await mobile.getByText("Initial office access", { exact: true }).scrollIntoViewIfNeeded();await expect(mobile.getByRole("button", { name: "Create login", exact: true })).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: "test-results/local-access/partner-login-mobile-offices.png", fullPage: false, animations: "disabled" })
    await mobile.getByRole("button", { name: "Cancel", exact: true }).click();await page.getByRole("button", { name: "Keep editing", exact: true }).click();await expect(mobile.getByLabel("Full name", { exact: true })).toHaveValue("Unsaved external login")
    await mobile.getByRole("button", { name: "Cancel", exact: true }).click();await page.getByRole("button", { name: "Discard changes", exact: true }).click();await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto(`/users/collaborators/${partner.id}`);await page.getByRole("checkbox", { name: "Archived", exact: true }).check();await page.getByRole("button", { name: "Save changes", exact: true }).click();await expect(page.getByRole("heading", { name: "External collaborators", exact: true })).toBeVisible()
    await page.goto(`/users/collaborators/${partner.id}/logins`);await expect(row).toContainText("SUSPENDED");await expect(page.getByRole("button", { name: "Create login", exact: true })).toBeDisabled();await expect(row.getByRole("button", { name: "Activate", exact: true })).toBeDisabled()
    const current = await json(admin.context, `/api/collaborators/${partner.id}`);await json(admin.context, `/api/collaborators/${partner.id}`, 200, "PATCH", { version: current.version, archived: false });await page.getByRole("button", { name: "Refresh logins", exact: true }).click()
    await expect(row).toContainText("SUSPENDED");await expect(row.getByRole("button", { name: "Activate", exact: true })).toBeEnabled()
    expect((await json(admin.context, `/api/access/users/${user.id}`)).accessAssignments[0].roleId).toBe(business.id)
    expect((await f.db.query('SELECT count(*)::int n FROM "StaffProfile" WHERE "userId"=$1', [user.id])).rows[0].n).toBe(0)
  } finally { await external?.context.close();await admin.context.close();await f.db.end() }
})

test("partner invitation screens scope pending links, accept named logins and revoke or expire only the selected partner", async ({ browser }) => {
  test.setTimeout(180_000)
  const f = await seed(), admin = await login(browser, f.origin, f.users.admin.email), page = admin.page, publicContext = await browser.newContext({ baseURL: f.origin })
  let manager: typeof admin | undefined
  try {
    const { partner } = await definitions(admin.context, f.users.manager.id)
    const other = await json(admin.context, "/api/collaborators", 201, "POST", { name: "Other agency", code: "OTHER", supervisorUserId: f.users.manager.id })
    const foreignEmail = `other-agency@${f.slug}.test`;await json(admin.context, "/api/invites", 201, "POST", { email: foreignEmail, collaboratorId: other.id, role: "STAFF", delivery: "LINK" })
    await page.goto(`/users/collaborators/${partner.id}/logins`)
    async function issue(email: string) {
      await page.getByRole("button", { name: "Invite login", exact: true }).click()
      const form = page.getByRole("dialog", { name: "Invite external login", exact: true });await form.getByLabel("Login email", { exact: true }).fill(email);await pick(page, "Add access profile", "UI Business viewer")
      await expect(form.getByRole("button", { name: "Create invite link", exact: true })).toBeEnabled();await form.getByRole("button", { name: "Create invite link", exact: true }).click()
      const ready = page.getByRole("dialog", { name: "Invitation ready", exact: true });const url = await ready.getByLabel("Invitation link", { exact: true }).inputValue();await ready.getByRole("button", { name: "Close", exact: true }).last().click();return url
    }
    const email = `invited-ui@${f.slug}.test`, url = await issue(email)
    await expect(page.getByText(email, { exact: true })).toBeVisible();await expect(page.getByText(foreignEmail, { exact: true })).toHaveCount(0)
    const publicPage = await publicContext.newPage();await publicPage.goto(url);await publicPage.getByLabel("Full name", { exact: true }).fill("Invited partner UI");await publicPage.getByLabel("Password", { exact: true }).fill(password);await publicPage.getByRole("button", { name: "Create account", exact: true }).click();await expect(publicPage.getByRole("button", { name: "Go to sign in", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Refresh logins", exact: true }).click();await expect(page.getByRole("link", { name: "Invited partner UI", exact: true })).toBeVisible()
    const revokeEmail = `revoke-ui@${f.slug}.test`;await issue(revokeEmail)
    const pending = page.getByRole("listitem").filter({ hasText: revokeEmail });await pending.getByRole("button", { name: "Open invite link", exact: true }).click();await expect(page.getByLabel("Invitation link", { exact: true })).toBeVisible();await page.getByRole("dialog", { name: "Invitation ready", exact: true }).getByRole("button", { name: "Close", exact: true }).last().click()
    await pending.getByRole("button", { name: "Revoke invite", exact: true }).click();await page.getByRole("dialog", { name: "Revoke invitation?", exact: true }).getByRole("button", { name: "Cancel", exact: true }).click();await expect(pending).toBeVisible()
    await pending.getByRole("button", { name: "Revoke invite", exact: true }).click();await page.getByRole("button", { name: "Revoke invitation", exact: true }).click();await expect(pending).toHaveCount(0)
    const expiring = await issue(`expiring-ui@${f.slug}.test`)
    const archived = await json(admin.context, `/api/collaborators/${partner.id}`, 200, "PATCH", { version: partner.version, archived: true });await json(admin.context, `/api/collaborators/${partner.id}`, 200, "PATCH", { version: archived.version, archived: false })
    await page.getByRole("button", { name: "Refresh logins", exact: true }).click();await expect(page.getByText("No pending invitations in this selection.", { exact: true })).toBeVisible()
    await publicPage.goto(expiring);await publicPage.getByLabel("Password", { exact: true }).fill(password);await publicPage.getByRole("button", { name: "Create account", exact: true }).click();await expect(publicPage.getByText("Invitation is invalid or expired. Ask your administrator for a new invitation.", { exact: true })).toBeVisible()
    manager = await login(browser, f.origin, f.users.manager.email);await manager.page.goto(`/users/collaborators/${partner.id}/logins`);await expect(manager.page.getByRole("heading", { name: "Access unavailable", exact: true })).toBeVisible();await expect(manager.page.getByRole("button", { name: "Create login", exact: true })).toHaveCount(0)
  } finally { await manager?.context.close();await publicContext.close();await admin.context.close();await f.db.end() }
})

test("failed partner onboarding preserves drafts and busy controls, and stale archived or revoked authority cannot create accounts", async ({ browser }) => {
  test.setTimeout(150_000)
  const f = await seed(), admin = await login(browser, f.origin, f.users.admin.email), page = admin.page
  try {
    const { partner } = await definitions(admin.context, f.users.manager.id)
    await page.goto(`/users/collaborators/${partner.id}/logins`);await page.getByRole("button", { name: "Create login", exact: true }).click()
    const email = `retry-ui@${f.slug}.test`, dialog = await credentials(page, "Retry partner", email)
    await page.route("**/api/users", route => route.request().method() === "POST" ? route.abort("failed") : route.continue())
    await expect(dialog.getByRole("button", { name: "Create login", exact: true })).toBeEnabled();await dialog.getByRole("button", { name: "Create login", exact: true }).click()
    await expect(dialog.getByText("Unable to confirm the request. Check logins or pending invitations before trying again.", { exact: true })).toBeVisible();await expect(dialog.getByLabel("Login email", { exact: true })).toHaveValue(email);await expect(dialog.getByRole("button", { name: "Create login", exact: true })).toBeEnabled();await page.unroute("**/api/users")
    const archived = await json(admin.context, `/api/collaborators/${partner.id}`, 200, "PATCH", { version: partner.version, archived: true })
    await dialog.getByRole("button", { name: "Create login", exact: true }).click();await expect(dialog.getByText("Choose an active collaborator in this workspace.", { exact: true })).toBeVisible();expect((await json(admin.context, `/api/collaborators/${partner.id}/logins`)).total).toBe(0)
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();await page.getByRole("button", { name: "Discard changes", exact: true }).click()
    await json(admin.context, `/api/collaborators/${partner.id}`, 200, "PATCH", { version: archived.version, archived: false });await page.getByRole("button", { name: "Refresh logins", exact: true }).click();await page.getByRole("button", { name: "Create login", exact: true }).click();await credentials(page, "Revoked partner", email)
    await expect(dialog.getByRole("button", { name: "Create login", exact: true })).toBeEnabled()
    await f.db.query(`UPDATE "User" SET role='MANAGER' WHERE id=$1`, [f.users.admin.id])
    try { await dialog.getByRole("button", { name: "Create login", exact: true }).click();await expect(dialog.getByRole("alert").filter({ hasText: /access|permitted|administrator/i }).first()).toBeVisible();await expect(dialog.getByRole("button", { name: "Create login", exact: true })).toBeDisabled() }
    finally { await f.db.query(`UPDATE "User" SET role='ADMIN' WHERE id=$1`, [f.users.admin.id]) }
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();await page.getByRole("button", { name: "Discard changes", exact: true }).click();await page.getByRole("button", { name: "Refresh logins", exact: true }).click()
    await page.getByRole("button", { name: "Create login", exact: true }).click();const unassigned = await credentials(page, "Unassigned partner", email)
    await unassigned.getByRole("button", { name: "Create login", exact: true }).click();await expect(page.getByRole("link", { name: "Unassigned partner", exact: true })).toBeVisible()
    const user = (await json(admin.context, `/api/collaborators/${partner.id}/logins`)).items[0]
    expect((await json(admin.context, `/api/access/users/${user.id}`)).accessAssignments).toHaveLength(0);expect((await json(admin.context, `/api/access/users/${user.id}/offices`)).offices).toHaveLength(0)
  } finally { await admin.context.close();await f.db.end() }
})
