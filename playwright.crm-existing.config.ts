import { existsSync } from "node:fs"
import { defineConfig, devices } from "@playwright/test"

// Explicit, read-only regression for the existing CRM Test business. This does
// not change the selected browser target or replace its saved login.
const admin = process.env.CRM_ADMIN_STORAGE_STATE || ".playwright-auth/performance-session.json"
const staff = process.env.CRM_STAFF_STORAGE_STATE || ".playwright-auth/staff-session.json"
for (const state of [admin, staff]) {
  if (!existsSync(state)) throw new Error(`Missing private browser login: ${state}. Save the appropriate CRM Test login first.`)
}
if (process.env.CRM_CAPTURE_BASELINE === "1" && process.env.CRM_EXISTING_BASELINE) {
  throw new Error("Capture a baseline or compare one, never both in the same run.")
}

export default defineConfig({
  testDir: "./tests/crm-existing",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  outputDir: "test-results/crm-existing",
  reporter: [["list"], ["html", { outputFolder: "playwright-report/crm-existing", open: "never" }]],
  use: {
    ...devices["Desktop Chrome"], channel: "chrome",
    baseURL: "https://crm-test.salon.leigia.com",
    screenshot: "only-on-failure", trace: "retain-on-failure",
  },
  projects: [
    { name: "existing-admin", use: { storageState: admin }, metadata: { role: "ADMIN" } },
    { name: "existing-staff", testIgnore: /release\.spec\.ts/, use: { storageState: staff }, metadata: { role: "STAFF" } },
  ],
})
