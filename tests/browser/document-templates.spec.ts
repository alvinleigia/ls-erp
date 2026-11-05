import { test, expect, type Page } from "@playwright/test"
import { orderTemplateCatalog } from "../../modules/sales-orders/document-template"
import { inlineDocumentWording, starterDocumentLayout } from "../../platform/documents/layout"
import type { DocumentContent } from "../../platform/documents/validation"
import { propertyDocumentFields, propertyUnitsSection } from "../../modules/real-estate/document-fields"
import { defaultDocumentAppearance } from "../../platform/documents/appearance"

const company = { id: "qa-company", name: "QA Demo Business", archived: false }
const booking = "real-estate.booking-intimation"
const acknowledgement = "order-acknowledgement"
const providers = [{ key: booking, name: "Booking intimation letter" }, { key: acknowledgement, name: "Order acknowledgement" }]
const catalog = { ...orderTemplateCatalog, fields: [...orderTemplateCatalog.fields, ...propertyDocumentFields], sections: [...orderTemplateCatalog.sections, propertyUnitsSection] }
const draft = (title: string): DocumentContent => ({
  title, opening: "Saved opening wording", terms: "Saved reviewed terms", address: "Saved office address",
  contact: "office@example.test", signatory: "Authorised signatory", useTenantLogo: false, enabled: true,
  layout: starterDocumentLayout(catalog),
})

async function fixture(page: Page, options: { version?: number; canPublish?: boolean; rejectRefreshAfterPublish?: boolean; styled?: boolean } = {}) {
  const templates = Object.fromEntries(providers.map(provider => [provider.key, { version: options.version ?? 2, content: { ...draft(provider.name), enabled: options.version !== 0, ...(options.styled ? { appearance: { ...defaultDocumentAppearance } } : {}) } }]))
  const state = { templates, attempts: [] as { companyId: string; providerKey: string; version: number; content: DocumentContent; reviewed: boolean }[], previews: [] as DocumentContent[], publications: 0, reads: 0, failNext: false }
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
    if (url.pathname === "/api/document-templates/preview" && method === "POST") {
      state.previews.push(request.postDataJSON().content)
      return route.fulfill({ body: "%PDF-1.7\nSynthetic download fixture", contentType: "application/pdf" })
    }
    unexpected.push(`${method} ${url.pathname}`)
    return json({ error: "Unexpected synthetic API request" }, 500)
  })
  await page.goto("/settings/documents")
  await expect(page.getByLabel("Document title", { exact: true })).toHaveValue("Booking intimation letter")
  return { state, unexpected }
}

const opening = (page: Page) => page.getByRole("textbox", { name: "Document layout", exact: true }).locator("p").first()
const terms = (page: Page) => page.getByRole("textbox", { name: "Document layout", exact: true }).locator("p").last()
const review = (page: Page) => page.getByLabel("I have reviewed the wording, company details and enablement for this version.", { exact: true })
const publish = (page: Page) => page.getByRole("button", { name: "Publish template version", exact: true })

test.beforeEach(({ baseURL }) => test.skip(baseURL !== "http://127.0.0.1:3012", "Synthetic component host only."))

test("publishing confirms the saved version in place and cannot republish unchanged content", async ({ page }) => {
  const { state, unexpected } = await fixture(page, { rejectRefreshAfterPublish: true })
  const layout = inlineDocumentWording(state.templates[booking].content.layout!, state.templates[booking].content)
  await expect(page.getByRole("button", { name: "Published version 2", exact: true })).toBeDisabled()
  await expect(review(page)).toHaveCount(0)
  await page.getByRole("tab", { name: "Company", exact: true }).click()
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
  expect(state.templates[booking].content.layout).toEqual(layout)
  expect(unexpected).toEqual([])
})

