import { test, expect } from "@playwright/test"

test("configuration groups existing settings and retains navigation on their pages", async ({ page }, info) => {
  await page.goto("/crm/configuration")
  await expect(page.getByRole("heading", { name: "CRM configuration", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "CRM", exact: true })).toBeVisible()
  for (const [label, path] of [["Pipelines", "pipelines"], ["Lead sources", "lead-sources"], ["Lost reasons", "lost-reasons"]]) {
    await expect(page.getByRole("link", { name: new RegExp(`^${label}`) })).toHaveAttribute("href", `/crm/${path}`)
  }
  await page.screenshot({ path: info.outputPath("configuration-desktop.png"), fullPage: true })
  await page.getByRole("link", { name: /^Lost reasons/ }).click()
  await expect(page).toHaveURL(/\/crm\/lost-reasons$/)
  await expect(page.locator('a[href="/crm/configuration"][data-active="true"]')).toBeVisible()
  await expect(page.getByRole("navigation", { name: "CRM", exact: true })).toHaveCount(0)
})

test("configuration cards and navigation fit a narrow screen", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/crm/activity-configuration")
  await expect(page.getByRole("heading", { name: "Activities and follow-ups", exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  await page.screenshot({ path: info.outputPath("configuration-mobile.png"), fullPage: true })
  for (const label of ["Activity types", "Activity plans", "Follow-up rules"]) await expect(page.getByRole("link", { name: new RegExp(`^${label}`) })).toBeVisible()
  await page.getByRole("button", { name: "Toggle Sidebar", exact: true }).first().click()
  await expect(page.getByRole("dialog").getByRole("link", { name: "Configuration", exact: true })).toBeVisible()
})
