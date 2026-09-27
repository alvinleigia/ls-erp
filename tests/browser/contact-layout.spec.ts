import { test, expect, type Page } from "@playwright/test"

// All contact data and writes are intercepted. These tests never modify hosted records.
async function contactFixture(page: Page, { populated = false, canEdit = true } = {}) {
  let contact = { id: "ui-contact", name: "Alex Taylor", email: "alex.taylor@example.com", phone: "+919876543210", archived: false, canEdit, version: 7 }
  const account = { id: "ui-account", name: "Taylor Enterprises", archived: false }
  let linked = populated
  const writes: { method: string; path: string; body: Record<string, unknown> | null }[] = []
  const queries: URLSearchParams[] = []
  await page.route("**/api/**", async route => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    if (request.method() !== "GET") {
      // Catch every write, even an unexpected one, so nothing can reach the server.
      const body = request.postData() ? request.postDataJSON() : null
      writes.push({ method: request.method(), path, body })
      if (path === "/api/crm/contacts/ui-contact" && request.method() === "PATCH") {
        contact = { ...contact, ...body, version: contact.version + 1 }
        return route.fulfill({ json: contact })
      }
      if (path.startsWith("/api/crm/contacts/ui-contact/accounts")) {
        linked = request.method() === "POST"
        return route.fulfill({ json: { success: true } })
      }
      return route.abort()
    }
    const list = (items: unknown[], total = items.length) => ({ items, total, page: Number(url.searchParams.get("page") || 1), pageSize: Number(url.searchParams.get("pageSize") || 20), totalPages: Math.max(1, Math.ceil(total / Number(url.searchParams.get("pageSize") || 20))) })
    if (path === "/api/crm/contacts/ui-contact") return route.fulfill({ json: contact })
    if (path === "/api/crm/contacts/ui-contact/accounts") return route.fulfill({ json: list(linked ? [account] : []) })
    if (path === "/api/crm/accounts") return route.fulfill({ json: list([account]) })
    if (path === "/api/crm/assignees") return route.fulfill({ json: list([{ id: "ui-staff", name: "CRM Test Staff" }]) })
    if (path === "/api/settings/display") return route.fulfill({ json: { settings: { dateFormat: "MM/dd/yyyy", timeZone: "Asia/Kolkata" } } })
    if (path === "/api/crm/contacts/ui-contact/interactions") return route.fulfill({ json: list(populated ? [{ id: "ui-interaction", type: "CALL", outcome: "CONNECTED", summary: "Alex confirmed receipt of the quotation.", occurredAt: "2026-09-27T10:00:00Z", callDirection: "OUTBOUND", durationMinutes: 5, completedBy: { name: "CRM Test Staff" } }] : []) })
    if (path === "/api/crm/work") {
      queries.push(url.searchParams)
      const items = populated ? [{ id: "ui-work", title: "Discuss Taylor business proposal", type: "CALL", priority: 2, status: "OPEN", dueOn: "2026-09-30T00:00:00Z", startsAt: null, assignee: { name: "CRM Test Admin" }, contact, planLaunch: null }] : []
      return route.fulfill({ json: { ...list(items, populated ? 21 : 0), canManage: canEdit, timeZone: "Asia/Kolkata" } })
    }
    return route.continue()
  })
  await page.goto("/crm/contacts/ui-contact")
  await expect(page.getByRole("heading", { name: "Alex Taylor", exact: true })).toBeVisible()
  await expect.poll(() => queries.length).toBeGreaterThan(0)
  return { writes, queries }
}

