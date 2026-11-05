import { test, expect } from "@playwright/test"
import { emptyCompanyDocumentSettings } from "../../platform/companies/document-settings"

test.beforeEach(({ baseURL }) => test.skip(baseURL !== "http://127.0.0.1:3012", "Synthetic UI only."))
test("company details and bank instructions survive tab changes and save together with the current version", async ({ page }) => {
  const company = { id: "company-test", name: "Example Industries", code: "MAIN", parentId: null, parent: null, archived: false, isInitial: true, version: 7, documentSettings: structuredClone(emptyCompanyDocumentSettings) }
  const writes: { version: number; documentSettings: typeof company.documentSettings }[] = []
  await page.route("**/api/**", route => {
    const request = route.request(), url = new URL(request.url())
    if (url.pathname === "/api/companies/company-test") {
      if (request.method() === "GET") return route.fulfill({ json: company })
      writes.push(request.postDataJSON()); return route.fulfill({ json: { ...company, version: 8 } })
    }
    return route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 20, totalPages: 1 } })
  })
  await page.goto("/settings/companies/company-test")
  await page.getByLabel("Document address", { exact: true }).fill("Example office, Goa")
  await page.getByLabel("Document footer", { exact: true }).fill("Example Industries\noffice@example.test")
  await page.getByRole("tab", { name: "Bank instructions", exact: true }).click()
  await page.getByLabel("Account name", { exact: true }).fill("Example Industries")
  await page.getByLabel("Account number", { exact: true }).fill("TEST-1234")
  await page.getByRole("tab", { name: "Letterhead printing", exact: true }).click()
  await page.getByLabel("Enable printing on preprinted letterhead", { exact: true }).check()
  await page.getByLabel("Reserved header space (mm)", { exact: true }).fill("55")
  await page.getByLabel("Reserved footer space (mm)", { exact: true }).fill("30")
  await page.getByRole("tab", { name: "Document details", exact: true }).click()
  await expect(page.getByLabel("Document address", { exact: true })).toHaveValue("Example office, Goa")
  await page.getByRole("button", { name: "Save changes", exact: true }).click()
  await expect.poll(() => writes.length).toBe(1)
  expect(writes[0].version).toBe(7); expect(writes[0].documentSettings.address).toBe("Example office, Goa"); expect(writes[0].documentSettings.bank.accountNumber).toBe("TEST-1234")
  expect(writes[0].documentSettings.letterhead).toEqual({ enabled: true, topMm: 55, bottomMm: 30 })
})

test("company settings fit a mobile viewport without dropping bank or contact fields", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.route("**/api/**", route => route.fulfill({ json: { items: [], total: 0 } }))
  await page.goto("/settings/companies/new")
  await page.getByLabel("Company name", { exact: true }).fill("Example company")
  await page.getByRole("tab", { name: "Bank instructions", exact: true }).click()
  await expect(page.getByLabel("IFSC / routing code", { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole("tab", { name: "Document details", exact: true }).click()
  await page.getByLabel("Document address", { exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: "test-results/company-document-settings-mobile.png" })
})