test("editing requires a fresh review and reverting changes restores the published state", async ({ page }) => {
  const { state } = await fixture(page)
  const wording = terms(page)
  await wording.fill("Updated wording")
  await review(page).check(); await expect(publish(page)).toBeEnabled()
  await wording.fill("Updated wording again")
  await expect(review(page)).not.toBeChecked(); await expect(publish(page)).toBeDisabled()
  await expect(page.getByText("Unpublished changes. Publishing will create version 3.", { exact: true })).toBeVisible()
  await wording.fill("Saved reviewed terms")
  await expect(review(page)).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Published version 2", exact: true })).toBeDisabled()
  await expect(page.getByLabel("Document type", { exact: true })).toBeEnabled()
  expect(state.attempts).toHaveLength(0)
})

test("a failed publication keeps the draft and review and can retry without a false success", async ({ page }) => {
  const { state } = await fixture(page)
  await opening(page).fill("Unsaved booking wording")
  await review(page).check(); state.failNext = true; await publish(page).click()
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Unable to publish this version. Try again.")
  await expect(page.getByRole("status")).toHaveCount(0)
  await expect(opening(page)).toHaveText("Unsaved booking wording")
  await expect(review(page)).toBeChecked(); await expect(publish(page)).toBeEnabled()
  expect(state.publications).toBe(0)
  await publish(page).click()
  await expect(page.getByRole("status")).toContainText("Version 3 published successfully.")
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0)
  expect(state.attempts).toHaveLength(2); expect(state.publications).toBe(1)
})

test("a stale version retains edits until the user explicitly discards and reloads", async ({ page }) => {
  const { state } = await fixture(page)
  await terms(page).fill("My pending changes")
  await review(page).check()
  state.templates[booking] = { version: 4, content: { ...state.templates[booking].content, terms: "Another administrator's saved version" } }
  await publish(page).click()
  await expect(page.getByRole("main").getByRole("alert")).toContainText("This template changed.")
  await expect(terms(page)).toHaveText("My pending changes")
  await expect(page.getByRole("status")).toHaveCount(0)
  await page.getByRole("button", { name: "Reload saved details", exact: true }).click()
  await page.getByRole("button", { name: "Keep editing", exact: true }).click()
  await expect(terms(page)).toHaveText("My pending changes")
  await page.getByRole("button", { name: "Reload saved details", exact: true }).click()
  await page.getByRole("button", { name: "Discard and reload", exact: true }).click()
  await expect(terms(page)).toHaveText("Another administrator's saved version")
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
  await page.getByRole("tab", { name: "Content", exact: true }).click()
  await expect(page.getByRole("button", { name: "Add paragraph", exact: true })).toBeDisabled()
  await expect(publish(page)).toHaveCount(0); await expect(review(page)).toHaveCount(0)
  expect(state.attempts).toHaveLength(0)
})

test("mobile success stays beside the actions and selecting another document clears it", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const { state, unexpected } = await fixture(page)
  await page.getByRole("tab", { name: "Company", exact: true }).click()
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
  await page.getByRole("tab", { name: "Content", exact: true }).click()
  await expect(page.getByLabel("Document title", { exact: true })).toHaveValue("Order acknowledgement")
  await expect(status).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Published version 2", exact: true })).toBeDisabled()
  expect(state.publications).toBe(1); expect(unexpected).toEqual([])
})