test("contact filters keep context, support nested dropdowns, and paginate", async ({ page }, info) => {
  const { queries, writes } = await contactFixture(page, { populated: true })
  const activities = page.getByRole("region", { name: "Activities and follow-ups" })
  await expect(activities.getByRole("link", { name: "Discuss Taylor business proposal" }).filter({ visible: true })).toBeVisible()
  await page.screenshot({ path: info.outputPath("contact-desktop.png"), fullPage: true })
  await activities.getByRole("button", { name: "Activity status", exact: true }).click()
  await page.getByRole("menuitemradio", { name: "Completed", exact: true }).click()
  await expect.poll(() => queries.at(-1)?.get("state")).toBe("completed")
  await activities.getByRole("button", { name: "Filters", exact: true }).click()
  await page.getByRole("button", { name: "Activity due filter", exact: true }).click()
  await page.getByRole("menuitemradio", { name: "Overdue", exact: true }).click()
  await expect.poll(() => queries.at(-1)?.get("due")).toBe("overdue")
  expect(queries.at(-1)?.get("state")).toBe("open")
  await page.getByRole("button", { name: "Activity type", exact: true }).click()
  await page.getByRole("menuitemradio", { name: "Call", exact: true }).click()
  await page.getByRole("button", { name: "Activity sorting", exact: true }).click()
  await page.getByRole("menuitemradio", { name: "Highest priority", exact: true }).click()
  await page.getByRole("combobox", { name: "Assigned staff" }).click()
  await page.getByRole("option", { name: "CRM Test Staff", exact: true }).click()
  await expect.poll(() => queries.at(-1)?.get("assignedUserId")).toBe("ui-staff")
  await page.screenshot({ path: info.outputPath("contact-filters.png"), fullPage: true })
  await page.getByRole("button", { name: "Reset filters", exact: true }).click()
  await expect.poll(() => queries.at(-1)?.has("assignedUserId")).toBe(false)
  expect(queries.at(-1)?.has("due")).toBe(false)
  await page.keyboard.press("Escape")
  await activities.getByRole("button", { name: "Next page", exact: true }).click()
  await expect.poll(() => queries.at(-1)?.get("page")).toBe("2")
  await activities.getByRole("textbox", { name: "Search activity titles" }).fill("quotation")
  await expect.poll(() => queries.at(-1)?.get("q")).toBe("quotation")
  expect(queries.at(-1)?.get("page")).toBe("1")
  expect(queries.at(-1)?.get("contactId")).toBe("ui-contact")
  await activities.getByRole("button", { name: "Rows per page" }).click()
  await page.getByRole("menuitemradio", { name: "10 / page", exact: true }).click()
  await expect.poll(() => queries.at(-1)?.get("pageSize")).toBe("10")
  await activities.getByRole("button", { name: "More actions" }).click()
  await expect(page.getByRole("menuitem", { name: "Apply plan" })).toHaveAttribute("href", "/crm/activity-plans/apply?contactId=ui-contact")
  await expect(page.getByRole("menuitem", { name: "Log interaction" })).toHaveAttribute("href", "/crm/activities/new?contactId=ui-contact&log=true")
  expect(writes).toHaveLength(0)
})

