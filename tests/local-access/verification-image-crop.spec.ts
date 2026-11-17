import { test, expect, type Page, type Locator } from "@playwright/test"
import { createHash } from "node:crypto"
import sharp from "sharp"
import { PDFDocument } from "pdf-lib"
import { seed, login, json } from "./fixtures"

async function setup(browser: Parameters<typeof login>[0]) {
  const f = await seed(), admin = await login(browser, f.origin, f.users.admin.email)
  await f.db.query('INSERT INTO "TenantModule"("tenantId",key,allowed,enabled,"updatedAt") VALUES($1,\'customerVerification\',true,true,now())', [f.slug])
  const definition = { format: 1, facts: [], documents: [{ code: "identity", label: "Identity proof", subjects: ["PERSON"], roles: ["CUSTOMER"] }], validityDays: null, preventSelfApproval: true }
  const preview = await json(admin.context, "/api/verification/policy/preview", 200, "POST", { version: 0, definition })
  await json(admin.context, "/api/verification/policy", 200, "PUT", { version: 0, definition, previewHash: preview.previewHash })
  const person = await json(admin.context, "/api/crm/contacts", 201, "POST", { name: "Synthetic crop customer" })
  await json(admin.context, "/api/verification/cases", 200, "POST", { kind: "PERSON", id: person.id })
  await admin.context.route("https://verificationtest.supabase.co/**", async route => { const u = new URL(route.request().url()), response = await route.fetch({ url: "http://127.0.0.1:3319" + u.pathname + u.search }); await route.fulfill({ response }) })
  await admin.page.goto(`/crm/contacts/${person.id}`); await admin.page.getByRole("tab", { name: "Verification", exact: true }).click()
  return { f, ...admin }
}
const pattern = () => sharp(Buffer.from('<svg width="2400" height="1200"><rect width="1200" height="1200" fill="red"/><rect x="1200" width="1200" height="1200" fill="blue" fill-opacity="0.5"/></svg>')).png().toBuffer()
async function upload(page: Page) {
  const saved = page.waitForResponse(r => r.url().endsWith("/finalize") && r.request().method() === "POST")
  await page.getByRole("button", { name: "Upload document", exact: true }).click(); expect((await saved).status()).toBe(200)
  await expect(page.getByRole("button", { name: "Upload document", exact: true })).toBeDisabled()
}
async function dragHandle(page: Page, dialog: Locator, direction: string, x: number, y: number) {
  const handle = dialog.getByRole("button", { name: new RegExp(direction + " drag handle") }), box = await handle.boundingBox()
  expect(box).not.toBeNull(); await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2); await page.mouse.down(); await page.mouse.move(x, y, { steps: 8 }); await page.mouse.up()
}

test("oversized and empty selections are rejected immediately and cannot upload a previously selected valid file", async ({ browser }) => {
  test.setTimeout(120_000)
  const { f, page, context } = await setup(browser)
  try {
    let reservations = 0
    page.on("request", r => { if (r.method() === "POST" && r.url().endsWith("/api/verification/evidence/uploads")) reservations++ })
    const input = page.getByLabel("Document file (up to 5 MB)"), button = page.getByRole("button", { name: "Upload document", exact: true }), valid = await pattern()
    await input.setInputFiles({ name: "valid.png", mimeType: "image/png", buffer: valid })
    await expect(button).toBeEnabled()
    for (const [name, mimeType] of [["too-large.png", "image/png"], ["too-large.pdf", "application/pdf"]]) {
      await input.setInputFiles({ name, mimeType, buffer: Buffer.alloc(12 * 1024 * 1024) })
      await expect(page.getByRole("alert").filter({ hasText: "Selected file is 12 MB. Maximum allowed is 5 MB." })).toBeVisible()
      await expect(input).toHaveAttribute("aria-invalid", "true")
      await expect(button).toBeDisabled()
      await expect(page.getByRole("button", { name: "Crop image", exact: true })).toHaveCount(0)
      await expect(page.getByRole("dialog", { name: "Crop image", exact: true })).toHaveCount(0)
      expect(reservations).toBe(0)
    }
    await page.screenshot({ path: "test-results/local-access/file-size-validation-desktop.png", animations: "disabled" })
    await page.setViewportSize({ width: 390, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: "test-results/local-access/file-size-validation-mobile.png", animations: "disabled" })
    await input.setInputFiles({ name: "empty.png", mimeType: "image/png", buffer: Buffer.alloc(0) })
    await expect(page.getByRole("alert").filter({ hasText: "The selected file is empty." })).toBeVisible()
    await expect(button).toBeDisabled()
    // The upper boundary is inclusive; no decode or upload happens on selection.
    await input.setInputFiles({ name: "exact-limit.png", mimeType: "image/png", buffer: Buffer.alloc(5 * 1024 * 1024) })
    await expect(input).not.toHaveAttribute("aria-invalid", "true")
    await expect(button).toBeEnabled()
    await input.setInputFiles({ name: "replacement.png", mimeType: "image/png", buffer: valid })
    await expect(page.getByRole("alert").filter({ hasText: /Selected file is|selected file is empty/ })).toHaveCount(0)
    await page.getByRole("button", { name: "Crop image", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "Crop image", exact: true })
    await expect(dialog.getByRole("img", { name: "Image to crop", exact: true })).toBeVisible()
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
    await upload(page)
    expect(reservations).toBe(1)
    const rows = (await f.db.query('SELECT filename,sha256 FROM "VerificationEvidence" WHERE "tenantId"=$1', [f.slug])).rows
    expect(rows).toEqual([{ filename: "replacement.png", sha256: createHash("sha256").update(valid).digest("hex") }])
  } finally { await context.close(); await f.db.end() }
})

