import { test, expect, type Page } from "@playwright/test"

// All writes are intercepted. These scenarios can run against a saved CRM session
// without creating or editing hosted customer records.
async function fixture(page: Page, { restricted = false, canManage = true } = {}) {
  const writes: { path: string; body: Record<string, unknown> }[] = []
  const queries: URLSearchParams[] = []
  const contact = { id: "intake-contact", name: "Intake Buyer", email: "buyer@example.test", phone: "+919876543210", version: 1, archived: false, canEdit: true }
  const account = { id: "intake-account", name: "Example Company" }
  let source = { id: "intake-source", name: "Website", archived: false, version: 3 }
  let enquiry = { id: "intake-enquiry", title: "Office requirement", source: "Website", sourceId: source.id, leadSource: source, contactId: contact.id, contact, accountId: account.id, account, targetCloseOn: "2026-12-06", requirements: "Near transport", assignedUserId: "intake-admin", assignee: { id: "intake-admin", name: "Admin" }, status: "NEW", outcome: "", version: 4, referralContactId: null, referralAccountId: null, referralRestricted: restricted, canAssign: canManage, opportunity: null, createdAt: "2026-09-28T09:00:00Z", updatedAt: "2026-09-28T09:00:00Z" }
  const pipeline = { id: "intake-pipeline", name: "Sales", archived: false, version: 1, stages: [{ id: "intake-stage", name: "Qualified", kind: "OPEN", probability: 20, archived: false }] }
  await page.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname
    const list = (items: unknown[], total = items.length) => ({ items, total, page: Number(url.searchParams.get("page") || 1), pageSize: Number(url.searchParams.get("pageSize") || 20), totalPages: Math.max(1, Math.ceil(total / Number(url.searchParams.get("pageSize") || 20))) })
    if (request.method() !== "GET") {
      const body = request.postDataJSON()
      writes.push({ path, body })
      if (path === "/api/crm/enquiries" && body.newContact) return route.fulfill({ status: 409, json: { error: "A contact with this email or phone already exists in this business. Ask your manager if you cannot find it." } })
      if (path.startsWith("/api/crm/enquiries")) { enquiry = { ...enquiry, ...body, version: enquiry.version + 1 }; return route.fulfill({ json: enquiry }) }
      if (path.startsWith("/api/crm/lead-sources")) { source = { ...source, ...body, version: source.version + 1 }; return route.fulfill({ json: source }) }
      return route.abort()
    }
    if (path === "/api/crm/assignees") return route.fulfill({ json: { ...list([{ id: "intake-admin", name: "Admin" }]), currentUserId: "intake-admin", canAssign: canManage } })
    if (path === "/api/crm/lead-sources") return route.fulfill({ json: { ...list([source]), canManage } })
    if (path === "/api/crm/contacts") return route.fulfill({ json: list([contact]) })
    if (path === `/api/crm/contacts/${contact.id}`) return route.fulfill({ json: contact })
    if (path === `/api/crm/contacts/${contact.id}/accounts` || path === "/api/crm/accounts") return route.fulfill({ json: list([account]) })
    if (path === "/api/crm/enquiries") { queries.push(url.searchParams); return route.fulfill({ json: list([enquiry], 21) }) }
    if (path === `/api/crm/enquiries/${enquiry.id}`) return route.fulfill({ json: enquiry })
    if (path === "/api/crm/pipelines") return route.fulfill({ json: list([pipeline]) })
    if (path === `/api/crm/pipelines/${pipeline.id}`) return route.fulfill({ json: pipeline })
    if (path === "/api/settings/display") return route.fulfill({ json: { settings: { timeZone: "Asia/Kolkata", dateFormat: "MM/dd/yyyy", currency: "INR" } } })
    if (path.startsWith("/api/crm/")) return route.fulfill({ json: { ...list([]), canManage, timeZone: "Asia/Kolkata" } })
    return route.continue()
  })
  return { writes, queries }
}

test("inline contact conflict preserves the enquiry draft and permits reusing the contact", async ({ page }, info) => {
  const { writes } = await fixture(page)
  await page.goto("/crm/enquiries/new")
  await page.getByLabel("Contact selection", { exact: true }).click()
  await page.getByRole("menuitemradio", { name: "New contact", exact: true }).click()
  await page.getByLabel("Full name", { exact: true }).fill("Intake Buyer")
  await page.getByLabel("Email", { exact: true }).fill("buyer@example.test")
  await page.getByLabel("Phone", { exact: true }).fill("+919876543210")
  await page.getByRole("button", { name: "Same as phone" }).click()
  await expect(page.getByLabel("WhatsApp number (optional)", { exact: true })).toHaveValue("+919876543210")
  await page.getByLabel("Enquiry title", { exact: true }).fill("Saved draft title")
  await page.getByLabel("Target close date (optional)", { exact: true }).fill("2026-12-06")
  await page.getByRole("button", { name: "Save enquiry", exact: true }).click()
  await expect(page.getByRole("alert").filter({ hasText: "already exists" })).toBeVisible()
  await expect(page.getByLabel("Enquiry title", { exact: true })).toHaveValue("Saved draft title")
  expect(writes[0].body).toMatchObject({ newContact: { name: "Intake Buyer", whatsappPhone: "+919876543210" }, targetCloseOn: "2026-12-06" })
  expect(writes[0].body).not.toHaveProperty("contactId")
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: info.outputPath("intake-mobile-conflict.png"), fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  await page.getByLabel("Contact selection", { exact: true }).click()
  await page.getByRole("menuitemradio", { name: "Existing contact", exact: true }).click()
  await page.getByRole("combobox", { name: "Contact", exact: true }).click()
  await page.getByRole("option", { name: "Intake Buyer", exact: true }).click()
  await page.getByRole("button", { name: "Save enquiry", exact: true }).click()
  await expect.poll(() => writes.length).toBe(2)
  expect(writes[1].body).toMatchObject({ contactId: "intake-contact", title: "Saved draft title" })
  expect(writes[1].body).not.toHaveProperty("newContact")
  await expect(page).toHaveURL(/\/crm\/enquiries\/intake-enquiry$/)
})

