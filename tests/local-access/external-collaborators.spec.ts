import { test, expect, type Page } from "@playwright/test"
import { seed, login, json } from "./fixtures"
async function supervisor(page: Page, name: string) {
  await page.getByRole("combobox", { name: "Internal supervisor", exact: true }).click()
  await page.getByPlaceholder("Type to search...").fill(name)
  await page.getByRole("option", { name, exact: true }).click()
}

test("external directory keeps partners separate from employees and access after real tenant sign-ins", async ({ browser }) => {
  test.setTimeout(120_000)
  const f = await seed(), admin = await login(browser, f.origin, f.users.admin.email), manager = await login(browser, f.origin, f.users.manager.email), page = admin.page
  try {
    const counts = async () => (await f.db.query('SELECT (SELECT count(*) FROM "User" WHERE "tenantId"=$1) users, (SELECT count(*) FROM "StaffProfile" p JOIN "User" u ON u.id=p."userId" WHERE u."tenantId"=$1) profiles, (SELECT count(*) FROM "BusinessOfficeGrant" WHERE "tenantId"=$1) grants', [f.slug])).rows[0]
    const before = await counts()
    await page.goto("/users/collaborators");await page.getByRole("link", { name: "New collaborator", exact: true }).click()
    await page.getByLabel("Collaborator name", { exact: true }).fill("Regional partner")
    await page.getByLabel("Code", { exact: true }).fill("PARTNER")
    await page.getByLabel("Classification", { exact: true }).fill("Channel partner")
    await page.getByLabel("Organization name", { exact: true }).fill("Independent agency")
    await page.getByLabel("Contact email", { exact: true }).fill("partner@example.test")
    await supervisor(page, "Access manager")
    await page.getByRole("button", { name: "Create collaborator", exact: true }).click()
    await expect(page.getByRole("link", { name: "Regional partner", exact: true })).toBeVisible()
    expect(await counts()).toEqual(before)
    const row = (await json(admin.context, "/api/collaborators?q=PARTNER")).items[0]
    expect(row.supervisorUserId).toBe(f.users.manager.id)
    await json(manager.context, "/api/collaborators", 403)
    await json(manager.context, `/api/collaborators/${row.id}`, 403)
    await json(manager.context, "/api/collaborators/supervisors", 403)
    await manager.page.goto("/users/collaborators");await expect(manager.page.getByRole("heading", { name: "Access unavailable", exact: true })).toBeVisible()
    await expect(manager.page.getByRole("link", { name: "External collaborators", exact: true })).toHaveCount(0)
    await page.getByRole("link", { name: "Regional partner", exact: true }).click()
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.getByLabel("Collaborator name", { exact: true })).toHaveValue("Regional partner")
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: "test-results/local-access/collaborator-mobile.png", fullPage: true, animations: "disabled" })
    await page.setViewportSize({ width: 1280, height: 900 })
    await supervisor(page, "Access admin")
    await page.getByRole("checkbox", { name: "Archived", exact: true }).check()
    await page.getByRole("button", { name: "Save changes", exact: true }).click()
    await expect(page.getByRole("heading", { name: "External collaborators", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Collaborator status", exact: true }).click();await page.getByRole("menuitemradio", { name: "Archived", exact: true }).click()
    await page.getByRole("link", { name: "Regional partner", exact: true }).click()
    await page.getByRole("checkbox", { name: "Archived", exact: true }).uncheck()
    await page.getByRole("button", { name: "Save changes", exact: true }).click()
    await expect(page.getByRole("link", { name: "Regional partner", exact: true })).toBeVisible()
    await page.screenshot({ path: "test-results/local-access/collaborator-desktop.png", fullPage: true, animations: "disabled" })
    expect(await counts()).toEqual(before)
    const saved = await json(admin.context, `/api/collaborators/${row.id}`);expect(saved.supervisorUserId).toBe(f.users.admin.id);expect(saved.archived).toBe(false)
  } finally { await manager.context.close();await admin.context.close();await f.db.end() }
})

test("stale collaborator forms keep drafts until explicit reload and reject a suspended supervisor", async ({ browser }) => {
  const f = await seed(), admin = await login(browser, f.origin, f.users.admin.email), page = admin.page
  try {
    const row = await json(admin.context, "/api/collaborators", 201, "POST", { name: "Draft partner", code: "DRAFT", supervisorUserId: f.users.manager.id })
    await page.goto(`/users/collaborators/${row.id}`);await expect(page.getByLabel("Collaborator name", { exact: true })).toHaveValue("Draft partner")
    await page.getByLabel("Collaborator name", { exact: true }).fill("My unsaved change")
    await json(admin.context, `/api/collaborators/${row.id}`, 200, "PATCH", { name: "Other administrator update", version: row.version })
    await page.getByRole("button", { name: "Save changes", exact: true }).click()
    await expect(page.getByText("Collaborator changed. Reload before saving.", { exact: true })).toBeVisible()
    await expect(page.getByLabel("Collaborator name", { exact: true })).toHaveValue("My unsaved change")
    await page.getByRole("button", { name: "Reload saved details", exact: true }).click()
    await expect(page.getByLabel("Collaborator name", { exact: true })).toHaveValue("Other administrator update")
    await f.db.query(`UPDATE "User" SET status='SUSPENDED' WHERE id=$1`, [f.users.manager.id])
    await page.getByRole("checkbox", { name: "Archived", exact: true }).check();await page.getByRole("button", { name: "Save changes", exact: true }).click()
    await expect(page.getByRole("heading", { name: "External collaborators", exact: true })).toBeVisible()
    const saved = await json(admin.context, `/api/collaborators/${row.id}`);expect(saved.archived).toBe(true)
    await page.goto(`/users/collaborators/${row.id}`);await expect(page.getByText("The saved supervisor is unavailable.", { exact: false })).toBeVisible()
    await page.getByRole("checkbox", { name: "Archived", exact: true }).uncheck();await page.getByRole("button", { name: "Save changes", exact: true }).click()
    await expect(page.getByText("Choose an active internal administrator or manager in this workspace.", { exact: true })).toBeVisible()
    expect((await json(admin.context, `/api/collaborators/${row.id}`)).version).toBe(saved.version)
    await supervisor(page, "Access admin");await page.getByRole("button", { name: "Save changes", exact: true }).click()
    await expect(page.getByRole("link", { name: "Other administrator update", exact: true })).toBeVisible()
  } finally { await admin.context.close();await f.db.end() }
})
