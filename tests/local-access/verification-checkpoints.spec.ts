import { test, expect } from "@playwright/test"
import { seed, login, json, assignProfiles, assignOffices } from "./fixtures"
import { emptyQuotationContent } from "../../modules/sales-documents/quotation-validation"

test("administrator configures Required checkpoints; status-only operators see every saved applicant and can proceed after independent approval", async ({ browser }) => {
  test.setTimeout(180_000)
  const f = await seed(), admin = await login(browser, f.origin, f.users.admin.email)
  let operator: Awaited<ReturnType<typeof login>> | undefined, reviewer: Awaited<ReturnType<typeof login>> | undefined
  try {
    for (const key of ["customerVerification", "salesOrders", "catalog"]) await f.db.query('INSERT INTO "TenantModule"("tenantId",key,allowed,enabled,"updatedAt") VALUES($1,$2,true,true,now()) ON CONFLICT("tenantId",key) DO UPDATE SET allowed=true,enabled=true', [f.slug, key])
    await f.db.query('UPDATE "TenantModule" SET enabled=false WHERE "tenantId"=$1 AND key=\'realEstate\'', [f.slug])
    const company = await json(admin.context, "/api/companies", 201, "POST", { code: "CHECK", name: "Generic verification company" }), office = await json(admin.context, "/api/offices", 201, "POST", { companyId: company.id, code: "CHECK", name: "Verification office" })
    for (const u of [f.users.admin, f.users.manager, f.users.staff]) await assignOffices(admin.context, u.id, [office.id], office.id)
    const definition = { format: 1, facts: [], documents: [], validityDays: 365, preventSelfApproval: true }, p = await json(admin.context, "/api/verification/policy/preview", 200, "POST", { version: 0, definition })
    await json(admin.context, "/api/verification/policy", 200, "PUT", { version: 0, definition, previewHash: p.previewHash })
    const { page } = admin
    await page.goto("/settings/verification"); await page.getByRole("tab", { name: "Transaction checkpoints", exact: true }).click()
    await expect(page.getByRole("heading", { name: "Verification checkpoints", exact: true })).toBeVisible()
    for (const label of ["Order confirmation", "Unit allocation", "Order document issuance"]) {
      await page.getByLabel(label, { exact: true }).click(); await page.getByRole("menuitemradio", { name: "Required", exact: true }).click()
    }
    await page.getByRole("button", { name: "Preview checkpoint rules", exact: true }).click(); await page.getByRole("button", { name: "Publish checkpoint rules", exact: true }).click()
    await expect(page.getByRole("status").filter({ hasText: "Published checkpoint settings version 1" })).toBeVisible()
    await page.screenshot({ path: "test-results/local-access/verification-checkpoints-settings.png", fullPage: true, animations: "disabled" })
    await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: "test-results/local-access/verification-checkpoints-settings-mobile.png", fullPage: true, animations: "disabled" }); await page.setViewportSize({ width: 1280, height: 900 })
    const opProfile = await json(admin.context, "/api/access/roles", 201, "POST", { name: "Verification status operator", permissions: ["salesOrders.read", "salesOrders.confirm", "opportunities.read", "verificationSummaries.read"] })
    const reviewProfile = await json(admin.context, "/api/access/roles", 201, "POST", { name: "Verification approver", permissions: ["contacts.read", "customerVerification.read", "verificationSubmissions.read", "verificationEvidence.read", "verificationReviews.read", "verificationReviews.approve", "verificationReviews.cancel"] })
    await assignProfiles(admin.context, f.users.manager.id, [opProfile.id], { salesRecordScope: "ACCOUNT_ROLE" }); await assignProfiles(admin.context, f.users.staff.id, [reviewProfile.id], { salesRecordScope: "ACCOUNT_ROLE" })
    operator = await login(browser, f.origin, f.users.manager.email); reviewer = await login(browser, f.origin, f.users.staff.email)
    const main = await json(admin.context, "/api/crm/contacts", 201, "POST", { name: "Checkpoint main buyer" }), additional = await json(admin.context, "/api/crm/contacts", 201, "POST", { name: "Checkpoint additional buyer" })
    const pipeline = await json(admin.context, "/api/crm/pipelines", 201, "POST", { name: "Generic sales", stages: [{ name: "Open", kind: "OPEN", probability: 10, color: "#123456" }, { name: "Won", kind: "WON", probability: 100, color: "#00aa00" }, { name: "Lost", kind: "LOST", probability: 0, color: "#aa0000" }] })
    const deal = await json(admin.context, "/api/crm/opportunities", 201, "POST", { title: "Generic checkpoint booking", contactId: main.id, assignedUserId: f.users.manager.id, pipelineId: pipeline.id, stageId: pipeline.stages[0].id, amount: "100", currency: "INR", expectedCloseOn: "2030-01-01" })
    await json(admin.context, `/api/crm/opportunities/${deal.id}/participants`, 200, "PUT", { version: 1, participants: [{ role: "ADDITIONAL_CUSTOMER", party: { kind: "PERSON", id: additional.id } }] })
    const item = await json(admin.context, "/api/catalog/items", 201, "POST", { code: "VERIFY-UNIT", name: "Generic unit", kind: "UNIT", price: "100", currency: "INR", unit: "each" })
    const quote = await json(admin.context, `/api/crm/opportunities/${deal.id}/quotations`, 201, "POST", { content: { ...structuredClone(emptyQuotationContent), title: "Generic checkpoint agreement", supplierName: "Generic verification company", currency: "INR", lines: [{ description: item.name, quantity: "1", unit: "each", rate: "100", catalogItemId: item.id, catalogItemVersion: item.version }] } })
    const order = await json(admin.context, "/api/sales-orders", 200, "POST", { quotationId: quote.id, revision: 1 })
    const op = operator.page
    await op.goto(`/sales-orders/${order.id}`); await op.getByRole("tab", { name: "Verification", exact: true }).click()
    await expect(op.getByRole("heading", { name: "Participant verification", exact: true })).toBeVisible(); await expect(op.getByText("Checkpoint additional buyer", { exact: true })).toBeVisible()
    await expect(op.getByText("Not started", { exact: true })).toHaveCount(2)
    await json(operator.context, `/api/verification/submissions?kind=PERSON&id=${main.id}`, 403)
    await json(operator.context, `/api/sales-orders/${order.id}`, 409, "PATCH", { action: "confirm", version: 1 })
    for (const [person, role] of [[main, "CUSTOMER"], [additional, "ADDITIONAL_CUSTOMER"]] as const) {
      const c = await json(admin.context, "/api/verification/cases", 200, "POST", { kind: "PERSON", id: person.id }), s = await json(admin.context, "/api/verification/submissions", 200, "POST", { caseId: c.case.id, version: 0, policyVersion: 1, role, facts: [], evidenceIds: [] })
      await json(reviewer.context, "/api/verification/reviews", 200, "POST", { submissionId: s.id, version: 1, reviewVersion: 0, decision: "APPROVED", reviewed: true })
    }
    await op.getByRole("button", { name: "Refresh verification summary", exact: true }).click(); await expect(op.getByText("Verified", { exact: true })).toHaveCount(2)
    await op.getByRole("button", { name: "Refresh", exact: true }).click(); await op.getByRole("button", { name: "Confirm sales order", exact: true }).click(); await op.getByRole("button", { name: "Confirm agreement", exact: true }).click()
    await expect(op.getByRole("dialog")).toHaveCount(0)
    await op.getByRole("tab", { name: "Verification", exact: true }).click(); await op.getByRole("button", { name: "Refresh verification summary", exact: true }).click(); await op.getByText("Accepted checkpoint history", { exact: true }).click()
    await expect(op.getByText("Order confirmation · Passed", { exact: true })).toBeVisible()
    await op.screenshot({ path: "test-results/local-access/verification-checkpoints-desktop.png", fullPage: true, animations: "disabled" })
    await op.setViewportSize({ width: 390, height: 844 }); await op.getByRole("heading", { name: "Participant verification", exact: true }).scrollIntoViewIfNeeded(); expect(await op.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await op.screenshot({ path: "test-results/local-access/verification-checkpoints-mobile.png", fullPage: true, animations: "disabled" })
    const h = await json(admin.context, `/api/sales-orders/${order.id}/reservations`, 200, "POST", { itemId: item.id, expiresAt: new Date(Date.now() + 86400000).toISOString() })
    await json(admin.context, `/api/sales-orders/${order.id}/reservations/${h.id}`, 200, "PATCH", { action: "allocate", version: 1 })
    expect((await f.db.query('SELECT count(*)::int n FROM "OrderVerificationAcceptance" WHERE "tenantId"=$1', [f.slug])).rows[0].n).toBe(2)
  } finally { await operator?.context.close(); await reviewer?.context.close(); await admin.context.close(); await f.db.end() }
})
