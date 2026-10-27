import { test, expect, type Page } from "@playwright/test"
import { seed, login, json, assignOffices, password } from "./fixtures"
import { allPermissions } from "@/platform/access/catalog"
import { defaultRecordRules, supportedScopes } from "@/platform/access/rules"
import { emptyQuotationContent } from "@/modules/sales-documents/quotation-validation"

test.use({ actionTimeout: 15_000 })
async function pick(page: Page, label: string, name: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click()
  await page.getByPlaceholder("Type to search...").fill(name)
  await page.getByRole("option", { name: new RegExp(name) }).click()
  await expect(page.getByRole("listbox")).toHaveCount(0)
}
async function setup(browser: Parameters<typeof login>[0]) {
  const f = await seed(), admin = await login(browser, f.origin, f.users.admin.email), office = (await json(admin.context, "/api/offices")).items[0]
  for (const u of [f.users.admin, f.users.manager, f.users.staff]) await assignOffices(admin.context, u.id, [office.id], office.id)
  for (const key of ["salesOrders", "receivables"]) await f.db.query('INSERT INTO "TenantModule" ("tenantId",key,allowed,enabled,"updatedAt") VALUES ($1,$2,true,true,now())', [f.slug,key])
  await json(admin.context, "/api/modules", 200, "PATCH", { key: "realEstate", enabled: false })
  const agency = await json(admin.context, "/api/collaborators", 201, "POST", { name: "Finance Alpha Agency", code: "FIN_ALPHA", supervisorUserId: f.users.manager.id })
  const rules = defaultRecordRules();for (const key of Object.keys(rules) as (keyof typeof rules)[]) if (supportedScopes(key.split(".")[0] as Parameters<typeof supportedScopes>[0]).includes("ALL")) rules[key] = "ALL"
  const profile = await json(admin.context, "/api/access/roles", 201, "POST", { name: "Financial reporting", permissions: allPermissions.filter(p => ["dashboard", "salesOrders", "receivables", "opportunities"].includes(p.split(".")[0])) })
  const policy = await json(admin.context, `/api/access/users/${f.users.manager.id}`);await json(admin.context, `/api/access/users/${f.users.manager.id}`, 200, "PATCH", { version: policy.accessPolicy.version, roleIds: [profile.id], rules })
  const partner = (await json(admin.context, "/api/users", 200, "POST", { name: "Financial Partner", email: `finance-partner@${f.slug}.test`, password, role: "STAFF", collaboratorId: agency.id })).user
  await assignOffices(admin.context,partner.id,[office.id],office.id)
  const contact = await json(admin.context,"/api/crm/contacts",201,"POST",{name:"Generic finance customer"}), pipeline = await json(admin.context,"/api/crm/pipelines",201,"POST",{name:"Generic financial sales",stages:[{name:"Open",kind:"OPEN",probability:10,color:"#123456"},{name:"Won",kind:"WON",probability:100,color:"#00aa00"},{name:"Lost",kind:"LOST",probability:0,color:"#aa0000"}]})
  for (const [title,userId,partnerId,amount,currency] of [["Internal Alpha",f.users.staff.id,agency.id,"100.25","INR"],["External Alpha",partner.id,agency.id,"200.50","INR"],["Unattributed external",partner.id,"","300.75","USD"]]) {
    const deal = await json(admin.context,"/api/crm/opportunities",201,"POST",{title,contactId:contact.id,assignedUserId:userId,pipelineId:pipeline.id,stageId:pipeline.stages[0].id,amount,currency,expectedCloseOn:"2030-01-01",...(partnerId?{introducedByCollaboratorId:partnerId}:{})})
    const quote = await json(admin.context,`/api/crm/opportunities/${deal.id}/quotations`,201,"POST",{content:{...structuredClone(emptyQuotationContent),title,supplierName:"Generic Services",currency,lines:[{description:"Services",quantity:"1",unit:"service",rate:amount}]}})
    const order = await json(admin.context,"/api/sales-orders",200,"POST",{quotationId:quote.id,revision:1});await json(admin.context,`/api/sales-orders/${order.id}`,200,"PATCH",{action:"confirm",version:order.version})
    await json(admin.context,`/api/sales-orders/${order.id}/receivables`,200,"POST",{dueDates:["2020-01-01"]})
  }
  return { f,admin,agency,profile,rules }
}

