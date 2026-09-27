import { test, expect } from "@playwright/test"

// Exercise the real form/select components with deterministic read-only choices.
// No form is submitted and no business records are created or changed.
for (const kind of ["staff", "customer"] as const) {
  test(`${kind} search separates the selected label from matching results`, async ({ page }, info) => {
    const rows = kind === "staff"
      ? [{ id: "select_admin", name: "CRM Test Admin" }, { id: "select_staff", name: "CRM Test Staff" }]
      : [{ id: "select_alex", name: "Alex Taylor" }, { id: "select_beth", name: "Beth Wilson" }]
    const endpoint = kind === "staff" ? "/api/crm/assignees" : "/api/crm/contacts"
    const query = kind === "staff" ? "staff" : "beth"
    await page.route(`**${endpoint}**`, async route => {
      const url = new URL(route.request().url())
      if (url.pathname !== endpoint) {
        const contact = rows.find(row => url.pathname.endsWith(`/${row.id}`))
        if (contact) return route.fulfill({ json: contact })
        return route.continue()
      }
      const q = url.searchParams.get("q") || ""
      // A backend match may use email/phone even when the label doesn't match.
      const items = q === "email-only-match" ? [rows[1]] : rows.filter(row => row.name.toLowerCase().includes(q.toLowerCase()))
      await route.fulfill({ json: { items, total: items.length, page: 1, pageSize: 20, totalPages: 1, canAssign: true, currentUserId: rows[0].id } })
    })
    await page.goto("/crm/activities/new")
    const trigger = page.locator(kind === "staff" ? "#work-assignee" : "#work-contact")
    await expect(trigger).toBeEnabled()
    await trigger.click()
    await page.getByRole("option", { name: rows[0].name, exact: true }).click()
    await expect(trigger).toHaveText(rows[0].name)
    await trigger.click()
    const search = page.getByPlaceholder("Type to search...", { exact: true })
    await search.fill(query)
    await expect(page.getByRole("option", { name: rows[1].name, exact: true })).toBeVisible()
    await expect(page.getByRole("listbox").getByRole("option")).toHaveCount(1)
    await expect(trigger).toHaveText(rows[0].name)
    await page.screenshot({ path: info.outputPath(`${kind}-search.png`) })

    await search.fill("no-such-record")
    await expect(page.getByText("No matching records.", { exact: true })).toBeVisible()
    await expect(page.getByRole("listbox").getByRole("option")).toHaveCount(0)
    await expect(trigger).toHaveText(rows[0].name)
    await search.press("Escape")
    await trigger.click()
    await expect(search).toHaveValue("")
    await expect(page.getByRole("listbox").getByRole("option")).toHaveCount(2)

    await search.fill("email-only-match")
    await expect(page.getByRole("option", { name: rows[1].name, exact: true })).toBeVisible()
    await expect(page.getByRole("listbox").getByRole("option")).toHaveCount(1)
    await page.getByRole("option", { name: rows[1].name, exact: true }).click()
    await expect(trigger).toHaveText(rows[1].name)
    await trigger.click()
    await expect(search).toHaveValue("")
    await expect(page.getByRole("listbox").getByRole("option")).toHaveCount(2)
    await expect(trigger).toHaveText(rows[1].name)
  })
}
