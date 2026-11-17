import { test, expect } from "@playwright/test"
import sharp from "sharp"
import { seed, login, json, assignProfiles } from "./fixtures"

async function setup(browser: Parameters<typeof login>[0]) {
  const f = await seed(), admin = await login(browser, f.origin, f.users.admin.email)
  await f.db.query('INSERT INTO "TenantModule"("tenantId",key,allowed,enabled,"updatedAt") VALUES($1,\'customerVerification\',true,true,now())', [f.slug])
  const definition = { format: 1, facts: [{ code: "legal_name", label: "Legal name", type: "TEXT", subjects: ["PERSON"], roles: ["CUSTOMER", "ADDITIONAL_CUSTOMER"] }], documents: [{ code: "identity", label: "Identity proof", subjects: ["PERSON"], roles: ["CUSTOMER", "ADDITIONAL_CUSTOMER"] }], validityDays: null, preventSelfApproval: true }
  const preview = await json(admin.context, "/api/verification/policy/preview", 200, "POST", { version: 0, definition })
  await json(admin.context, "/api/verification/policy", 200, "PUT", { version: 0, definition, previewHash: preview.previewHash })
  const person = await json(admin.context, "/api/crm/contacts", 201, "POST", { name: "Synthetic workflow customer" })
  await json(admin.context, "/api/verification/cases", 200, "POST", { kind: "PERSON", id: person.id })
  return { f, admin, person }
}
async function open(page: Awaited<ReturnType<typeof login>>["page"], id: string) {
  await page.goto(`/crm/contacts/${id}`)
  await page.getByRole("tab", { name: "Verification", exact: true }).click()
  await expect(page.getByRole("tab", { name: "Documents", exact: true })).toBeVisible()
}
async function upload(actor: Awaited<ReturnType<typeof login>>) {
  await actor.context.route("https://verificationtest.supabase.co/**", async route => {
    const u = new URL(route.request().url()), response = await route.fetch({ url: "http://127.0.0.1:3319" + u.pathname + u.search })
    await route.fulfill({ response })
  })
  const bytes = await sharp({ create: { width: 20, height: 20, channels: 3, background: "orange" } }).png().toBuffer()
  await actor.page.getByLabel("Document file (up to 5 MB)").setInputFiles({ name: "workflow.png", mimeType: "image/png", buffer: bytes })
  await actor.page.getByRole("button", { name: "Upload document", exact: true }).click()
  await expect(actor.page.getByRole("status").filter({ hasText: "Document uploaded." })).toBeVisible()
}

test("document workflow preserves drafts, shows the next step and separates confirmed business cleanup from customer collection", async ({ browser }) => {
  test.setTimeout(150_000)
  const { f, admin, person } = await setup(browser), { page } = admin
  try {
    await open(page, person.id)
    await expect(page.getByText("Collecting documents", { exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "Clean expired business uploads", exact: true })).toHaveCount(0)
    await expect(page.getByText("No documents uploaded yet.", { exact: true })).toBeVisible()
    await page.screenshot({ path: "test-results/local-access/verification-workflow-documents-desktop.png", fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: "test-results/local-access/verification-workflow-documents-mobile.png", fullPage: true })
    await page.getByRole("button", { name: "Continue to details & review", exact: true }).click()
    await expect(page.getByRole("tabpanel", { name: "Details & review", exact: true })).toBeFocused()
    await page.getByLabel("Legal name", { exact: true }).fill("Synthetic Buyer")
    await page.getByRole("tab", { name: "Documents", exact: true }).click()
    await upload(admin)
    await page.getByRole("button", { name: "Continue to details & review", exact: true }).click()
    await expect(page.getByLabel("Legal name", { exact: true })).toHaveValue("Synthetic Buyer")
    await page.getByLabel("workflow.png", { exact: true }).check()
    await page.getByRole("button", { name: "Submit for review", exact: true }).click()
    await expect(page.getByText("Awaiting review", { exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "Approve verification", exact: true })).toBeDisabled()
    await page.getByRole("tab", { name: "File management", exact: true }).click()
    await expect(page.getByRole("heading", { name: "Remove documents", exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "Remove unused upload", exact: true })).toHaveCount(0)
    await expect(page.getByLabel("Hold reason", { exact: true })).toBeHidden()
    let cleanups = 0
    page.on("request", r => { if (r.method() === "POST" && r.url().endsWith("/evidence/cleanup")) cleanups++ })
    await page.getByText("Advanced cleanup", { exact: true }).click()
    await page.getByRole("button", { name: "Clean expired business uploads", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "Clean expired business uploads?", exact: true })
    await expect(dialog).toContainText("entire business")
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
    expect(cleanups).toBe(0)
    await page.getByRole("button", { name: "Clean expired business uploads", exact: true }).click()
    await page.getByRole("button", { name: "Confirm cleanup", exact: true }).click()
    await expect(page.getByRole("status").filter({ hasText: "Stored customer documents were retained." })).toBeVisible()
    expect(cleanups).toBe(1)
    await page.screenshot({ path: "test-results/local-access/verification-workflow-management-mobile.png", fullPage: true })
    expect((await f.db.query('SELECT state FROM "VerificationEvidence" WHERE "tenantId"=$1', [f.slug])).rows).toEqual([{ state: "READY" }])
    expect((await f.db.query('SELECT count(*)::int n FROM "VerificationSubmission" WHERE "tenantId"=$1', [f.slug])).rows[0].n).toBe(1)
  } finally { await admin.context.close(); await f.db.end() }
})

