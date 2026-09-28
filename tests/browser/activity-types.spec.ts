import { test, expect, type Page } from "@playwright/test"

// Browser writes intercepted; real DB authorisation and mutation tests use the local integration suite.
async function fixture(page: Page, canManage = true) {
  const writes: { path: string; body: Record<string, unknown> }[] = [], queries: URLSearchParams[] = []
  const type = { id: "site-visit", name: "Site Visit", baseType: "MEETING", defaultInstructions: "Meet at the project reception.", archived: false, version: 1 }
  const contact = { id: "visit-contact", name: "Alex Taylor", email: "alex@example.test" }
  const person = { id: "visit-admin", name: "Administrator" }
  const list = (items: unknown[]) => ({ items, total: items.length, page: 1, pageSize: 20, totalPages: 1 })
  await page.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname
    if (request.method() !== "GET") {
      const body = request.postDataJSON(); writes.push({ path, body })
      if (path.startsWith("/api/crm/activity-types")) return route.fulfill({ json: { ...type, ...body } })
      if (path === "/api/crm/work") return route.fulfill({ json: { id: "new-visit", ...body } })
      return route.abort()
    }
    if (path === "/api/crm/activity-types") return route.fulfill({ json: { ...list(type.name.toLowerCase().includes((url.searchParams.get("q") || "").toLowerCase()) ? [type] : []), canManage } })
    if (path === "/api/crm/activity-types/site-visit") return route.fulfill({ json: type })
    if (path === "/api/crm/assignees") return route.fulfill({ json: { ...list([person]), canAssign: canManage, currentUserId: person.id } })
    if (path === "/api/crm/contacts/visit-contact") return route.fulfill({ json: contact })
    if (path === "/api/crm/work") { queries.push(url.searchParams); return route.fulfill({ json: { ...list([]), timeZone: "Asia/Kolkata", canManage, currentUserId: person.id } }) }
    if (path === "/api/settings/display") return route.fulfill({ json: { settings: { currency: "INR", timeZone: "Asia/Kolkata", dateFormat: "dd/MM/yyyy" } } })
    if (path.startsWith("/api/crm/")) return route.fulfill({ json: { ...list([]), canManage, timeZone: "Asia/Kolkata" } })
    return route.continue()
  })
  return { writes, queries }
}

test("manager configures and archives types with standard controls; staff catalog is read only", async ({ page }, info) => {
  const { writes } = await fixture(page)
  await page.goto("/crm/activity-types")
  await page.getByRole("button", { name: "New activity type", exact: true }).click()
  await page.getByLabel("Activity type name", { exact: true }).fill("Demo")
  await page.getByLabel("Default instructions", { exact: true }).fill("Prepare the demo.")
  await page.getByRole("button", { name: "Save activity type", exact: true }).click()
  await expect.poll(() => writes.length).toBe(1)
  expect(writes[0].body).toEqual({ name: "Demo", baseType: "MEETING", defaultInstructions: "Prepare the demo." })
  await expect(page.getByRole("dialog")).toBeHidden()
  await page.getByRole("button", { name: "Edit Site Visit" }).click()
  await expect(page.getByLabel("Behaviour", { exact: true })).toBeDisabled()
  await page.getByLabel("Status", { exact: true }).click()
  await page.getByRole("menuitemradio", { name: "Archived", exact: true }).click()
  await page.getByRole("button", { name: "Save activity type", exact: true }).click()
  await expect.poll(() => writes.length).toBe(2)
  expect(writes[1].body).toMatchObject({ version: 1, archived: true })
  await expect(page.getByRole("dialog")).toBeHidden()
  await page.screenshot({ path: info.outputPath("activity-type-catalog.png"), fullPage: true })
  await fixture(page, false); await page.reload()
  await expect(page.getByRole("cell", { name: "Site Visit", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "New activity type", exact: true })).toHaveCount(0)
})

test("scheduling uses custom behaviour and defaults without overwriting instructions; mobile layout fits", async ({ page }, info) => {
  const { writes } = await fixture(page)
  await page.goto("/crm/activities/new?contactId=visit-contact")
  await page.getByLabel("Activity title", { exact: true }).fill("Tour project")
  const select = page.getByRole("combobox", { name: "Activity type", exact: true })
  await select.click()
  await page.getByPlaceholder("Type to search...").fill("Site")
  await page.getByRole("option", { name: "Site Visit", exact: true }).click()
  await expect(page.getByLabel("Staff instructions / preparation", { exact: true })).toHaveValue("Meet at the project reception.")
  await expect(page.getByLabel("Call direction", { exact: true })).toHaveCount(0)
  await page.getByLabel("Staff instructions / preparation", { exact: true }).fill("Bring floor plans.")
  await select.click(); await page.getByRole("option", { name: "Call", exact: true }).click()
  await expect(page.getByLabel("Call direction", { exact: true })).toBeVisible()
  await select.click(); await page.getByRole("option", { name: "Site Visit", exact: true }).click()
  await expect(page.getByLabel("Staff instructions / preparation", { exact: true })).toHaveValue("Bring floor plans.")
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole("option", { name: "Site Visit", exact: true })).toBeHidden()
  await page.screenshot({ path: info.outputPath("site-visit-mobile.png"), fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  await page.getByRole("button", { name: "Save activity", exact: true }).click()
  await expect.poll(() => writes.length).toBe(1)
  expect(writes[0].body).toMatchObject({ type: "MEETING", activityTypeId: "site-visit", description: "Bring floor plans.", callDirection: null })
  expect(writes[0].body).not.toHaveProperty("activityTypeName")
})

test("activity filtering and report links retain the specific custom type", async ({ page }) => {
  const { queries } = await fixture(page)
  await page.goto("/crm/activities?activityTypeId=site-visit&state=completed")
  await expect.poll(() => queries.at(-1)?.get("activityTypeId")).toBe("site-visit")
  await page.getByRole("button", { name: /^Filters/ }).click()
  const select = page.getByRole("combobox", { name: "Activity type", exact: true })
  await expect(select).toContainText("Site Visit")
  await select.click(); await page.getByRole("option", { name: "Meeting (all types with this behaviour)", exact: true }).click()
  await expect.poll(() => queries.at(-1)?.get("type")).toBe("MEETING")
  expect(queries.at(-1)?.has("activityTypeId")).toBe(false)
})
