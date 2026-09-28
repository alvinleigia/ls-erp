import { test, expect, type Page } from "@playwright/test"

// Mutations are intercepted; reusable with a saved CRM login without changing
// hosted leads. Database enforcement is covered in crm.integration.test.cjs.
async function fixture(page: Page, canManage = true) {
  const writes: { path: string; body: Record<string, unknown> }[] = []
  const queries: URLSearchParams[] = []
  const reason = { id: "reason-spam", name: "Spam", archived: false, version: 1 }
  const contact = { id: "reason-contact", name: "Alex Taylor", email: "alex@example.test", version: 1, archived: false }
  const stages = [{ id: "open", name: "Qualified", kind: "OPEN", probability: 20, archived: false }, { id: "lost", name: "Lost", kind: "LOST", probability: 0, archived: false }]
  const pipeline = { id: "reason-pipeline", name: "Sales", stages, archived: false }
  let lead = { id: "reason-lead", title: "Web enquiry", contact, assignedUserId: "reason-admin", assignee: { id: "reason-admin", name: "Administrator" }, status: "QUALIFIED", outcome: "", version: 1, lostReasonId: "", lostReasonName: "", realEstateEnabled: false }
  let deal = { id: "reason-deal", title: "Office purchase", contact, pipeline, pipelineId: pipeline.id, stage: stages[0], stageId: "open", contactId: contact.id, assignedUserId: "reason-admin", assignee: lead.assignee, expectedCloseOn: "2026-10-01", amount: "100", currency: "INR", probability: 20, version: 1, lostReasonId: "", lostReasonName: "", realEstateEnabled: false }
  await page.route("**/api/**", async route => {
    const r = route.request(), u = new URL(r.url()), path = u.pathname
    const list = (items: unknown[]) => ({ items, total: items.length, page: 1, pageSize: 20, totalPages: 1 })
    if (r.method() !== "GET") {
      const body = r.postDataJSON(); writes.push({ path, body })
      if (path === `/api/crm/enquiries/${lead.id}`) { lead = { ...lead, ...body, lostReasonName: body.lostReasonId ? reason.name : "", version: lead.version + 1 }; return route.fulfill({ json: lead }) }
      if (path.startsWith(`/api/crm/opportunities/${deal.id}`)) { deal = { ...deal, ...body, lostReasonName: body.lostReasonId ? reason.name : "", version: deal.version + 1 }; return route.fulfill({ json: deal }) }
      if (path === "/api/crm/lost-reasons") return route.fulfill({ json: { ...reason, ...body } })
      return route.abort()
    }
    if (path === "/api/crm/lost-reasons") return route.fulfill({ json: { ...list([reason]), canManage } })
    if (path === "/api/crm/assignees") return route.fulfill({ json: { ...list([lead.assignee]), canAssign: canManage, currentUserId: lead.assignedUserId } })
    if (path === `/api/crm/enquiries/${lead.id}`) return route.fulfill({ json: lead })
    if (path === "/api/crm/enquiries") { queries.push(u.searchParams); return route.fulfill({ json: list([lead]) }) }
    if (path === "/api/crm/pipelines") return route.fulfill({ json: list([pipeline]) })
    if (path === `/api/crm/pipelines/${pipeline.id}`) return route.fulfill({ json: pipeline })
    if (path === `/api/crm/opportunities/${deal.id}`) return route.fulfill({ json: deal })
    if (path === "/api/crm/opportunities") return route.fulfill({ json: list(!u.searchParams.get("stageId") || u.searchParams.get("stageId") === deal.stageId ? [deal] : []) })
    if (path === "/api/settings/display") return route.fulfill({ json: { settings: { currency: "INR", timeZone: "Asia/Kolkata", dateFormat: "dd/MM/yyyy" } } })
    if (path.startsWith("/api/crm/")) return route.fulfill({ json: { ...list([]), canManage, timeZone: "Asia/Kolkata" } })
    return route.continue()
  })
  return { writes, queries }
}

