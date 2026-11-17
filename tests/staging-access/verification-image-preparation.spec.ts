import fs from "node:fs"
import { createHash, randomBytes } from "node:crypto"
import sharp from "sharp"
import { PDFDocument } from "pdf-lib"
import { test, expect, type BrowserContext, type Page } from "@playwright/test"
import { stagingFixture } from "../helpers/p13s-staging"
import { api } from "../helpers/p13s-acceptance"
import { defaultRecordRules, supportedScopes } from "../../platform/access/rules"
import { type Resource } from "../../platform/access/catalog"

// Hosted acceptance uses synthetic customers and normal application/storage APIs.
// Never seed SQL, use service credentials, or mutate a production tenant here.
async function assign(c: BrowserContext, userId: string, name: string, permissions: string[]) {
  const role = await api(c, "/api/access/roles", 201, "POST", { name, permissions })
  const current = await api(c, `/api/access/users/${userId}`), rules = defaultRecordRules()
  for (const key of Object.keys(rules) as (keyof typeof rules)[]) if (supportedScopes(key.split(".")[0] as Resource).includes("ALL")) rules[key] = "ALL"
  await api(c, `/api/access/users/${userId}`, 200, "PATCH", { version: current.accessPolicy.version, roleIds: [role.id], rules })
}
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex")
async function original(c: BrowserContext, id: string) {
  const redirect = await c.request.get(`/api/verification/evidence/${id}/download`, { maxRedirects: 0 })
  expect(redirect.status()).toBe(303)
  const url = redirect.headers().location
  expect(new URL(url).hostname).toBe("oyhsrcmjhwxhvepdbcdc.supabase.co")
  const file = await c.request.get(url); expect(file.status()).toBe(200)
  return file.body()
}
async function upload(page: Page, name: string, mimeType: string, buffer: Buffer) {
  await page.getByLabel("Evidence file (up to 5 MB)").setInputFiles({ name, mimeType, buffer })
  await confirmUpload(page)
}
async function confirmUpload(page: Page) {
  const finalized = page.waitForResponse(r => r.url().endsWith("/finalize") && r.request().method() === "POST")
  await page.getByRole("button", { name: "Upload evidence", exact: true }).click()
  const result = await finalized; expect(result.status()).toBe(200)
  await expect(page.getByRole("button", { name: "Upload evidence", exact: true })).toBeDisabled()
  return (await result.json()).id as string
}

