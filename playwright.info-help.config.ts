import { defineConfig } from "@playwright/test"
import config from "./playwright.project-ui.config"

export default defineConfig({
  ...config,
  testMatch: ["info-help.spec.ts", "sales-report-charts.spec.ts"],
  outputDir: "test-results/info-help",
  webServer: { ...config.webServer, command: "node scripts/project-ui-preview.cjs", url: "http://127.0.0.1:3012/help-fixture", timeout: 120_000, reuseExistingServer: false },
})
