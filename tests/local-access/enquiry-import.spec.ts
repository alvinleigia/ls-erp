import { test, expect } from "@playwright/test"
import { readFile } from "node:fs/promises"
import { parse } from "csv-parse/sync"
import { seed, login, json } from "./fixtures"
import type { ImportProgress } from "../../modules/crm/import-types"

test("enquiry upload, review, correction download and reupload use shared CRM controls", async ({ browser }, testInfo) => {
  test.setTimeout(180000)
  const fixture = await seed()
  const { context, page } = await login(browser, fixture.origin, fixture.users.admin.email)
  try {
    await page.goto("/crm/enquiries")
    await page.getByRole("link", { name: "Import enquiries", exact: true }).click()
    await expect(page.getByRole("heading", { name: "Import enquiries", exact: true })).toBeVisible()
    const templateDownload = page.waitForEvent("download")
    await page.getByRole("link", { name: "Download CSV template" }).click()
    const template = await templateDownload
    expect(template.suggestedFilename()).toBe("enquiry-import-template.csv")
    const templateRows = parse(await readFile((await template.path())!, "utf8"), { bom: true }) as string[][]
    expect(templateRows).toHaveLength(1)
    expect(templateRows[0]).toEqual(expect.arrayContaining(["Contact name", "Email", "Phone", "Project"]))
    await page.screenshot({ path: testInfo.outputPath("import-template-download.png"), fullPage: true })
    await page.getByLabel("Enquiry file").setInputFiles({ name: "market-leads.csv", mimeType: "text/csv", buffer: Buffer.from('Contact name,Email,Phone,Requirements\nAlice,alice@example.com,+919876543210,Near a school\nDuplicate,ALICE@example.com,,Duplicate enquiry\nBob,bad-address,,Needs a villa\n') })
    await page.getByRole("button", { name: "Upload and map fields" }).click()
    await expect(page.getByRole("heading", { name: "Match your columns" })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath("import-mapping-desktop.png"), fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    for (const name of ["Salesperson", "Source", "Sales team", "Project", "Subproject"]) {
      await expect(page.getByRole("combobox", { name, exact: true })).toBeVisible()
    }
    await page.getByRole("combobox", { name: "Salesperson", exact: true }).click()
    await page.getByRole("option", { name: "Access admin", exact: true }).click()
    await page.screenshot({ path: testInfo.outputPath("import-mapping-mobile.png"), fullPage: true, animations: "disabled" })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.getByRole("button", { name: "Validate rows", exact: true }).click()
    await expect(page.getByRole("button", { name: "Import 1 ready row" })).toBeVisible({ timeout: 30000 })
    expect((await json(context, "/api/crm/enquiries")).total).toBe(0)
    await page.screenshot({ path: testInfo.outputPath("import-review-desktop.png"), fullPage: true })
    await page.getByRole("button", { name: "Import 1 ready row" }).click()
    await expect(page.getByText("1 enquiry imported. 2 rows skipped.", { exact: true })).toBeVisible({ timeout: 30000 })
    expect((await json(context, "/api/crm/enquiries")).total).toBe(1)
    const downloaded = page.waitForEvent("download")
    await page.getByRole("link", { name: "Download correction sheet" }).click()
    const download = await downloaded
    const csv = await readFile((await download.path())!, "utf8")
    const rows = parse(csv, { columns: true, bom: true }) as Record<string, string>[]
    expect(rows).toHaveLength(2)
    expect(rows.map(r => r["Contact name"])).toEqual(["Duplicate", "Bob"])
    expect(rows[0]["Import errors"]).toContain("Duplicate")
    await page.getByRole("button", { name: "Upload another sheet" }).click()
    await page.getByLabel("Enquiry file").setInputFiles({ name: "corrected.csv", mimeType: "text/csv", buffer: Buffer.from(csv.replace("bad-address", "bob@example.com")) })
    await page.getByRole("button", { name: "Upload and map fields" }).click()
    await page.getByRole("button", { name: "Validate rows", exact: true }).click()
    await expect(page.getByRole("button", { name: "Import 1 ready row" })).toBeVisible({ timeout: 30000 })
    await page.getByRole("button", { name: "Import 1 ready row" }).click()
    await expect(page.getByText("1 enquiry imported. 1 row skipped.", { exact: true })).toBeVisible({ timeout: 30000 })
    expect((await json(context, "/api/crm/enquiries")).total).toBe(2)
    await page.reload()
    await expect(page.getByText("1 enquiry imported. 1 row skipped.", { exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath("import-complete.png"), fullPage: true })
  } finally { await context.close(); await fixture.db.end() }
})

test("compact import progress survives an interruption and reload without losing correction rows", async ({ browser }, testInfo) => {
  test.setTimeout(180000)
  const fixture = await seed()
  const { context, page } = await login(browser, fixture.origin, fixture.users.admin.email)
  try {
    let validations = 0, interrupted = false
    const progress: ImportProgress[] = []
    await page.route(/\/api\/crm\/enquiry-imports\/[^/?]+$/, async route => {
      if (route.request().method() === "POST" && route.request().postDataJSON().action === "validate") {
        if (++validations === 2 && !interrupted) { interrupted = true; await route.abort("connectionreset"); return }
      }
      await route.continue()
    })
    page.on("response", async response => {
      if (response.request().method() === "POST" && /\/api\/crm\/enquiry-imports\/[^/?]+$/.test(response.url()) && response.ok()) {
        progress.push(await response.json())
      }
    })
    const rows = Array.from({ length: 61 }, (_, i) => [`Bulk ${i}`, `bulk-${i}@${fixture.slug}.test`])
    rows[25][1] = rows[0][1].toUpperCase()
    rows[60][1] = "invalid-address"
    await page.goto("/crm/enquiries/import")
    await page.getByLabel("Enquiry file").setInputFiles({ name: "bulk-leads.csv", mimeType: "text/csv", buffer: Buffer.from([['Name', 'Email'], ...rows].map(row => row.join(',')).join('\n')) })
    await page.getByRole("button", { name: "Upload and map fields" }).click()
    await page.getByRole("button", { name: "Validate rows", exact: true }).click()
    await expect(page.getByRole("alert")).toBeVisible({ timeout: 30000 })
    await expect.poll(() => progress.length).toBe(1)
    const firstCount = progress[0].counts.READY
    expect(firstCount).toBeGreaterThan(0)
    expect(firstCount).toBeLessThanOrEqual(25)
    await expect(page.getByText(new RegExp(`Processing paused.*${firstCount} rows processed`))).toBeVisible()
    expect((await json(context, "/api/crm/enquiries")).total).toBe(0)
    await page.reload()
    await page.getByRole("button", { name: "Resume validation" }).click()
    await expect(page.getByRole("button", { name: "Import 59 ready rows" })).toBeVisible({ timeout: 60000 })
    await page.getByRole("button", { name: "Import 59 ready rows" }).click()
    await expect(page.getByText("59 enquiries imported. 2 rows skipped.", { exact: true })).toBeVisible({ timeout: 60000 })
    expect((await json(context, "/api/crm/enquiries")).total).toBe(59)
    await expect.poll(() => progress.filter(p => p.status === "COMPLETE").length).toBe(1)
    expect(progress.every(p => Object.keys(p).sort().join(',') === 'counts,id,status')).toBe(true)
    expect(progress[0].counts.PENDING).toBe(61 - firstCount)
    expect(progress.length).toBeGreaterThanOrEqual(6)
    expect(progress.length).toBeLessThan(26)
    await page.getByRole("button", { name: "Show import rows", exact: true }).click()
    await page.getByRole("menuitemradio", { name: "Errors and duplicates", exact: true }).click()
    await expect(page.getByRole("cell", { name: "Bulk 25", exact: true })).toBeVisible()
    await expect(page.getByRole("cell", { name: "Bulk 60", exact: true })).toBeVisible()
    const downloaded = page.waitForEvent("download")
    await page.getByRole("link", { name: "Download correction sheet" }).click()
    const correction = parse(await readFile((await (await downloaded).path())!, "utf8"), { bom: true })
    expect(correction).toHaveLength(3)
    await page.screenshot({ path: testInfo.outputPath("bulk-import-corrections.png"), fullPage: true })
  } finally { await context.close(); await fixture.db.end() }
})
