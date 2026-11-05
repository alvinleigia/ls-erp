import { defineConfig } from "@playwright/test"
import config from "./playwright.project-ui.config"

export default defineConfig({
  ...config,
  testMatch: ["document-templates.spec.ts", "company-document-settings.spec.ts"],
  outputDir: "test-results/document-templates",
  webServer: { ...config.webServer, command: "node scripts/project-ui-preview.cjs", url: "http://127.0.0.1:3012/settings/documents" },
})
