import { test, expect } from "@playwright/test"
import { get, period, verifyLogin } from "./fixture"

// Deliberately fail if an old deployment is being tested. Missing features are
// release blockers, never skips or successful verification of the new release.
test.beforeEach(async ({ request }) => { await verifyLogin(request, "ADMIN") })

test("release gate: managed lead sources are deployed", async ({ request }) => {
  const result = await get(request, "/api/crm/lead-sources")
  expect(Array.isArray(result.items)).toBe(true)
})

test("release gate: optional Real Estate module is deployed", async ({ request }) => {
  const { modules } = await get(request, "/api/modules")
  expect(modules.find((item: { key: string }) => item.key === "realEstate"), "Deploy the new module before project-linked sales testing.").toBeTruthy()
})

test("release gate: sales reports and scoped exports are deployed", async ({ request }) => {
  const report = await get(request, `/api/crm/reports/sales?scope=team&${period}`)
  const rows = await get(request, `/api/crm/reports/sales/records?scope=team&view=leads&${period}`)
  expect(report.totals.leads).toBe(rows.total)
  const exported = await request.get(`/api/crm/reports/sales/export?scope=team&view=leads&${period}`)
  expect(exported.status()).toBe(200)
  expect(exported.headers()["content-type"]).toContain("text/csv")
  const csv = await exported.text()
  for (const row of rows.items) expect(csv).toContain(row.id)
})
