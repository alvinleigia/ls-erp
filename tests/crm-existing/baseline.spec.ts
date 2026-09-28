import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { test, expect } from "@playwright/test"
import { get, listAll, period, records, verifyLogin } from "./fixture"

test.beforeEach(async ({ request, page }, info) => {
  await verifyLogin(request, info.project.metadata.role)
  await page.route("**/api/crm/**", route => ["GET", "HEAD"].includes(route.request().method()) ? route.continue() : route.abort())
})

test("existing lead conversion and role boundaries remain intact", async ({ request }, info) => {
  if (info.project.metadata.role === "STAFF") {
    for (const path of [
      `/api/crm/contacts/${records.privateContact}`, `/api/crm/contacts/${records.contact}`,
      `/api/crm/enquiries/${records.enquiry}`, `/api/crm/opportunities/${records.openDeal}`,
      `/api/crm/work/${records.privateWork}`,
    ]) {
      const response = await request.get(path)
      expect(response.status(), path).toBe(404)
      expect(Object.keys(await response.json())).toEqual(["error"])
    }
    expect((await request.get(`/api/crm/reports/activities?scope=team&${period}`)).status()).toBe(403)
    const work = await get(request, `/api/crm/work/${records.staffWork}`)
    expect(work).toMatchObject({ title: "Staff handoff test", status: "COMPLETED", outcome: "CONNECTED" })
    return
  }
  const lead = await get(request, `/api/crm/enquiries/${records.enquiry}`)
  const deal = await get(request, `/api/crm/opportunities/${records.converted}`)
  expect(lead).toMatchObject({ title: "Quotation request", contactId: records.contact, opportunity: { id: records.converted } })
  expect(deal).toMatchObject({ enquiryId: lead.id, contactId: lead.contactId, stage: { kind: "WON" }, amount: "10000", currency: "INR" })
  expect((await get(request, `/api/crm/opportunities/${records.openDeal}`)).stage.kind).toBe("OPEN")
  expect((await get(request, `/api/crm/opportunities/${records.lostDeal}`)).stage.kind).toBe("LOST")
  const matches = (await listAll(request, "/api/crm/opportunities")).filter(row => row.enquiryId === lead.id)
  expect(matches.map(row => row.id)).toEqual([records.converted])
})

test("activity totals reconcile with the existing paginated work for each role", async ({ request }, info) => {
  const scopes = info.project.metadata.role === "ADMIN" ? ["mine", "team"] : ["mine"]
  for (const scope of scopes) {
    const report = await get(request, `/api/crm/reports/activities?scope=${scope}&${period}`)
    const workScope = scope === "team" ? "visible" : "mine"
    const completed = await listAll(request, `/api/crm/work?scope=${workScope}&state=completed&completedFrom=2026-09-01&completedThrough=2026-09-28`)
    const open = await listAll(request, `/api/crm/work?scope=${workScope}&state=open`)
    expect(report.timeZone).toBe("Asia/Kolkata")
    expect(report.totals.completed).toBe(completed.length)
    expect(report.totals.open).toBe(open.length)
    for (const row of report.byType) {
      expect(row.completed).toBe(completed.filter(item => item.type === row.type).length)
      expect(row.open).toBe(open.filter(item => item.type === row.type).length)
    }
    for (const row of report.callOutcomes) expect(row.count).toBe(completed.filter(item => item.type === "CALL" && item.outcome === row.outcome).length)
  }
})

