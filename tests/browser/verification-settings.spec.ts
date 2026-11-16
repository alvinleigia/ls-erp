import { test, expect, type Page } from "@playwright/test"
import { emptyVerificationPolicy, type VerificationPolicy } from "../../platform/verification/contracts"

async function settings(page: Page, { version = 0, canPublish = true, definition = emptyVerificationPolicy() } = {}) {
  let saved = { version, canPublish, definition }
  const writes: { method: string; path: string; data: { version: number; definition: VerificationPolicy; previewHash?: string } }[] = []
  await page.route("**/api/verification/policy**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (request.method() === "GET") return route.fulfill({ json: saved })
    const data = request.postDataJSON(); writes.push({ method: request.method(), path, data })
    if (path.endsWith("/preview")) return route.fulfill({ json: { previewHash: "a".repeat(64), facts: data.definition.facts.length, documents: data.definition.documents.length } })
    saved = { version: saved.version + 1, canPublish, definition: data.definition }
    return route.fulfill({ json: saved })
  })
  await page.goto("/settings/verification")
  await expect(page.getByRole("heading", { name: "Customer verification requirements", exact: true })).toBeVisible()
  return writes
}

test("simple checklist prepares an editable draft and requires explicit preview and publication", async ({ page }, info) => {
  const writes = await settings(page)
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath("simple-checklist-starter-mobile.png"), fullPage: true, animations: "disabled" })
  await page.getByRole("button", { name: "Use simple individual checklist", exact: true }).click()
  await expect(page.getByRole("tab", { name: "Required documents (2)", exact: true })).toHaveAttribute("aria-selected", "true")
  await expect(page.getByLabel("Label", { exact: true }).nth(0)).toHaveValue("Tax identification proof")
  await expect(page.getByLabel("Label", { exact: true }).nth(1)).toHaveValue("Identity/address evidence")
  await expect(page.getByRole("checkbox", { name: "Person", exact: true }).nth(0)).toBeChecked()
  await expect(page.getByRole("checkbox", { name: "Business", exact: true }).nth(0)).not.toBeChecked()
  await expect(page.getByRole("checkbox", { name: "Customer", exact: true }).nth(1)).toBeChecked()
  await expect(page.getByRole("checkbox", { name: "Additional customer", exact: true }).nth(1)).toBeChecked()
  await expect(page.getByRole("checkbox", { name: "Representative", exact: true }).nth(1)).not.toBeChecked()
  await expect(page.getByLabel(/Approval validity/)).toHaveValue("")
  expect(writes).toEqual([])
  await expect(page.getByRole("button", { name: "Publish requirements", exact: true })).toBeDisabled()
  await page.getByRole("button", { name: "Preview requirements", exact: true }).click()
  await expect(page.getByRole("status")).toContainText("0 fact requirements and 2 document types")
  await page.getByLabel("Label", { exact: true }).nth(0).fill("Tax identification evidence")
  await expect(page.getByRole("button", { name: "Publish requirements", exact: true })).toBeDisabled()
  await page.getByRole("button", { name: "Preview requirements", exact: true }).click()
  await page.getByRole("button", { name: "Publish requirements", exact: true }).click()
  await expect(page.getByRole("status")).toContainText("Published verification requirements version 1")
  expect(writes.map(w => [w.method, w.path])).toEqual([["POST", "/api/verification/policy/preview"], ["POST", "/api/verification/policy/preview"], ["PUT", "/api/verification/policy"]])
  expect(writes[2].data).toMatchObject({ version: 0, previewHash: "a".repeat(64), definition: { facts: [], validityDays: null, preventSelfApproval: true } })
  await expect(page.getByRole("button", { name: "Use simple individual checklist", exact: true })).toHaveCount(0)
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath("simple-checklist-mobile.png"), fullPage: true, animations: "disabled" })
})

test("starter cannot replace an unsaved draft and reloading discards it without a write", async ({ page }) => {
  const writes = await settings(page)
  await page.getByLabel(/Approval validity/).fill("180")
  await expect(page.getByRole("button", { name: "Use simple individual checklist", exact: true })).toHaveCount(0)
  await page.getByRole("button", { name: "Reload saved details", exact: true }).click()
  await page.getByRole("button", { name: "Discard and reload", exact: true }).click()
  await page.getByRole("button", { name: "Use simple individual checklist", exact: true }).click()
  await page.reload()
  await expect(page.getByRole("tab", { name: "Required documents (0)", exact: true })).toBeVisible()
  expect(writes).toEqual([])
})

for (const scenario of [
  { name: "read-only access", canPublish: false, version: 0, definition: emptyVerificationPolicy() },
  { name: "published requirements", canPublish: true, version: 1, definition: emptyVerificationPolicy() },
  { name: "existing document choices", canPublish: true, version: 0, definition: { ...emptyVerificationPolicy(), documents: [{ code: "custom", label: "Existing evidence", subjects: ["BUSINESS"] as ["BUSINESS"], roles: ["CUSTOMER"] as ["CUSTOMER"] }] } },
]) test(`starter preserves ${scenario.name}`, async ({ page }) => {
  const writes = await settings(page, scenario)
  await expect(page.getByRole("button", { name: "Use simple individual checklist", exact: true })).toHaveCount(0)
  expect(writes).toEqual([])
})