test("hosted image preparation, exact duplicate removal and independent review preserve originals and access boundaries", async ({ browser }, info) => {
  test.setTimeout(900_000)
  const f = await stagingFixture(browser, ["crm", "customerVerification"])
  const a = f.admin.context, o = f.operator.context, r = f.reviewer.context, page = f.operator.page, admin = f.admin.page
  const passed: string[] = []
  const record = async (name: string, work: () => Promise<void>) => {
    await test.step(name, work); passed.push(name)
    fs.writeFileSync(`tmp/p13s-staging/${f.receipt.slug}-image-progress.json`, JSON.stringify({ deployment: f.receipt.deployment, passed }, null, 2), { mode: 0o600 })
  }
  try {
    const company = await api(a, "/api/companies", 201, "POST", { code: "CROP", name: "Synthetic Upload Acceptance" })
    const office = await api(a, "/api/offices", 201, "POST", { companyId: company.id, code: "QA", name: "Synthetic test office" })
    for (const user of [f.admin, f.operator, f.reviewer]) {
      const current = await api(a, `/api/access/users/${user.id}/offices`)
      await api(a, `/api/access/users/${user.id}/offices`, 200, "PATCH", { version: current.version, officeIds: [office.id], companies: [], creationOfficeId: office.id })
    }
    await assign(a, f.operator.id, "Synthetic evidence collector", ["dashboard.read", "contacts.read", "contacts.create", "customerVerification.read", "customerVerification.create", "verificationUploads.read", "verificationUploads.create", "verificationUploads.cancel", "verificationEvidence.read", "verificationSubmissions.read", "verificationSubmissions.create"])
    await assign(a, f.reviewer.id, "Synthetic independent reviewer", ["dashboard.read", "contacts.read", "customerVerification.read", "verificationEvidence.read", "verificationSubmissions.read", "verificationReviews.read", "verificationReviews.approve", "verificationReviews.cancel"])
    const definition = { format: 1, facts: [], documents: [{ code: "identity", label: "Synthetic identity evidence", subjects: ["PERSON"], roles: ["CUSTOMER"] }], validityDays: null, preventSelfApproval: true }
    const preview = await api(a, "/api/verification/policy/preview", 200, "POST", { version: 0, definition })
    await api(a, "/api/verification/policy", 200, "PUT", { version: 0, definition, previewHash: preview.previewHash })
    const person = await api(o, "/api/crm/contacts", 201, "POST", { name: "SYNTHETIC Crop and Review Customer" })
    const started = await api(o, "/api/verification/cases", 200, "POST", { kind: "PERSON", id: person.id })
    const query = new URLSearchParams({ kind: "PERSON", id: person.id }).toString()
    const collection = () => api(a, `/api/verification/collection?${query}`)
    const find = async (name: string) => {
      const view = await collection(), row = view.evidence.find((e: { filename: string }) => e.filename === name)
      expect(row, `Accepted synthetic evidence: ${name}`).toBeTruthy(); return row
    }
    await page.goto(`/crm/contacts/${person.id}`); await page.getByRole("tab", { name: "Verification", exact: true }).click()
    await expect(page.getByLabel("Evidence file (up to 5 MB)")).toBeVisible()
    let reservations = 0
    page.on("request", request => { if (request.method() === "POST" && request.url().endsWith("/api/verification/evidence/uploads")) reservations++ })
    const pattern = await sharp(Buffer.from('<svg width="2400" height="1200"><rect width="1200" height="1200" fill="red"/><rect x="1200" width="1200" height="1200" fill="blue" fill-opacity="0.5"/></svg>')).png().toBuffer()
    await record("PNG cropping: natural resolution, alpha, rotation, responsive dialog and no premature upload", async () => {
      await page.getByLabel("Evidence file (up to 5 MB)").setInputFiles({ name: "synthetic-id.png", mimeType: "image/png", buffer: pattern })
      await page.getByRole("button", { name: "Crop image", exact: true }).click()
      const dialog = page.getByRole("dialog", { name: "Crop image", exact: true }), canvas = dialog.getByRole("img", { name: "Image to crop", exact: true })
      await expect(canvas).toBeVisible()
      await dialog.getByRole("button", { name: "Rotate left", exact: true }).click(); await expect(dialog.getByText(/Rotation: 270/)).toBeVisible()
      await dialog.getByRole("button", { name: "Reset crop", exact: true }).click(); await expect(dialog.getByText(/Rotation: 0/)).toBeVisible()
      await dialog.getByRole("button", { name: "Rotate right", exact: true }).click()
      await expect.poll(() => canvas.evaluate(n => ({ width: (n as HTMLCanvasElement).width, height: (n as HTMLCanvasElement).height }))).toEqual({ width: 800, height: 1600 })
      const box = await canvas.boundingBox(); expect(box).not.toBeNull()
      for (const [direction, scale] of [["north west", .25], ["south east", .75]] as const) {
        const handle = await dialog.getByRole("button", { name: new RegExp(direction + " drag handle") }).boundingBox(); expect(handle).not.toBeNull()
        await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2); await page.mouse.down()
        await page.mouse.move(box!.x + box!.width * scale, box!.y + box!.height * scale, { steps: 8 }); await page.mouse.up()
      }
      await page.screenshot({ path: info.outputPath("crop-desktop.png"), animations: "disabled" })
      await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: info.outputPath("crop-mobile.png"), animations: "disabled" })
      expect(reservations).toBe(0)
      await dialog.getByRole("button", { name: "Apply crop", exact: true }).click()
      await expect(page.getByRole("img", { name: "Cropped image preview", exact: true })).toBeVisible(); expect(reservations).toBe(0)
      await confirmUpload(page); expect(reservations).toBe(1)
      const row = await find("synthetic-id-cropped.png"), bytes = await original(a, row.id), meta = await sharp(bytes).metadata()
      expect(row.bytes).toBe(bytes.length); expect(Math.abs(meta.width! - 600)).toBeLessThan(10); expect(Math.abs(meta.height! - 1200)).toBeLessThan(10)
      const raw = await sharp(bytes).ensureAlpha().raw().toBuffer(), red = Math.floor(meta.height! * .25) * meta.width! * 4 + Math.floor(meta.width! / 2) * 4, blue = Math.floor(meta.height! * .75) * meta.width! * 4 + Math.floor(meta.width! / 2) * 4
      expect(raw[red]).toBeGreaterThan(240); expect(raw[blue + 2]).toBeGreaterThan(240); expect(raw[blue + 3]).toBeGreaterThan(120); expect(raw[blue + 3]).toBeLessThan(135)
      await page.setViewportSize({ width: 1280, height: 900 })
    })
    await record("Cancel, use original and PDF bypass preserve exact uploaded bytes", async () => {
      const input = page.getByLabel("Evidence file (up to 5 MB)")
      await input.setInputFiles({ name: "original.png", mimeType: "image/png", buffer: pattern }); await page.getByRole("button", { name: "Crop image", exact: true }).click()
      const dialog = page.getByRole("dialog", { name: "Crop image", exact: true })
      await expect(dialog.getByRole("img", { name: "Image to crop", exact: true })).toBeVisible()
      await dialog.getByRole("button", { name: "Rotate right", exact: true }).click(); await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
      await expect(page.getByRole("img", { name: "Cropped image preview", exact: true })).toHaveCount(0); expect(reservations).toBe(1)
      await page.getByRole("button", { name: "Crop image", exact: true }).click(); await dialog.getByRole("button", { name: "Use original", exact: true }).click(); await confirmUpload(page)
      expect(digest(await original(a, (await find("original.png")).id))).toBe(digest(pattern))
      const pdf = await PDFDocument.create(); pdf.addPage([100, 100]); const bytes = Buffer.from(await pdf.save())
      await input.setInputFiles({ name: "synthetic.pdf", mimeType: "application/pdf", buffer: bytes }); await expect(page.getByRole("button", { name: "Crop image", exact: true })).toHaveCount(0)
      await confirmUpload(page); expect(digest(await original(a, (await find("synthetic.pdf")).id))).toBe(digest(bytes))
    })
    await record("Phone JPEG orientation and invalid/oversized image guards", async () => {
      const input = page.getByLabel("Evidence file (up to 5 MB)"), before = reservations
      await input.setInputFiles({ name: "broken.png", mimeType: "image/png", buffer: Buffer.from("not an image") }); await page.getByRole("button", { name: "Crop image", exact: true }).click()
      const dialog = page.getByRole("dialog", { name: "Crop image", exact: true })
      await expect(dialog.getByRole("alert")).toContainText("valid JPEG or PNG"); await dialog.getByRole("button", { name: "Cancel", exact: true }).click(); expect(reservations).toBe(before)
      await input.setInputFiles({ name: "oversized.png", mimeType: "image/png", buffer: Buffer.alloc(5 * 1024 * 1024 + 1) })
      await page.getByRole("button", { name: "Upload evidence", exact: true }).click()
      await expect(page.getByRole("alert").filter({ hasText: "Choose a PDF, JPEG or PNG up to 5 MB." })).toBeVisible(); expect(reservations).toBe(before)
      const bytes = await sharp(pattern).resize(120, 60).flatten({ background: "white" }).withMetadata({ orientation: 6 }).jpeg().toBuffer()
      await input.setInputFiles({ name: "phone.jpg", mimeType: "image/jpeg", buffer: bytes }); await page.getByRole("button", { name: "Crop image", exact: true }).click()
      const canvas = dialog.getByRole("img", { name: "Image to crop", exact: true })
      await expect.poll(() => canvas.evaluate(n => ({ width: (n as HTMLCanvasElement).width, height: (n as HTMLCanvasElement).height }))).toEqual({ width: 60, height: 120 })
      await dialog.getByRole("button", { name: "Rotate left", exact: true }).click(); await dialog.getByRole("button", { name: "Apply crop", exact: true }).click(); await confirmUpload(page)
      const meta = await sharp(await original(a, (await find("phone-cropped.jpg")).id)).metadata()
      expect(meta).toMatchObject({ width: 120, height: 60, format: "jpeg" }); expect(meta.orientation).toBeUndefined()
    })
    await record("A valid image above 4.5 MB uploads directly to storage and retains its checksum", async () => {
      const bytes = await sharp(randomBytes(1600 * 1000 * 3), { raw: { width: 1600, height: 1000, channels: 3 } }).png().toBuffer()
      expect(bytes.length).toBeGreaterThan(4.5 * 1024 * 1024); expect(bytes.length).toBeLessThan(5 * 1024 * 1024)
      await upload(page, "synthetic-large.png", "image/png", bytes)
      const row = await find("synthetic-large.png")
      expect(row.bytes).toBe(bytes.length); expect(digest(await original(a, row.id))).toBe(digest(bytes))
    })
    const duplicate = await sharp({ create: { width: 16, height: 16, channels: 3, background: "orange" } }).png().toBuffer()
    await upload(page, "duplicate.png", "image/png", duplicate)
    const keeper = await find("duplicate.png")
    await upload(page, "duplicate.png", "image/png", duplicate)
    const candidates = (await collection()).evidence.filter((e: { filename: string }) => e.filename === "duplicate.png")
    const redundant = candidates.find((e: { id: string }) => e.id !== keeper.id)
    expect(candidates).toHaveLength(2)
    await record("Only administrators remove duplicates; confirmation and cancellation retain an older identical original", async () => {
      await api(o, "/api/verification/disposals/preview", 403, "POST", { evidenceId: redundant.id, kind: "DUPLICATE" })
      await expect(page.getByRole("button", { name: "Manage duplicate uploads and retention", exact: true })).toHaveCount(0)
      await admin.goto(`/crm/contacts/${person.id}`); await admin.getByRole("tab", { name: "Verification", exact: true }).click()
      await admin.getByRole("button", { name: "Manage duplicate uploads and retention", exact: true }).click()
      await expect(admin.getByRole("button", { name: "Remove duplicate", exact: true })).toHaveCount(1)
      await admin.getByRole("button", { name: "Remove duplicate", exact: true }).click()
      await expect(admin.getByText("Older original to keep", { exact: true })).toBeVisible()
      await expect(admin.getByRole("button", { name: "Confirm duplicate removal", exact: true })).toBeDisabled()
      await admin.getByRole("button", { name: "Keep file", exact: true }).click()
      expect((await collection()).evidence).toHaveLength(7)
      await admin.getByRole("button", { name: "Remove duplicate", exact: true }).click()
      await admin.getByLabel("Disposal reason", { exact: true }).fill("Synthetic accidental duplicate uploaded for hosted acceptance")
      await admin.getByLabel("I reviewed the duplicate, the original to keep and permanent removal.", { exact: true }).check()
      await admin.getByRole("button", { name: "Confirm duplicate removal", exact: true }).scrollIntoViewIfNeeded()
      await admin.screenshot({ path: info.outputPath("duplicate-desktop.png"), fullPage: true, animations: "disabled" })
      await admin.setViewportSize({ width: 390, height: 844 }); expect(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await admin.getByRole("button", { name: "Confirm duplicate removal", exact: true }).scrollIntoViewIfNeeded()
      await admin.screenshot({ path: info.outputPath("duplicate-mobile.png"), fullPage: true, animations: "disabled" })
      await admin.getByRole("button", { name: "Confirm duplicate removal", exact: true }).click()
      await expect(admin.getByRole("status").filter({ hasText: "Duplicate removed." })).toHaveText("Duplicate removed. The older original was preserved.")
      const retained = await collection(); expect(retained.evidence).toHaveLength(6)
      expect(retained.evidence.some((e: { id: string }) => e.id === keeper.id)).toBe(true)
      expect(retained.evidence.some((e: { id: string }) => e.id === redundant.id)).toBe(false)
      expect(digest(await original(a, keeper.id))).toBe(digest(duplicate))
      await api(a, `/api/verification/evidence/${redundant.id}/download`, 404)
      const history = await api(a, `/api/verification/holds?${query}`)
      expect(history.disposals.some((d: { state: string; retainedEvidenceId: string; evidenceId: string }) => d.evidenceId === redundant.id && d.retainedEvidenceId === keeper.id && d.state === "COMPLETED")).toBe(true)
      expect((await api(a, "/api/verification/retention")).version).toBe(0)
    })
    await record("Independent review, correction history and saved-selection duplicate protection", async () => {
      const submission = await api(o, "/api/verification/submissions", 200, "POST", { caseId: started.case.id, version: 0, policyVersion: 1, role: "CUSTOMER", facts: [], evidenceIds: [keeper.id] })
      await api(o, "/api/verification/reviews", 403, "POST", { submissionId: submission.id, version: 1, reviewVersion: 0, decision: "APPROVED", reviewed: true })
      await api(r, "/api/verification/reviews", 200, "POST", { submissionId: submission.id, version: 1, reviewVersion: 0, decision: "CHANGES_REQUIRED", reviewed: false, reason: "Synthetic request to confirm corrected evidence selection" })
      const corrected = await api(o, "/api/verification/submissions", 200, "POST", { caseId: started.case.id, version: 1, policyVersion: 1, role: "CUSTOMER", facts: [], evidenceIds: [keeper.id], reason: "Synthetic reviewed correction retaining the accepted original" })
      await api(r, "/api/verification/reviews", 200, "POST", { submissionId: corrected.id, version: 2, reviewVersion: 0, decision: "APPROVED", reviewed: true })
      const details = await api(r, `/api/verification/submissions?${query}`)
      expect(details.status).toBe("VERIFIED"); expect(details.history).toHaveLength(2)
      expect((await api(a, `/api/verification/holds?${query}`)).decisions.find((e: { id: string }) => e.id === keeper.id).decision).toBe("SUBMISSION_REFERENCE")
      await api(a, "/api/verification/disposals/preview", 409, "POST", { evidenceId: keeper.id, kind: "DUPLICATE" })
      expect(digest(await original(r, keeper.id))).toBe(digest(duplicate))
      await f.reviewer.page.goto(`/crm/contacts/${person.id}`); await f.reviewer.page.getByRole("tab", { name: "Verification", exact: true }).click()
      await f.reviewer.page.getByRole("tab", { name: "Facts and review", exact: true }).click()
      await expect(f.reviewer.page.getByText("Review status: Verified", { exact: true })).toBeVisible()
      await f.reviewer.page.screenshot({ path: info.outputPath("independent-review.png"), fullPage: true, animations: "disabled" })
    })
    fs.writeFileSync(`tmp/p13s-staging/${f.receipt.slug}-image-acceptance.json`, JSON.stringify({ at: new Date().toISOString(), source: f.receipt.source, deployment: f.receipt.deployment, tenantId: f.receipt.tenantId, passed, customerId: person.id, keeperId: keeper.id, removedDuplicateId: redundant.id, productionChanged: false }, null, 2), { mode: 0o600 })
  } finally { await f.close() }
})
