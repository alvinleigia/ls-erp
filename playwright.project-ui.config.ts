import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: "./tests/browser", testMatch: ["project-detail.spec.ts", "crm-record-detail.spec.ts"], workers: 1,
  timeout: 60_000, expect: { timeout: 15_000 },
  outputDir: "test-results/project-detail", reporter: "list",
  use: { ...devices["Desktop Chrome"], channel: "chrome", baseURL: "http://127.0.0.1:3012", screenshot: "only-on-failure", trace: "retain-on-failure" },
  webServer: { command: "node scripts/project-ui-preview.cjs", url: "http://127.0.0.1:3012/crm/projects/test", timeout: 120_000, reuseExistingServer: false },
})
