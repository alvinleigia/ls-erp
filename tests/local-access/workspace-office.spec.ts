import { test, expect, type Page } from "@playwright/test"
import { seed, login, json, password } from "./fixtures"

async function open(page: Page) {
  await page.getByRole("button",{name:"Change creation office",exact:true}).click()
  await expect(page.getByRole("combobox",{name:"Office for new records",exact:true})).toBeVisible()
}
async function pick(page: Page,name: string) {
  await page.getByRole("combobox",{name:"Office for new records",exact:true}).click()
  await page.getByPlaceholder("Type to search...").fill(name)
  await page.getByRole("option",{name:new RegExp(name)}).click()
  await expect(page.getByRole("listbox")).toHaveCount(0)
}
async function apply(page: Page) {
  await expect(page.getByRole("button",{name:"Apply creation office",exact:true})).toBeEnabled()
  await page.getByRole("button",{name:"Apply creation office",exact:true}).click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
}
test("self selector pages eligible offices, cancels safely, syncs tabs and preserves accessible records",async({browser})=>{
  test.setTimeout(180_000)
  const f=await seed(),admin=await login(browser,f.origin,f.users.admin.email)
  let staff:Awaited<ReturnType<typeof login>>|undefined
  try {
    const parent=await json(admin.context,"/api/companies",201,"POST",{name:"Regional group",code:"REGIONAL"})
    const a=await json(admin.context,"/api/offices",201,"POST",{name:"Central office",code:"CENTRAL",companyId:parent.id})
    const b=await json(admin.context,"/api/offices",201,"POST",{name:"Zonal office",code:"ZONAL",companyId:parent.id})
    const other=(await json(admin.context,"/api/companies")).items.find((row:{id:string})=>row.id!==parent.id)
    await json(admin.context,"/api/offices",201,"POST",{name:"Outside office",code:"OUTSIDE",companyId:other.id})
    for(let i=0;i<24;i++)await f.db.query('INSERT INTO "BusinessOffice"(id,"tenantId","companyId",name,code,"updatedAt") VALUES($1,$2,$3,$4,$5,now())',[`${f.slug}_page_${i}`,f.slug,parent.id,`Paged office ${String(i).padStart(2,"0")}`,`PAGED_${i}`])
    const path=`/api/access/users/${f.users.staff.id}/offices`
    await json(admin.context,path,200,"PATCH",{version:0,officeIds:[],companies:[{companyId:parent.id,includeSubsidiaries:false}],creationOfficeId:a.id})
    const original=await json(admin.context,path),profiles=await json(admin.context,`/api/access/users/${f.users.staff.id}`)
    staff=await login(browser,f.origin,f.users.staff.email);const page=staff.page,tab=await staff.context.newPage()
    await tab.goto("/dashboard");await expect(tab.getByRole("button",{name:"Change creation office",exact:true})).toContainText("Central office")
    const contact=await json(staff.context,"/api/crm/contacts",201,"POST",{name:"Workspace customer"})
    const first=await json(staff.context,"/api/crm/enquiries",201,"POST",{title:"Central workspace record",contactId:contact.id,assignedUserId:f.users.staff.id})
    await page.getByRole("button",{name:"Change creation office",exact:true}).focus();await page.keyboard.press("Enter")
    await expect(page.getByRole("combobox",{name:"Office for new records",exact:true})).toBeVisible();await page.keyboard.press("Escape");await expect(page.getByRole("dialog")).toHaveCount(0)
    await open(page)
    await expect(page.getByText("26 eligible offices",{exact:true})).toBeVisible()
    await page.getByRole("combobox",{name:"Office for new records",exact:true}).click();await page.getByPlaceholder("Type to search...").fill("Outside office")
    await expect(page.getByText("0 eligible offices",{exact:true})).toBeVisible();await expect(page.getByRole("option",{name:/Outside office/})).toHaveCount(0)
    await page.keyboard.press("Escape");await expect(page.getByRole("listbox")).toHaveCount(0)
    await page.getByRole("combobox",{name:"Office for new records",exact:true}).click();await page.getByPlaceholder("Type to search...").fill("")
    await page.keyboard.press("Escape");await expect(page.getByRole("listbox")).toHaveCount(0)
    await expect(page.getByRole("button",{name:"Next workspace choices",exact:true})).toBeVisible();await page.getByRole("button",{name:"Next workspace choices",exact:true}).click()
    await page.getByRole("combobox",{name:"Office for new records",exact:true}).click();await page.getByRole("option",{name:/Zonal office/}).click();await expect(page.getByRole("listbox")).toHaveCount(0)
    await expect(page.getByRole("button",{name:"Apply creation office",exact:true})).toBeEnabled()
    await page.screenshot({path:"test-results/local-access/workspace-office-desktop.png",animations:"disabled"})
    await page.getByRole("button",{name:"Cancel",exact:true}).click();await page.getByRole("button",{name:"Discard changes",exact:true}).click();await expect(page.getByRole("dialog")).toHaveCount(0)
    expect((await json(staff.context,"/api/workspace/office")).version).toBe(original.version)
    await open(page);await pick(page,"Zonal office");await apply(page)
    await expect(tab.getByRole("button",{name:"Change creation office",exact:true})).toContainText("Zonal office")
    const second=await json(staff.context,"/api/crm/enquiries",201,"POST",{title:"Zonal workspace record",contactId:contact.id,assignedUserId:f.users.staff.id})
    const before=(await json(staff.context,"/api/crm/enquiries")).total;expect(before).toBe(2)
    await json(staff.context,`/api/crm/enquiries/${first.id}`)
    expect((await f.db.query('SELECT "officeId" FROM "CrmEnquiry" WHERE id=$1',[first.id])).rows[0].officeId).toBe(a.id)
    expect((await f.db.query('SELECT "officeId" FROM "CrmEnquiry" WHERE id=$1',[second.id])).rows[0].officeId).toBe(b.id)
    await page.setViewportSize({width:390,height:844});await open(page)
    await expect(page.getByText("Creation office updated.",{exact:true})).toHaveCount(0)
    await expect(page.getByRole("button",{name:"Cancel",exact:true})).toBeInViewport();await expect(page.getByRole("button",{name:"Apply creation office",exact:true})).toBeInViewport()
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
    await page.screenshot({path:"test-results/local-access/workspace-office-mobile.png",animations:"disabled"})
    await page.getByRole("combobox",{name:"Office for new records",exact:true}).click();await page.getByRole("option",{name:"No creation office",exact:true}).click();await expect(page.getByRole("listbox")).toHaveCount(0);await apply(page)
    await expect(tab.getByRole("button",{name:"Change creation office",exact:true})).toContainText("No creation office")
    expect((await json(staff.context,"/api/workspace/office")).creationOfficeId).toBeNull()
    expect((await json(staff.context,"/api/crm/enquiries")).total).toBe(before)
    await json(staff.context,"/api/crm/enquiries",403,"POST",{title:"No selected office",contactId:contact.id,assignedUserId:f.users.staff.id})
    const after=await json(admin.context,path),afterProfiles=await json(admin.context,`/api/access/users/${f.users.staff.id}`)
    expect(after.offices).toEqual(original.offices);expect(after.companies).toEqual(original.companies);expect(afterProfiles.accessPolicy).toEqual(profiles.accessPolicy);expect(afterProfiles.accessAssignments).toEqual(profiles.accessAssignments)
  }finally{await staff?.context.close();await admin.context.close();await f.db.end()}
})

