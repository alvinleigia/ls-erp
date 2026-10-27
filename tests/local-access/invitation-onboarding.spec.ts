import { test, expect } from "@playwright/test"
import { seed, login, json, password } from "./fixtures"

test("link invitation supports profiles, one-time password setup and office-bound sign-in", async ({ browser }) => {
  test.setTimeout(150_000)
  const fixture = await seed(), admin = await login(browser, fixture.origin, fixture.users.admin.email)
  const publicContext = await browser.newContext({ baseURL: fixture.origin })
  let invited: Awaited<ReturnType<typeof login>> | undefined
  try {
    // Exercise an explicitly unassigned invitation through the actual dialog, without SMTP.
    await admin.page.goto("/users/invites")
    await admin.page.getByRole("button", { name: "Invite user", exact: true }).click()
    const dialog = admin.page.getByRole("dialog")
    await dialog.getByLabel("Email", { exact: true }).fill(`link-only@${fixture.slug}.test`)
    await dialog.getByLabel("Role", { exact: true }).selectOption("STAFF")
    await expect(dialog.getByText("No profiles selected. Business access stays disabled until profiles are assigned.")).toBeVisible()
    await dialog.getByLabel("Delivery", { exact: true }).selectOption("LINK")
    await admin.page.screenshot({ path: "test-results/local-access/invitation-desktop.png" })
    await admin.page.setViewportSize({ width: 390, height: 844 })
    await admin.page.screenshot({ path: "test-results/local-access/invitation-mobile.png" })
    await expect(dialog.getByRole("button", { name: "Create invite link", exact: true })).toBeInViewport()
    await dialog.getByRole("button", { name: "Create invite link", exact: true }).click()
    await expect(dialog).toBeHidden()
    await admin.page.setViewportSize({ width: 1280, height: 900 })
    const pendingRow = admin.page.getByRole("row").filter({ hasText: `link-only@${fixture.slug}.test` })
    await pendingRow.getByRole("button").click()
    await admin.page.getByRole("menuitem", { name: "Revoke invite", exact: true }).click()
    const confirmation = admin.page.getByRole("dialog", { name: "Revoke invitation?" })
    await confirmation.getByRole("button", { name: "Cancel", exact: true }).click()
    await expect(pendingRow).toBeVisible()
    await pendingRow.getByRole("button").click()
    await admin.page.getByRole("menuitem", { name: "Revoke invite", exact: true }).click()
    await confirmation.getByRole("button", { name: "Revoke invitation", exact: true }).click()
    await expect(pendingRow).toHaveCount(0)

    const office = (await json(admin.context, "/api/offices")).items[0]
    const accessRoleIds = (await fixture.db.query('SELECT "roleId" FROM "TenantRoleAssignment" WHERE "tenantId"=$1 AND "userId"=$2', [fixture.slug, fixture.users.staff.id])).rows.map(row => row.roleId)
    const email = `invited@${fixture.slug}.test`
    const invitation = await json(admin.context, "/api/invites", 201, "POST", { email, role: "STAFF", delivery: "LINK", accessRoleIds, officeAccess: { creationOfficeId: office.id, officeIds: [office.id], companies: [] } })
    expect(new URL(invitation.inviteUrl).origin).toBe(fixture.origin)
    const page = await publicContext.newPage()
    await page.goto(invitation.inviteUrl)
    await page.getByLabel("Full name", { exact: true }).fill("Invited sales staff")
    await page.getByLabel("Password", { exact: true }).fill(password)
    const submitted = page.waitForResponse(response => response.url().endsWith("/api/invites/accept") && response.request().method() === "POST")
    await page.getByRole("button", { name: "Create account", exact: true }).click()
    const result = await submitted
    expect(result.status()).toBe(200)
    await expect(page.getByRole("button", { name: "Go to sign in", exact: true })).toBeVisible()
    invited = await login(browser, fixture.origin, email)
    expect((await json(invited.context, "/api/workspace/office")).creationOffice.id).toBe(office.id)
    const contact = await json(invited.context, "/api/crm/contacts", 201, "POST", { name: "Invitation customer" })
    const userId = (await fixture.db.query('SELECT id FROM "User" WHERE "tenantId"=$1 AND email=$2', [fixture.slug, email])).rows[0].id
    const enquiry = await json(invited.context, "/api/crm/enquiries", 201, "POST", { title: "Invited staff enquiry", contactId: contact.id, assignedUserId: userId })
    expect((await fixture.db.query('SELECT "officeId" FROM "CrmEnquiry" WHERE id=$1', [enquiry.id])).rows[0].officeId).toBe(office.id)
    await json(invited.context, "/api/invites", 403)
    await page.goto(invitation.inviteUrl)
    await page.getByLabel("Password", { exact: true }).fill(password + "-different")
    await page.getByRole("button", { name: "Create account", exact: true }).click()
    await expect(page.getByText("Invitation is invalid or expired. Ask your administrator for a new invitation.", { exact: true })).toBeVisible()
  } finally { await invited?.context.close(); await publicContext.close(); await admin.context.close(); await fixture.db.end() }
})
