import { test, expect } from "@playwright/test"
import sharp from "sharp"
import { createHash } from "node:crypto"
import { PDFDocument } from "pdf-lib"
import { seed, login, json } from "./fixtures"
import { emptyQuotationContent } from "../../modules/sales-documents/quotation-validation"

test("tenant logos are optimized and isolated; draft PDF previews stay transient and issued PDFs stay immutable", async ({ browser }, info) => {
  const fixture = await seed(), admin = await login(browser, fixture.origin, fixture.users.admin.email), other = await login(browser, fixture.otherOrigin, fixture.users.other.email), staff = await login(browser, fixture.origin, fixture.users.staff.email)
  const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex")
  try {
    const foreign = await json(other.context, "/api/settings/branding")
    expect((await json(admin.context, "/api/settings/branding")).storageReady).toBe(true)
    const bytes = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="800"><rect width="2400" height="800" fill="#2563eb"/><text x="200" y="450" font-size="240" fill="white">QA R9</text></svg>')).png().toBuffer()
    await admin.page.goto("/settings/branding")
    await admin.page.getByLabel("Upload logo", { exact: true }).setInputFiles({ name: "qa-r9.png", mimeType: "image/png", buffer: bytes })
    await expect(admin.page.getByAltText("Light background logo preview")).toBeVisible()
    await admin.page.getByLabel("Business display name", { exact: true }).fill("QA R9 Industries")
    await admin.page.getByRole("button", { name: "Save branding", exact: true }).click()
    await expect(admin.page.getByText("Branding saved.", { exact: true })).toBeVisible()
    const branding = await json(admin.context, "/api/settings/branding")
    expect(branding.branding.logo.document.bytes).toBeLessThanOrEqual(524288)
    expect(branding.branding.logo.sidebar.bytes).toBeLessThanOrEqual(524288)
    expect((await json(other.context, "/api/settings/branding")).branding).toEqual(foreign.branding)
    await admin.page.setViewportSize({ width: 390, height: 844 })
    expect(await admin.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await admin.page.screenshot({ path: info.outputPath("branding-mobile.png"), fullPage: true })
    const contact = await json(admin.context, "/api/crm/contacts", 201, "POST", { name: "PDF boundary customer" })
    const pipeline = await json(admin.context, "/api/crm/pipelines", 201, "POST", { name: "PDF issue pipeline", stages: [{ name: "Open", kind: "OPEN", probability: 10, color: "#123456" }, { name: "Won", kind: "WON", probability: 100, color: "#00aa00" }, { name: "Lost", kind: "LOST", probability: 0, color: "#aa0000" }] })
    const deal = await json(admin.context, "/api/crm/opportunities", 201, "POST", { title: "QA R9 PDF agreement", contactId: contact.id, assignedUserId: fixture.users.admin.id, pipelineId: pipeline.id, stageId: pipeline.stages[0].id, amount: "1000", currency: "INR", expectedCloseOn: "2030-10-31" })
    const content = { ...structuredClone(emptyQuotationContent), title: "QA R9 PDF quotation", supplierName: "QA R9 Industries", currency: "INR", lines: [{ description: "QA support", quantity: "1", unit: "item", rate: "1000" }] }
    const quote = await json(admin.context, `/api/crm/opportunities/${deal.id}/quotations`, 201, "POST", { content })
    expect((await json(admin.context, `/api/crm/quotations/${quote.id}`)).archivedPdf).toBeNull()
    const preview = await admin.context.request.get(`/api/crm/quotations/${quote.id}/pdf?revision=1`)
    expect(preview.status()).toBe(200)
    expect((await PDFDocument.load(await preview.body())).getPageCount()).toBeGreaterThan(0)
    expect((await json(admin.context, `/api/crm/quotations/${quote.id}`)).archivedPdf).toBeNull()
    await admin.page.goto(`/crm/quotations/${quote.id}`)
    await admin.page.getByRole("button", { name: "Issue & Download", exact: true }).click()
    const downloaded = admin.page.waitForEvent("download")
    await admin.page.getByRole("dialog").getByRole("button", { name: "Issue & Download", exact: true }).click()
    await (await downloaded).saveAs(info.outputPath("issued.pdf"))
    const issued = await json(admin.context, `/api/crm/quotations/${quote.id}`)
    expect(issued.archivedPdf.sha256).toMatch(/^[a-f0-9]{64}$/)
    const first = await admin.context.request.get(`/api/crm/quotations/${quote.id}/pdf?revision=1`), second = await admin.context.request.get(`/api/crm/quotations/${quote.id}/pdf?revision=1`)
    expect(first.status()).toBe(200); expect(second.status()).toBe(200)
    expect(hash(await first.body())).toBe(issued.archivedPdf.sha256)
    expect(hash(await second.body())).toBe(issued.archivedPdf.sha256)
    await json(other.context, `/api/crm/quotations/${quote.id}`, 404)
    await json(admin.context, `/api/crm/quotations/${quote.id}`, 200, "PUT", { version: 1, content: { ...content, title: content.title + " revised" } })
    expect((await json(admin.context, `/api/crm/quotations/${quote.id}`)).archivedPdf).toBeNull()
    const historical = await admin.context.request.get(`/api/crm/quotations/${quote.id}/pdf?revision=1`)
    expect(hash(await historical.body())).toBe(issued.archivedPdf.sha256)
    const assignment = await json(admin.context, `/api/access/users/${fixture.users.staff.id}`)
    await json(admin.context, `/api/access/users/${fixture.users.staff.id}`, 200, "PATCH", { roleIds: [fixture.profileId], version: assignment.accessPolicy.version, rules: { ...assignment.accessPolicy.rules, "branding.edit": "NONE" } })
    expect((await staff.context.request.post("/api/settings/branding/preview", { multipart: { logo: { name: "qa.png", mimeType: "image/png", buffer: bytes } } })).status()).toBe(403)
  } finally { await staff.context.close(); await other.context.close(); await admin.context.close(); await fixture.db.end() }
})