test("enquiry edits preserve restricted referral context and send versioned intake fields", async ({ page }, info) => {
  const { writes } = await fixture(page, { restricted: true })
  await page.goto("/crm/enquiries/intake-enquiry")
  await expect(page.getByText("Referral details are restricted.", { exact: false })).toBeVisible()
  await expect(page.getByLabel("Target close date (optional)", { exact: true })).toHaveValue("2026-12-06")
  await page.getByLabel("Enquiry title", { exact: true }).fill("Updated requirement")
  await page.screenshot({ path: info.outputPath("intake-desktop.png"), fullPage: true })
  await page.getByRole("button", { name: "Save enquiry", exact: true }).click()
  await expect.poll(() => writes.length).toBe(1)
  expect(writes[0].body).toMatchObject({ version: 4, sourceId: "intake-source", accountId: "intake-account", targetCloseOn: "2026-12-06" })
  expect(writes[0].body).not.toHaveProperty("referralContactId")
  expect(writes[0].body).not.toHaveProperty("referralAccountId")
})

test("source editor saves names, archives with a version and keeps common pagination", async ({ page }) => {
  const { writes } = await fixture(page)
  await page.goto("/crm/lead-sources")
  await page.getByRole("button", { name: "Edit Website", exact: true }).click()
  await page.getByLabel("Source name", { exact: true }).fill("Web enquiry")
  await page.getByLabel("Status", { exact: true }).click()
  await page.getByRole("menuitemradio", { name: "Archived", exact: true }).click()
  await page.getByRole("button", { name: "Save source", exact: true }).click()
  await expect.poll(() => writes.length).toBe(1)
  expect(writes[0].body).toEqual({ name: "Web enquiry", archived: true, version: 3 })
  await expect(page.getByRole("navigation", { name: "Pagination", exact: true })).toBeVisible()
})

test("staff can browse sources without configuration controls", async ({ page }) => {
  await fixture(page, { canManage: false })
  await page.goto("/crm/lead-sources")
  await expect(page.getByRole("cell", { name: "Website", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "New source", exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Edit Website", exact: true })).toHaveCount(0)
})

test("enquiry filters preserve query context across pagination and reset to page one", async ({ page }) => {
  const { queries } = await fixture(page)
  await page.goto("/crm/enquiries")
  await page.getByPlaceholder("Search title, customer, phone or company…").fill("Example Company")
  await page.getByRole("button", { name: "Filters", exact: true }).click()
  await page.getByRole("combobox", { name: "Lead source", exact: true }).click()
  await page.getByRole("option", { name: "Website", exact: true }).click()
  await expect.poll(() => queries.at(-1)?.get("sourceId")).toBe("intake-source")
  await page.getByRole("button", { name: /^Filters/ }).click()
  await expect(page.getByLabel("Enquiry filters", { exact: true })).toBeHidden()
  await page.getByRole("button", { name: "Next page", exact: true }).click()
  await expect.poll(() => queries.at(-1)?.get("page")).toBe("2")
  expect(queries.at(-1)?.get("q")).toBe("Example Company")
  expect(queries.at(-1)?.get("sourceId")).toBe("intake-source")
  await page.getByRole("button", { name: "Filters", exact: false }).click()
  await page.getByRole("button", { name: "Reset filters", exact: true }).click()
  await expect.poll(() => queries.at(-1)?.get("page")).toBe("1")
  expect(queries.at(-1)?.get("sourceId")).toBeNull()
})

test("conversion prefills company and target-close date from the enquiry", async ({ page }) => {
  await fixture(page)
  await page.goto("/crm/opportunities/new?enquiryId=intake-enquiry")
  await expect(page.getByLabel("Expected close date", { exact: true })).toHaveValue("2026-12-06")
  await expect(page.getByRole("combobox", { name: "Business account (optional)", exact: true })).toContainText("Example Company")
  await expect(page.getByLabel("Opportunity title", { exact: true })).toHaveValue("Office requirement")
})
