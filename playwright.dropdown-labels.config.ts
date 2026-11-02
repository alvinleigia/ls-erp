import { defineConfig } from "@playwright/test"
import config from "./playwright.project-ui.config"
export default defineConfig({ ...config, testMatch: ["dropdown-labels.spec.ts", "crm-record-detail.spec.ts", "inventory-ui.spec.ts", "leaves-shifts-ui.spec.ts"], grep: /built-in labels|selected and menu|dropdown labels|outcome labels|category records|new leave definitions/, outputDir: "test-results/dropdown-labels", webServer: { ...config.webServer, command: "node scripts/project-ui-preview.cjs", url: "http://127.0.0.1:3012/dropdown-labels-fixture" } })
