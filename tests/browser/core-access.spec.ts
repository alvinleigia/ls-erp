import { test, expect, type Page } from "@playwright/test"
async function fixture(page: Page, permissions: string[]) {
 const calls: string[] = []
 await page.route("**/api/**", async route => {
  const path = new URL(route.request().url()).pathname; calls.push(path)
  expect(route.request().method()).toBe("GET")
  if (path === "/api/modules") return route.fulfill({json:{permissions,modules:[]}})
  if (path === "/api/settings/taxes") return route.fulfill({json:{items:[{id:"tax",name:"VAT",percent:5,isActive:true,sortOrder:0}],total:1,totalPages:1,page:1,pageSize:10}})
  if (path.startsWith("/api/settings")) return route.fulfill({json:{settings:{locale:"en-IN",currency:"INR",timeZone:"Asia/Kolkata",dateFormat:"dd/MM/yyyy",timeFormat:"H24",firstDayOfWeek:"MONDAY",emailNotificationsEnabled:false,currencySymbolPlacement:"BEFORE",numberFormat:"US_UK",workingHours:[],overrides:[]}}})
  return route.fulfill({json:{items:[],total:0,totalPages:1,page:1,pageSize:10}})
 })
 return calls
}
for(const [path,api] of [["/dashboard","/api/dashboard/summary"],["/reports/audit-logs","/api/reports/audit-logs"],["/settings","/api/settings"],["/settings/taxes","/api/settings/taxes"]]) {
 test(`denied core view does not fetch its data: ${path}`,async({page})=>{
  const calls=await fixture(page,[]);await page.goto(path)
  await expect(page.getByRole("heading",{name:"Access unavailable"})).toBeVisible();expect(calls).not.toContain(api)
 })
}
test("settings read-only mode disables changes while preserving the view",async({page})=>{
 await fixture(page,["businessSettings.read"]);await page.goto("/settings")
 await expect(page.getByRole("heading",{name:"Settings",exact:true})).toBeVisible()
 await expect(page.getByRole("button",{name:"Save settings"})).toBeDisabled()
 await expect(page.getByLabel("Locale",{exact:true})).toBeDisabled()
 await expect(page.getByRole("status").filter({hasText:"read-only access"})).toBeVisible()
 await page.screenshot({path:test.info().outputPath("settings-readonly.png"),fullPage:true,animations:"disabled"})
})
test("tax editor cannot change active status or delete without archive permission",async({page})=>{
 await fixture(page,["taxRates.read","taxRates.edit"]);await page.goto("/settings/taxes")
 await expect(page.getByRole("button",{name:"New tax"})).toBeDisabled()
 await page.getByRole("row").filter({hasText:"VAT"}).getByRole("button").click()
 await expect(page.getByRole("menuitem",{name:"Delete",exact:true})).toBeDisabled()
 await page.getByRole("menuitem",{name:"Edit",exact:true}).click()
 await expect(page.getByRole("checkbox")).toBeDisabled()
 await expect(page.getByRole("button",{name:"Save changes",exact:true})).toBeEnabled()
 await page.screenshot({path:test.info().outputPath("tax-editor.png"),fullPage:true,animations:"disabled"})
})
test("staff cannot open administration even with a matching permission",async({page})=>{
 const calls=await fixture(page,["businessSettings.read"]);await page.goto("/settings?role=STAFF")
 await expect(page.getByRole("heading",{name:"Access unavailable"})).toBeVisible();expect(calls).not.toContain("/api/settings")
})
