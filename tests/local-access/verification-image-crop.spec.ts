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
  await page.getByRole("button", { name: "Upload evidence", exact: true }).click(); expect((await saved).status()).toBe(200)
  await expect(page.getByRole("button", { name: "Upload evidence", exact: true })).toBeDisabled()
}
async function dragHandle(page: Page, dialog: Locator, direction: string, x: number, y: number) {
  const handle = dialog.getByRole("button", { name: new RegExp(direction + " drag handle") }), box = await handle.boundingBox()
  expect(box).not.toBeNull(); await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2); await page.mouse.down(); await page.mouse.move(x, y, { steps: 8 }); await page.mouse.up()
}

test("shared cropper rotates and crops at natural resolution, preserves PNG transparency and uploads only after confirmation", async ({ browser }) => {
  test.setTimeout(120_000)
  const { f, page, context } = await setup(browser)
  try {
    let reservations = 0
    page.on("request", r => { if (r.method() === "POST" && r.url().endsWith("/api/verification/evidence/uploads")) reservations++ })
    await page.getByLabel("Evidence file (up to 5 MB)").setInputFiles({ name: "synthetic-id.png", mimeType: "image/png", buffer: await pattern() })
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
    expect(reservations).toBe(0)
    await upload(page); expect(reservations).toBe(1)
    const row = (await f.db.query('SELECT state,path,bytes,filename,"contentType",sha256 FROM "VerificationEvidence" WHERE "tenantId"=$1', [f.slug])).rows[0]
    expect(row).toMatchObject({ state: "READY", filename: "synthetic-id-cropped.png", contentType: "image/png" })
    const stored = await context.request.get("http://127.0.0.1:3319/storage/v1/object/tenant-verification/" + row.path), bytes = await stored.body(), meta = await sharp(bytes).metadata()
    expect(stored.status()).toBe(200); expect(Math.abs(meta.width! - 600)).toBeLessThan(10); expect(Math.abs(meta.height! - 1200)).toBeLessThan(10)
    expect(row.sha256).toBe(createHash("sha256").update(bytes).digest("hex")); expect(row.bytes).toBe(bytes.length)
    const raw = await sharp(bytes).ensureAlpha().raw().toBuffer(), red = Math.floor(meta.height! * 0.25) * meta.width! * 4 + Math.floor(meta.width! / 2) * 4, blue = Math.floor(meta.height! * 0.75) * meta.width! * 4 + Math.floor(meta.width! / 2) * 4
    expect(raw[red]).toBeGreaterThan(240); expect(raw[blue + 2]).toBeGreaterThan(240); expect(raw[blue + 3]).toBeGreaterThan(120); expect(raw[blue + 3]).toBeLessThan(135)
    await expect(page.getByRole("button", { name: "Crop image", exact: true })).toHaveCount(0)
  } finally { await context.close(); await f.db.end() }
})

test("cancel and use original preserve selected bytes; PDFs bypass cropping and invalid images never reserve an upload in the editor", async ({ browser }) => {
  test.setTimeout(120_000)
  const { f, page, context } = await setup(browser)
  try {
    const bytes = await pattern(), input = page.getByLabel("Evidence file (up to 5 MB)")
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
    const jpeg = await sharp(await pattern()).resize(120, 60).flatten({ background: "white" }).withMetadata({ orientation: 6 }).jpeg().toBuffer(), input = page.getByLabel("Evidence file (up to 5 MB)")
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
