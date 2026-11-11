/* eslint-disable @typescript-eslint/no-explicit-any -- Public API acceptance spans module-specific response contracts. */
// Shared acceptance: public APIs and browser UI only. No SQL, fixture reset,
// hosted service credentials, email sending or production targets.
import { randomUUID, createHash } from "node:crypto"
import sharp from "sharp"
import { expect, type BrowserContext, type Page, type TestInfo } from "@playwright/test"
import { allPermissions, type Resource } from "../../platform/access/catalog"
import { defaultRecordRules, supportedScopes } from "../../platform/access/rules"
import { emptyQuotationContent } from "../../modules/sales-documents/quotation-validation"

type Actor = { context: BrowserContext; page: Page; id: string }
export async function api(c: BrowserContext, path: string, status = 200, method = "GET", data?: unknown): Promise<any> {
  let headers = {}
  if (method === "POST" && /^\/api\/crm\/(enquiries|opportunities)(\?|$)/.test(path)) {
    const office = await api(c, "/api/workspace/office")
    if (office.creationOffice) headers = { "x-office-id": office.creationOffice.id, "x-office-version": String(office.version) }
  }
  const r = await c.request.fetch(path, { method, headers, ...(data === undefined ? {} : { data }) })
  expect(r.status(), `${method} ${path}`).toBe(status)
  return r.json()
}
async function profile(c: BrowserContext, userId: string, name: string, permissions: string[]) {
  const p = await api(c, "/api/access/roles", 201, "POST", { name, permissions }), current = await api(c, `/api/access/users/${userId}`), rules = defaultRecordRules()
  for (const k of Object.keys(rules) as (keyof typeof rules)[]) if (supportedScopes(k.split(".")[0] as Resource).includes("ALL")) rules[k] = "ALL"
  await api(c, `/api/access/users/${userId}`, 200, "PATCH", { version: current.accessPolicy.version, roleIds: [p.id], rules })
}
async function publishTemplate(c: BrowserContext, companyId: string, providerKey: string) {
  const old = await api(c, `/api/document-templates?${new URLSearchParams({ companyId, providerKey })}`)
  await api(c, "/api/document-templates", 200, "PUT", { companyId, providerKey, version: old.version, reviewed: true, content: { ...old.content, enabled: true, address: "Synthetic QA office, Goa, India", terms: "Synthetic acceptance only. No real booking or payment." } })
}
async function pdf(c: BrowserContext, url: string) {
  const r = await c.request.get(url, { maxRedirects: 0 }); expect(r.status()).toBe(303)
  const location = r.headers().location; expect(new URL(location).protocol).toBe("https:")
  const original = await c.request.get(location); expect(original.ok()).toBe(true)
  const bytes = await original.body(); expect(bytes.subarray(0, 5).toString()).toBe("%PDF-")
  return { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }
}

