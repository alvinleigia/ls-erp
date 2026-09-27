import { test, expect, type Page } from "@playwright/test"

// Intercept every API call and mutation; UI regressions never change business data.
async function fixture(page: Page) {
  const writes: { path: string; body: Record<string, unknown> }[] = []
  const contact = { id: "ui-contact", name: "Alex Taylor", email: null, phone: null }
  const work = { id: "ui-work", contactId: contact.id, contact, title: "UI call", type: "CALL", status: "OPEN", priority: 2, version: 4, assignedUserId: "ui-admin", assignee: { id: "ui-admin", name: "Admin" }, dueOn: "2026-09-30T00:00:00Z", startsAt: null, endsAt: null, reminderAt: null, description: "", callDirection: "OUTBOUND", canEdit: true, timeZone: "Asia/Kolkata" }
  await page.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname
    if (request.method() !== "GET") {
      const body = request.postDataJSON()
      writes.push({ path, body })
      if (path.endsWith("/complete")) Object.assign(work, { status: "COMPLETED", summary: body.summary, outcome: body.outcome })
      return route.fulfill({ json: path === "/api/crm/follow-up-rules" ? { ...body, id: "ui-rule", canManage: true } : path === "/api/crm/activity-plans" ? { ...body, id: "ui-plan", canManage: true } : work })
    }
    const list = { items: [], total: 0, page: Number(url.searchParams.get("page") || 1), pageSize: Number(url.searchParams.get("pageSize") || 10), totalPages: 1 }
    if (path === "/api/auth/session") return route.fulfill({ json: { user: { id: "ui-admin", name: "Admin", role: "ADMIN" }, expires: "2099-01-01" } })
    if (path === "/api/settings/display") return route.fulfill({ json: { settings: { timeZone: "Asia/Kolkata", dateFormat: "MM/dd/yyyy" } } })
    if (path === "/api/crm/assignees") return route.fulfill({ json: { ...list, items: [{ id: "ui-admin", name: "Admin" }], currentUserId: "ui-admin", canAssign: true } })
    if (path === "/api/crm/work/ui-work") return route.fulfill({ json: work })
    if (path.endsWith("/follow-up")) return route.fulfill({ json: { rule: null } })
    if (path === "/api/crm/follow-up-rules/ui-rule") return route.fulfill({ json: { ...writes.at(-1)?.body, id: "ui-rule", canManage: true } })
    if (path === "/api/crm/activity-plans/ui-plan") return route.fulfill({ json: { ...writes.at(-1)?.body, id: "ui-plan", canManage: true } })
    return route.fulfill({ json: { ...list, canManage: true } })
  })
  return writes
}

test("rule header saves dependent dropdown values and Cancel leaves without another write", async ({ page }) => {
  const writes = await fixture(page)
  await page.goto("/crm/follow-up-rules/new")
  await page.getByLabel("Rule name", { exact: true }).fill("Standard rule")
  await page.getByLabel("When completing", { exact: true }).click()
  await page.getByRole("menuitemradio", { name: "TASK", exact: true }).click()
  await expect(page.getByLabel("With outcome", { exact: true })).toHaveText("DONE")
  await page.getByLabel("Type", { exact: true }).click()
  await page.getByRole("menuitemradio", { name: "EMAIL", exact: true }).click()
  await expect(page.getByLabel("Call direction", { exact: true })).toHaveCount(0)
  await page.getByRole("button", { name: "Save rule", exact: true }).click()
  await expect.poll(() => writes.length).toBe(1)
  expect(writes[0].body).toMatchObject({ name: "Standard rule", sourceType: "TASK", outcome: "DONE", nextStep: { type: "EMAIL", callDirection: null } })
  await expect(page).toHaveURL(/follow-up-rules\/ui-rule$/)
  await page.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(page).toHaveURL(/follow-up-rules$/)
  expect(writes).toHaveLength(1)
})

test("plan header validates required steps before saving the full plan", async ({ page }) => {
  const writes = await fixture(page)
  await page.goto("/crm/activity-plans/new")
  await page.getByLabel("Plan name", { exact: true }).fill("UI follow-up")
  await page.getByRole("button", { name: "Save plan", exact: true }).click()
  expect(writes).toHaveLength(0)
  await expect(page.getByLabel("Title", { exact: true })).toBeFocused()
  await page.getByLabel("Title", { exact: true }).fill("Confirm quotation")
  await page.getByRole("button", { name: "Add step (up to 12)", exact: true }).click()
  await page.getByRole("region", { name: "Step 2", exact: true }).getByLabel("Title", { exact: true }).fill("Discuss decision")
  await page.getByRole("button", { name: "Save plan", exact: true }).click()
  await expect.poll(() => writes.length).toBe(1)
  expect(writes[0].body).toMatchObject({ name: "UI follow-up", steps: [{ title: "Confirm quotation", dayOffset: 0 }, { title: "Discuss decision", dayOffset: 1 }] })
})

test("activity dropdowns support keyboard selection and completion stays separate from saving", async ({ page }) => {
  const writes = await fixture(page)
  await page.goto("/crm/activities/ui-work")
  await page.getByLabel("Priority", { exact: true }).focus()
  await page.keyboard.press("Enter")
  await page.getByRole("menuitemradio", { name: "High", exact: true }).click()
  await page.getByRole("button", { name: "Save activity", exact: true }).click()
  await expect.poll(() => writes.length).toBe(1)
  expect(writes[0]).toMatchObject({ path: "/api/crm/work/ui-work", body: { priority: 3, version: 4 } })
  const completion = page.getByRole("region", { name: "Record outcome and next step" })
  await completion.getByLabel("Outcome", { exact: true }).click()
  await page.getByRole("menuitemradio", { name: "CONNECTED", exact: true }).click()
  await completion.getByLabel("Customer interaction summary", { exact: true }).fill("Reviewed the quotation.")
  await completion.getByRole("button", { name: "Complete activity", exact: true }).click()
  await expect.poll(() => writes.length).toBe(2)
  expect(writes[1]).toMatchObject({ path: "/api/crm/work/ui-work/complete", body: { outcome: "CONNECTED", summary: "Reviewed the quotation.", version: 4 } })
  await expect(page.getByRole("button", { name: "Save activity", exact: true })).toHaveCount(0)
})

test("required outcome dropdown preserves native validation when logging a past interaction", async ({ page }) => {
  await fixture(page)
  await page.goto("/crm/activities/new?log=true")
  await expect(page.getByLabel("Outcome", { exact: true })).toBeVisible()
  // Validate just the required dropdown: the customer selector is independently required for saving.
  const valid = await page.locator('#completion-outcome').evaluate(element => element.closest('span')!.querySelector('select')!.reportValidity())
  expect(valid).toBe(false)
  await expect(page.getByLabel("Outcome", { exact: true })).toBeFocused()
  await expect(page.getByText("Choose an option.", { exact: true })).toBeVisible()
  await page.getByLabel("Outcome", { exact: true }).click()
  await page.getByRole("menuitemradio", { name: "CONNECTED", exact: true }).click()
  await expect(page.getByText("Choose an option.", { exact: true })).toHaveCount(0)
})
