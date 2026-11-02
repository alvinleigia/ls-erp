import { defineConfig } from "@playwright/test"
import config from "./playwright.project-ui.config"
export default defineConfig({ ...config, testMatch: ["list-navigation.spec.ts", "info-help.spec.ts", "sales-report-charts.spec.ts"], outputDir: "test-results/list-navigation", webServer: { ...config.webServer, command: "node scripts/project-ui-preview.cjs", url: "http://127.0.0.1:3012/navigation-fixture" } })