test("styling is an unsaved draft until explicit preview and reviewed publication", async ({ page }) => {
  const { state, unexpected } = await fixture(page)
  await page.getByRole("tab", { name: "PDF style", exact: true }).click()
  await page.getByLabel("Customise document styling", { exact: true }).check()
  await page.getByRole("tab", { name: "Tables and footer", exact: true }).click()
  await page.getByLabel("Repeating footer", { exact: true }).fill("Example Business | example.test")
  await page.getByRole("button", { name: "Letter style", exact: true }).click()
  await page.getByRole("tab", { name: "Letterhead", exact: true }).click()
  await page.getByLabel("Repeat logo on later pages", { exact: true }).check()
  await page.getByLabel("Use the selected document logo as a watermark", { exact: true }).check()
  await page.getByRole("tab", { name: "Tables and footer", exact: true }).click()
  await expect(page.getByLabel("Repeating footer", { exact: true })).toHaveValue("Example Business | example.test")
  expect(state.previews).toHaveLength(0); expect(state.attempts).toHaveLength(0)
  const download = page.waitForEvent("download")
  await page.getByRole("button", { name: "Download sample preview", exact: true }).click(); await download
  expect(state.previews).toHaveLength(1); expect(state.publications).toBe(0)
  await review(page).check()
  await page.getByRole("button", { name: "Compact style", exact: true }).click()
  await expect(review(page)).not.toBeChecked(); await expect(publish(page)).toBeDisabled()
  await review(page).check(); await publish(page).click()
  const saved = state.templates[booking].content
  expect(saved.appearance).toMatchObject({ fontSize: 9, margins: "narrow", tableStyle: "grid", repeatLogo: true, watermark: true, footer: "Example Business | example.test" })
  expect(saved.opening).toBe("Saved opening wording"); expect(saved.terms).toBe("Saved reviewed terms")
  expect(state.publications).toBe(1); expect(unexpected).toEqual([])
})

