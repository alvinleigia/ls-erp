import { test, expect, type Page } from "@playwright/test"
import { seed, login, json, assignOffices, password } from "./fixtures"
import { allPermissions } from "@/platform/access/catalog"
import { defaultRecordRules, supportedScopes } from "@/platform/access/rules"
import { emptyQuotationContent } from "@/modules/sales-documents/quotation-validation"

test.use({actionTimeout:15_000})
async function pick(page:Page,label:string,name:string){await page.getByRole("combobox",{name:label,exact:true}).click();await page.getByPlaceholder("Type to search...").fill(name);await page.getByRole("option",{name:new RegExp(name)}).click();await expect(page.getByRole("listbox")).toHaveCount(0)}
async function setup(browser:Parameters<typeof login>[0]){
  const f=await seed(),admin=await login(browser,f.origin,f.users.admin.email),office=(await json(admin.context,"/api/offices")).items[0]
  for(const u of [f.users.admin,f.users.manager,f.users.staff])await assignOffices(admin.context,u.id,[office.id],office.id)
  await json(admin.context,"/api/modules",200,"PATCH",{key:"realEstate",enabled:false})
  const agency=await json(admin.context,"/api/collaborators",201,"POST",{name:"Dashboard Alpha Agency",code:"DASH_ALPHA",supervisorUserId:f.users.manager.id})
  const rules=defaultRecordRules();for(const key of Object.keys(rules) as (keyof typeof rules)[])if(supportedScopes(key.split(".")[0] as Parameters<typeof supportedScopes>[0]).includes("ALL"))rules[key]="ALL"
  const permissions=allPermissions.filter(p=>["dashboard","contacts","enquiries","opportunities","reports","activities","activityTypes","pipelines","quotations"].includes(p.split(".")[0]))
  const profile=await json(admin.context,"/api/access/roles",201,"POST",{name:"Dashboard report access",permissions}),assignment=await json(admin.context,`/api/access/users/${f.users.manager.id}`)
  await json(admin.context,`/api/access/users/${f.users.manager.id}`,200,"PATCH",{version:assignment.accessPolicy.version,roleIds:[profile.id],rules})
  const partner=(await json(admin.context,"/api/users",200,"POST",{name:"Dashboard Partner",email:`dashboard-partner@${f.slug}.test`,password,role:"STAFF",collaboratorId:agency.id})).user;await assignOffices(admin.context,partner.id,[office.id],office.id)
  const contact=await json(admin.context,"/api/crm/contacts",201,"POST",{name:"Generic dashboard buyer"}),pipeline=await json(admin.context,"/api/crm/pipelines",201,"POST",{name:"Generic sales",stages:[{name:"Open",kind:"OPEN",probability:10,color:"#123456"},{name:"Won",kind:"WON",probability:100,color:"#00aa00"},{name:"Lost",kind:"LOST",probability:0,color:"#aa0000"}]})
  const day=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date())
  let dealA:string=""
  for(const [title,userId,partnerId] of [["Internal Alpha",f.users.staff.id,agency.id],["External ordinary",partner.id,""]]){
    const enquiry=await json(admin.context,"/api/crm/enquiries",201,"POST",{title:title+" enquiry",contactId:contact.id,assignedUserId:userId,...(partnerId?{introducedByCollaboratorId:partnerId}:{})})
    const deal=await json(admin.context,"/api/crm/opportunities",201,"POST",{title:title+" sale",contactId:contact.id,assignedUserId:userId,enquiryId:enquiry.id,pipelineId:pipeline.id,stageId:pipeline.stages[0].id,amount:"100.25",currency:"INR",expectedCloseOn:"2030-01-01"})
    if(partnerId)dealA=deal.id
    await json(admin.context,`/api/crm/opportunities/${deal.id}/quotations`,201,"POST",{content:{...structuredClone(emptyQuotationContent),title:title+" quote",supplierName:"Generic Services",currency:"INR",bookingDate:day,lines:[{description:"Services",quantity:"1",unit:"service",rate:"100.25"}],instalments:[{label:"Start",percent:"100",days:0,note:""}]}})
  }
  const completed=await json(admin.context,"/api/crm/work",201,"POST",{title:"Completed external Alpha",type:"CALL",callDirection:"OUTBOUND",contactId:contact.id,opportunityId:dealA,assignedUserId:partner.id,dueOn:"2020-01-01"})
  await json(admin.context,`/api/crm/work/${completed.id}/complete`,200,"POST",{version:completed.version,outcome:"CONNECTED",summary:"Synthetic admin completion",occurredAt:new Date().toISOString()})
  await json(admin.context,"/api/crm/work",201,"POST",{title:"Internal Alpha follow-up",type:"TASK",contactId:contact.id,opportunityId:dealA,assignedUserId:f.users.staff.id,dueOn:"2020-01-01"})
  const category=(await json(admin.context,"/api/service-categories",200,"POST",{name:"Independent service category"})).item
  await json(admin.context,"/api/services",200,"POST",{name:"Independent service",categoryId:category.id,durationMinutes:30,priceCents:10000})
  return {f,admin,agency,rules,permissions,day}
}