test("collector can upload and submit own documents without gaining file management, downloads or review authority", async ({ browser }) => {
  test.setTimeout(120_000)
  const { f, admin, person } = await setup(browser)
  let collector: Awaited<ReturnType<typeof login>> | undefined
  try {
    const role = await json(admin.context, "/api/access/roles", 201, "POST", { name: "Workflow collector", permissions: ["contacts.read", "customerVerification.read", "verificationUploads.read", "verificationUploads.create", "verificationUploads.cancel", "verificationSubmissions.read", "verificationSubmissions.create"] })
    await assignProfiles(admin.context, f.users.manager.id, [role.id], { salesRecordScope: "ACCOUNT_ROLE" })
    collector = await login(browser, f.origin, f.users.manager.email)
    const { page } = collector
    await open(page, person.id)
    await expect(page.getByRole("tab", { name: "File management", exact: true })).toHaveCount(0)
    await expect(page.getByText("No documents uploaded yet.", { exact: true })).toHaveCount(0)
    await upload(collector)
    await expect(page.getByRole("link", { name: "Download document", exact: true })).toHaveCount(0)
    await page.getByRole("button", { name: "Continue to details & review", exact: true }).click()
    await page.getByLabel("Legal name", { exact: true }).fill("Synthetic Collected Buyer")
    await page.getByLabel("workflow.png", { exact: true }).check()
    await page.getByRole("button", { name: "Submit for review", exact: true }).click()
    await expect(page.getByText("Awaiting review", { exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "Approve verification", exact: true })).toHaveCount(0)
    await json(collector.context, "/api/verification/holds", 403)
  } finally { await collector?.context.close(); await admin.context.close(); await f.db.end() }
})

