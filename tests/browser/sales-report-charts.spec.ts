import { test, expect, type Page } from "@playwright/test"
import { teamMetricKeys } from "../../modules/crm/team-performance-contract"

test.beforeEach(({ baseURL }) => { test.skip(baseURL !== "http://127.0.0.1:3012", "Only run against the isolated component host; all APIs are intercepted.") })

async function fixture(page: Page) {
  const reads: URL[] = [], writes: string[] = []
  let empty = false, denied = false
  const counts = { ...Object.fromEntries(teamMetricKeys.map(key => [key, 0])), enquiries: 100, new: 40, contacted: 30, qualified: 20, closed: 10, converted: 25, pipeline: 12, won: 6, lost: 2, gaps: 3, activitiesOpen: 15, activitiesInProgress: 5, activitiesOverdue: 4, activitiesDueToday: 6, activitiesCompleted: 50, callsCompleted: 40, connected: 20, noAnswer: 10, busy: 3, voicemail: 2, wrongNumber: 1, notInterested: 1, unknownOutcome: 3 }
  const metadata = { from: "2026-10-01", through: "2026-10-31", today: "2026-10-31", timeZone: "Asia/Kolkata", generatedAt: "2026-10-31T12:00:00Z", canManage: true, extensionColumns: [], dimensions: [{ key: "source", label: "Source", emptyLabel: "Unclassified" }] }
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url()), path = url.pathname
    if (route.request().method() !== "GET") { writes.push(path); return route.fulfill({ status: 405, json: {} }) }
    reads.push(url)
    const list = { items: [], page: 1, pageSize: 20, total: 0, totalPages: 1 }
    if (path === "/api/modules") return route.fulfill({ json: { modules: [], permissions: null } })
    if (path === "/api/settings/display") return route.fulfill({ json: { settings: { timeZone: "Asia/Kolkata", currency: "INR" } } })
    if (path.startsWith("/api/crm/reports/sales") && denied) return route.fulfill({ status: 403, json: { error: "Report permission removed." } })
    if (path === "/api/crm/reports/sales/options") return route.fulfill({ json: metadata })
    if (path === "/api/crm/reports/sales/team") {
      const zero = empty || !!url.searchParams.get("q")
      const totals = zero ? Object.fromEntries(teamMetricKeys.map(key => [key, 0])) : counts
      const currentPage = Number(url.searchParams.get("page") || 1)
      return route.fulfill({ json: { ...metadata, ...list, page: currentPage, totalPages: zero ? 1 : 2, total: zero ? 0 : 21, team: { id: "team", name: "Regional team", archived: false }, canReadRoster: true, totals: { ...totals, conversionPercent: zero ? null : 25, pipelineValues: [{ currency: "INR", amount: "9007199254740993.01" }, { currency: "USD", amount: "200.00" }] }, items: zero ? [] : [{ ...counts, id: `member-${currentPage}`, name: currentPage === 1 ? "Alex Sales" : "Blair Sales", status: "ACTIVE", userType: "internal", isMember: true, conversionPercent: 25, pipelineValues: [] }] } })
    }
    if (path === "/api/crm/reports/sales") return route.fulfill({ json: { ...metadata, totals: { leads: 100, converted: 25, pipeline: 12, won: 6, lost: 2, gaps: 3, overdue: 4 }, conversionPercent: 25 } })
    if (path === "/api/crm/reports/sales/breakdown") return route.fulfill({ json: { ...list, total: 1, items: [{ id: "source", label: "Website", leads: 100, converted: 25 }] } })
    if (path === "/api/crm/reports/sales/values") return route.fulfill({ json: { ...list, total: 2, items: [{ stageId: "stage", stage: "Proposal", pipeline: "Sales", currency: "INR", count: 8, amount: "9007199254740993.01" }, { stageId: "stage", stage: "Proposal", pipeline: "Sales", currency: "USD", count: 4, amount: "200.00" }] } })
    return route.fulfill({ json: list })
  })
  return { reads, writes, setEmpty: () => { empty = true }, deny: () => { denied = true } }
}

