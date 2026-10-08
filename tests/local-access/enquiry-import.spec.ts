import { test, expect } from "@playwright/test"
import { readFile } from "node:fs/promises"
import { parse } from "csv-parse/sync"
import { seed, login, json } from "./fixtures"

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
    await page.screenshot({ path: testInfo.outputPath("import-mapping-mobile.png"), fullPage: true })
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
