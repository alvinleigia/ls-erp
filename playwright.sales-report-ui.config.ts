import { defineConfig } from "@playwright/test"
import config from "./playwright.project-ui.config"

export default defineConfig({
  ...config,
  testMatch: "sales-report-charts.spec.ts",
  outputDir: "test-results/sales-report-charts",
  webServer: { ...config.webServer, command: "node scripts/project-ui-preview.cjs", url: "http://127.0.0.1:3012/crm/sales", timeout: 120_000, reuseExistingServer: false },
})