test("contact status keeps archive confirmation and versioned saves", async ({ page }) => {
  const { writes } = await contactFixture(page)
  await page.getByRole("button", { name: "Contact status" }).focus()
  await page.keyboard.press("Enter")
  await page.getByRole("menuitemradio", { name: "Archived", exact: true }).click()
  await page.getByRole("button", { name: "Save contact", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Archive this contact?" })
  await expect(dialog).toBeVisible()
  expect(writes).toHaveLength(0)
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
  expect(writes).toHaveLength(0)
  await page.getByRole("button", { name: "Save contact", exact: true }).click()
  await dialog.getByRole("button", { name: "Archive contact", exact: true }).click()
  await expect(dialog).not.toBeVisible()
  expect(writes[0].body).toMatchObject({ archived: true, version: 7, name: "Alex Taylor" })
  await expect(page.getByRole("link", { name: "Create enquiry" })).toHaveCount(0)
  await page.getByRole("button", { name: "Contact status" }).click()
  await page.getByRole("menuitemradio", { name: "Active", exact: true }).click()
  await page.getByRole("button", { name: "Save contact", exact: true }).click()
  await expect(page.getByRole("link", { name: "Create enquiry" })).toBeVisible()
  expect(writes[1].body).toMatchObject({ archived: false, version: 8 })
})

test("account linking and confirmed unlinking remain separate from contact save", async ({ page }) => {
  const { writes } = await contactFixture(page)
  const accounts = page.getByRole("region", { name: "Business accounts", exact: true })
  await accounts.getByRole("combobox", { name: "Link an account" }).click()
  await page.getByRole("option", { name: "Taylor Enterprises", exact: true }).click()
  await accounts.getByRole("button", { name: "Link account", exact: true }).click()
  await expect(accounts.getByRole("link", { name: "Taylor Enterprises" })).toBeVisible()
  await accounts.getByRole("button", { name: "Unlink", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Unlink Taylor Enterprises?" })
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
  expect(writes).toHaveLength(1)
  await accounts.getByRole("button", { name: "Unlink", exact: true }).click()
  await dialog.getByRole("button", { name: "Unlink account", exact: true }).click()
  await expect(accounts.getByText("No linked business accounts", { exact: true })).toBeVisible()
  expect(writes.map(write => write.method)).toEqual(["POST", "DELETE"])
})

for (const theme of ["light", "dark"]) {
  test(`contact layout fits mobile in ${theme} theme with useful empty states`, async ({ page }, info) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.addInitScript(theme => { localStorage.setItem("theme", theme); document.documentElement.classList.toggle("dark", theme === "dark") }, theme)
    await contactFixture(page)
    await page.evaluate(theme => document.documentElement.classList.toggle("dark", theme === "dark"), theme)
    expect(await page.locator("html").evaluate(element => element.classList.contains("dark"))).toBe(theme === "dark")
    await expect(page.getByText("No interactions logged yet", { exact: true })).toBeVisible()
    for (const previous of await page.getByRole("button", { name: "Previous page", exact: true }).all()) await expect(previous).toBeDisabled()
    await expect(page.locator("select:visible")).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`contact-mobile-${theme}.png`), fullPage: true })
    await page.getByRole("button", { name: "Filters", exact: true }).click()
    await expect(page.getByRole("dialog", { name: "Activity filters" })).toBeVisible()
    await page.getByRole("button", { name: "Activity scope" }).click()
    await page.getByRole("menuitemradio", { name: "Assigned to me" }).click()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`contact-mobile-filters-${theme}.png`), fullPage: true })
  })
}

test("populated contact uses readable activity cards on narrow screens", async ({ page }, info) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await contactFixture(page, { populated: true })
  await page.evaluate(() => document.documentElement.classList.add("dark"))
  const activities = page.getByRole("region", { name: "Activities and follow-ups" })
  await expect(activities.getByRole("article").getByRole("link", { name: "Discuss Taylor business proposal" })).toBeVisible()
  await expect(activities.getByRole("table")).not.toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath("contact-populated-mobile-dark.png"), fullPage: true })
  await page.setViewportSize({ width: 1360, height: 1000 })
  await page.screenshot({ path: info.outputPath("contact-populated-desktop-dark.png"), fullPage: true })
})

test("staff with view-only access cannot edit contact or account links", async ({ page }) => {
  await contactFixture(page, { canEdit: false })
  await expect(page.getByRole("textbox", { name: "Full name", exact: true })).toBeDisabled()
  await expect(page.getByRole("button", { name: "Contact status" })).toBeDisabled()
  await expect(page.getByRole("button", { name: "Save contact" })).toHaveCount(0)
  await expect(page.getByRole("combobox", { name: "Link an account" })).toHaveCount(0)
  await page.getByRole("button", { name: "Filters", exact: true }).click()
  await expect(page.getByRole("combobox", { name: "Assigned staff" })).toHaveCount(0)
})
