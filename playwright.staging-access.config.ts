import { defineConfig, devices } from "@playwright/test"
export default defineConfig({
  testDir: "./tests/staging-access", workers: 1, fullyParallel: false, retries: 0,
  timeout: 300_000, expect: { timeout: 30_000 }, outputDir: "test-results/staging-access",
  reporter: [["list"], ["json", { outputFile: "tmp/r9-staging/test-results.json" }]],
  use: { ...devices["Desktop Chrome"], channel: "chrome", headless: true, trace: "off", video: "off", screenshot: "only-on-failure", navigationTimeout: 60_000 },
})
