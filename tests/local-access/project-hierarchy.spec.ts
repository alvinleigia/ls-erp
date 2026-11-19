import { test, expect } from "@playwright/test"
import { seed, login, json } from "./fixtures"

test.use({ actionTimeout: 15_000 })

test("deep project navigation, child creation and path selections work on desktop and mobile", async ({ browser }) => {
  test.setTimeout(180_000)
  const fixture = await seed(), admin = await login(browser, fixture.origin, fixture.users.admin.email)
  const errors: string[] = []
  admin.page.on("pageerror", error => errors.push(error.message))
  try {
    const nodes: { id: string; name: string }[] = []
    for (const [index, name] of ["Estate", "Square", "Sector", "Block", "Wing"].entries()) nodes.push(await json(admin.context, "/api/real-estate/projects", 201, "POST", { name, code: `TREE-${index}`, parentId: nodes.at(-1)?.id || "" }))
    await admin.page.goto(`/crm/projects/${nodes[4].id}`)
    const path = admin.page.getByRole("navigation", { name: "Project hierarchy" })
    await expect(path.getByText("Estate", { exact: true })).toBeVisible()
    await expect(path.getByText("Wing", { exact: true })).toBeVisible()
    await admin.page.getByRole("tab", { name: "Subprojects", exact: true }).click()
    await admin.page.getByRole("link", { name: "New subproject", exact: true }).click()
    await admin.page.locator("#project-name").fill("Floor 1")
    await admin.page.locator("#project-code").fill("TREE-5")
    const saved = admin.page.waitForResponse(response => new URL(response.url()).pathname === "/api/real-estate/projects" && response.request().method() === "POST", { timeout: 15_000 })
    await admin.page.getByRole("button", { name: /^Save (?:subproject|project)$/i }).click()
    const result = await saved
    expect(result.status(), await result.text()).toBe(201)
    const leaf = await result.json()
    expect(leaf.rootId).toBe(nodes[0].id)
    await admin.page.goto(`/crm/projects/${leaf.id}`)
    await expect(admin.page.getByRole("navigation", { name: "Project hierarchy" }).getByText("Floor 1", { exact: true })).toBeVisible()
    await admin.page.screenshot({ path: "test-results/project-hierarchy-desktop.png", fullPage: true })
    await admin.page.setViewportSize({ width: 390, height: 844 })
    await admin.page.screenshot({ path: "test-results/project-hierarchy-mobile.png", fullPage: true })
    expect(await admin.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false)
    await admin.page.setViewportSize({ width: 1440, height: 1000 })
    await admin.page.goto("/crm/projects")
    await admin.page.getByRole("button", { name: "Hierarchy", exact: true }).click()
    for (const node of nodes) await admin.page.getByRole("button", { name: `Expand ${node.name}`, exact: true }).click()
    await expect(admin.page.getByRole("link", { name: "Floor 1", exact: true })).toBeVisible()
    await admin.page.screenshot({ path: "test-results/project-hierarchy-tree.png", fullPage: true })
    const descendantChoices = await json(admin.context, `/api/real-estate/projects?descendantOf=${nodes[0].id}`)
    expect(descendantChoices.total).toBe(5)
    expect(descendantChoices.items.find((node: { id: string }) => node.id === leaf.id).pathName).toBe("Estate / Square / Sector / Block / Wing / Floor 1")
    expect(errors).toEqual([])
  } finally { await admin.context.close(); await fixture.db.end() }
})
