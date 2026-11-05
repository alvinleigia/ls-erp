import { defineConfig } from "@playwright/test"
import config from "./playwright.project-ui.config"
export default defineConfig({...config,testMatch:["section-tabs.spec.ts","document-templates.spec.ts","sales-order-detail.spec.ts"],outputDir:"test-results/section-tabs"})
