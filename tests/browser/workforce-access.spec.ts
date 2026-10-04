import { test, expect } from "@playwright/test"
import { fixture } from "./workforce-fixtures"
const views = [
  ["/leaves", "leaveDefinitions", "New leave definition"],
  ["/leaves/groups", "leaveGroups", "New leave group"],
  ["/leaves/requests", "leaveRequests", "Apply leave"],
  ["/leaves/approvals", "leaveApprovals", "Approve selected"],
  ["/shifts", "shiftTemplates", "New template"],
  ["/shifts/schedules", "shiftSchedules", "New schedule"],
  ["/shifts/recurring", "shiftPlans", "New recurring plan"],
] as const
for (const [path, resource, action] of views) for (const mode of ["disabled", "denied", "readonly"] as const) {
  test(`${path} ${mode}`, async ({ page }) => {
    const { queries, writes } = await fixture(page)
    await page.route("**/api/modules", route => route.fulfill({ json: {
      modules: ["leaves", "shifts"].map(key => ({ key, allowed: true, enabled: mode !== "disabled" })),
      permissions: mode === "denied" ? [] : [`${resource}.read`],
    } }))
    await page.goto(path)
    if (mode !== "readonly") {
      await expect(page.getByRole("heading", { name: mode === "disabled" ? "Module unavailable" : "Access unavailable" })).toBeVisible()
      expect(queries.filter(q => q.pathname.startsWith("/api/leaves") || q.pathname.startsWith("/api/shifts"))).toHaveLength(0)
    } else {
      if (action.startsWith("New leave")) await expect(page.getByRole("link", { name: action })).toHaveCount(0)
      else await expect(page.getByRole("button", { name: action, exact: true })).toBeDisabled()
      await page.getByRole("button", { name: "Record actions" }).first().click()
      const denied = resource === "leaveRequests" ? ["Cancel request"] : resource === "leaveApprovals" ? ["Approve", "Reject", "Revoke approval"] : resource === "shiftPlans" ? ["Edit", "Clone pattern", "Assign to staff", "Deactivate"] : resource.startsWith("shift") ? ["Edit", "Delete"] : ["Delete"]
      for (const name of denied) await expect(page.getByRole("menuitem", { name, exact: true })).toBeDisabled()
      await page.keyboard.press("Escape")
      if (path === "/leaves/approvals") await page.screenshot({ path: test.info().outputPath("approvals-readonly.png"), animations: "disabled" })
    }
    expect(writes).toHaveLength(0)
  })
}
test("staff cannot open definition management even with legacy unrestricted permissions", async ({ page }) => {
  const { queries } = await fixture(page)
  await page.goto("/leaves?role=STAFF")
  await expect(page.getByRole("heading", { name: "Access unavailable" })).toBeVisible()
  expect(queries.filter(q => q.pathname.startsWith("/api/leaves"))).toHaveLength(0)
})
test("detail edit controls and status transitions obey separate permissions", async ({ page }) => {
  await fixture(page)
  await page.route("**/api/modules", route => route.fulfill({ json: { modules: [{ key: "leaves", allowed: true, enabled: true }], permissions: ["leaveDefinitions.read", "leaveDefinitions.edit"] } }))
  await page.goto("/leaves/leave")
  await expect(page.getByRole("button", { name: "Delete", exact: true })).toBeDisabled()
  await page.getByRole("button", { name: "Edit details" }).click()
  await expect(page.locator("#status")).toBeDisabled()
  await expect(page.getByRole("button", { name: "Save changes", exact: true })).toBeEnabled()
})