test("shared cropper rotates and crops at natural resolution, preserves PNG transparency and uploads only after confirmation", async ({ browser }) => {
  test.setTimeout(120_000)
  const { f, page, context } = await setup(browser)
  try {
    let reservations = 0
    page.on("request", r => { if (r.method() === "POST" && r.url().endsWith("/api/verification/evidence/uploads")) reservations++ })
    await page.getByLabel("Document file (up to 5 MB)").setInputFiles({ name: "synthetic-id.png", mimeType: "image/png", buffer: await pattern() })
    await expect(page.getByRole("img", { name: "Selected image preview", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Crop image", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "Crop image", exact: true }), canvas = dialog.getByRole("img", { name: "Image to crop", exact: true })
    await expect(canvas).toBeVisible()
    await dialog.getByRole("button", { name: "Rotate left", exact: true }).click(); await expect(dialog.getByText(/Rotation: 270/)).toBeVisible()
    await dialog.getByRole("button", { name: "Reset crop", exact: true }).click(); await expect(dialog.getByText(/Rotation: 0/)).toBeVisible()
    await dialog.getByRole("button", { name: "Rotate right", exact: true }).click(); await expect(dialog.getByText(/Rotation: 90/)).toBeVisible()
    await expect.poll(() => canvas.evaluate(n => ({ width: (n as HTMLCanvasElement).width, height: (n as HTMLCanvasElement).height }))).toEqual({ width: 800, height: 1600 })
    const box = await canvas.boundingBox(); expect(box).not.toBeNull(); expect(Math.abs(box!.width / box!.height - 0.5)).toBeLessThan(0.01)
    await dragHandle(page, dialog, "north west", box!.x + box!.width * 0.25, box!.y + box!.height * 0.25)
    await dragHandle(page, dialog, "south east", box!.x + box!.width * 0.75, box!.y + box!.height * 0.75)
    await page.screenshot({ path: "test-results/local-access/image-crop-desktop.png", animations: "disabled" })
    await page.setViewportSize({ width: 390, height: 844 }); await expect(canvas).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: "test-results/local-access/image-crop-mobile.png", animations: "disabled" })
    expect(reservations).toBe(0)
    await dialog.getByRole("button", { name: "Apply crop", exact: true }).click()
    await expect(page.getByRole("img", { name: "Cropped image preview", exact: true })).toBeVisible()
    await expect(page.getByRole("img", { name: "Selected image preview", exact: true })).toHaveCount(0)
    const thumb = page.getByRole("img", { name: "Cropped image preview", exact: true })
    await expect.poll(() => thumb.evaluate(n => Math.abs((n as HTMLImageElement).naturalWidth - 600) < 10 && Math.abs((n as HTMLImageElement).naturalHeight - 1200) < 10)).toBe(true)
    expect(reservations).toBe(0)
    let releaseTransfer!: () => void, releaseValidation!: () => void
    const transferGate = new Promise<void>(resolve => { releaseTransfer = resolve }), validationGate = new Promise<void>(resolve => { releaseValidation = resolve })
    await page.route("https://verificationtest.supabase.co/**", async route => {
      await transferGate
      const u = new URL(route.request().url()), response = await route.fetch({ url: "http://127.0.0.1:3319" + u.pathname + u.search })
      await route.fulfill({ response })
    })
    await page.route("**/api/verification/evidence/*/finalize", async route => { await validationGate; await route.continue() })
    const finalized = page.waitForResponse(r => r.url().endsWith("/finalize") && r.request().method() === "POST")
    await page.getByRole("button", { name: "Upload document", exact: true }).click()
    const progress = page.getByRole("progressbar", { name: "Document upload progress", exact: true })
    await expect(progress).toBeVisible()
    await expect(page.getByRole("button", { name: "Upload document", exact: true })).toBeDisabled()
    await progress.scrollIntoViewIfNeeded()
    await page.screenshot({ path: "test-results/local-access/image-upload-progress-mobile.png", animations: "disabled" })
    releaseTransfer()
    await expect(page.getByRole("status").filter({ hasText: "Validating file" })).toBeVisible()
    await expect(progress).toHaveCount(0)
    releaseValidation()
    expect((await finalized).status()).toBe(200)
    await expect(page.getByRole("status").filter({ hasText: "Document uploaded" })).toBeVisible()
    expect(reservations).toBe(1)
    const row = (await f.db.query('SELECT state,path,bytes,filename,"contentType",sha256 FROM "VerificationEvidence" WHERE "tenantId"=$1', [f.slug])).rows[0]
    expect(row).toMatchObject({ state: "READY", filename: "synthetic-id-cropped.png", contentType: "image/png" })
    const stored = await context.request.get("http://127.0.0.1:3319/storage/v1/object/tenant-verification/" + row.path), bytes = await stored.body(), meta = await sharp(bytes).metadata()
    expect(stored.status()).toBe(200); expect(Math.abs(meta.width! - 600)).toBeLessThan(10); expect(Math.abs(meta.height! - 1200)).toBeLessThan(10)
    expect(row.sha256).toBe(createHash("sha256").update(bytes).digest("hex")); expect(row.bytes).toBe(bytes.length)
    const raw = await sharp(bytes).ensureAlpha().raw().toBuffer(), red = Math.floor(meta.height! * 0.25) * meta.width! * 4 + Math.floor(meta.width! / 2) * 4, blue = Math.floor(meta.height! * 0.75) * meta.width! * 4 + Math.floor(meta.width! / 2) * 4
    expect(raw[red]).toBeGreaterThan(240); expect(raw[blue + 2]).toBeGreaterThan(240); expect(raw[blue + 3]).toBeGreaterThan(120); expect(raw[blue + 3]).toBeLessThan(135)
    await expect(page.getByRole("button", { name: "Crop image", exact: true })).toHaveCount(0)
    await expect(thumb).toHaveCount(0)
  } finally { await context.close(); await f.db.end() }
})

test("failed transfers clear progress, keep the local thumbnail and leave evidence unaccepted until a successful retry", async ({ browser }) => {
  test.setTimeout(120_000)
  const { f, page, context } = await setup(browser)
  try {
    let finalizations = 0
    page.on("request", r => { if (r.method() === "POST" && r.url().endsWith("/finalize")) finalizations++ })
    await page.getByLabel("Document file (up to 5 MB)").setInputFiles({ name: "retry-image.png", mimeType: "image/png", buffer: await pattern() })
    await expect(page.getByRole("img", { name: "Selected image preview", exact: true })).toBeVisible()
    await page.route("https://verificationtest.supabase.co/**", route => route.fulfill({ status: 503, headers: { "access-control-allow-origin": "*" }, body: "Synthetic upload failure" }))
    await page.getByRole("button", { name: "Upload document", exact: true }).click()
    await expect(page.getByRole("alert").filter({ hasText: "The upload failed." })).toBeVisible()
    await expect(page.getByRole("progressbar", { name: "Document upload progress", exact: true })).toHaveCount(0)
    await expect(page.getByRole("status").filter({ hasText: "Document uploaded" })).toHaveCount(0)
    await expect(page.getByRole("img", { name: "Selected image preview", exact: true })).toBeVisible()
    expect(finalizations).toBe(0)
    expect((await f.db.query('SELECT state FROM "VerificationEvidence" WHERE "tenantId"=$1', [f.slug])).rows).toEqual([{ state: "PENDING" }])
    await page.getByRole("button", { name: "Cancel upload", exact: true }).click()
    await expect(page.getByRole("button", { name: "Cancel upload", exact: true })).toHaveCount(0)
    await page.unroute("https://verificationtest.supabase.co/**")
    await upload(page)
    expect(finalizations).toBe(1)
    expect((await f.db.query('SELECT state FROM "VerificationEvidence" WHERE "tenantId"=$1 ORDER BY "createdAt"', [f.slug])).rows).toEqual([{ state: "ABANDONED" }, { state: "READY" }])
  } finally { await context.close(); await f.db.end() }
})

test("cancel and use original preserve selected bytes; PDFs bypass cropping and invalid images never reserve an upload in the editor", async ({ browser }) => {
  test.setTimeout(120_000)
  const { f, page, context } = await setup(browser)
  try {
    const bytes = await pattern(), input = page.getByLabel("Document file (up to 5 MB)")
    await input.setInputFiles({ name: "original.png", mimeType: "image/png", buffer: bytes }); await page.getByRole("button", { name: "Crop image", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "Crop image", exact: true })
    await expect(dialog.getByRole("img", { name: "Image to crop", exact: true })).toBeVisible(); await dialog.getByRole("button", { name: "Rotate right", exact: true }).click(); await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
    await expect(page.getByRole("img", { name: "Cropped image preview", exact: true })).toHaveCount(0)
    await page.getByRole("button", { name: "Crop image", exact: true }).click(); await dialog.getByRole("button", { name: "Use original", exact: true }).click(); await upload(page)
    const original = (await f.db.query('SELECT filename,sha256,bytes FROM "VerificationEvidence" WHERE "tenantId"=$1', [f.slug])).rows[0]
    expect(original).toEqual({ filename: "original.png", sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length })
    await input.setInputFiles({ name: "corrupt.png", mimeType: "image/png", buffer: Buffer.from("not a PNG") }); await page.getByRole("button", { name: "Crop image", exact: true }).click()
    await expect(dialog.getByRole("alert")).toContainText("valid JPEG or PNG"); await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
    const pdf = await PDFDocument.create(); pdf.addPage([100, 100]); const pdfBytes = Buffer.from(await pdf.save())
    await input.setInputFiles({ name: "original.pdf", mimeType: "application/pdf", buffer: pdfBytes }); await expect(page.getByRole("button", { name: "Crop image", exact: true })).toHaveCount(0); await upload(page)
    const rows = (await f.db.query('SELECT filename,sha256,state FROM "VerificationEvidence" WHERE "tenantId"=$1 ORDER BY "createdAt"', [f.slug])).rows
    expect(rows).toHaveLength(2); expect(rows[1]).toEqual({ filename: "original.pdf", sha256: createHash("sha256").update(pdfBytes).digest("hex"), state: "READY" })
  } finally { await context.close(); await f.db.end() }
})

test("JPEG orientation is respected, prepared JPEGs normalize rotation, and oversized output cannot replace the selected file", async ({ browser }) => {
  test.setTimeout(120_000)
  const { f, page, context } = await setup(browser)
  try {
    const jpeg = await sharp(await pattern()).resize(120, 60).flatten({ background: "white" }).withMetadata({ orientation: 6 }).jpeg().toBuffer(), input = page.getByLabel("Document file (up to 5 MB)")
    await input.setInputFiles({ name: "phone.jpg", mimeType: "image/jpeg", buffer: jpeg }); await page.getByRole("button", { name: "Crop image", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "Crop image", exact: true }), canvas = dialog.getByRole("img", { name: "Image to crop", exact: true })
    await expect.poll(() => canvas.evaluate(n => ({ width: (n as HTMLCanvasElement).width, height: (n as HTMLCanvasElement).height }))).toEqual({ width: 60, height: 120 })
    await dialog.getByRole("button", { name: "Rotate left", exact: true }).click(); await dialog.getByRole("button", { name: "Use original", exact: true }).click(); await upload(page)
    await input.setInputFiles({ name: "phone.jpg", mimeType: "image/jpeg", buffer: jpeg }); await page.getByRole("button", { name: "Crop image", exact: true }).click(); await expect(canvas).toBeVisible(); await dialog.getByRole("button", { name: "Rotate left", exact: true }).click(); await dialog.getByRole("button", { name: "Apply crop", exact: true }).click(); await upload(page)
    const rows = (await f.db.query('SELECT filename,sha256,path,"contentType" FROM "VerificationEvidence" WHERE "tenantId"=$1 ORDER BY "createdAt"', [f.slug])).rows
    expect(rows).toHaveLength(2); expect(rows[0].sha256).toBe(createHash("sha256").update(jpeg).digest("hex")); expect(rows[1].contentType).toBe("image/jpeg")
    const response = await context.request.get("http://127.0.0.1:3319/storage/v1/object/tenant-verification/" + rows[1].path), meta = await sharp(await response.body()).metadata()
    expect(meta).toMatchObject({ width: 120, height: 60, format: "jpeg" }); expect(meta.orientation).toBeUndefined()
    await input.setInputFiles({ name: "phone.jpg", mimeType: "image/jpeg", buffer: jpeg }); await page.getByRole("button", { name: "Crop image", exact: true }).click(); await expect(canvas).toBeVisible(); await dialog.getByRole("button", { name: "Rotate right", exact: true }).click()
    await page.evaluate(() => { HTMLCanvasElement.prototype.toBlob = function (callback, type) { callback(new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: type ?? "image/png" })) } })
    await dialog.getByRole("button", { name: "Apply crop", exact: true }).click(); await expect(dialog.getByRole("alert")).toContainText("exceeds the upload limit")
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click(); await expect(page.getByRole("img", { name: "Cropped image preview", exact: true })).toHaveCount(0)
    expect((await f.db.query('SELECT count(*)::int n FROM "VerificationEvidence" WHERE "tenantId"=$1', [f.slug])).rows[0].n).toBe(2)
  } finally { await context.close(); await f.db.end() }
})