test("receivables filters narrow numeric summaries and rows without directory access, and reset restores the full balance set",async({browser})=>{
  test.setTimeout(150_000)
  const s=await setup(browser),viewer=await login(browser,s.f.origin,s.f.users.manager.email),{page}=viewer
  try{
    await page.goto("/sales-orders/receivables");await expect(page.getByRole("link",{name:"Internal Alpha",exact:true})).toBeVisible();await expect(page.getByRole("link",{name:"Unattributed external",exact:true})).toBeVisible()
    await page.getByRole("button",{name:"Filters",exact:true}).click();await page.getByLabel("Salesperson type",{exact:true}).click();await page.getByRole("menuitemradio",{name:"External collaborators",exact:true}).click()
    await pick(page,"Introducing collaborator","Finance Alpha Agency");await page.getByRole("heading",{name:"Receivables",exact:true}).click()
    await expect(page.getByRole("link",{name:"External Alpha",exact:true})).toBeVisible();await expect(page.getByRole("link",{name:"Internal Alpha",exact:true})).toHaveCount(0);await expect(page.getByRole("link",{name:"Unattributed external",exact:true})).toHaveCount(0)
    const report=await json(viewer.context,`/api/receivables?responsibleType=external&introducedByCollaboratorId=${s.agency.id}`);expect(report.total).toBe(1);expect(report.summaries[0].outstanding).toBe("200.5")
    await expect(page.getByText("1 matching order",{exact:true})).toBeVisible();await page.screenshot({path:"test-results/local-access/receivables-attribution-desktop.png",fullPage:true,animations:"disabled"})
    await page.getByRole("button",{name:"Reset filters",exact:true}).first().click();await expect(page.getByRole("link",{name:"Internal Alpha",exact:true})).toBeVisible();await expect(page.getByRole("link",{name:"Unattributed external",exact:true})).toBeVisible()
    await json(viewer.context,"/api/collaborators",403)
  }finally{await viewer.context.close();await s.admin.context.close();await s.f.db.end()}
})

test("financial choice search preserves row search and archived evidence, and the final mobile filter remains reachable",async({browser})=>{
  test.setTimeout(150_000)
  const s=await setup(browser),{page,context}=s.admin
  try{
    await json(context,`/api/collaborators/${s.agency.id}`,200,"PATCH",{version:s.agency.version,archived:true})
    await page.goto("/sales-orders/receivables");await page.getByLabel("Search receivables",{exact:true}).fill("Internal Alpha");await expect(page.getByRole("link",{name:"External Alpha",exact:true})).toHaveCount(0)
    await page.setViewportSize({width:390,height:844});await page.getByRole("button",{name:"Filters",exact:true}).click();await pick(page,"Introducing collaborator","Finance Alpha Agency")
    await expect(page.getByRole("combobox",{name:"Introducing collaborator",exact:true})).toContainText("Finance Alpha Agency")
    await page.getByLabel("Supervisor at introduction",{exact:true}).scrollIntoViewIfNeeded();await expect(page.getByRole("dialog",{name:"Filters",exact:true})).toBeInViewport({ratio:1})
    await page.screenshot({path:"test-results/local-access/receivables-attribution-filters-mobile.png",fullPage:false,animations:"disabled"});await page.getByRole("heading",{name:"Receivables",exact:true}).click()
    await expect(page.getByRole("link",{name:"Internal Alpha",exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
    await page.screenshot({path:"test-results/local-access/receivables-attribution-mobile.png",fullPage:true,animations:"disabled"})
  }finally{await context.close();await s.f.db.end()}
})

test("revoking source Read preserves ordinary financial Read and removes origin choices; revoking balances clears stale totals",async({browser})=>{
  test.setTimeout(150_000)
  const s=await setup(browser),viewer=await login(browser,s.f.origin,s.f.users.manager.email),{page}=viewer
  try{
    const finance=await json(s.admin.context,"/api/access/roles",201,"POST",{name:"Finance only",permissions:["dashboard.read","salesOrders.read","receivables.read"]});let policy=await json(s.admin.context,`/api/access/users/${s.f.users.manager.id}`)
    await json(s.admin.context,`/api/access/users/${s.f.users.manager.id}`,200,"PATCH",{version:policy.accessPolicy.version,roleIds:[finance.id],rules:s.rules})
    await page.goto("/sales-orders/receivables");await expect(page.getByRole("link",{name:"Internal Alpha",exact:true})).toBeVisible();await page.getByRole("button",{name:"Filters",exact:true}).click();await expect(page.getByText("Origin filters require read access to their sales sources.")).toBeVisible();await expect(page.getByRole("combobox",{name:"Introducing collaborator",exact:true})).toHaveCount(0)
    await json(viewer.context,`/api/receivables?introducedByCollaboratorId=${s.agency.id}`,403);await page.getByRole("heading",{name:"Receivables",exact:true}).click()
    policy=await json(s.admin.context,`/api/access/users/${s.f.users.manager.id}`);await json(s.admin.context,`/api/access/users/${s.f.users.manager.id}`,200,"PATCH",{version:policy.accessPolicy.version,roleIds:[],rules:s.rules})
    await page.getByRole("button",{name:"Refresh",exact:true}).click();await expect(page.getByRole("alert").filter({hasText:"does not permit"})).toBeVisible();await expect(page.getByRole("link",{name:"Internal Alpha",exact:true})).toHaveCount(0);await expect(page.getByRole("heading",{name:"INR balances",exact:true})).toHaveCount(0)
  }finally{await viewer.context.close();await s.admin.context.close();await s.f.db.end()}
})