export async function p13sAcceptance({ admin, operator, reviewer, info }: { admin: Actor; operator: Actor; reviewer: Actor; info: TestInfo }) {
  const a = admin.context, o = operator.context, r = reviewer.context
  const company = await api(a, "/api/companies", 201, "POST", { code: "P13S", name: "P13S Synthetic Industries" }), office = await api(a, "/api/offices", 201, "POST", { companyId: company.id, code: "QA", name: "Acceptance office" })
  for (const u of [admin, operator, reviewer]) { const m = await api(a, `/api/access/users/${u.id}/offices`); await api(a, `/api/access/users/${u.id}/offices`, 200, "PATCH", { version: m.version, officeIds: [office.id], companies: [], creationOfficeId: office.id }) }
  const resources = ["dashboard", "contacts", "enquiries", "opportunities", "pipelines", "assignmentTargets", "partnerChoices", "partnerLinks", "quotations", "catalogItems", "salesOrders", "unitReservations", "receivables", "orderPayments", "orderDocuments", "paymentDocuments", "verificationSummaries", "customerVerification", "verificationUploads", "verificationSubmissions"]
  await profile(a, operator.id, "QA Booking and Collections", allPermissions.filter(p => resources.includes(p.split(".")[0])))
  await profile(a, reviewer.id, "QA Independent Reviewer", ["dashboard.read", "contacts.read", "customerVerification.read", "verificationEvidence.read", "verificationSubmissions.read", "verificationReviews.read", "verificationReviews.approve", "verificationReviews.cancel"])
  const definition = { format: 1, facts: [{ code: "legal_name", label: "Legal name", type: "TEXT", subjects: ["PERSON"], roles: ["CUSTOMER", "ADDITIONAL_CUSTOMER"] }], documents: [{ code: "identity", label: "Identity evidence", subjects: ["PERSON"], roles: ["CUSTOMER", "ADDITIONAL_CUSTOMER"] }], validityDays: 365, preventSelfApproval: true }, preview = await api(a, "/api/verification/policy/preview", 200, "POST", { version: 0, definition })
  await api(a, "/api/verification/policy", 200, "PUT", { version: 0, definition, previewHash: preview.previewHash })
  const cpA = await api(a, "/api/collaborators", 201, "POST", { code: "CP-A", name: "Synthetic Partner Alpha", supervisorUserId: admin.id }), cpB = await api(a, "/api/collaborators", 201, "POST", { code: "CP-B", name: "Synthetic Partner Beta", supervisorUserId: admin.id })
  await api(o, "/api/collaborators", 403); expect((await api(o, "/api/crm/partner-choices")).items.some((x: any) => x.id === cpA.id)).toBe(true)
  const buyer = await api(o, "/api/crm/contacts", 201, "POST", { name: "P13S Synthetic Buyer", email: "p13s-buyer@example.test" }), additional = await api(o, "/api/crm/contacts", 201, "POST", { name: "P13S Synthetic Co-applicant", email: "p13s-additional@example.test" })
  const pipeline = await api(a, "/api/crm/pipelines", 201, "POST", { name: "Synthetic generic sales", stages: [{ name: "Open", kind: "OPEN", probability: 10, color: "#123456", isConversionDefault: true }, { name: "Won", kind: "WON", probability: 100, color: "#00aa00" }, { name: "Lost", kind: "LOST", probability: 0, color: "#aa0000" }] })
  let enquiry = await api(o, "/api/crm/enquiries", 201, "POST", { title: "P13S Synthetic Enquiry", contactId: buyer.id, assignedUserId: operator.id, introducedByCollaboratorId: cpA.id })
  enquiry = await api(o, `/api/crm/enquiries/${enquiry.id}`, 200, "PATCH", { title: enquiry.title, assignedUserId: operator.id, version: enquiry.version, status: "QUALIFIED" })
  const input = { title: "P13S Synthetic Booking", contactId: buyer.id, assignedUserId: operator.id, enquiryId: enquiry.id, enquiryVersion: enquiry.version, pipelineId: pipeline.id, stageId: pipeline.stages[0].id, amount: "100", currency: "INR", expectedCloseOn: "2030-01-01" }
  let deal = await api(o, "/api/crm/opportunities", 201, "POST", input)
  expect(deal.introducedByCollaboratorId).toBe(cpA.id)
  const parties = await api(o, `/api/crm/opportunities/${deal.id}/participants`)
  await api(o, `/api/crm/opportunities/${deal.id}/participants`, 200, "PUT", { version: parties.version, participants: [{ role: "ADDITIONAL_CUSTOMER", party: { kind: "PERSON", id: additional.id } }] })
  deal = await api(o, `/api/crm/opportunities/${deal.id}`)
  await api(o, `/api/crm/opportunities/${deal.id}`, 200, "PATCH", { ...input, enquiryId: undefined, enquiryVersion: undefined, version: deal.version, stageId: pipeline.stages.find((x: any) => x.kind === "WON").id })
  const item = await api(a, "/api/catalog/items", 201, "POST", { code: "P13S-UNIT", name: "Synthetic generic unit", kind: "UNIT", price: "100", currency: "INR", unit: "each" })
  const quote = await api(o, `/api/crm/opportunities/${deal.id}/quotations`, 201, "POST", { content: { ...structuredClone(emptyQuotationContent), title: "Synthetic acceptance quotation", supplierName: company.name, currency: "INR", bookingDate: "2026-11-11", lines: [{ description: item.name, quantity: "1", unit: "each", rate: "100", catalogItemId: item.id, catalogItemVersion: item.version }], instalments: [{ label: "Booking", percent: "20", days: 0, note: "" }, { label: "Balance", percent: "80", days: 30, note: "" }] } })
  const order = await api(o, "/api/sales-orders", 200, "POST", { quotationId: quote.id, revision: 1, orderedOn: "2026-11-11" }), saved = await api(o, `/api/sales-orders/${order.id}`)
  const links = await api(o, `/api/crm/opportunities/${deal.id}/partner`)
  await api(o, `/api/crm/opportunities/${deal.id}/partner`, 200, "PATCH", { version: links.version, partnerId: cpB.id, reason: "Synthetic correction after won and saved quotation" })
  expect((await api(o, `/api/crm/opportunities/${deal.id}`)).assignedUserId).toBe(operator.id)
  expect((await api(o, `/api/sales-orders/${order.id}`)).snapshot).toEqual(saved.snapshot)
  expect((await api(o, `/api/crm/enquiries/${enquiry.id}`)).introducedByCollaboratorId).toBe(cpA.id)
  const checkpoints = { version: 0, definition: { format: 1, roles: ["CUSTOMER", "ADDITIONAL_CUSTOMER"], checkpoints: { ORDER_CONFIRMATION: "REQUIRED", UNIT_ALLOCATION: "REQUIRED", ORDER_DOCUMENT: "REQUIRED" } } }, ck = await api(a, "/api/verification/checkpoints/preview", 200, "POST", checkpoints)
  await api(a, "/api/verification/checkpoints", 200, "PUT", { ...checkpoints, previewHash: ck.previewHash })
  await api(o, `/api/sales-orders/${order.id}`, 409, "PATCH", { action: "confirm", version: 1 })
  const submissions = []
  for (const [person, role] of [[buyer, "CUSTOMER"], [additional, "ADDITIONAL_CUSTOMER"]] as const) {
    const c = await api(o, "/api/verification/cases", 200, "POST", { kind: "PERSON", id: person.id }), bytes = await sharp({ create: { width: 10, height: 10, channels: 3, background: "orange" } }).png().toBuffer()
    const upload = await api(o, "/api/verification/evidence/uploads", 200, "POST", { caseId: c.case.id, documentCode: "identity", filename: "synthetic-only.png", contentType: "image/png", bytes: bytes.length })
    const put = await o.request.put(upload.uploadUrl, { headers: { "Content-Type": "image/png" }, data: bytes }); expect(put.ok()).toBe(true)
    await api(o, `/api/verification/evidence/${upload.id}/finalize`, 200, "POST")
    const submission = await api(o, "/api/verification/submissions", 200, "POST", { caseId: c.case.id, version: 0, policyVersion: 1, role, facts: [{ code: "legal_name", value: person.name }], evidenceIds: [upload.id] })
    await api(o, "/api/verification/reviews", 403, "POST", { submissionId: submission.id, version: 1, reviewVersion: 0, decision: "APPROVED", reviewed: true })
    await api(r, "/api/verification/reviews", 200, "POST", { submissionId: submission.id, version: 1, reviewVersion: 0, decision: "APPROVED", reviewed: true })
    submissions.push(submission)
    if (role === "CUSTOMER") await api(o, `/api/sales-orders/${order.id}`, 409, "PATCH", { action: "confirm", version: 1 })
  }
  await api(o, `/api/sales-orders/${order.id}`, 200, "PATCH", { action: "confirm", version: 1 })
  const hold = await api(o, `/api/sales-orders/${order.id}/reservations`, 200, "POST", { itemId: item.id, expiresAt: new Date(Date.now() + 86400000).toISOString() })
  await api(o, `/api/sales-orders/${order.id}/reservations/${hold.id}`, 200, "PATCH", { action: "allocate", version: 1 })
  for (const key of ["order-acknowledgement", "payment-receipt"]) await publishTemplate(a, company.id, key)
  const endpoint = `/api/sales-orders/${order.id}/documents`, prepared = await api(o, endpoint + "/prepare", 200, "POST", { providerKey: "order-acknowledgement" }), issue = { providerKey: "order-acknowledgement", previewHash: prepared.previewHash, requestKey: randomUUID() }
  const document = await api(o, endpoint + "/issue", 200, "POST", issue)
  expect((await api(o, endpoint + "/issue", 200, "POST", issue)).id).toBe(document.id)
  const originalPdf = await pdf(o, `${endpoint}/${document.id}/pdf?providerKey=order-acknowledgement`)
  await api(o, `/api/sales-orders/${order.id}/receivables`, 200, "POST", { dueDates: [null, null] })
  // Verification revocation must block new operational acceptance, while money
  // already received can still be recorded and immutable PDFs remain retrievable.
  await api(r, "/api/verification/reviews", 200, "POST", { submissionId: submissions[0].id, version: 1, reviewVersion: 1, decision: "REVOKED", reviewed: false, reason: "Synthetic post-booking review correction" })
  const replacement = await api(o, endpoint + "/prepare", 200, "POST", { providerKey: "order-acknowledgement", supersedesId: document.id, reason: "Synthetic replacement attempt" })
  await api(o, endpoint + "/issue", 409, "POST", { providerKey: "order-acknowledgement", supersedesId: document.id, reason: "Synthetic replacement attempt", previewHash: replacement.previewHash, requestKey: randomUUID() })
  expect(await pdf(o, `${endpoint}/${document.id}/pdf?providerKey=order-acknowledgement`)).toEqual(originalPdf)
  const paymentInput = { requestKey: randomUUID(), version: 1, amount: "30", receivedOn: "2026-11-11", method: "BANK_TRANSFER", reference: "SYNTHETIC-NOT-A-PAYMENT", note: "Acceptance test only" }
  const payment = await api(o, `/api/sales-orders/${order.id}/receivables/payments`, 200, "POST", paymentInput)
  expect((await api(o, `/api/sales-orders/${order.id}/receivables/payments`, 200, "POST", paymentInput)).id).toBe(payment.id)
  const receiptEndpoint = `/api/payment-receipts/${payment.id}/documents`, receiptPreview = await api(o, receiptEndpoint + "/prepare", 200, "POST", { providerKey: "payment-receipt" }), receipt = await api(o, receiptEndpoint + "/issue", 200, "POST", { providerKey: "payment-receipt", previewHash: receiptPreview.previewHash, requestKey: randomUUID() })
  await pdf(o, `${receiptEndpoint}/${receipt.id}/pdf?providerKey=payment-receipt`)
  const balance = await api(o, `/api/sales-orders/${order.id}/receivables`)
  expect(Number(balance.paid)).toBe(30); expect(Number(balance.outstanding)).toBe(70)
  const page = operator.page
  await page.goto(`/sales-orders/${order.id}`); await page.getByRole("tab", { name: "Documents", exact: true }).click()
  await expect(page.getByRole("link", { name: "Download issued PDF", exact: true })).toBeVisible()
  await page.screenshot({ path: info.outputPath("p13s-combined-documents-desktop.png"), fullPage: true, animations: "disabled" })
  await page.getByRole("tab", { name: "Verification", exact: true }).click(); await expect(page.getByText("Revoked", { exact: true })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath("p13s-combined-verification-mobile.png"), fullPage: true, animations: "disabled" })
  return { orderId: order.id, enquiryId: enquiry.id, opportunityId: deal.id, documentId: document.id, receiptId: receipt.id, paid: "30", outstanding: "70", originalPdf, passed: true }
}
