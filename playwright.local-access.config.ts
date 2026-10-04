import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: "./tests/local-access", workers: 1, fullyParallel: false,
  timeout: 60_000, expect: { timeout: 15_000 },
  outputDir: "test-results/local-access", reporter: "list",
  // Real sign-ins use ephemeral contexts; no saved hosted authentication is read.
  use: { ...devices["Desktop Chrome"], channel: "chrome", trace: "off", screenshot: "only-on-failure" },
  webServer: {
    command: "node scripts/local-access-server.cjs", url: "http://127.0.0.1:3108/api/auth/csrf",
    timeout: 60_000, reuseExistingServer: false,
  },
})