test("read-only styling remains inspectable and mobile styling stays within its panel", async ({ page }) => {
  const { state } = await fixture(page, { canPublish: false, styled: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole("tab", { name: "PDF style", exact: true }).click()
  await expect(page.getByLabel("Customise document styling", { exact: true })).toBeDisabled()
  await page.getByRole("tab", { name: "Letterhead", exact: true }).click()
  await expect(page.getByLabel("Repeat logo on later pages", { exact: true })).toBeDisabled()
  await page.getByRole("tab", { name: "Tables and footer", exact: true }).click()
  await expect(page.getByLabel("Repeating footer", { exact: true })).toBeDisabled()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(state.attempts).toHaveLength(0); expect(state.previews).toHaveLength(0)
  await page.screenshot({ path: test.info().outputPath("document-styling-mobile.png"), fullPage: true, animations: "disabled" })
})

test("compact section presentation preserves required sections and publishes their display choice", async ({ page }) => {
  const { state } = await fixture(page)
  await page.getByRole("tab", { name: "Content", exact: true }).click()
  const layout = page.getByRole("textbox", { name: "Document layout", exact: true })
  await layout.getByText("Section: Payment schedule", { exact: true }).click()
  await page.getByLabel("Show table rows in this section as compact labelled details", { exact: true }).check()
  await review(page).check(); await publish(page).click()
  const nodes = state.templates[booking].content.layout!.content
  expect(nodes.some(node => node.type === "documentSection" && node.attrs.key === "payment-schedule" && node.attrs.compact)).toBe(true)
  for (const section of catalog.sections.filter(section => section.required)) expect(nodes.filter(node => node.type === "documentSection" && node.attrs.key === section.key)).toHaveLength(1)
})

test("saved company details control the letterhead and footer without disabling other style controls", async ({ page }) => {
  const { state, unexpected } = await fixture(page, { styled: true })
  await page.getByRole("tab", { name: "Company", exact: true }).click()
  await page.getByLabel("Use saved company document details", { exact: true }).check()
  await expect(page.getByLabel("Issuing company address", { exact: true })).toHaveCount(0)
  await expect(page.getByRole("link", { name: "Edit company details", exact: true })).toHaveAttribute("href", "/settings/companies/qa-company")
  await page.getByRole("tab", { name: "PDF style", exact: true }).click()
  await page.getByRole("tab", { name: "Tables and footer", exact: true }).click()
  await expect(page.getByLabel("Repeating footer", { exact: true })).toBeDisabled()
  await expect(page.getByLabel("Table style", { exact: true })).toBeEnabled()
  const download = page.waitForEvent("download")
  await page.getByRole("button", { name: "Download sample preview", exact: true }).click()
  await download
  expect(state.previews.at(-1)?.useCompanyDetails).toBe(true)
  expect(state.publications).toBe(0); expect(unexpected).toEqual([])
})

test("field panel preserves insertion position through search and keyboard insertion, bold and undo", async ({ page }) => {
  const { state, unexpected } = await fixture(page)
  await page.getByRole("tab", { name: "Content", exact: true }).click()
  const editor = page.getByRole("textbox", { name: "Document layout", exact: true })
  // Insert a field in the middle, rather than replacing the current paragraph or appending it.
  await editor.locator("p").first().click()
  await page.keyboard.press("Home"); await page.keyboard.type("Dear , remaining wording")
  await page.keyboard.press("Home"); for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight")
  const search = page.getByRole("textbox", { name: "Find fields or sections", exact: true })
  await search.fill("Customer")
  await page.getByRole("button", { name: "Insert Customer name", exact: true }).focus()
  await page.keyboard.press("Enter")
  await expect(editor.locator("p").first()).toContainText("Dear Customer name, remaining wording")
  // Selecting the fixed label can be formatted independently from the inserted value.
  await editor.locator("p").first().dblclick({ position: { x: 10, y: 8 } })
  await expect.poll(() => page.evaluate(() => getSelection()?.toString().trim())).toBe("Dear")
  await page.getByRole("button", { name: "Bold", exact: true }).click()
  await expect(editor.locator("strong").first()).toHaveText("Dear")
  await page.keyboard.press("Control+z")
  await expect(editor.locator("strong")).toHaveCount(0)
  await search.fill("impossible-match")
  await expect(page.getByText("No matching fields or sections.", { exact: true })).toBeVisible()
  await search.fill("Property")
  await expect(page.getByRole("button", { name: "Insert Project / phase name", exact: true })).toBeVisible()
  expect(state.previews).toHaveLength(0); expect(state.publications).toBe(0)
  const download = page.waitForEvent("download")
  await page.getByRole("button", { name: "Download sample preview", exact: true }).click(); await download
  expect(JSON.stringify(state.previews.at(-1)?.layout)).toContain('"customer.name"')
  await page.getByRole("tab", { name: "Content", exact: true }).click()
  await page.getByRole("tab", { name: "Content", exact: true }).click()
  await expect(editor.locator("p").first()).toContainText("Dear Customer name, remaining wording")
  expect(state.publications).toBe(0); expect(unexpected).toEqual([])
  await page.screenshot({ path: test.info().outputPath("dynamic-field-panel-desktop.png"), fullPage: true, animations: "disabled" })
})

test("mobile field panel is contained and read-only fields cannot insert or mutate the draft", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const { state } = await fixture(page, { canPublish: false })
  const before = JSON.stringify(state.templates[booking].content.layout)
  await page.getByRole("tab", { name: "Content", exact: true }).click()
  const search = page.getByRole("textbox", { name: "Find fields or sections", exact: true })
  await search.fill("Property")
  await expect(page.getByRole("button", { name: "Insert Unit code", exact: true })).toBeDisabled()
  await expect(page.getByRole("button", { name: "Insert section: Property units", exact: true })).toBeDisabled()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(JSON.stringify(state.templates[booking].content.layout)).toBe(before)
  expect(state.attempts).toHaveLength(0); expect(state.previews).toHaveLength(0)
  await page.getByRole("complementary", { name: "Insert dynamic content" }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: test.info().outputPath("dynamic-field-panel-mobile.png"), animations: "disabled" })
})

