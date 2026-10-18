import { test, expect } from "@playwright/test"
import { readFile } from "node:fs/promises"
import { parse } from "csv-parse/sync"
import { seed, login, json } from "./fixtures"

test("import labels refresh without resetting mapping/defaults; downloads retain stable identity", async ({ browser }, testInfo) => {
  test.setTimeout(180000)
  const fixture = await seed(), { context, page } = await login(browser, fixture.origin, fixture.users.admin.email)
  async function rename(labels: Record<string, string | null>) {
    const current = await json(context, "/api/settings/terminology")
    await json(context, "/api/settings/terminology", 200, "PATCH", { version: current.version, changes: Object.entries(labels).map(([key, label]) => ({ key, label })) })
    await page.evaluate(() => window.dispatchEvent(new Event("terminology-changed")))
  }
  try {
    await page.goto("/crm/enquiries/import")
    const custom = await json(context, "/api/crm/custom-fields", 201, "POST", { scope: "ENQUIRY", code: "original_note", name: "Enquiry {label} $&", type: "TEXT" })
    const project = await json(context, "/api/real-estate/projects", 201, "POST", { name: "Original project", code: "TERM-IMPORT", location: "Pune" })
    await rename({ "crm.contact.singular": "Person", "crm.enquiry.singular": "Prospect", "crm.enquiry.plural": "Prospects", "realEstate.project.singular": "Development" })
    await expect(page.getByRole("heading", { name: "Import Prospects", exact: true })).toBeVisible()
    const pending = page.waitForEvent("download")
    await page.getByRole("link", { name: "Download CSV template" }).click()
    const download = await pending
    expect(download.suggestedFilename()).toBe("enquiry-import-template.csv")
    const headers = parse(await readFile((await download.path())!, "utf8"), { bom: true })[0]
    expect(headers).toEqual(expect.arrayContaining(["Person name [name]", "Prospect title [title]", "Development [projectId]", "enquiry.original_note"]))
    await page.getByLabel("Prospect file", { exact: true }).setInputFiles({ name: "prospects.csv", mimeType: "text/csv", buffer: Buffer.from("Person name [name],Email,Prospect title [title],enquiry.original_note\nOriginal person,terms@example.test,Original title,Original field value\nDuplicate,TERMS@example.test,Duplicate title,\nBad,bad-email,Bad title,\n") })
    await page.getByRole("button", { name: "Upload and map fields" }).click()
    await expect(page.getByRole("heading", { name: "Match your columns" })).toBeVisible()
    await expect(page.locator("#map-0")).toContainText("Person name")
    await expect(page.locator("#map-2")).toContainText("Prospect title")
    await expect(page.locator("#map-3")).toContainText("Enquiry {label} $& (Prospect)")
    await page.getByRole("combobox", { name: "Development", exact: true }).click()
    await page.getByRole("option", { name: "Original project", exact: true }).click()
    const location = page.url()
    let batchRequests = 0
    page.on("request", request => { if (request.url().includes("/api/crm/enquiry-imports")) batchRequests++ })
    await rename({ "crm.contact.singular": "Buyer", "crm.enquiry.singular": "Lead", "crm.enquiry.plural": "Leads", "realEstate.project.singular": "Estate" })
    await expect(page.locator("#map-0")).toContainText("Buyer name")
    await expect(page.locator("#map-2")).toContainText("Lead title")
    await expect(page.locator("#map-3")).toContainText("Enquiry {label} $& (Lead)")
    await expect(page.getByRole("combobox", { name: "Estate", exact: true })).toContainText("Original project")
    expect(page.url()).toBe(location); expect(batchRequests).toBe(0)
    await page.screenshot({ path: testInfo.outputPath("mapping-desktop.png"), fullPage: true, animations: "disabled" })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: testInfo.outputPath("mapping-mobile.png"), fullPage: true, animations: "disabled" })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
    await page.getByRole("button", { name: "Validate rows", exact: true }).click()
    await expect(page.getByRole("button", { name: "Import 1 ready row" })).toBeVisible({ timeout: 30000 })
    await page.getByRole("button", { name: "Import 1 ready row" }).click()
    await expect(page.getByText("1 Lead imported. 2 rows skipped.", { exact: true })).toBeVisible({ timeout: 30000 })
    const imported = await json(context, "/api/crm/enquiries")
    expect(imported.total).toBe(1); expect(imported.items[0].title).toBe("Original title"); expect(imported.items[0].propertyContext.project.id).toBe(project.id)
    const record = await json(context, `/api/crm/enquiries/${imported.items[0].id}`)
    expect(record.customFields.find((field: { id: string }) => field.id === custom.id)).toMatchObject({ value: "Original field value", name: "Enquiry {label} $&" })
    const correctionPending = page.waitForEvent("download")
    await page.getByRole("link", { name: "Download correction sheet" }).click()
    const correction = await correctionPending
    const csv = parse(await readFile((await correction.path())!, "utf8"), { bom: true })
    expect(csv[0].slice(0, 3)).toEqual(["Person name [name]", "Email", "Prospect title [title]"]); expect(csv).toHaveLength(3)
    for (const [url, expected] of [
      ["/api/crm/enquiries/export", ["Buyer", "Estate"]],
      ["/api/crm/opportunities/export", ["Buyer", "Estate"]],
      ["/api/crm/reports/sales/export?view=leads", ["Buyer", "Estate"]],
      ["/api/real-estate/projects/export", ["Estate"]],
    ] as const) {
      const response = await context.request.get(url)
      expect(response.status()).toBe(200)
      expect(parse(await response.text(), { bom: true })[0]).toEqual(expect.arrayContaining([...expected]))
    }
  } finally { await context.close(); await fixture.db.end() }
})