test("concurrent selector edits preserve a stale choice until explicit reload",async({browser})=>{
  test.setTimeout(120_000)
  const f=await seed(),admin=await login(browser,f.origin,f.users.admin.email),page=admin.page,tab=await admin.context.newPage()
  try{
    const company=(await json(admin.context,"/api/companies")).items[0]
    const a=await json(admin.context,"/api/offices",201,"POST",{name:"Conflict east",code:"CONF_EAST",companyId:company.id})
    await json(admin.context,"/api/offices",201,"POST",{name:"Conflict west",code:"CONF_WEST",companyId:company.id})
    const c=await json(admin.context,"/api/offices",201,"POST",{name:"Conflict north",code:"CONF_NORTH",companyId:company.id})
    const own=await json(admin.context,"/api/workspace/office");await json(admin.context,"/api/workspace/office",200,"PATCH",{version:own.version,officeId:a.id})
    await tab.goto("/dashboard");await open(page);await pick(page,"Conflict west")
    await open(tab);await pick(tab,"Conflict north");await apply(tab)
    await expect(page.getByRole("combobox",{name:"Office for new records",exact:true})).toContainText("Conflict west")
    await page.getByRole("button",{name:"Apply creation office",exact:true}).click()
    await expect(page.getByRole("alert")).toContainText("Office preference changed")
    await expect(page.getByRole("combobox",{name:"Office for new records",exact:true})).toContainText("Conflict west")
    await expect(page.getByRole("button",{name:"Apply creation office",exact:true})).toBeDisabled()
    expect((await json(admin.context,"/api/workspace/office")).creationOffice.id).toBe(c.id)
    await page.getByRole("button",{name:"Discard choice and reload",exact:true}).click()
    await expect(page.getByRole("combobox",{name:"Office for new records",exact:true})).toContainText("Conflict north")
    await page.getByRole("button",{name:"Cancel",exact:true}).click();await expect(page.getByRole("dialog")).toHaveCount(0)
    expect((await json(admin.context,"/api/workspace/office")).creationOffice.id).toBe(c.id)
  }finally{await admin.context.close();await f.db.end()}
})