test("fixed labels and dynamic values retain bold independently and blank paragraphs survive preview", async ({ page }) => {
  const { state } = await fixture(page)
  await page.getByRole("tab", { name: "Content", exact: true }).click()
  const editor = page.getByRole("textbox", { name: "Document layout", exact: true })
  await editor.locator("p").first().click(); await page.keyboard.press("Control+Home")
  await page.getByRole("button", { name: "Bold", exact: true }).click()
  await expect(editor).toBeFocused()
  await page.keyboard.type("Project: ")
  await page.getByRole("button", { name: "Bold", exact: true }).click()
  await expect(editor).toBeFocused()
  await page.getByRole("textbox", { name: "Find fields or sections", exact: true }).fill("Project")
  await page.getByRole("button", { name: "Insert Project / phase name", exact: true }).click()
  await expect(editor).toBeFocused()
  await expect(editor.locator("p").first()).toContainText("Project: Project / phase name")
  await editor.getByText("Project / phase name", { exact: true }).click()
  await page.getByRole("button", { name: "Bold", exact: true }).click()
  await expect(editor).toBeFocused()
  await page.keyboard.press("ArrowRight"); await page.keyboard.press("Enter"); await page.keyboard.press("Enter")
  const download = page.waitForEvent("download")
  await page.getByRole("button", { name: "Download sample preview", exact: true }).click(); await download
  const nodes = state.previews.at(-1)!.layout!.content
  const first = nodes[0]
  expect(first.type).toBe("paragraph")
  if (first.type !== "paragraph") throw Error("Expected formatted paragraph")
  expect(first.content?.find(n => n.type === "text" && n.text === "Project: ")?.marks).toContainEqual({ type: "bold" })
  expect(first.content?.find(n => n.type === "documentField" && n.attrs.key === "property.project-name")?.marks).toContainEqual({ type: "bold" })
  expect(nodes.some(n => n.type === "paragraph" && !n.content?.length)).toBe(true)
  expect(state.publications).toBe(0)
})

test("adding a paragraph preserves a selected required source section", async ({ page }) => {
  const { state } = await fixture(page)
  await page.getByRole("tab", { name: "Content", exact: true }).click()
  const editor = page.getByRole("textbox", { name: "Document layout", exact: true })
  await editor.getByText("Section: Customers and correspondence", { exact: true }).click()
  await page.getByRole("button", { name: "Insert Customer name", exact: true }).click()
  await expect(editor.getByText("Section: Customers and correspondence", { exact: true })).toBeVisible()
  await editor.getByText("Section: Customers and correspondence", { exact: true }).click()
  await page.getByRole("button", { name: "Add paragraph", exact: true }).click()
  await page.keyboard.type("Additional approved wording")
  const download = page.waitForEvent("download")
  await page.getByRole("button", { name: "Download sample preview", exact: true }).click(); await download
  const nodes = state.previews.at(-1)!.layout!.content
  for (const section of catalog.sections.filter(s => s.required)) expect(nodes.filter(n => n.type === "documentSection" && n.attrs.key === section.key)).toHaveLength(1)
  await expect(editor.locator("p").last()).toHaveText("Additional approved wording")
  expect(state.publications).toBe(0)
})

