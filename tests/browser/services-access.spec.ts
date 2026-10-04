import { test, expect } from "@playwright/test"

for (const entity of ["services", "categories"] as const) for (const mode of ["disabled", "denied", "readonly", "editor"] as const) {
  test(`Services ${entity}: ${mode} access`, async ({ page }) => {
    const calls: string[] = []
    const resource = entity === "services" ? "services" : "serviceCategories"
    const category = { id: "category", name: "Consultations", status: "ACTIVE", sortOrder: 0, createdAt: "2026-10-03T10:00:00Z" }
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname; calls.push(path)
      expect(route.request().method()).toBe("GET")
      if (path === "/api/modules") return route.fulfill({ json: {
        modules: [{ key: "services", allowed: true, enabled: mode !== "disabled" }],
        permissions: mode === "denied" ? [] : [`${resource}.read`, ...(mode === "editor" ? [`${resource}.edit`, `${resource}.create`, "serviceCategories.read"] : [])],
      } })
      if (path.startsWith("/api/settings")) return route.fulfill({ json: { settings: { currency: "INR", locale: "en-IN" }, items: [] } })
      const item = entity === "categories" || path === "/api/service-categories" ? category : { id: "service", name: "Consultation", category, type: "STANDARD", status: "ACTIVE", durationMinutes: 60, priceCents: 10000, taxMode: "EXCLUSIVE", taxIds: [], packageItems: [] }
      return route.fulfill({ json: { items: [item], total: 1, page: 1, pageSize: 10, totalPages: 1 } })
    })
    await page.goto(entity === "services" ? "/services" : "/services/categories")
    if (mode === "disabled" || mode === "denied") {
      await expect(page.getByRole("heading", { name: mode === "disabled" ? "Module unavailable" : "Access unavailable" })).toBeVisible()
      expect(calls).not.toContain("/api/services"); expect(calls).not.toContain("/api/service-categories")
      return
    }
    const create = page.getByRole("button", { name: entity === "services" ? "New service" : "New category", exact: true })
    if (mode === "readonly") await expect(create).toBeDisabled(); else await expect(create).toBeEnabled()
    await page.getByRole("button", { name: "Record actions", exact: true }).click()
    await expect(page.getByRole("menuitem", { name: "Delete", exact: true })).toBeDisabled()
    if (mode === "readonly") {
      await expect(page.getByRole("menuitem", { name: "Edit", exact: true })).toBeDisabled()
      await page.keyboard.press("Escape")
      await page.getByRole("button", { name: entity === "services" ? "Consultation" : "Consultations", exact: true }).click()
      await expect(page.getByRole("button", { name: "Edit details" })).toHaveCount(0)
    } else {
      await page.getByRole("menuitem", { name: "Edit", exact: true }).click()
      await expect(page.locator(entity === "services" ? "#edit-service-status" : "#edit-status")).toBeDisabled()
      await expect(page.getByRole("button", { name: "Save changes", exact: true })).toBeEnabled()
      if (entity === "services") await page.screenshot({ path: test.info().outputPath("service-editor-permissions.png"), animations: "disabled" })
    }
  })
}
