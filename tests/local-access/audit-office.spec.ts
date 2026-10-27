import { test, expect } from "@playwright/test"
import { seed, login, json } from "./fixtures"

test("audit report keeps source offices private and reloads denied details after real sign-in", async ({ browser }) => {
  test.setTimeout(150_000)
  const f = await seed(), admin = await login(browser, f.origin, f.users.admin.email)
  let manager: typeof admin | undefined
  try {
    const company = await json(admin.context, "/api/companies", 201, "POST", { name: "Audit company", code: "AUDIT" })
    const east = await json(admin.context, "/api/offices", 201, "POST", { companyId: company.id, name: "East", code: "EAST" })
    const west = await json(admin.context, "/api/offices", 201, "POST", { companyId: company.id, name: "West", code: "WEST" })
    async function grant(officeIds: string[]) {
      const current = await json(admin.context, `/api/access/users/${f.users.manager.id}/offices`)
      await json(admin.context, `/api/access/users/${f.users.manager.id}/offices`, 200, "PATCH", { version: current.version, officeIds, companies: [], creationOfficeId: officeIds[0] ?? null })
    }
    await grant([east.id])
    for (const [key, event, type, office] of [
      ["east", "inventory.stock.updated", "inventoryStock", east.id],
      ["west", "inventory.stock.updated", "inventoryStock", west.id],
      ["shared", "inventory.inventoryProducts.edit", "inventoryProducts", null],
      ["unknown", "inventory.futureModule.updated", "Unregistered", null],
    ] as const) await f.db.query(`INSERT INTO "AuditLog"(id,"tenantId",event,"entityType","entityId","actorUserId","createdAt",metadata,before,after) VALUES($1,$2,$3,$4,$1,$5,'2036-02-04T10:00Z',$6,$7,$8)`, [f.slug + key, f.slug, event, type, f.users.manager.id, office ? { officeId: office, officeFamily: "inventory" } : {}, { quantity: 1, api_key: "never-expose" }, { quantity: 2, note: key === "east" ? "East balance corrected" : "Hidden evidence" }])
    manager = await login(browser, f.origin, f.users.manager.email, "America/Los_Angeles")
    const page = manager.page
    await page.goto("/reports/audit-logs")
    await expect(page.getByRole("status").filter({ hasText: "Event dates in Asia/Kolkata" })).toBeVisible()
    await expect(page.getByRole("cell", { name: "inventory.stock.updated", exact: true })).toHaveCount(1)
    await expect(page.getByRole("cell", { name: "inventory.futureModule.updated", exact: true })).toHaveCount(0)
    await expect(page.getByRole("cell", { name: "04/02/2036 15:30", exact: true })).toHaveCount(2)
    const result = await json(manager.context, "/api/reports/audit-logs?dateFrom=2036-02-04&dateTo=2036-02-04")
    expect(result.total).toBe(2); expect(result.items.some((row: { id: string }) => row.id === f.slug + "west")).toBe(false)
    await page.getByRole("button", { name: /^Filters/ }).click()
    await page.getByLabel("Event", { exact: true }).fill("inventory.stock.")
    await page.getByLabel("Date from", { exact: true }).fill("2036-02-04")
    await page.getByLabel("Date to", { exact: true }).fill("2036-02-04")
    await page.keyboard.press("Escape")
    await expect(page.getByRole("heading", { name: "Filters", exact: true })).toHaveCount(0)
    await expect(page.getByRole("cell", { name: "inventory.stock.updated", exact: true })).toHaveCount(1)
    await expect(page.getByRole("cell", { name: "inventory.inventoryProducts.edit", exact: true })).toHaveCount(0)
    await page.screenshot({ path: "test-results/local-access/audit-office-desktop.png", fullPage: true, animations: "disabled" })
    await page.getByRole("row").filter({ hasText: "inventory.stock.updated" }).getByRole("button", { name: "View", exact: true }).click()
    const panel = page.getByRole("dialog")
    await expect(panel.getByRole("heading", { name: "inventory.stock.updated", exact: true })).toBeVisible()
    await expect(panel.getByText('"East balance corrected"', { exact: true })).toBeVisible()
    await panel.getByText("Recorded snapshots", { exact: true }).click()
    await expect(panel.getByText(/redacted/).last()).toBeVisible()
    await expect(panel.getByText("never-expose", { exact: false })).toHaveCount(0)
    await page.setViewportSize({ width: 390, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: "test-results/local-access/audit-office-mobile-detail.png", fullPage: true, animations: "disabled" })
    await grant([])
    await panel.getByRole("button", { name: "Reload entry", exact: true }).click()
    await expect(panel.getByRole("alert")).toHaveText("Audit entry not found or no longer accessible.")
    await expect(panel.getByText(/East balance corrected/)).toHaveCount(0)
    await panel.locator('[data-slot="sheet-footer"]').getByRole("button", { name: "Close", exact: true }).click()
    await expect(page.getByRole("dialog")).toHaveCount(0)
    await page.getByRole("button", { name: "Refresh", exact: true }).click()
    await expect(page.getByText("No audit logs found.", { exact: true })).toBeVisible()
    await page.screenshot({ path: "test-results/local-access/audit-office-mobile-empty.png", fullPage: true, animations: "disabled" })
    await page.getByRole("button", { name: /^Filters/ }).click()
    await page.getByRole("button", { name: "Reset filters", exact: true }).click()
    await page.keyboard.press("Escape")
    await expect(page.getByRole("heading", { name: "Filters", exact: true })).toHaveCount(0)
    await expect(page.getByRole("cell", { name: "inventory.inventoryProducts.edit", exact: true })).toBeVisible()
    await expect(page.getByRole("cell", { name: "inventory.stock.updated", exact: true })).toHaveCount(0)
  } finally { await manager?.context.close(); await admin.context.close(); await f.db.end() }
})
