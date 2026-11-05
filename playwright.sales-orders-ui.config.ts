import { defineConfig } from "@playwright/test"
import config from "./playwright.project-ui.config"

export default defineConfig({
  ...config,
  testMatch: ["sales-order-detail.spec.ts"],
  outputDir: "test-results/sales-order-detail",
  webServer: { ...config.webServer, command: "node scripts/project-ui-preview.cjs", url: "http://127.0.0.1:3012/sales-orders/test" },
})
