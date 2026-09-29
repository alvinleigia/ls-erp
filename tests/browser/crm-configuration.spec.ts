import { test, expect } from "@playwright/test"

test("configuration groups existing settings and retains navigation on their pages", async ({ page }, info) => {
  await page.goto("/crm/configuration")
  await expect(page.getByRole("heading", { name: "CRM Configuration", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "CRM", exact: true })).toBeVisible()
  for (const [label, path] of [["Pipelines", "pipelines"], ["Lead sources", "lead-sources"], ["Lost reasons", "lost-reasons"], ["Activity types", "activity-types"], ["Activity plans", "activity-plans"], ["Follow-up rules", "follow-up-rules"]]) {
    await expect(page.getByRole("link", { name: new RegExp(`^${label}`) })).toHaveAttribute("href", `/crm/${path}`)
  }
  await page.screenshot({ path: info.outputPath("configuration-desktop.png"), fullPage: true })
  await page.getByRole("link", { name: /^Lost reasons/ }).click()
  await expect(page).toHaveURL(/\/crm\/lost-reasons$/)
  await expect(page.getByRole("navigation", { name: "CRM", exact: true }).getByRole("link", { name: "Configuration", exact: true })).toHaveAttribute("aria-current", "page")
})

test("configuration cards and navigation fit a narrow screen", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/crm/configuration")
  await expect(page.getByRole("heading", { name: "Activities and follow-ups", exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  await page.screenshot({ path: info.outputPath("configuration-mobile.png"), fullPage: true })
  const nav = page.getByRole("navigation", { name: "CRM", exact: true })
  await nav.getByRole("button", { name: "Configuration", exact: true }).click()
  await expect(page.getByRole("menuitem", { name: "Configuration", exact: true })).toBeVisible()
})
