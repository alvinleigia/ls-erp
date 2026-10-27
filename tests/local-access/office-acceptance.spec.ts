import { test, expect, type Page } from "@playwright/test"
import { seed, login, json, password, assignProfiles, assignOffices } from "./fixtures"
import { defaultRecordRules } from "@/platform/access/rules"

async function pick(page:Page,label:string,name:string){await page.getByRole("combobox",{name:label,exact:true}).click();await page.getByPlaceholder("Type to search...").fill(name);await page.getByRole("option",{name:new RegExp(name)}).click();await expect(page.getByRole("listbox")).toHaveCount(0)}
async function office(page:Page,name:string){await page.getByRole("button",{name:"Change creation office",exact:true}).click();await pick(page,"Office for new records",name);await expect(page.getByRole("button",{name:"Apply creation office",exact:true})).toBeEnabled();await page.getByRole("button",{name:"Apply creation office",exact:true}).click();await expect(page.getByRole("dialog")).toHaveCount(0)}

test("onboarding, managed teams, office grants and employee workplace remain independent in one real-user journey",async({browser})=>{
  test.setTimeout(240_000)
  const f=await seed(),admin=await login(browser,f.origin,f.users.admin.email),page=admin.page
  let employee:typeof admin|undefined,manager:typeof admin|undefined
  try{
    const parent=await json(admin.context,"/api/companies",201,"POST",{name:"Acceptance company",code:"ACCEPT"}),child=await json(admin.context,"/api/companies",201,"POST",{name:"Acceptance region",code:"REGION",parentId:parent.id})
    const a=await json(admin.context,"/api/offices",201,"POST",{name:"Head office",code:"HEAD",companyId:parent.id}),b=await json(admin.context,"/api/offices",201,"POST",{name:"Regional office",code:"REGION",companyId:child.id})
    const profile=await json(admin.context,"/api/access/roles",201,"POST",{name:"Acceptance reader",permissions:["dashboard.read","users.read","enquiries.read","contacts.read","teams.read","teamMembers.read","shiftRoster.read"]})
    await page.goto("/users");await page.getByRole("button",{name:"New user",exact:true}).click()
    const dialog=page.getByRole("dialog",{name:"Create user",exact:true}),email=`acceptance-staff@${f.slug}.test`
    await dialog.getByLabel("Role",{exact:true}).selectOption("STAFF");await pick(page,"Add access profile","Acceptance reader")
    await dialog.getByLabel("Full name",{exact:true}).fill("Acceptance staff");await dialog.getByLabel("Email",{exact:true}).fill(email);await dialog.getByLabel("Temporary password",{exact:true}).fill(password)
    await pick(page,"Add specific office","Head office");await pick(page,"Add specific office","Regional office");await pick(page,"Creation office","Head office")
    await expect(dialog.getByRole("button",{name:"Create user",exact:true})).toBeEnabled();await dialog.getByRole("button",{name:"Create user",exact:true}).click();await expect(dialog).toHaveCount(0)
    const staff=(await f.db.query('SELECT id FROM "User" WHERE "tenantId"=$1 AND email=$2',[f.slug,email])).rows[0]
    const rules=defaultRecordRules();for(const key of ["enquiries.read","contacts.read","teams.read","teamMembers.read"] as const)rules[key]="MANAGED_TEAMS"
    const managerEmail=`acceptance-manager@${f.slug}.test`,leadManager=(await json(admin.context,"/api/users",200,"POST",{name:"Acceptance manager",email:managerEmail,password,role:"MANAGER",accessRoleIds:[profile.id],recordRules:rules,officeAccess:{officeIds:[a.id],companies:[],creationOfficeId:a.id}})).user
    await assignOffices(admin.context,f.users.staff.id,[b.id],b.id)
    async function team(name:string,worker:string){let group=await json(admin.context,"/api/teams",201,"POST",{name});group=await json(admin.context,`/api/teams/${group.id}/members`,200,"POST",{version:group.version,userId:worker});group=await json(admin.context,`/api/teams/${group.id}/members`,200,"POST",{version:group.version,userId:leadManager.id,isManager:true});return group}
    const teamA=await team("Acceptance head team",staff.id),teamB=await team("Acceptance regional team",f.users.staff.id)
    const contact=await json(admin.context,"/api/crm/contacts",201,"POST",{name:"Acceptance customer"})
    await office(page,"Head office");const leadA=await json(admin.context,"/api/crm/enquiries",201,"POST",{title:"Acceptance head lead",contactId:contact.id,assignedUserId:staff.id,salesTeamId:teamA.id})
    await office(page,"Regional office");const leadB=await json(admin.context,"/api/crm/enquiries",201,"POST",{title:"Acceptance regional lead",contactId:contact.id,assignedUserId:f.users.staff.id,salesTeamId:teamB.id})
    const workplacePath=`/api/shifts/workplaces?staffId=${staff.id}`
    await page.goto(`/users/${staff.id}/staff`)
    await expect(page.getByText("Save the staff profile above before assigning a workplace. Saving a profile does not assign an office or workplace.",{exact:true})).toBeVisible()
    await expect(page.getByRole("button",{name:"Assign workplace",exact:true})).toHaveCount(0)
    await page.getByRole("button",{name:"Save",exact:true}).click()
    await expect(page.getByRole("button",{name:"Assign workplace",exact:true})).toBeVisible()
    const before=await json(admin.context,workplacePath);expect(before.current).toBeNull()
    const panel=page.getByRole("region",{name:"Staff workplace"})
    await panel.getByLabel("Working office",{exact:true}).click();await page.getByRole("option",{name:"Acceptance company / Head office",exact:true}).click();await panel.getByLabel("Effective date",{exact:true}).fill(before.today)
    const assigned=page.waitForResponse(response=>response.url().includes("/api/shifts/workplaces")&&response.request().method()==="POST")
    await panel.getByRole("button",{name:"Assign workplace",exact:true}).click();expect((await assigned).status()).toBe(200)
    await expect(panel.getByText("Acceptance company / Head office",{exact:true}).first()).toBeVisible()
    const placed=await json(admin.context,workplacePath);expect(placed.current.officeId).toBe(a.id)
    employee=await login(browser,f.origin,email);await office(employee.page,"Regional office")
    expect((await json(employee.context,workplacePath)).current.id).toBe(placed.current.id)
    const source=await json(employee.context,`/api/crm/enquiries/${leadA.id}`);expect(source.recordAccess.permissions["enquiries.edit"]).toBe(false)
    manager=await login(browser,f.origin,managerEmail);await manager.page.goto("/crm/enquiries")
    await expect(manager.page.getByRole("link",{name:"Acceptance head lead",exact:true})).toBeVisible();await expect(manager.page.getByRole("link",{name:"Acceptance regional lead",exact:true})).toHaveCount(0)
    await json(manager.context,`/api/crm/enquiries/${leadB.id}`,404)
    await page.goto(`/users/${leadManager.id}`);await page.getByRole("button",{name:"Office access",exact:true}).click()
    await pick(page,"Add company","Acceptance company");await page.getByRole("checkbox",{name:"Include subsidiary companies for Acceptance company",exact:true}).check()
    await expect(page.getByRole("button",{name:"Save office access",exact:true})).toBeEnabled();await page.getByRole("button",{name:"Save office access",exact:true}).click();await expect(page.getByRole("dialog")).toHaveCount(0)
    await manager.page.reload();await expect(manager.page.getByRole("link",{name:"Acceptance regional lead",exact:true})).toBeVisible()
    const count=(await json(manager.context,"/api/crm/enquiries")).total;expect(count).toBe(2)
    await office(manager.page,"Regional office");expect((await json(manager.context,"/api/crm/enquiries")).total).toBe(count)
    expect((await json(admin.context,workplacePath)).current.id).toBe(placed.current.id)
    await json(manager.context,`/api/crm/enquiries/${leadB.id}`,403,"PATCH",{title:"Denied edit",assignedUserId:f.users.staff.id,status:"NEW",version:leadB.version})
    await manager.page.screenshot({path:"test-results/local-access/office-acceptance-manager.png",fullPage:true,animations:"disabled"})
    await page.goto(`/users/${staff.id}/staff`);await page.setViewportSize({width:390,height:844});await page.getByRole("region",{name:"Staff workplace"}).scrollIntoViewIfNeeded()
    await expect(page.getByText("Current workplace:",{exact:false})).toContainText("Acceptance company / Head office")
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
    await page.screenshot({path:"test-results/local-access/office-acceptance-workplace-mobile.png",fullPage:true,animations:"disabled"})
    // Manager accounts use the same explicit employee-profile step; no HR placement is inferred.
    await page.setViewportSize({width:1280,height:900});await page.goto(`/users/${leadManager.id}`)
    await page.getByRole("button",{name:"Staff profile",exact:true}).click()
    await expect(page.getByRole("heading",{name:"Staff eligibility",exact:true})).toBeVisible()
    await expect(page.getByText("Save the staff profile above before assigning a workplace. Saving a profile does not assign an office or workplace.",{exact:true})).toBeVisible()
    await page.getByRole("button",{name:"Save",exact:true}).click();await expect(page.getByRole("button",{name:"Assign workplace",exact:true})).toBeVisible()
    expect((await json(admin.context,`/api/shifts/workplaces?staffId=${leadManager.id}`)).current).toBeNull()
    const grants=await json(admin.context,`/api/access/users/${leadManager.id}/offices`)
    await assignProfiles(admin.context,leadManager.id,[])
    await json(manager.context,"/api/crm/enquiries",403)
    expect((await json(admin.context,`/api/access/users/${leadManager.id}/offices`)).companies).toEqual(grants.companies)
    expect((await f.db.query('SELECT "officeId" FROM "CrmEnquiry" WHERE id=$1',[leadA.id])).rows[0].officeId).toBe(a.id)
    expect((await f.db.query('SELECT "officeId" FROM "CrmEnquiry" WHERE id=$1',[leadB.id])).rows[0].officeId).toBe(b.id)
  }finally{await manager?.context.close();await employee?.context.close();await admin.context.close();await f.db.end()}
})
