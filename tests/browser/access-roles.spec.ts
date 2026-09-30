import { test, expect } from "@playwright/test"

test("role template permissions and assignment are reviewable on desktop and mobile", async ({ page }) => {
 const writes: { name?: string; permissions?: string[]; roleId?: string; previousRoleId?: string | null }[] = []
 let saved: { id: string; name: string; permissions: string[]; archived: boolean; version: number } | null = null
 await page.route("**/api/**", async route => {
  const path = new URL(route.request().url()).pathname, method = route.request().method()
  if (method === "POST") { const data = route.request().postDataJSON(); writes.push(data); saved = { ...data, id: "role-1", version: 1 }; return route.fulfill({ json: saved }) }
  if (method === "PATCH") { writes.push(route.request().postDataJSON()); return route.fulfill({ json: { roleId: "role-1" } }) }
  if (path === "/api/access/users/staff") return route.fulfill({ json: { id: "staff", name: "Test Staff", role: "STAFF", accessAssignment: null } })
  if (path === "/api/users") return route.fulfill({ json: { items: [{ id: "staff", name: "Test Staff" }], total: 1 } })
  if (path === "/api/access/roles/role-1") return route.fulfill({ json: saved })
  return route.fulfill({ json: { items: saved ? [{ ...saved, _count: { assignments: 0 } }] : [], total: saved ? 1 : 0 } })
 })
 await page.goto("/settings/roles")
 await page.getByRole("button", { name: "New role", exact: true }).click()
 await page.getByRole("button", { name: "Copy template" }).click()
 await page.getByRole("menuitemradio", { name: "Read-only", exact: true }).click()
 await page.getByLabel("Role name", { exact: true }).fill("Sales observer")
 await expect(page.getByRole("checkbox", { name: "Contacts: read", exact: true })).toBeChecked()
 await expect(page.getByRole("checkbox", { name: "Contacts: edit", exact: true })).not.toBeChecked()
 await page.getByRole("checkbox", { name: "Contacts: edit", exact: true }).check()
 await page.getByRole("checkbox", { name: "Contacts: read", exact: true }).uncheck()
 await expect(page.getByRole("checkbox", { name: "Contacts: edit", exact: true })).not.toBeChecked()
 await page.screenshot({ path: test.info().outputPath("access-role-desktop.png"), fullPage: true })
 await page.setViewportSize({ width: 390, height: 844 })
 expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
 await page.screenshot({ path: test.info().outputPath("access-role-mobile.png"), fullPage: true })
 await page.getByRole("button", { name: "Save changes", exact: true }).click()
 await expect(page.getByRole("button", { name: "Sales observer", exact: true })).toBeVisible()
 expect(writes[0].permissions).not.toContain("contacts.read")
 await page.getByRole("button", { name: "Assign role", exact: true }).click()
 await page.locator("#access-user").click()
 await page.getByRole("option", { name: "Test Staff", exact: true }).click()
 await page.locator("#assigned-role").click()
 await page.getByRole("option", { name: "Sales observer", exact: true }).click()
 await page.getByRole("button", { name: "Save changes", exact: true }).click()
 await expect(page.getByRole("dialog")).toHaveCount(0)
 expect(writes[1]).toEqual({ roleId: "role-1", previousRoleId: null })
})

test("denied CRM direct view does not mount its data requests", async ({ page }) => {
 const calls: string[] = []
 await page.route("**/api/**", async route => {
  const path = new URL(route.request().url()).pathname; calls.push(path)
  return route.fulfill({ json: { permissions: ["enquiries.read"], modules: [{ key: "crm", allowed: true, enabled: true }] } })
 })
 await page.goto("/crm/contacts/hidden")
 await expect(page.getByRole("heading", { name: "Access unavailable" })).toBeVisible()
 expect(calls).not.toContain("/api/crm/contacts/hidden")
})


test("read-only contact hides edit, create and inaccessible sections",async({page})=>{
 await page.route("**/api/**",async route=>{
 const path=new URL(route.request().url()).pathname
 if(path==='/api/modules')return route.fulfill({json:{permissions:['contacts.read'],modules:[{key:'crm',allowed:true,enabled:true}]}})
 if(path==='/api/crm/contacts/buyer')return route.fulfill({json:{id:'buyer',name:'Visible buyer',email:'buyer@example.test',phone:'',archived:false,version:1,canEdit:true}})
 return route.fulfill({json:{items:[],total:0,settings:{timeZone:'Asia/Kolkata',dateFormat:'dd/MM/yyyy'}}})
 })
 await page.goto('/crm/contacts/buyer')
 await expect(page.getByRole('heading',{name:'Visible buyer'})).toBeVisible()
 await expect(page.getByRole('button',{name:'Edit',exact:true})).toHaveCount(0)
 await expect(page.getByRole('button',{name:'Edit details',exact:true})).toHaveCount(0)
 await expect(page.getByRole('link',{name:'Create enquiry'})).toHaveCount(0)
 await expect(page.getByRole('tab',{name:'Activities',exact:true})).toHaveCount(0)
 await expect(page.getByRole('tab',{name:'Business accounts',exact:true})).toHaveCount(0)
})
