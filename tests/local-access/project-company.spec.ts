import { test, expect } from "@playwright/test"
import { seed, login, json } from "./fixtures"

test("project form explicitly chooses company without losing its draft or moving a saved project", async ({ browser }) => {
  test.setTimeout(150_000)
  const fixture = await seed(), admin = await login(browser, fixture.origin, fixture.users.admin.email)
  try {
    const initialOffice = (await json(admin.context, "/api/workspace/office")).creationOfficeId
    const company = await json(admin.context, "/api/companies", 201, "POST", { name: "Project company", code: "PROJ" })
    const office = await json(admin.context, "/api/offices", 201, "POST", { name: "Project office", code: "PROJ", companyId: company.id })
    await admin.page.goto("/crm/projects/new")
    await admin.page.getByLabel("Project name", { exact: true }).fill("Ownership browser project")
    await admin.page.getByLabel("Project code", { exact: true }).fill("OWNERSHIP")
    let projectCreates = 0
    admin.page.on("request", request => { if (request.method() === "POST" && new URL(request.url()).pathname === "/api/real-estate/projects") projectCreates++ })
    await admin.page.getByRole("button", { name: "Choose company and office", exact: true }).click()
    const panel = admin.page.getByRole("dialog")
    await panel.getByLabel("Office for new records").click()
    await admin.page.getByRole("option", { name: "Project company / Project office (PROJ)", exact: true }).click()
    await panel.getByRole("button", { name: "Apply creation office", exact: true }).click()
    await expect(panel).not.toBeVisible()
    await expect(admin.page.getByLabel("Project name", { exact: true })).toHaveValue("Ownership browser project")
    await expect(admin.page.getByText("Project company", { exact: true })).toBeVisible()
    expect(projectCreates, "Applying the portalled office form must not submit its parent project form").toBe(0)
    const saved = admin.page.waitForResponse(r => new URL(r.url()).pathname === "/api/real-estate/projects" && r.request().method() === "POST")
    await admin.page.getByRole("button", { name: "Save project", exact: true }).click()
    const response = await saved
    expect(projectCreates).toBe(1)
    expect(response.status(), await response.text()).toBe(201)
    const project = await response.json()
    expect(project.officeId).toBe(office.id)
    await admin.page.waitForURL(`/crm/projects/${project.id}`)
    await expect(admin.page.getByText("Owning company", { exact: true })).toBeVisible()
    await expect(admin.page.getByText("Project company", { exact: true })).toBeVisible()
    await expect(admin.page.getByRole("button", { name: "Choose company and office", exact: true })).toHaveCount(0)
    await admin.page.screenshot({ path: test.info().outputPath("project-company-desktop.png"), fullPage: true })
    await admin.page.setViewportSize({ width: 390, height: 844 })
    await expect(admin.page.getByText("Owning company", { exact: true })).toBeVisible()
    expect(await admin.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
    await admin.page.screenshot({ path: test.info().outputPath("project-company-mobile.png"), fullPage: true })
    // A phase inherits its saved parent even when another office is selected
    // for new independent work. There is no editable company override here.
    const preference = await json(admin.context, "/api/workspace/office")
    await json(admin.context, "/api/workspace/office", 200, "PATCH", { version: preference.version, officeId: initialOffice })
    await admin.page.setViewportSize({ width: 1280, height: 900 })
    await admin.page.goto(`/crm/projects/new?parentId=${project.id}`)
    await expect(admin.page.getByRole("button", { name: "Choose company and office", exact: true })).toHaveCount(0)
    await expect(admin.page.getByText("Project company", { exact: true })).toBeVisible()
    await admin.page.locator("#project-name").fill("Ownership browser phase")
    await admin.page.locator("#project-code").fill("OWN-PHASE")
    const savedPhase = admin.page.waitForResponse(r => new URL(r.url()).pathname === "/api/real-estate/projects" && r.request().method() === "POST")
    await admin.page.getByRole("button", { name: /^Save (?:subproject|project)$/i }).click()
    const phaseResponse = await savedPhase
    expect(phaseResponse.status(), await phaseResponse.text()).toBe(201)
    expect((await phaseResponse.json()).officeId).toBe(office.id)
  } finally { await admin.context.close(); await fixture.db.end() }
})