test("another tab's selector cannot reroute an open CRM creation draft",async({browser})=>{
  test.setTimeout(150_000)
  const f=await seed(),admin=await login(browser,f.origin,f.users.admin.email),page=admin.page,tab=await admin.context.newPage()
  try{
    const company=(await json(admin.context,"/api/companies")).items[0],a=await json(admin.context,"/api/offices",201,"POST",{name:"Draft east",code:"DRAFT_EAST",companyId:company.id}),b=await json(admin.context,"/api/offices",201,"POST",{name:"Draft west",code:"DRAFT_WEST",companyId:company.id})
    const own=await json(admin.context,"/api/workspace/office");await json(admin.context,"/api/workspace/office",200,"PATCH",{version:own.version,officeId:a.id})
    const contact=await json(admin.context,"/api/crm/contacts",201,"POST",{name:"Captured draft contact"})
    const reads:string[]=[];page.on("response",response=>{if(new URL(response.url()).pathname==="/api/workspace/office"&&response.request().method()==="GET"&&response.status()===200)reads.push(response.url())})
    await page.goto(`/crm/enquiries/new?contactId=${contact.id}`);await page.getByText("Enquiry details",{exact:true}).click();await page.getByLabel("Enquiry title",{exact:true}).fill("UI captured office draft")
    await expect.poll(()=>reads.length).toBeGreaterThanOrEqual(2)
    await tab.goto("/dashboard");await open(tab);await pick(tab,"Draft west");await apply(tab)
    await expect(page.getByRole("button",{name:"Change creation office",exact:true})).toContainText("Draft west")
    await expect(page.getByLabel("Enquiry title",{exact:true})).toHaveValue("UI captured office draft")
    const sent=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/crm/enquiries"&&r.request().method()==="POST")
    await page.getByRole("button",{name:"Save enquiry",exact:true}).click();const response=await sent;expect(response.status()).toBe(409);expect(response.request().headers()["x-office-id"]).toBe(a.id)
    await expect(page.getByText("Office context changed; reload the creation form.",{exact:true})).toBeVisible()
    expect((await json(admin.context,"/api/crm/enquiries?q=UI%20captured%20office%20draft")).total).toBe(0)
    page.once("dialog",d=>d.accept());await page.reload();await page.getByText("Enquiry details",{exact:true}).click();await page.getByLabel("Enquiry title",{exact:true}).fill("UI fresh office draft")
    const saved=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/crm/enquiries"&&r.request().method()==="POST")
    await page.getByRole("button",{name:"Save enquiry",exact:true}).click();const result=await saved;expect(result.status()).toBe(201);expect((await result.json()).officeId).toBe(b.id)
  }finally{await admin.context.close();await f.db.end()}
})

