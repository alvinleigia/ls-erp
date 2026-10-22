import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: './tests/staging-orders', workers: 1, fullyParallel: false,
  timeout: 180_000, expect: { timeout: 20_000 },
  outputDir: 'test-results/staging-orders', reporter: 'list',
  use: { ...devices['Desktop Chrome'], channel: 'chrome', trace: 'off', screenshot: 'only-on-failure' },
})
