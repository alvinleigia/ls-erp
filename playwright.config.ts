import { readFileSync, existsSync } from "node:fs"
import { defineConfig, devices } from "@playwright/test"

const targetPath = ".playwright-auth/target.json"
if (!existsSync(targetPath) || !existsSync(".playwright-auth/session.json")) throw new Error("Run npm run browser:open, sign in, then npm run browser:save before browser tests.")
const target = JSON.parse(readFileSync(targetPath, "utf8"))
if (!target.tenantId || !target.userId) throw new Error("Save the current login with npm run browser:save.")

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  outputDir: "test-results/browser",
  reporter: [["list"], ["html", { open: "never" }]],
  metadata: target,
  use: {
    ...devices["Desktop Chrome"],
    channel: "chrome",
    baseURL: target.baseURL,
    storageState: ".playwright-auth/session.json",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
})