test("unassigned accounts can inspect self choices and closed preferences can be explicitly cleared",async({browser})=>{
  test.setTimeout(120_000)
  const f=await seed(),admin=await login(browser,f.origin,f.users.admin.email)
  let plain:Awaited<ReturnType<typeof login>>|undefined,platform:Awaited<ReturnType<typeof login>>|undefined
  try{
    const email=`workspace-none@${f.slug}.test`,created=await json(admin.context,"/api/users",200,"POST",{name:"Unassigned workspace",email,password,role:"STAFF"})
    plain=await login(browser,f.origin,email);await open(plain.page)
    await expect(plain.page.getByText("No eligible active offices. Ask your administrator to review office membership.",{exact:true})).toBeVisible()
    await expect(plain.page.getByRole("button",{name:"Apply creation office",exact:true})).toBeDisabled();await json(plain.context,"/api/offices",403)
    await plain.page.getByRole("button",{name:"Cancel",exact:true}).click();await expect(plain.page.getByRole("dialog")).toHaveCount(0)
    const company=(await json(admin.context,"/api/companies")).items[0],office=await json(admin.context,"/api/offices",201,"POST",{name:"Closing preference",code:"CLOSING",companyId:company.id})
    await json(admin.context,`/api/access/users/${created.user.id}/offices`,200,"PATCH",{version:0,officeIds:[office.id],companies:[],creationOfficeId:office.id})
    await json(admin.context,`/api/offices/${office.id}`,200,"PATCH",{version:office.version,archived:true})
    await open(plain.page);await expect(plain.page.getByRole("alert")).toContainText("no longer eligible")
    await plain.page.getByRole("combobox",{name:"Office for new records",exact:true}).click();await plain.page.getByRole("option",{name:"No creation office",exact:true}).click();await expect(plain.page.getByRole("listbox")).toHaveCount(0);await apply(plain.page)
    expect((await json(plain.context,"/api/workspace/office")).creationOfficeId).toBeNull()
    expect((await json(admin.context,`/api/access/users/${created.user.id}/offices`)).offices[0].officeId).toBe(office.id)
    platform=await login(browser,"http://platform.localhost:3108",f.users.platform.email)
    await expect(platform.page.getByRole("button",{name:"Change creation office",exact:true})).toHaveCount(0)
  }finally{await platform?.context.close();await plain?.context.close();await admin.context.close();await f.db.end()}
})


test("failed lookups recover explicitly and stale label responses cannot restore revoked access",async({browser})=>{
  test.setTimeout(120_000)
  const f=await seed(),admin=await login(browser,f.origin,f.users.admin.email)
  let staff:Awaited<ReturnType<typeof login>>|undefined,release:(()=>void)|undefined
  try{
    const company=(await json(admin.context,"/api/companies")).items[0],a=await json(admin.context,"/api/offices",201,"POST",{name:"Recover east",code:"RECOVER_EAST",companyId:company.id}),b=await json(admin.context,"/api/offices",201,"POST",{name:"Recover west",code:"RECOVER_WEST",companyId:company.id})
    await json(admin.context,`/api/access/users/${f.users.staff.id}/offices`,200,"PATCH",{version:0,officeIds:[a.id,b.id],companies:[],creationOfficeId:a.id})
    staff=await login(browser,f.origin,f.users.staff.email);const page=staff.page
    await open(page);await expect(page.getByText("2 eligible offices",{exact:true})).toBeVisible()
    await page.route("**/api/workspace/offices?**",route=>route.abort("failed"),{times:1})
    await page.getByRole("combobox",{name:"Office for new records",exact:true}).click();await page.getByPlaceholder("Type to search...").fill("Recover west")
    await expect(page.getByRole("alert")).toBeVisible();await page.keyboard.press("Escape");await expect(page.getByRole("listbox")).toHaveCount(0)
    await expect(page.getByRole("button",{name:"Apply creation office",exact:true})).toBeDisabled()
    await page.getByRole("button",{name:"Discard choice and reload",exact:true}).click()
    await expect(page.getByRole("combobox",{name:"Office for new records",exact:true})).toContainText("Recover east")
    await expect(page.getByText("2 eligible offices",{exact:true})).toBeVisible()
    const old=await json(staff.context,"/api/workspace/office"),held=new Promise<void>(resolve=>{release=resolve});let waiting=false,finished=false
    await page.route("**/api/workspace/office",async route=>{waiting=true;await held;await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(old)}).catch(()=>{});finished=true})
    await page.evaluate(()=>window.dispatchEvent(new Event("focus")));await expect.poll(()=>waiting).toBe(true)
    await f.db.query(`UPDATE "User" SET status='SUSPENDED' WHERE id=$1`,[f.users.staff.id])
    await page.getByRole("combobox",{name:"Office for new records",exact:true}).click();await page.getByPlaceholder("Type to search...").fill("Recover")
    await expect(page.getByText("Office selection is not permitted. Reload to check current access.",{exact:true})).toBeVisible()
    release?.();await expect.poll(()=>finished).toBe(true)
    await expect(page.getByRole("combobox",{name:"Office for new records",exact:true})).toHaveCount(0)
    await expect(page.getByRole("button",{name:"Change creation office",exact:true,includeHidden:true})).toContainText("Creation office unavailable")
    expect((await f.db.query('SELECT "creationOfficeId",version FROM "BusinessOfficePolicy" WHERE "tenantId"=$1 AND "userId"=$2',[f.slug,f.users.staff.id])).rows[0]).toEqual({creationOfficeId:a.id,version:1})
  }finally{release?.();await staff?.context.close();await admin.context.close();await f.db.end()}
})