test("team charts reconcile totals, retain page context and remove automatic sort icons", async ({ page }) => {
  const f = await fixture(page)
  await page.goto("/crm/sales?view=team")
  const status = page.getByRole("region", { name: "Enquiry status mix", exact: true })
  await expect(status.getByRole("listitem")).toHaveText(["New 40 (40.0%)", "Contacted 30 (30.0%)", "Qualified 20 (20.0%)", "Lost enquiries 10 (10.0%)"])
  await expect(page.getByRole("region", { name: "Enquiry conversion", exact: true }).getByRole("listitem")).toHaveText(["Converted 25 (25.0%)", "Without a readable linked opportunity 75 (75.0%)"])
  await expect(page.getByRole("region", { name: "Closed opportunity outcomes" }).getByRole("listitem")).toHaveText(["Won in period 6 (75.0%)", "Lost in period 2 (25.0%)"])
  await expect(page.getByRole("region", { name: "Completed call outcomes" }).getByRole("listitem")).toHaveCount(7)
  await expect(page.getByRole("region", { name: "Open pipeline follow-up coverage" }).getByRole("listitem")).toHaveText(["With open follow-up 9 (75.0%)", "Without open follow-up 3 (25.0%)"])
  await page.getByRole("button", { name: "Performance columns", exact: true }).click()
  await page.getByRole("menuitemradio", { name: "Enquiry statuses", exact: true }).click()
  const newHeader = page.getByRole("region", { name: "Team member performance comparison", exact: true }).getByRole("columnheader", { name: /^New(?:\s|$)/ })
  await expect(newHeader.locator("svg")).toHaveCount(0)
  await newHeader.getByRole("button").click()
  await expect(newHeader).toHaveAttribute("aria-sort", "ascending")
  await expect(page.getByRole("region", { name: "Member comparison", exact: true })).toContainText("page 1 of 2")
  await page.getByRole("button", { name: "Member chart comparison", exact: true }).click()
  await page.getByRole("menuitemradio", { name: "Completed and connected calls", exact: true }).click()
  await page.getByRole("button", { name: "Next page", exact: true }).click()
  await expect(page.getByRole("region", { name: "Member comparison", exact: true })).toContainText("page 2 of 2")
  const members = page.getByRole("region", { name: "Member comparison", exact: true })
  await members.getByText("Chart figures", { exact: true }).click()
  await expect(members.getByRole("rowheader", { name: "Blair Sales" })).toBeVisible()
  await expect(status.getByRole("listitem").first()).toHaveText("New 40 (40.0%)")
  await expect(members.getByRole("columnheader", { name: "Calls completed" })).toBeVisible()
  expect(f.reads.filter(url => url.pathname === "/api/crm/reports/sales")).toHaveLength(0)
  expect(f.writes).toEqual([])
})

test("sales summary charts keep conversion, stage counts and exact currencies separate", async ({ page }) => {
  const f = await fixture(page)
  await page.goto("/crm/sales")
  await expect(page.getByRole("region", { name: "Conversion mix", exact: true }).getByRole("listitem").first()).toHaveText("Converted 25 (25.0%)")
  const group = page.getByRole("region", { name: "Conversion by group", exact: true })
  await group.getByText("Chart figures", { exact: true }).click()
  await expect(group.getByRole("rowheader", { name: "Website" })).toBeVisible()
  const stages = page.getByRole("region", { name: "Opportunity counts by stage and currency", exact: true })
  await stages.getByText("Chart figures", { exact: true }).click()
  await expect(stages.getByRole("rowheader", { name: "Sales / Proposal / INR", exact: true })).toBeVisible()
  await expect(stages.getByRole("rowheader", { name: "Sales / Proposal / USD", exact: true })).toBeVisible()
  const values = page.getByRole("region", { name: "Deal values by stage", exact: true }).getByRole("table").last()
  await expect(values.getByRole("cell", { name: "INR 9,007,199,254,740,993.01", exact: true })).toBeVisible()
  await expect(values.getByRole("cell", { name: "USD 200.00", exact: true })).toBeVisible()
  expect(f.reads.filter(url => url.pathname === "/api/crm/reports/sales/team")).toHaveLength(0)
  expect(f.writes).toEqual([])
})

test("charts clear on search, zero results and revoked permissions without NaN or stale data", async ({ page }) => {
  const f = await fixture(page)
  await page.goto("/crm/sales?view=team")
  await expect(page.getByRole("heading", { name: "Team insights" })).toBeVisible()
  await page.getByLabel("Find team member", { exact: true }).fill("No such person")
  await expect(page.getByText("No matching records for this chart.", { exact: true })).toHaveCount(7)
  await expect(page.getByRole("region", { name: "Enquiry status mix", exact: true })).not.toContainText("40.0%")
  f.setEmpty()
  await page.getByLabel("Find team member", { exact: true }).fill("")
  await expect(page.getByRole("region", { name: "Enquiry conversion", exact: true })).not.toContainText(/NaN|Infinity/)
  f.deny()
  await page.getByRole("button", { name: "Refresh", exact: true }).click()
  await expect(page.getByRole("alert").first()).toContainText("Report permission removed")
  await expect(page.getByRole("heading", { name: "Team insights" })).toHaveCount(0)
  expect(f.writes).toEqual([])
})

test("charts render legibly in dark/light themes and mobile without page overflow", async ({ page }, info) => {
  await fixture(page)
  const errors: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  await page.goto("/crm/sales?view=team")
  await expect(page.getByRole("region", { name: "Enquiry status mix", exact: true }).locator(".recharts-surface")).toBeVisible()
  await page.screenshot({ path: info.outputPath("sales-charts-desktop-dark.png"), fullPage: true, animations: "disabled" })
  await page.evaluate(() => document.documentElement.classList.remove("dark"))
  await page.screenshot({ path: info.outputPath("sales-charts-desktop-light.png"), fullPage: true, animations: "disabled" })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const chart = page.getByRole("region", { name: "Completed call outcomes", exact: true })
  await chart.scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath("sales-charts-mobile.png"), animations: "disabled" })
  expect(errors).toEqual([])
})
