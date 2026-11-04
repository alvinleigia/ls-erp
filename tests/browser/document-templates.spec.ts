import { test, expect, type Page } from "@playwright/test"
import { orderTemplateCatalog } from "../../modules/sales-orders/document-template"
import { starterDocumentLayout } from "../../platform/documents/layout"
import type { DocumentContent } from "../../platform/documents/validation"

const company = { id: "qa-company", name: "QA Demo Business", archived: false }
const booking = "real-estate.booking-intimation"
const acknowledgement = "order-acknowledgement"
const providers = [{ key: booking, name: "Booking intimation letter" }, { key: acknowledgement, name: "Order acknowledgement" }]
const catalog = { ...orderTemplateCatalog, sections: [...orderTemplateCatalog.sections, { key: "property-units", label: "Property units", required: true }] }
const draft = (title: string): DocumentContent => ({
  title, opening: "Saved opening wording", terms: "Saved reviewed terms", address: "Saved office address",
  contact: "office@example.test", signatory: "Authorised signatory", useTenantLogo: false, enabled: true,
  layout: starterDocumentLayout(catalog),
})

async function fixture(page: Page, options: { version?: number; canPublish?: boolean; rejectRefreshAfterPublish?: boolean } = {}) {
  const templates = Object.fromEntries(providers.map(provider => [provider.key, { version: options.version ?? 2, content: { ...draft(provider.name), enabled: options.version !== 0 } }]))
  const state = { templates, attempts: [] as { companyId: string; providerKey: string; version: number; content: DocumentContent; reviewed: boolean }[], publications: 0, reads: 0, failNext: false }
  const unexpected: string[] = []
  await page.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method()
    const json = (body: unknown, status = 200) => route.fulfill({ status, json: body })
    if (url.pathname === "/api/document-templates/catalog" && method === "GET") return json({ items: [company], total: 1, providers, canPublish: options.canPublish ?? true })
    if (url.pathname === "/api/document-templates" && method === "GET") {
      state.reads++
      if (options.rejectRefreshAfterPublish && state.publications) return json({ error: "Refresh is temporarily unavailable." }, 503)
      const providerKey = url.searchParams.get("providerKey") || booking
      return json({ company, providerKey, ...templates[providerKey], templateCatalog: catalog })
    }
    if (url.pathname === "/api/document-templates" && method === "PUT") {
      const input = request.postDataJSON(); state.attempts.push(input)
      if (state.failNext) { state.failNext = false; return json({ error: "Unable to publish this version. Try again." }, 503) }
      if (input.version !== templates[input.providerKey].version) return json({ error: "This template changed. Reload before publishing; your draft is retained." }, 409)
      expect(input.companyId).toBe(company.id); expect(input.reviewed).toBe(true)
      templates[input.providerKey] = { version: input.version + 1, content: input.content }
      state.publications++
      return json({ version: input.version + 1 })
    }
    unexpected.push(`${method} ${url.pathname}`)
    return json({ error: "Unexpected synthetic API request" }, 500)
  })
  await page.goto("/settings/documents")
  await expect(page.getByLabel("Document title", { exact: true })).toHaveValue("Booking intimation letter")
  return { state, unexpected }
}

const review = (page: Page) => page.getByLabel("I have reviewed the wording, company details and enablement for this version.", { exact: true })
const publish = (page: Page) => page.getByRole("button", { name: "Publish template version", exact: true })

test.beforeEach(({ baseURL }) => test.skip(baseURL !== "http://127.0.0.1:3012", "Synthetic component host only."))

test("publishing confirms the saved version in place and cannot republish unchanged content", async ({ page }) => {
  const { state, unexpected } = await fixture(page, { rejectRefreshAfterPublish: true })
  const layout = JSON.stringify(state.templates[booking].content.layout)
  await expect(page.getByRole("button", { name: "Published version 2", exact: true })).toBeDisabled()
  await expect(review(page)).toHaveCount(0)
  await page.getByLabel("Issuing company address", { exact: true }).fill("Reviewed Goa office")
  await expect(publish(page)).toBeDisabled()
  await review(page).check(); await publish(page).click()
  await expect(page.getByRole("status")).toHaveText("Version 3 published successfully. Enabled for new documents.")
  await expect(page.getByRole("heading", { name: "QA Demo Business - version 3", exact: true })).toBeVisible()
  await expect(page.getByLabel("Issuing company address", { exact: true })).toHaveValue("Reviewed Goa office")
  await expect(page.getByRole("button", { name: "Published version 3", exact: true })).toBeDisabled()
  await expect(page.getByText("All changes are published. Edit the template to create a new version.", { exact: true })).toBeVisible()
  await expect(review(page)).toHaveCount(0)
  expect(state.reads).toBe(1); expect(state.attempts).toHaveLength(1); expect(state.publications).toBe(1)
  expect(JSON.stringify(state.templates[booking].content.layout)).toBe(layout)
  expect(unexpected).toEqual([])
})