test("existing records provide a before/after upgrade baseline", async ({ request }, info) => {
  test.skip(info.project.metadata.role !== "ADMIN", "Admin captures the existing business test records once.")
  const snapshot: Record<string, unknown> = {}
  const paths = [
    ...[records.contact, records.privateContact].map(id => `/api/crm/contacts/${id}`),
    `/api/crm/enquiries/${records.enquiry}`,
    ...[records.converted, records.openDeal, records.lostDeal].map(id => `/api/crm/opportunities/${id}`),
  ]
  const scalar = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).filter(([, value]) => value === null || ["string", "number", "boolean"].includes(typeof value)))
  for (const path of paths) snapshot[path] = scalar(await get(request, path))
  for (const row of await listAll(request, "/api/crm/work?scope=visible&state=all")) snapshot[`/api/crm/work/${row.id}`] = scalar(row)
  await info.attach("existing-records-baseline", { body: JSON.stringify(snapshot, null, 2), contentType: "application/json" })
  if (process.env.CRM_EXISTING_BASELINE) {
    const baseline = JSON.parse(readFileSync(process.env.CRM_EXISTING_BASELINE, "utf8"))
    expect(Object.keys(baseline).length).toBeGreaterThanOrEqual(paths.length)
    // Additive fields are permitted; existing values, links and versions must survive.
    expect(snapshot).toMatchObject(baseline)
  }
  if (process.env.CRM_CAPTURE_BASELINE === "1") {
    mkdirSync("test-results", { recursive: true })
    writeFileSync("test-results/crm-existing-baseline.json", JSON.stringify(snapshot, null, 2), { flag: "wx" })
  }
  const tasks = Object.values(snapshot) as Record<string, unknown>[]
  const lastRetry = tasks.find(row => row.automationDepth === 3)
  expect(lastRetry).toMatchObject({ status: "COMPLETED", outcome: "NO_ANSWER" })
  expect(tasks.filter(row => row.followUpOfId === lastRetry?.id)).toHaveLength(0)
})

for (const theme of ["light", "dark"]) for (const mobile of [false, true]) {
  test(`existing record detail and timeline render ${mobile ? "mobile" : "desktop"} ${theme}`, async ({ page }, info) => {
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 })
    await page.addInitScript(selected => localStorage.setItem("theme", selected), theme)
    const failures: string[] = []
    page.on("pageerror", error => failures.push(error.message))
    page.on("response", response => {
      if (new URL(response.url()).pathname.startsWith("/api/") && response.status() >= 400) failures.push(`${new URL(response.url()).pathname}: ${response.status()}`)
    })
    const staff = info.project.metadata.role === "STAFF"
    const path = staff ? `/crm/activities/${records.staffWork}` : `/crm/contacts/${records.contact}`
    await page.goto(path)
    await expect(page.getByRole("heading", { name: staff ? "Staff handoff test" : "Alex Taylor", exact: true })).toBeVisible()
    await expect(page.getByRole("heading", { name: "Previous customer interactions", exact: true })).toBeVisible()
    if (staff) {
      await expect(page.getByLabel("Activity title", { exact: true })).toHaveValue("Staff handoff test")
      await expect(page.getByRole("heading", { name: "Activity history and internal notes", exact: true })).toBeVisible()
      // A completed standalone task preserves access to that task, not to all
      // subsequent customer conversations. contactScope requires active work.
      await expect(page.getByRole("status").filter({ hasText: "Customer interaction history is not available with your current access." })).toBeVisible()
    } else await expect(page.getByLabel("Full name", { exact: true })).toHaveValue("Alex Taylor")
    await page.waitForLoadState("networkidle")
    expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(theme === "dark")
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0)
    expect(failures).toEqual(staff ? [`/api/crm/contacts/${records.contact}/interactions: 404`] : [])
    if (!staff && !mobile && theme === "light") {
      const pagination = page.getByRole("navigation", { name: "Customer interaction pages", exact: true })
      await pagination.getByRole("button", { name: "Next page", exact: true }).click()
      await expect(pagination).toContainText("Page 2 of 2")
      await expect(page.getByText("Discussed requirements. Alex requested a quotation.", { exact: true })).toBeVisible()
      await pagination.getByRole("button", { name: "Previous page", exact: true }).click()
      await expect(pagination).toContainText("Page 1 of 2")
      await expect(page.getByText("Retry 3 unanswered.", { exact: true })).toBeVisible()
    }
    await page.screenshot({ path: info.outputPath(`${mobile ? "mobile" : "desktop"}-${theme}.png`), fullPage: true })
  })
}
