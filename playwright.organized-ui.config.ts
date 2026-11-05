import { defineConfig } from "@playwright/test"
import config from "./playwright.project-ui.config"
export default defineConfig({
  ...config,
  testMatch:["section-tabs.spec.ts","document-templates.spec.ts","sales-order-detail.spec.ts","sales-report-charts.spec.ts","inventory-ui.spec.ts","services-ui.spec.ts","appointments-ui.spec.ts","leaves-shifts-ui.spec.ts","dashboard-reports-ui.spec.ts","module-controls.spec.ts","core-access.spec.ts"],
  outputDir:"test-results/organized-ui",
})
