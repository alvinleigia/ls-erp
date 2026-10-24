import { test, expect } from "@playwright/test"
import { seed, login, json } from "./fixtures"

test("business team management is independent of CRM; scope choices are explicit", async ({ browser }, info) => {
  test.setTimeout(120_000)
  const fixture = await seed()
  await fixture.db.query('UPDATE "TenantModule" SET enabled=false WHERE "tenantId"=$1 AND key=\'crm\'', [fixture.slug])
  const admin = await login(browser, fixture.origin, fixture.users.admin.email)
  try {
    await admin.page.goto("/users/teams/new")
    await admin.page.getByLabel("Team name", { exact: true }).fill("Operations team")
    await expect(admin.page.getByLabel("Sales workflow", { exact: true })).toHaveCount(0)
    await admin.page.getByRole("button", { name: "Save team", exact: true }).click()
    await expect(admin.page).toHaveURL(/\/users\/teams\/(?!new)[^/]+$/)
    const id = admin.page.url().split("/").at(-1)!
    let team = await json(admin.context, `/api/teams/${id}`)
    expect(team.workflow).toBe("BOTH")
    team = await json(admin.context, `/api/teams/${id}/members`, 200, "POST", { userId: fixture.users.manager.id, isManager: true, version: team.version })
    await admin.page.reload()
    await expect(admin.page.getByRole("heading", { name: "Operations team", exact: true })).toBeVisible()
    await admin.page.screenshot({ path: info.outputPath("shared-team-desktop.png"), fullPage: true, animations: "disabled" })
    await admin.page.goto("/settings/roles")
    await admin.page.getByRole("button", { name: "Assign profiles", exact: true }).click()
    await admin.page.getByLabel("User", { exact: true }).click()
    await admin.page.getByRole("option", { name: "Access manager", exact: true }).click()
    await admin.page.locator("summary").filter({ hasText: /^Projects and subprojects$/ }).click()
    await expect(admin.page.getByRole("button", { name: "Projects and subprojects: read", exact: true })).toBeVisible()
    await admin.page.setViewportSize({ width: 390, height: 844 })
    await admin.page.getByRole("button", { name: "Projects and subprojects: read", exact: true }).click()
    await expect(admin.page.getByRole("menuitemradio", { name: "Own and managed teams", exact: true })).toBeVisible()
    await admin.page.screenshot({ path: info.outputPath("record-scopes-mobile.png"), fullPage: true, animations: "disabled" })
    expect(await admin.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  } finally { await admin.context.close(); await fixture.db.end() }
})

test("activity overview selects a team and preserves the team on drill-down", async ({ browser }, info) => {
  test.setTimeout(120_000)
  const fixture = await seed(), admin = await login(browser, fixture.origin, fixture.users.admin.email)
  try {
    let team = await json(admin.context, "/api/teams", 201, "POST", { name: "Inside sales" })
    team = await json(admin.context, `/api/teams/${team.id}/members`, 200, "POST", { userId: fixture.users.staff.id, version: team.version })
    const contact = await json(admin.context, "/api/crm/contacts", 201, "POST", { name: "Team reporting buyer" })
    const lead = await json(admin.context, "/api/crm/enquiries", 201, "POST", { title: "Team reporting lead", contactId: contact.id, assignedUserId: fixture.users.staff.id, salesTeamId: team.id })
    await json(admin.context, "/api/crm/work", 201, "POST", { title: "Call team buyer", contactId: contact.id, enquiryId: lead.id, assignedUserId: fixture.users.staff.id, type: "CALL", callDirection: "OUTBOUND", dueOn: "2030-10-07" })
    await json(admin.context, "/api/crm/work", 201, "POST", { title: "Unattributed call", contactId: contact.id, assignedUserId: fixture.users.staff.id, type: "CALL", callDirection: "OUTBOUND", dueOn: "2030-10-07" })
    await admin.page.goto("/crm/overview")
    await admin.page.getByLabel("Scope", { exact: true }).click()
    await admin.page.getByRole("menuitemradio", { name: "All accessible work", exact: true }).click()
    await admin.page.getByRole("menu").waitFor({ state: "hidden" })
    const card = admin.page.getByRole("link").filter({ hasText: "Open activities" })
    await expect(card.getByText("2", { exact: true })).toBeVisible()
    await admin.page.getByLabel("Sales team", { exact: true }).click()
    const teamLoaded = admin.page.waitForResponse(response => response.url().includes("/api/crm/reports/activities?") && new URL(response.url()).searchParams.get("salesTeamId") === team.id && response.status() === 200)
    await admin.page.getByRole("option", { name: "Inside sales", exact: true }).click()
    await teamLoaded
    await expect(admin.page.locator('p[role="status"]')).toHaveCount(0)
    await expect(card.getByText("1", { exact: true })).toBeVisible()
    await expect(card).toHaveAttribute("href", new RegExp(`salesTeamId=${team.id}`))
    await admin.page.screenshot({ path: info.outputPath("team-activity-overview.png"), fullPage: true, animations: "disabled" })
    await card.click()
    await expect(admin.page).toHaveURL(new RegExp(`salesTeamId=${team.id}`))
    await expect(admin.page.getByRole("link", { name: "Call team buyer", exact: true })).toBeVisible()
  } finally { await admin.context.close(); await fixture.db.end() }
})

test("a project assigned to a business team is readable by its staff members", async ({ browser }, info) => {
  test.setTimeout(120_000)
  const fixture = await seed(), admin = await login(browser, fixture.origin, fixture.users.admin.email)
  const staff = await login(browser, fixture.origin, fixture.users.staff.email)
  try {
    let team = await json(admin.context, "/api/teams", 201, "POST", { name: "Delivery team" })
    team = await json(admin.context, `/api/teams/${team.id}/members`, 200, "POST", { userId: fixture.users.staff.id, version: team.version })
    await admin.page.goto("/crm/projects/new")
    await admin.page.getByLabel("Project name", { exact: true }).fill("Shared delivery project")
    await admin.page.getByLabel("Project code", { exact: true }).fill("DELIVERY")
    await admin.page.getByLabel("Responsible team", { exact: true }).click()
    await admin.page.getByRole("option", { name: "Delivery team", exact: true }).click()
    await admin.page.getByRole("button", { name: "Save project", exact: true }).click()
    await expect(admin.page).toHaveURL(/\/crm\/projects\/(?!new)[^/]+$/)
    const id = admin.page.url().split("/").at(-1)!
    expect((await json(staff.context, `/api/real-estate/projects/${id}`)).teamId).toBe(team.id)
    await staff.page.goto(`/crm/projects/${id}`)
    await expect(staff.page.getByRole("heading", { name: "Shared delivery project", exact: true })).toBeVisible()
    await expect(staff.page.getByRole("button", { name: "Edit project", exact: true })).toHaveCount(0)
    await staff.page.screenshot({ path: info.outputPath("staff-project-team-read.png"), fullPage: true, animations: "disabled" })
  } finally { await admin.context.close(); await staff.context.close(); await fixture.db.end() }
})
