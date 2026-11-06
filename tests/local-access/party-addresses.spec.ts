import { test, expect } from "@playwright/test"
import { seed, login, json } from "./fixtures"
import { emptyCorrespondence } from "../../platform/participants/information"
import { emptyQuotationContent } from "../../modules/sales-documents/quotation-validation"

test("named contact/business addresses, purpose selection, project overrides and frozen documents", async ({ browser }) => {
  test.setTimeout(300_000)
  const f = await seed(), { context, page } = await login(browser, f.origin, f.users.admin.email)
  try {
    const contact = await json(context, "/api/crm/contacts", 201, "POST", { name: "QA Address Buyer", addressLine1: "Profile address", city: "Panaji", country: "India" })
    const endpoint = `/api/crm/contacts/${contact.id}/addresses`
    await page.goto(`/crm/contacts/${contact.id}`)
    await expect(page.getByRole("tab", { name: "Addresses", exact: true }).locator("svg")).toHaveCount(0)
    await page.getByRole("tab", { name: "Addresses", exact: true }).click()
    await page.getByRole("button", { name: "Add address", exact: true }).click()
    const editor = page.getByRole("dialog", { name: "Add address", exact: true })
    await editor.getByLabel("Address name", { exact: true }).fill("Home")
    await editor.getByLabel("Billing", { exact: true }).check()
    await editor.getByLabel("Delivery / site", { exact: true }).check()
    await editor.getByLabel("Default Correspondence", { exact: true }).check()
    await editor.getByLabel("Default Billing", { exact: true }).check()
    await editor.getByLabel("Address line 1", { exact: true }).fill("Home road")
    await editor.getByLabel("City", { exact: true }).fill("Pune")
    await editor.getByLabel("Country", { exact: true }).click()
    await page.getByRole("option", { name: "India", exact: true }).click()
    await editor.getByRole("button", { name: "Save address", exact: true }).click()
    await expect(editor).toHaveCount(0)
    await expect(page.getByText("Home road, Pune, India", { exact: true })).toBeVisible()
    const address = (await json(context, endpoint)).items[0]
    const site = await json(context, endpoint, 201, "POST", { name: "Site office", purposes: ["BILLING", "DELIVERY"], values: { ...emptyCorrespondence, addressLine1: "Site road", city: "Mumbai", country: "India" } })
    const pipeline = await json(context, "/api/crm/pipelines", 201, "POST", { name: "Address test", stages: [{ name: "Open", kind: "OPEN", probability: 10, color: "#123456" }, { name: "Won", kind: "WON", probability: 100, color: "#00aa00" }, { name: "Lost", kind: "LOST", probability: 0, color: "#aa0000" }] })
    const deal = await json(context, "/api/crm/opportunities", 201, "POST", { title: "Address-specific transaction", contactId: contact.id, assignedUserId: f.users.admin.id, pipelineId: pipeline.id, stageId: pipeline.stages[0].id, amount: "100", currency: "INR", expectedCloseOn: "2027-01-01" })
    await page.goto(`/crm/opportunities/${deal.id}`)
    await page.getByRole("tab", { name: "Customer details", exact: true }).click()
    await expect(page.getByRole("tabpanel", { name: "Correspondence", exact: true }).getByText("Home road", { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Edit customer details", exact: true }).click()
    const cif = page.getByRole("dialog", { name: "Edit customer details", exact: true })
    await cif.getByRole("tab", { name: "Billing", exact: true }).click()
    await expect(cif.getByLabel("City (billing) for QA Address Buyer", { exact: true })).toHaveValue("Pune")
    await cif.getByRole("button", { name: "Choose saved address", exact: true }).click()
    const picker = page.getByRole("dialog", { name: "Choose billing address", exact: true })
    await picker.getByLabel("Find saved address", { exact: true }).fill("Site")
    await picker.getByRole("button", { name: "Use Site office", exact: true }).click()
    await expect(picker).toHaveCount(0)
    await expect(cif.getByLabel("City (billing) for QA Address Buyer", { exact: true })).toHaveValue("Mumbai")
    await cif.getByLabel("City (billing) for QA Address Buyer", { exact: true }).fill("Billing override town")
    await cif.getByRole("tab", { name: "Delivery / site", exact: true }).click()
    // Closing a picker while its detail fetch is in flight must not change the draft.
    let ready!: () => void, release!: () => void, done!: () => void
    const requested = new Promise<void>(resolve => { ready = resolve }), held = new Promise<void>(resolve => { release = resolve }), fulfilled = new Promise<void>(resolve => { done = resolve })
    const detailUrl = `${f.origin}${endpoint}/${site.id}`
    await page.route(detailUrl, async route => { const response = await route.fetch(); ready(); await held; await route.fulfill({ response }); done() })
    await cif.getByRole("button", { name: "Choose saved address", exact: true }).click()
    const deliveryPicker = page.getByRole("dialog", { name: "Choose delivery / site address", exact: true })
    await deliveryPicker.getByRole("button", { name: "Use Site office", exact: true }).click()
    await requested
    await deliveryPicker.locator('[data-slot="sheet-footer"]').getByRole("button", { name: "Close", exact: true }).click()
    release(); await fulfilled; await page.unroute(detailUrl)
    await expect(cif.getByLabel("City (delivery / site) for QA Address Buyer", { exact: true })).toHaveValue("")
    await cif.getByRole("button", { name: "Choose saved address", exact: true }).click()
    await page.getByRole("dialog", { name: "Choose delivery / site address", exact: true }).getByRole("button", { name: "Use Site office", exact: true }).click()
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(cif.getByRole("button", { name: "Save customer details", exact: true })).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: test.info().outputPath("address-selection-mobile.png"), animations: "disabled" })
    await cif.getByRole("button", { name: "Save customer details", exact: true }).click()
    await expect(cif).toHaveCount(0)
    const info = await json(context, `/api/crm/opportunities/${deal.id}/information`), row = info.participants[0]
    expect(row.addresses.billing.city).toBe("Billing override town"); expect(row.addressReferences.billing).toBeUndefined(); expect(row.addressReferences.delivery.id).toBe(site.id)
    expect((await json(context, `${endpoint}/${site.id}`)).values.city).toBe("Mumbai")
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.getByRole("tab", { name: "Delivery / site", exact: true }).click()
    await expect(page.getByRole("tabpanel", { name: "Delivery / site", exact: true }).getByText("Site road", { exact: true })).toBeVisible()
    await page.screenshot({ path: test.info().outputPath("transaction-addresses-desktop.png"), animations: "disabled" })
    // Edits to the source book cannot refresh the accepted transaction copy.
    const { id: _id, version, name, purposes, values, defaultCorrespondence, defaultBilling, defaultDelivery, archived } = address
    void _id
    await json(context, `${endpoint}/${address.id}`, 200, "PATCH", { version, name, purposes, values: { ...values, city: "Changed master city" }, defaultCorrespondence, defaultBilling, defaultDelivery, archived })
    const quote = await json(context, `/api/crm/opportunities/${deal.id}/quotations`, 201, "POST", { content: { ...structuredClone(emptyQuotationContent), title: "Address snapshot", supplierName: "QA Company", currency: "INR", lines: [{ description: "Service", quantity: "1", unit: "hour", rate: "100" }] } })
    const snapshot = (await json(context, `/api/crm/quotations/${quote.id}`)).snapshot
    expect(snapshot.participants.participants[0].information.city).toBe("Pune")
    expect(snapshot.participants.participants[0].addresses.billing.city).toBe("Billing override town")
    const account = await json(context, "/api/crm/accounts", 201, "POST", { name: "QA Business Address" })
    await json(context, `/api/crm/accounts/${account.id}/addresses`, 201, "POST", { name: "Registered office", purposes: ["BILLING"], values: { ...emptyCorrespondence, addressLine1: "Company office", country: "India" }, defaultBilling: true })
    await page.goto(`/crm/accounts/${account.id}`); await page.getByRole("tab", { name: "Addresses", exact: true }).click()
    await expect(page.getByText("Company office, India", { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "View address", exact: true }).click()
    const accountEditor = page.getByRole("dialog", { name: "Edit address", exact: true })
    await accountEditor.getByLabel("Archived", { exact: true }).check()
    await accountEditor.getByRole("button", { name: "Save address", exact: true }).click()
    await expect(accountEditor).toHaveCount(0)
    await expect(page.getByText("No saved addresses in this view.", { exact: true })).toBeVisible()
    await page.screenshot({ path: test.info().outputPath("business-addresses-desktop.png"), animations: "disabled" })
  } finally { await context.close(); await f.db.end() }
})