test("editing requires a fresh review and reverting changes restores the published state", async ({ page }) => {
  const { state } = await fixture(page)
  const terms = page.getByLabel("Terms and notes", { exact: true })
  await terms.fill("Updated wording")
  await review(page).check(); await expect(publish(page)).toBeEnabled()
  await terms.fill("Updated wording again")
  await expect(review(page)).not.toBeChecked(); await expect(publish(page)).toBeDisabled()
  await expect(page.getByText("Unpublished changes. Publishing will create version 3.", { exact: true })).toBeVisible()
  await terms.fill("Saved reviewed terms")
  await expect(review(page)).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Published version 2", exact: true })).toBeDisabled()
  await expect(page.getByLabel("Document type", { exact: true })).toBeEnabled()
  expect(state.attempts).toHaveLength(0)
})

test("a failed publication keeps the draft and review and can retry without a false success", async ({ page }) => {
  const { state } = await fixture(page)
  await page.getByLabel("Opening paragraph", { exact: true }).fill("Unsaved booking wording")
  await review(page).check(); state.failNext = true; await publish(page).click()
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Unable to publish this version. Try again.")
  await expect(page.getByRole("status")).toHaveCount(0)
  await expect(page.getByLabel("Opening paragraph", { exact: true })).toHaveValue("Unsaved booking wording")
  await expect(review(page)).toBeChecked(); await expect(publish(page)).toBeEnabled()
  expect(state.publications).toBe(0)
  await publish(page).click()
  await expect(page.getByRole("status")).toContainText("Version 3 published successfully.")
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0)
  expect(state.attempts).toHaveLength(2); expect(state.publications).toBe(1)
})

test("a stale version retains edits until the user explicitly discards and reloads", async ({ page }) => {
  const { state } = await fixture(page)
  await page.getByLabel("Terms and notes", { exact: true }).fill("My pending changes")
  await review(page).check()
  state.templates[booking] = { version: 4, content: { ...state.templates[booking].content, terms: "Another administrator's saved version" } }
  await publish(page).click()
  await expect(page.getByRole("main").getByRole("alert")).toContainText("This template changed.")
  await expect(page.getByLabel("Terms and notes", { exact: true })).toHaveValue("My pending changes")
  await expect(page.getByRole("status")).toHaveCount(0)
  await page.getByRole("button", { name: "Reload saved details", exact: true }).click()
  await page.getByRole("button", { name: "Keep editing", exact: true }).click()
  await expect(page.getByLabel("Terms and notes", { exact: true })).toHaveValue("My pending changes")
  await page.getByRole("button", { name: "Reload saved details", exact: true }).click()
  await page.getByRole("button", { name: "Discard and reload", exact: true }).click()
  await expect(page.getByLabel("Terms and notes", { exact: true })).toHaveValue("Another administrator's saved version")
  await expect(page.getByRole("button", { name: "Published version 4", exact: true })).toBeDisabled()
  await expect(review(page)).toHaveCount(0)
  expect(state.publications).toBe(0)
})

test("an unchanged starter can be published once and disabled issuance is stated explicitly", async ({ page }) => {
  const { state } = await fixture(page, { version: 0 })
  await expect(publish(page)).toBeDisabled()
  await page.getByLabel("Enable new issuance with this version", { exact: true }).uncheck()
  await review(page).check(); await publish(page).click()
  await expect(page.getByRole("status")).toHaveText("Version 1 published successfully. New issuance is disabled.")
  await expect(page.getByRole("button", { name: "Published version 1", exact: true })).toBeDisabled()
  await expect(page.getByText("Published version 1. New issuance is disabled.", { exact: true })).toBeVisible()
  expect(state.publications).toBe(1)
})

test("published templates remain read-only without publication authority", async ({ page }) => {
  const { state } = await fixture(page, { canPublish: false })
  await expect(page.getByLabel("Document title", { exact: true })).toBeDisabled()
  await expect(page.getByRole("button", { name: "Add paragraph", exact: true })).toBeDisabled()
  await expect(publish(page)).toHaveCount(0); await expect(review(page)).toHaveCount(0)
  expect(state.attempts).toHaveLength(0)
})

test("mobile success stays beside the actions and selecting another document clears it", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const { state, unexpected } = await fixture(page)
  await page.getByLabel("Office contact details", { exact: true }).fill("reviewed-office@example.test")
  await review(page).check(); await publish(page).click()
  const status = page.getByRole("status")
  await expect(status).toContainText("Version 3 published successfully.")
  await status.scrollIntoViewIfNeeded()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const bounds = await status.boundingBox(); expect(bounds!.y).toBeGreaterThanOrEqual(0); expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844)
  await page.screenshot({ path: test.info().outputPath("published-template-mobile.png"), animations: "disabled" })
  await page.setViewportSize({ width: 1440, height: 1000 }); await status.scrollIntoViewIfNeeded()
  await page.screenshot({ path: test.info().outputPath("published-template-desktop.png"), animations: "disabled" })
  await page.getByLabel("Document type", { exact: true }).click()
  await page.getByRole("menuitemradio", { name: "Order acknowledgement", exact: true }).click()
  await expect(page.getByLabel("Document title", { exact: true })).toHaveValue("Order acknowledgement")
  await expect(status).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Published version 2", exact: true })).toBeDisabled()
  expect(state.publications).toBe(1); expect(unexpected).toEqual([])
})