test("content combines title, editable wording, underline and separators without saving on open", async ({ page }) => {
  const { state, unexpected } = await fixture(page)
  const original = JSON.stringify(state.templates[booking].content)
  const editor = page.getByRole("textbox", { name: "Document layout", exact: true })
  await expect(opening(page)).toHaveText("Saved opening wording")
  await expect(terms(page)).toHaveText("Saved reviewed terms")
  await expect(page.getByLabel("Opening paragraph", { exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Insert Opening wording", exact: true })).toHaveCount(0)
  expect(state.previews).toHaveLength(0); expect(state.publications).toBe(0)
  expect(JSON.stringify(state.templates[booking].content)).toBe(original)
  await page.getByLabel("Document title", { exact: true }).fill("Reviewed booking letter")
  await opening(page).fill("Welcome customer")
  await opening(page).dblclick({ position: { x: 25, y: 8 } })
  await expect.poll(() => page.evaluate(() => getSelection()?.toString().trim())).toBe("Welcome")
  await page.getByRole("button", { name: "Underline", exact: true }).click()
  await expect(editor.locator("u")).toHaveCount(1)
  await editor.getByText("Section: Customers and correspondence", { exact: true }).click()
  await page.getByRole("button", { name: "Separator", exact: true }).click()
  await expect(editor.locator("hr:not([data-document-page-break])")).toHaveCount(1)
  await expect(editor.getByText("Section: Customers and correspondence", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Undo", exact: true }).click()
  await expect(editor.locator("hr:not([data-document-page-break])")).toHaveCount(0)
  await page.getByRole("button", { name: "Redo", exact: true }).click()
  await expect(editor.locator("hr:not([data-document-page-break])")).toHaveCount(1)
  await page.getByRole("tab", { name: "Company", exact: true }).click()
  await page.getByRole("tab", { name: "Content", exact: true }).click()
  await expect(opening(page)).toHaveText("Welcome customer")
  const download = page.waitForEvent("download")
  await page.getByRole("button", { name: "Download sample preview", exact: true }).click(); await download
  const preview = state.previews.at(-1)!
  expect(preview.title).toBe("Reviewed booking letter")
  expect(JSON.stringify(preview.layout)).toContain('"underline"')
  expect(preview.layout!.content.some(n => n.type === "horizontalRule")).toBe(true)
  expect(JSON.stringify(preview.layout)).not.toContain('"template.opening"')
  expect(state.publications).toBe(0)
  await review(page).check(); await publish(page).click()
  await expect(page.getByRole("status")).toContainText("Version 3 published successfully.")
  expect(state.templates[booking].content.layout).toEqual(preview.layout)
  await page.screenshot({ path: test.info().outputPath("unified-document-editor-desktop.png"), fullPage: true, animations: "disabled" })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole("complementary", { name: "Insert dynamic content" }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: test.info().outputPath("unified-document-editor-mobile.png"), animations: "disabled" })
  expect(unexpected).toEqual([])
})

test("starter reset warns about replacing body wording and can cancel without losing edits", async ({ page }) => {
  const { state } = await fixture(page)
  await opening(page).fill("My unsaved wording")
  await page.getByRole("button", { name: "Use starter layout", exact: true }).click()
  await expect(page.getByRole("dialog")).toContainText("including edited wording and formatting")
  await page.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(opening(page)).toHaveText("My unsaved wording")
  await page.getByRole("button", { name: "Use starter layout", exact: true }).click()
  await page.getByRole("button", { name: "Replace layout", exact: true }).click()
  await expect(opening(page)).toHaveText("Saved opening wording")
  await expect(page.getByRole("button", { name: "Published version 2", exact: true })).toBeDisabled()
  expect(state.publications).toBe(0)
})

test("pasting supported formatting keeps page breaks distinct from separators and strips executable HTML", async ({ page }) => {
  const { state } = await fixture(page)
  const editor = page.getByRole("textbox", { name: "Document layout", exact: true })
  await page.getByRole("button", { name: "Add paragraph", exact: true }).click()
  await expect(editor).toBeFocused()
  await editor.evaluate(el => {
    const data = new DataTransfer()
    data.setData("text/html", '<p>Approved <u>wording</u></p><hr data-document-page-break=""><p>Next page</p><hr><script>window.untrustedTemplateScript=true</script>')
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }))
  })
  await expect(editor.locator("hr[data-document-page-break]")).toHaveCount(1)
  await expect(editor.locator("hr:not([data-document-page-break])")).toHaveCount(1)
  await expect(editor.locator("u")).toHaveText("wording")
  expect(await page.evaluate(() => "untrustedTemplateScript" in window)).toBe(false)
  const download = page.waitForEvent("download")
  await page.getByRole("button", { name: "Download sample preview", exact: true }).click(); await download
  const nodes = state.previews.at(-1)!.layout!.content
  expect(nodes.filter(n => n.type === "documentPageBreak")).toHaveLength(1)
  expect(nodes.filter(n => n.type === "horizontalRule")).toHaveLength(1)
  expect(JSON.stringify(nodes)).not.toContain("script")
  expect(state.publications).toBe(0)
})