test("enquiry shows reasons only for Lost, saves the selection and filters by it", async ({ page }, info) => {
  const { writes, queries } = await fixture(page)
  await page.goto("/crm/enquiries/reason-lead")
  await expect(page.getByRole("combobox", { name: "Lost reason", exact: true })).toHaveCount(0)
  await page.getByLabel("Status", { exact: true }).click()
  await page.getByRole("menuitemradio", { name: "Lost", exact: true }).click()
  await page.getByRole("combobox", { name: "Lost reason", exact: true }).click()
  await page.getByRole("option", { name: "Spam", exact: true }).click()
  await page.getByLabel("Closing note (optional)").fill("Unsolicited promotion")
  await page.getByRole("button", { name: "Save enquiry", exact: true }).click()
  await expect.poll(() => writes.length).toBe(1)
  expect(writes[0].body).toMatchObject({ status: "CLOSED", lostReasonId: "reason-spam", outcome: "Unsolicited promotion" })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: info.outputPath("lost-enquiry-mobile.png"), fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  await page.goto("/crm/enquiries")
  await page.getByRole("button", { name: "Filters", exact: true }).click()
  await page.getByRole("combobox", { name: "Lost reason", exact: true }).click()
  await page.getByRole("option", { name: "Spam", exact: true }).click()
  await expect.poll(() => queries.at(-1)?.get("lostReasonId")).toBe("reason-spam")
})

test("opportunity editor and board both use the shared reason dropdown", async ({ page }, info) => {
  const { writes } = await fixture(page)
  await page.goto("/crm/opportunities/reason-deal")
  await expect(page.getByRole("combobox", { name: "Lost reason", exact: true })).toHaveCount(0)
  await page.getByLabel("Stage", { exact: true }).click()
  await page.getByRole("menuitemradio", { name: "Lost", exact: true }).click()
  await page.getByRole("combobox", { name: "Lost reason", exact: true }).click()
  await page.getByRole("option", { name: "Spam", exact: true }).click()
  await page.getByRole("button", { name: "Save opportunity", exact: true }).click()
  await expect.poll(() => writes.length).toBe(1)
  expect(writes[0].body).toMatchObject({ stageId: "lost", lostReasonId: "reason-spam", lossReason: "" })
  await page.goto("/crm/opportunities")
  // Reopen through the board, then close again through its review dialog.
  await page.getByLabel("Move Office purchase to stage").click()
  await page.getByRole("menuitemradio", { name: "Qualified", exact: true }).click()
  await expect.poll(() => writes.length).toBe(2)
  await page.getByLabel("Move Office purchase to stage").click()
  await page.getByRole("menuitemradio", { name: "Lost", exact: true }).click()
  await expect(page.getByRole("button", { name: "Close as lost", exact: true })).toBeDisabled()
  await page.getByRole("combobox", { name: "Lost reason", exact: true }).click()
  await page.getByRole("option", { name: "Spam", exact: true }).click()
  await expect(page.getByRole("option", { name: "Spam", exact: true })).toBeHidden()
  await page.screenshot({ path: info.outputPath("lost-opportunity-dialog.png") })
  await page.getByRole("button", { name: "Close as lost", exact: true }).click()
  await expect.poll(() => writes.length).toBe(3)
  expect(writes[2].body).toMatchObject({ stageId: "lost", lostReasonId: "reason-spam" })
})

test("managers configure lost reasons; staff see a read-only catalog", async ({ page }, info) => {
  const { writes } = await fixture(page)
  await page.goto("/crm/lost-reasons")
  await page.getByRole("button", { name: "New reason", exact: true }).click()
  await page.getByLabel("Reason name", { exact: true }).fill("Duplicate")
  await page.getByRole("button", { name: "Save reason", exact: true }).click()
  await expect.poll(() => writes.length).toBe(1)
  expect(writes[0].body).toEqual({ name: "Duplicate" })
  await expect(page.getByRole("dialog")).toBeHidden()
  await page.screenshot({ path: info.outputPath("lost-reason-catalog.png"), fullPage: true })
  await fixture(page, false)
  await page.reload()
  await expect(page.getByRole("cell", { name: "Spam", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "New reason", exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Edit Spam" })).toHaveCount(0)
})
