import { test, expect } from "@playwright/test"

for (const mode of ["disabled", "denied", "readonly", "editor"] as const) {
  test(`Inventory categories: ${mode} access controls`, async ({ page }) => {
    const calls: string[] = []
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname
      calls.push(path)
      if (path === "/api/modules") return route.fulfill({ json: {
        modules: [{ key: "inventory", allowed: true, enabled: mode !== "disabled" }],
        permissions: mode === "denied" ? [] : ["inventoryCategories.read", ...(mode === "editor" ? ["inventoryCategories.edit", "inventoryCategories.create"] : [])],
      } })
      expect(route.request().method()).toBe("GET")
      return route.fulfill({ json: { items: [{ id: "category", name: "Test category", description: "", status: "ACTIVE", sortOrder: 0 }], total: 1, totalPages: 1, page: 1, pageSize: 20 } })
    })
    await page.goto("/inventory/categories")
    if (mode === "disabled" || mode === "denied") {
      await expect(page.getByRole("heading", { name: mode === "disabled" ? "Module unavailable" : "Access unavailable" })).toBeVisible()
      expect(calls).not.toContain("/api/inventory/categories")
      return
    }
    await expect(page.getByRole("heading", { name: "Inventory categories" })).toBeVisible()
    if (mode === "readonly") await expect(page.getByRole("button", { name: "New category" })).toBeDisabled()
    else await expect(page.getByRole("button", { name: "New category" })).toBeEnabled()
    await page.getByRole("row").filter({ hasText: "Test category" }).getByRole("button", { name: "Record actions" }).click()
    await expect(page.getByRole("menuitem", { name: "Delete", exact: true })).toBeDisabled()
    if (mode === "readonly") await expect(page.getByRole("menuitem", { name: "Edit", exact: true })).toBeDisabled()
    else {
      await page.getByRole("menuitem", { name: "Edit", exact: true }).click()
      await expect(page.locator("#cat-status")).toBeDisabled()
      await expect(page.getByRole("button", { name: "Save changes" })).toBeEnabled()
    }
  })
}
