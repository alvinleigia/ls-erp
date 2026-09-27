import { test, expect } from "@playwright/test"

test("saved browser session opens the business dashboard", async ({ page }, info) => {
  const response = await page.request.get("/api/auth/session")
  expect(response.ok()).toBeTruthy()
  const session = await response.json()
  expect(session?.user?.id, "Refresh the saved login using browser:save.").toBe(info.config.metadata.userId)
  expect(session?.user?.tenantId).toBe(info.config.metadata.tenantId)
  const navigation = await page.goto("/dashboard")
  expect(navigation?.ok()).toBeTruthy()
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toBeVisible()
  await page.screenshot({ path: info.outputPath("dashboard.png"), fullPage: true })
})
