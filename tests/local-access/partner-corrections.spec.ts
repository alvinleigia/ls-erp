import { test, expect, type Page } from "@playwright/test"
import { seed, login, json, assignOffices } from "./fixtures"
import { allPermissions } from "@/platform/access/catalog"
import { defaultRecordRules, supportedScopes } from "@/platform/access/rules"

async function pick(page: Page, label: string, name: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click()
  await page.getByPlaceholder("Type to search...").fill(name)
  await page.getByRole("option", { name: new RegExp(name) }).click()
  await expect(page.getByRole("listbox")).toHaveCount(0)
}

test("collections manager selects a CP, corrects/removes/adds with reason and keeps the salesperson", async ({ browser }) => {
  test.setTimeout(150_000)
  const f = await seed(), admin = await login(browser, f.origin, f.users.admin.email)
  const office = (await json(admin.context, "/api/offices")).items[0]
  await json(admin.context, "/api/modules", 200, "PATCH", { key: "realEstate", enabled: false })
  for (const user of [f.users.admin, f.users.manager]) await assignOffices(admin.context, user.id, [office.id], office.id)
  const a = await json(admin.context, "/api/collaborators", 201, "POST", { code: "CP_ALPHA", name: "Alpha Channel Partner", supervisorUserId: f.users.admin.id })
  const b = await json(admin.context, "/api/collaborators", 201, "POST", { code: "CP_BETA", name: "Beta Channel Partner", supervisorUserId: f.users.admin.id })
  const profile = await json(admin.context, "/api/access/roles", 201, "POST", { name: "Collections with partner corrections", permissions: allPermissions.filter(p => ["contacts", "enquiries", "opportunities", "pipelines", "partnerChoices", "partnerLinks"].includes(p.split(".")[0])) })
  const assignment = await json(admin.context, `/api/access/users/${f.users.manager.id}`), rules = defaultRecordRules()
  for (const key of Object.keys(rules) as (keyof typeof rules)[]) if (supportedScopes(key.split(".")[0] as Parameters<typeof supportedScopes>[0]).includes("ALL")) rules[key] = "ALL"
  await json(admin.context, `/api/access/users/${f.users.manager.id}`, 200, "PATCH", { version: assignment.accessPolicy.version, roleIds: [profile.id], rules })
  const contact = await json(admin.context, "/api/crm/contacts", 201, "POST", { name: "Partner correction buyer" })
  const pipeline = await json(admin.context, "/api/crm/pipelines", 201, "POST", { name: "Partner correction sales", stages: [{ name: "Open", kind: "OPEN", probability: 10, color: "#123456" }, { name: "Won", kind: "WON", probability: 100, color: "#00aa00" }, { name: "Lost", kind: "LOST", probability: 0, color: "#aa0000" }] })
  const manager = await login(browser, f.origin, f.users.manager.email), { page, context } = manager
  try {
    await page.goto("/crm/opportunities/new")
    await page.getByLabel("Opportunity title", { exact: true }).fill("Collections partner workflow")
    await pick(page, "Contact", contact.name)
    await page.getByLabel("Expected close date", { exact: true }).fill("2030-01-01")
    await page.getByText("Introducing collaborator", { exact: true }).click()
    await pick(page, "Introducing collaborator (optional)", a.name)
    await page.getByRole("button", { name: "Save opportunity", exact: true }).click()
    await expect(page).toHaveURL(/\/crm\/opportunities\/(?!new)[^/]+$/)
    await page.getByRole("tab", { name: "Partner / CP", exact: true }).click()
    await expect(page.getByText(`${a.name} (${a.code})`, { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Change partner", exact: true }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog.getByRole("button", { name: "Save partner change", exact: true })).toBeDisabled()
    await pick(page, "Introducing collaborator / CP", b.name)
    await dialog.getByLabel("Reason", { exact: true }).fill("Initial CP was selected incorrectly")
    await dialog.getByRole("button", { name: "Save partner change", exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByText(`${b.name} (${b.code})`, { exact: true })).toBeVisible()
    await page.getByText("Partner history", { exact: true }).click()
    await expect(page.getByText("Initial CP was selected incorrectly", { exact: true })).toBeVisible()
    await page.screenshot({ path: "test-results/local-access/partner-correction-desktop.png", fullPage: true })
    await page.getByRole("button", { name: "Change partner", exact: true }).click()
    await dialog.getByRole("button", { name: "Remove partner", exact: true }).click()
    await dialog.getByLabel("Reason", { exact: true }).fill("Introduction not confirmed")
    await dialog.getByRole("button", { name: "Save partner change", exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await page.getByRole("button", { name: "Add partner", exact: true }).click()
    await pick(page, "Introducing collaborator / CP", a.name)
    await dialog.getByLabel("Reason", { exact: true }).fill("Confirmed original introduction")
    await dialog.getByRole("button", { name: "Save partner change", exact: true }).click()
    await expect(dialog).toHaveCount(0)
    const id = new URL(page.url()).pathname.split("/").pop()
    const result = await json(context, `/api/crm/opportunities/${id}`)
    expect(result.introducedByCollaboratorId).toBe(a.id)
    expect(result.assignedUserId).toBe(f.users.manager.id)
    expect(result.pipelineId).toBe(pipeline.id)
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.getByRole("button", { name: "Change partner", exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: "test-results/local-access/partner-correction-mobile.png", fullPage: true })
  } finally { await context.close(); await admin.context.close(); await f.db.end() }
})