test("dashboard filters preserve assignee/origin meaning and KPI drill-downs retain the exact selection",async({browser})=>{
  test.setTimeout(150_000)
  const s=await setup(browser),viewer=await login(browser,s.f.origin,s.f.users.manager.email),{page}=viewer
  try{
    await expect(page.getByRole("link",{name:"2 New enquiries",exact:true})).toBeVisible()
    await json(viewer.context,`/api/dashboard/summary?introduction=unattributed&introducedByCollaboratorId=${s.agency.id}`,400);await json(viewer.context,"/api/dashboard/sales-records?kind=unknown",400)
    await page.getByRole("button",{name:"Filters",exact:true}).click();await page.getByLabel("Sales owner / assigned user type",{exact:true}).click();await page.getByRole("menuitemradio",{name:"External collaborators",exact:true}).click();await pick(page,"Introducing collaborator","Dashboard Alpha Agency");await page.getByRole("heading",{name:"Dashboard",exact:true}).click()
    await expect(page.getByRole("link",{name:"1 Completed activities",exact:true})).toBeVisible();await expect(page.getByRole("link",{name:"0 New enquiries",exact:true})).toBeVisible()
    await page.getByRole("link",{name:"1 Completed activities",exact:true}).click();await expect(page).toHaveURL(/\/dashboard\/sales-records\?/);await expect(page).toHaveURL(/responsibleType=external/);await expect(page).toHaveURL(new RegExp(`introducedByCollaboratorId=${s.agency.id}`));await expect(page).toHaveURL(/range=custom/)
    await expect(page.getByRole("heading",{name:"Completed activities",exact:true})).toBeVisible();await expect(page.getByRole("link",{name:"Completed external Alpha",exact:true})).toBeVisible();await expect(page.getByRole("link",{name:"Internal Alpha follow-up",exact:true})).toHaveCount(0)
    await page.screenshot({path:"test-results/local-access/dashboard-attribution-drilldown.png",fullPage:true,animations:"disabled"});await json(viewer.context,"/api/collaborators",403)
  }finally{await viewer.context.close();await s.admin.context.close();await s.f.db.end()}
})
test("archived source choices, latest document metrics and mobile filter/drill-down views stay usable",async({browser})=>{
  test.setTimeout(150_000)
  const s=await setup(browser),{page,context}=s.admin
  try{
    const before=await json(context,"/api/dashboard/summary"),filtered=await json(context,`/api/dashboard/summary?introducedByCollaboratorId=${s.agency.id}`)
    expect(before.kpis.activeServices).toBe(1);expect(filtered.kpis).toEqual(before.kpis);expect(filtered.visibility).toEqual(before.visibility)
    await json(context,`/api/collaborators/${s.agency.id}`,200,"PATCH",{version:s.agency.version,archived:true});await page.reload()
    await page.setViewportSize({width:390,height:844});await page.getByRole("button",{name:"Filters",exact:true}).click();await pick(page,"Introducing collaborator","Dashboard Alpha Agency");await expect(page.getByRole("combobox",{name:"Introducing collaborator",exact:true})).toContainText("Dashboard Alpha Agency")
    await page.getByLabel("Supervisor at introduction",{exact:true}).scrollIntoViewIfNeeded();await expect(page.getByRole("dialog",{name:"Sales filters",exact:true})).toBeInViewport({ratio:1});await page.screenshot({path:"test-results/local-access/dashboard-attribution-filters-mobile.png",fullPage:false,animations:"disabled"});await page.getByRole("heading",{name:"Dashboard",exact:true}).click()
    await expect(page.getByRole("link",{name:"1 Quotations created",exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
    await page.screenshot({path:"test-results/local-access/dashboard-attribution-mobile.png",fullPage:true,animations:"disabled"});await page.setViewportSize({width:1280,height:900});await page.screenshot({path:"test-results/local-access/dashboard-attribution-desktop.png",fullPage:true,animations:"disabled"})
    await page.getByRole("link",{name:"1 Quotations created",exact:true}).click();await expect(page.getByRole("heading",{name:"Quotations created",exact:true})).toBeVisible();await expect(page.getByRole("link",{name:"Internal Alpha quote",exact:true})).toBeVisible();await expect(page.getByRole("link",{name:"External ordinary quote",exact:true})).toHaveCount(0);await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:"test-results/local-access/dashboard-document-drilldown-mobile.png",fullPage:true,animations:"disabled"})
  }finally{await context.close();await s.f.db.end()}
})
test("current source permission loss omits dependent widgets and denied refresh clears stale dashboard values",async({browser})=>{
  test.setTimeout(150_000)
  const s=await setup(browser),viewer=await login(browser,s.f.origin,s.f.users.manager.email),{page}=viewer
  try{
    await page.getByRole("button",{name:"Filters",exact:true}).click();await pick(page,"Introducing collaborator","Dashboard Alpha Agency");await page.getByRole("heading",{name:"Dashboard",exact:true}).click();await expect(page.getByRole("link",{name:"1 Quotations created",exact:true})).toBeVisible()
    const limited=await json(s.admin.context,"/api/access/roles",201,"POST",{name:"No opportunity Read",permissions:s.permissions.filter(p=>!p.startsWith("opportunities."))});let p=await json(s.admin.context,`/api/access/users/${s.f.users.manager.id}`);await json(s.admin.context,`/api/access/users/${s.f.users.manager.id}`,200,"PATCH",{version:p.accessPolicy.version,roleIds:[limited.id],rules:s.rules})
    await page.getByRole("button",{name:"Refresh",exact:true}).click();await expect(page.getByRole("status").filter({hasText:"Document widgets need opportunity Read"})).toBeVisible();await expect(page.getByRole("link",{name:/Quotations created/,exact:false})).toHaveCount(0);await expect(page.getByRole("link",{name:"1 New enquiries",exact:true})).toBeVisible()
    await json(viewer.context,`/api/dashboard/sales-records?kind=quotations&introducedByCollaboratorId=${s.agency.id}`,403)
    p=await json(s.admin.context,`/api/access/users/${s.f.users.manager.id}`);await json(s.admin.context,`/api/access/users/${s.f.users.manager.id}`,200,"PATCH",{version:p.accessPolicy.version,roleIds:[],rules:s.rules});await page.getByRole("button",{name:"Refresh",exact:true}).click();await expect(page.getByRole("alert").filter({hasText:"does not permit"})).toBeVisible();await expect(page.getByRole("link",{name:/New enquiries/})).toHaveCount(0)
  }finally{await viewer.context.close();await s.admin.context.close();await s.f.db.end()}
})
