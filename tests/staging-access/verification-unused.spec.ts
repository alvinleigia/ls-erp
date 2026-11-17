import fs from "node:fs"
import sharp from "sharp"
import { test, expect } from "@playwright/test"
import { stagingFixture } from "../helpers/p13s-staging"
import { api } from "../helpers/p13s-acceptance"
import { defaultRecordRules, supportedScopes } from "../../platform/access/rules"
import type { Resource } from "../../platform/access/catalog"

test("hosted unused upload removal protects submissions and preserves the normal replacement/review flow", async ({ browser }, info) => {
  test.setTimeout(600_000)
  const f = await stagingFixture(browser, ["crm", "customerVerification"])
  const a = f.admin.context, o = f.operator.context, r = f.reviewer.context, page = f.admin.page
  try {
    const company = await api(a, "/api/companies", 201, "POST", { code: "UNUSED", name: "Synthetic Unused Upload Acceptance" })
    const office = await api(a, "/api/offices", 201, "POST", { companyId: company.id, code: "QA", name: "Synthetic test office" })
    for (const user of [f.admin, f.operator, f.reviewer]) {
      const current = await api(a, `/api/access/users/${user.id}/offices`)
      await api(a, `/api/access/users/${user.id}/offices`, 200, "PATCH", { version: current.version, officeIds: [office.id], companies: [], creationOfficeId: office.id })
    }
    for (const [user, permissions] of [
      [f.operator, ["dashboard.read", "contacts.read", "contacts.create", "customerVerification.read", "customerVerification.create", "verificationUploads.read", "verificationUploads.create", "verificationUploads.cancel", "verificationSubmissions.read", "verificationSubmissions.create"]],
      [f.reviewer, ["dashboard.read", "contacts.read", "customerVerification.read", "verificationEvidence.read", "verificationSubmissions.read", "verificationReviews.read", "verificationReviews.approve"]],
    ] as const) {
      const role = await api(a, "/api/access/roles", 201, "POST", { name: `Synthetic ${user === f.operator ? "collector" : "reviewer"}`, permissions })
      const current = await api(a, `/api/access/users/${user.id}`), rules = defaultRecordRules()
      for (const key of Object.keys(rules) as (keyof typeof rules)[]) if (supportedScopes(key.split(".")[0] as Resource).includes("ALL")) rules[key] = "ALL"
      await api(a, `/api/access/users/${user.id}`, 200, "PATCH", { version: current.accessPolicy.version, roleIds: [role.id], rules })
    }
    const definition = { format: 1, facts: [], documents: [{ code: "identity", label: "Synthetic identity", subjects: ["PERSON"], roles: ["CUSTOMER"] }], validityDays: null, preventSelfApproval: true }
    const preview = await api(a, "/api/verification/policy/preview", 200, "POST", { version: 0, definition })
    await api(a, "/api/verification/policy", 200, "PUT", { version: 0, definition, previewHash: preview.previewHash })
    const person = await api(o, "/api/crm/contacts", 201, "POST", { name: "SYNTHETIC Unused Upload Customer" })
    const started = await api(o, "/api/verification/cases", 200, "POST", { kind: "PERSON", id: person.id })
    const bytes = await sharp({ create: { width: 20, height: 20, channels: 3, background: "orange" } }).png().toBuffer()
    const query = new URLSearchParams({ kind: "PERSON", id: person.id })
    async function upload() {
      const u = await api(o, "/api/verification/evidence/uploads", 200, "POST", { caseId: started.case.id, documentCode: "identity", filename: "synthetic-unused.png", contentType: "image/png", bytes: bytes.length })
      expect(new URL(u.uploadUrl).hostname).toBe("oyhsrcmjhwxhvepdbcdc.supabase.co")
      expect((await o.request.put(u.uploadUrl, { headers: { "Content-Type": "image/png" }, data: bytes })).ok()).toBe(true)
      await api(o, `/api/verification/evidence/${u.id}/finalize`, 200, "POST")
      return u.id as string
    }
    const original = await upload()
    await api(o, "/api/verification/disposals/preview", 403, "POST", { evidenceId: original, kind: "UNSUBMITTED" })
    await page.goto(`/crm/contacts/${person.id}`)
    await page.getByRole("tab", { name: "Verification", exact: true }).click()
    await page.getByRole("button", { name: "Manage uploaded files", exact: true }).click()
    await page.getByRole("button", { name: "Remove unused upload", exact: true }).click()
    const confirm = page.getByRole("button", { name: "Confirm unused upload removal", exact: true })
    await expect(confirm).toBeDisabled()
    await page.getByRole("button", { name: "Keep file", exact: true }).click()
    await page.getByRole("button", { name: "Remove unused upload", exact: true }).click()
    await page.getByLabel("Disposal reason", { exact: true }).fill("Synthetic uncropped image replaced during acceptance")
    await page.getByLabel("I reviewed this unused upload and permanent removal.", { exact: true }).check()
    await confirm.scrollIntoViewIfNeeded()
    await page.screenshot({ path: info.outputPath("unused-desktop.png"), animations: "disabled" })
    await page.setViewportSize({ width: 390, height: 844 }); await confirm.scrollIntoViewIfNeeded()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath("unused-mobile.png"), animations: "disabled" })
    await confirm.click()
    await expect(page.getByRole("status").filter({ hasText: "Unused upload removed." })).toBeVisible()
    expect((await api(a, `/api/verification/collection?${query}`)).evidence).toHaveLength(0)
    await api(a, `/api/verification/evidence/${original}/download`, 404)
    expect((await api(a, "/api/verification/retention")).version).toBe(0)
    const history = await api(a, `/api/verification/holds?${query}`)
    expect(history.disposals).toEqual(expect.arrayContaining([expect.objectContaining({ evidenceId: original, kind: "UNSUBMITTED", state: "COMPLETED", retainedEvidenceId: null })]))
    const replacement = await upload()
    const submitted = await api(o, "/api/verification/submissions", 200, "POST", { caseId: started.case.id, version: 0, policyVersion: 1, role: "CUSTOMER", facts: [], evidenceIds: [replacement] })
    await api(a, "/api/verification/disposals/preview", 409, "POST", { evidenceId: replacement, kind: "UNSUBMITTED" })
    await api(r, "/api/verification/reviews", 200, "POST", { submissionId: submitted.id, version: 1, reviewVersion: 0, decision: "APPROVED", reviewed: true })
    await api(a, "/api/verification/disposals/preview", 409, "POST", { evidenceId: replacement, kind: "UNSUBMITTED" })
    fs.writeFileSync(`tmp/p13s-staging/${f.receipt.slug}-unused-progress.json`, JSON.stringify({ deployment: f.receipt.deployment, passed: ["admin-only confirmation and cancellation", "last unused upload removed", "replacement upload and independent review", "submitted original protected", "retention unchanged"] }, null, 2), { mode: 0o600 })
  } finally { await f.close() }
})