test("shared checklists need no role choice and contextual views cannot mix another role's submission or approval", async ({ browser }) => {
  test.setTimeout(120_000)
  const { f, admin, person } = await setup(browser), { page, context } = admin
  try {
    await open(page, person.id); await upload(admin)
    await page.getByRole("button", { name: "Continue to details & review", exact: true }).click()
    await expect(page.getByLabel("Participant role", { exact: true })).toHaveCount(0)
    await expect(page.getByLabel("Verification checklist", { exact: true })).toHaveCount(0)
    await page.getByLabel("Legal name", { exact: true }).fill("Common checklist buyer")
    await page.getByLabel("workflow.png", { exact: true }).check()
    await page.getByRole("button", { name: "Submit for review", exact: true }).click()
    await expect(page.getByRole("heading", { name: "Submitted revision 1", exact: true })).toBeVisible()
    const common = await json(context, `/api/verification/submissions?kind=PERSON&id=${person.id}&role=CUSTOMER`)
    expect(common.submission.role).toBe("CUSTOMER")
    await json(context, "/api/verification/submissions", 200, "POST", { caseId: common.case.id, version: 1, policyVersion: 1, role: "ADDITIONAL_CUSTOMER", facts: [{ code: "legal_name", value: "Same person as co-applicant" }], evidenceIds: common.submission.evidenceIds, reason: "Another transaction participant context" })
    // Customer correction must use the latest case token (2), not its own revision (1).
    const refreshed = page.waitForResponse(r => r.request().method() === "GET" && r.url().includes("/api/verification/submissions?") && new URL(r.url()).searchParams.get("role") === "CUSTOMER")
    await page.getByRole("button", { name: "Refresh verification", exact: true }).click()
    expect((await (await refreshed).json()).caseVersion).toBe(2)
    await page.getByText("Prepare a corrected submission", { exact: true }).click()
    await page.getByLabel("Legal name", { exact: true }).fill("Corrected customer context")
    await page.getByLabel("Reason for new revision", { exact: true }).fill("Correct only the primary customer details")
    await page.getByRole("button", { name: "Submit for review", exact: true }).click()
    await expect(page.getByRole("heading", { name: "Submitted revision 3", exact: true })).toBeVisible()
    const query = new URLSearchParams({ "l.record-view.tab": JSON.stringify("verification"), verificationRole: "ADDITIONAL_CUSTOMER" })
    await page.goto(`/crm/contacts/${person.id}?${query}`)
    await expect(page.getByRole("tab", { name: "Verification", exact: true })).toHaveAttribute("aria-selected", "true")
    await page.getByRole("tab", { name: "Details & review", exact: true }).click()
    await expect(page.getByText("Verification for: Additional customer", { exact: true })).toBeVisible()
    await expect(page.getByRole("heading", { name: "Submitted revision 2", exact: true })).toBeVisible()
    await expect(page.getByText("Same person as co-applicant", { exact: true })).toBeVisible()
    await expect(page.getByText("Corrected customer context", { exact: true })).toHaveCount(0)
    await expect(page.getByLabel("Verification checklist", { exact: true })).toHaveCount(0)
    await page.screenshot({ path: "test-results/local-access/verification-context-role-desktop.png", fullPage: true })
    const rows = (await f.db.query('SELECT number,role FROM "VerificationSubmission" WHERE "tenantId"=$1 ORDER BY number', [f.slug])).rows
    expect(rows).toEqual([{ number: 1, role: "CUSTOMER" }, { number: 2, role: "ADDITIONAL_CUSTOMER" }, { number: 3, role: "CUSTOMER" }])
  } finally { await context.close(); await f.db.end() }
})

test("a checklist selector appears only for genuinely different requirements and contextual roles stay automatic", async ({ browser }) => {
  test.setTimeout(120_000)
  const { f, admin, person } = await setup(browser), { page, context } = admin
  try {
    const current = await json(context, "/api/verification/policy")
    const definition = { ...current.definition, facts: [...current.definition.facts, { code: "authority", label: "Authority reference", type: "TEXT", subjects: ["PERSON"], roles: ["REPRESENTATIVE"] }] }
    const preview = await json(context, "/api/verification/policy/preview", 200, "POST", { version: 1, definition })
    await json(context, "/api/verification/policy", 200, "PUT", { version: 1, definition, previewHash: preview.previewHash })
    await open(page, person.id); await page.getByRole("tab", { name: "Details & review", exact: true }).click()
    await expect(page.getByLabel("Verification checklist", { exact: true })).toBeVisible()
    await page.getByLabel("Legal name", { exact: true }).fill("Unsaved customer name")
    await page.getByLabel("Verification checklist", { exact: true }).click()
    await page.getByRole("menuitemradio", { name: "Representative", exact: true }).click()
    await expect(page.getByLabel("Authority reference", { exact: true })).toBeVisible()
    await expect(page.getByLabel("Legal name", { exact: true })).toHaveCount(0)
    await page.getByLabel("Authority reference", { exact: true }).fill("Synthetic authority")
    await page.getByRole("tab", { name: "Documents", exact: true }).click(); await page.getByRole("tab", { name: "Details & review", exact: true }).click()
    await expect(page.getByLabel("Authority reference", { exact: true })).toHaveValue("Synthetic authority")
    await page.setViewportSize({ width: 390, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: "test-results/local-access/verification-checklist-mobile.png", fullPage: true })
    expect((await f.db.query('SELECT count(*)::int n FROM "VerificationSubmission" WHERE "tenantId"=$1', [f.slug])).rows[0].n).toBe(0)
  } finally { await context.close(); await f.db.end() }
})
