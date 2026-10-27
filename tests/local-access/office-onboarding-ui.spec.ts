import { test, expect, type Page } from "@playwright/test"
import { seed, login, json, password } from "./fixtures"

async function pick(page: Page, label: string, name: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click()
  await page.getByPlaceholder("Type to search...").fill(name)
  await page.getByRole("option", { name: new RegExp(name) }).click()
  await expect(page.getByRole("listbox")).toHaveCount(0)
}
const countUsers = async (f: Awaited<ReturnType<typeof seed>>) => (await f.db.query('SELECT count(*)::int n FROM "User" WHERE "tenantId"=$1',[f.slug])).rows[0].n

test("user creation saves exact office access atomically and rechecks a closed draft office", async ({ browser }) => {
  test.setTimeout(180_000)
  const f = await seed(), admin = await login(browser,f.origin,f.users.admin.email), page = admin.page
  let created: Awaited<ReturnType<typeof login>> | undefined
  try {
    const company=(await json(admin.context,"/api/companies")).items[0]
    const a=await json(admin.context,"/api/offices",201,"POST",{name:"Onboarding east",code:"ONBOARD_EAST",companyId:company.id})
    const b=await json(admin.context,"/api/offices",201,"POST",{name:"Onboarding west",code:"ONBOARD_WEST",companyId:company.id})
    await page.goto("/users");await page.getByRole("button",{name:"New user",exact:true}).click()
    const dialog=page.getByRole("dialog",{name:"Create user",exact:true})
    await dialog.getByLabel("Role",{exact:true}).selectOption("STAFF")
    await pick(page,"Add access profile","Account fixture access")
    await dialog.getByLabel("Full name",{exact:true}).fill("Office onboarded staff")
    const email=`onboarded@${f.slug}.test`
    await dialog.getByLabel("Email",{exact:true}).fill(email)
    await dialog.getByLabel("Temporary password",{exact:true}).fill(password)
    await pick(page,"Add specific office","Onboarding east");await pick(page,"Creation office","Onboarding east")
    await expect(dialog.getByRole("button",{name:"Create user",exact:true})).toBeEnabled()
    const before=await countUsers(f)
    await json(admin.context,`/api/offices/${a.id}`,200,"PATCH",{version:a.version,archived:true})
    const failed=page.waitForResponse(r=>r.url().endsWith("/api/users")&&r.request().method()==="POST")
    await dialog.getByRole("button",{name:"Create user",exact:true}).click();expect((await failed).status()).toBe(400)
    await expect(dialog.getByLabel("Email",{exact:true})).toHaveValue(email)
    await expect(dialog.getByLabel("Specific office grants")).toContainText("Onboarding east")
    await expect(dialog.getByRole("button",{name:"Create user",exact:true})).toBeDisabled()
    expect(await countUsers(f)).toBe(before)
    await pick(page,"Add specific office","Onboarding west");await pick(page,"Creation office","Onboarding west")
    await expect(dialog.getByRole("button",{name:"Create user",exact:true})).toBeEnabled()
    await page.setViewportSize({width:390,height:844})
    await expect(dialog.getByRole("button",{name:"Create user",exact:true})).toBeInViewport()
    await expect(dialog.getByRole("button",{name:"Cancel",exact:true})).toBeInViewport()
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
    await page.getByRole("combobox",{name:"Creation office",exact:true}).scrollIntoViewIfNeeded()
    await expect(page.getByText("Choose an active creation office from this workspace.",{exact:true})).toHaveCount(0)
    await page.screenshot({path:"test-results/local-access/office-onboarding-user-mobile.png",animations:"disabled"})
    const submitted=page.waitForResponse(r=>r.url().endsWith("/api/users")&&r.request().method()==="POST")
    await dialog.getByRole("button",{name:"Create user",exact:true}).click();const response=await submitted
    expect(response.status()).toBe(200)
    await expect(dialog).toHaveCount(0)
    const user=(await f.db.query('SELECT id FROM "User" WHERE "tenantId"=$1 AND email=$2',[f.slug,email])).rows[0]
    expect(await countUsers(f)).toBe(before+1)
    const saved=await json(admin.context,`/api/access/users/${user.id}/offices`)
    expect(saved.creationOfficeId).toBe(b.id);expect(saved.offices.map((row:{officeId:string})=>row.officeId).sort()).toEqual([a.id,b.id].sort())
    expect((await f.db.query('SELECT count(*)::int n FROM "AuditLog" WHERE "tenantId"=$1 AND "entityId"=$2 AND event=\'structure.officeMembership.updated\'',[f.slug,user.id])).rows[0].n).toBe(1)
    expect((await f.db.query('SELECT count(*)::int n FROM "StaffWorkplaceAssignment" w JOIN "StaffProfile" s ON s.id=w."staffProfileId" WHERE s."userId"=$1',[user.id])).rows[0].n).toBe(0)
    created=await login(browser,f.origin,email)
    expect((await json(created.context,"/api/workspace/offices")).items.map((row:{id:string})=>row.id)).toEqual([b.id])
    expect((await json(created.context,"/api/workspace/office")).creationOffice.id).toBe(b.id)
    const contact=await json(created.context,"/api/crm/contacts",201,"POST",{name:"New account customer"})
    const enquiry=await json(created.context,"/api/crm/enquiries",201,"POST",{title:"New account office enquiry",contactId:contact.id,assignedUserId:user.id})
    expect((await f.db.query('SELECT "officeId" FROM "CrmEnquiry" WHERE id=$1',[enquiry.id])).rows[0].officeId).toBe(b.id)
  } finally {await created?.context.close();await admin.context.close();await f.db.end()}
})

test("role and status changes clear hidden grants; cancellation and empty access never assign an office", async ({ browser }) => {
  test.setTimeout(150_000)
  const f=await seed(),admin=await login(browser,f.origin,f.users.admin.email),page=admin.page
  try {
    const office=(await json(admin.context,"/api/offices")).items[0],before=await countUsers(f)
    await page.goto("/users");await page.getByRole("button",{name:"New user",exact:true}).click()
    const dialog=page.getByRole("dialog",{name:"Create user",exact:true})
    await dialog.getByLabel("Role",{exact:true}).selectOption("STAFF")
    await pick(page,"Add specific office",office.name);await pick(page,"Creation office",office.name)
    await dialog.getByLabel("Role",{exact:true}).selectOption("CUSTOMER")
    await expect(page.getByRole("combobox",{name:"Creation office",exact:true})).toHaveCount(0)
    await dialog.getByLabel("Role",{exact:true}).selectOption("MANAGER")
    await expect(page.getByText("No specific office grants.",{exact:true})).toBeVisible()
    await expect(page.getByRole("combobox",{name:"Creation office",exact:true})).toHaveText("No creation office")
    await pick(page,"Add specific office",office.name)
    await dialog.getByLabel("Status",{exact:true}).selectOption("SUSPENDED")
    await expect(page.getByRole("combobox",{name:"Add specific office",exact:true})).toHaveCount(0)
    await dialog.getByLabel("Full name",{exact:true}).fill("Inactive onboarding")
    const email=`inactive@${f.slug}.test`
    await dialog.getByLabel("Email",{exact:true}).fill(email);await dialog.getByLabel("Temporary password",{exact:true}).fill(password)
    const submitted=page.waitForResponse(r=>r.url().endsWith("/api/users")&&r.request().method()==="POST")
    await dialog.getByRole("button",{name:"Create user",exact:true}).click();const response=await submitted;expect(response.status()).toBe(200)
    expect(response.request().postDataJSON().officeAccess).toBeUndefined()
    await expect(dialog).toHaveCount(0)
    const user=(await f.db.query('SELECT id FROM "User" WHERE "tenantId"=$1 AND email=$2',[f.slug,email])).rows[0]
    expect((await f.db.query('SELECT count(*)::int n FROM "BusinessOfficePolicy" WHERE "userId"=$1',[user.id])).rows[0].n).toBe(0)
    await expect(dialog).toHaveCount(0);expect(await countUsers(f)).toBe(before+1)
    await page.getByRole("button",{name:"New user",exact:true}).click();await dialog.getByLabel("Role",{exact:true}).selectOption("STAFF")
    await pick(page,"Add specific office",office.name);await dialog.getByRole("button",{name:"Cancel",exact:true}).click();await expect(dialog).toHaveCount(0)
    expect(await countUsers(f)).toBe(before+1)
    await page.getByRole("button",{name:"New user",exact:true}).click();await dialog.getByLabel("Role",{exact:true}).selectOption("STAFF")
    await expect(page.getByText("No specific office grants.",{exact:true})).toBeVisible()
    await dialog.getByLabel("Full name",{exact:true}).fill("Unassigned staff");await dialog.getByLabel("Email",{exact:true}).fill(`unassigned@${f.slug}.test`);await dialog.getByLabel("Temporary password",{exact:true}).fill(password)
    await expect(dialog.getByRole("button",{name:"Create user",exact:true})).toBeEnabled()
    const empty=page.waitForResponse(r=>r.url().endsWith("/api/users")&&r.request().method()==="POST")
    await dialog.getByRole("button",{name:"Create user",exact:true}).click();const result=await empty;expect(result.status()).toBe(200);await expect(dialog).toHaveCount(0);const unassigned=(await f.db.query('SELECT id FROM "User" WHERE "tenantId"=$1 AND email=$2',[f.slug,`unassigned@${f.slug}.test`])).rows[0]
    expect((await f.db.query('SELECT count(*)::int n FROM "BusinessOfficePolicy" WHERE "userId"=$1',[unassigned.id])).rows[0].n).toBe(0)
    expect((await f.db.query('SELECT count(*)::int n FROM "TenantRoleAssignment" WHERE "userId"=$1',[unassigned.id])).rows[0].n).toBe(0)
  }finally{await admin.context.close();await f.db.end()}
})

test("invitation form proposes explicit subsidiary coverage and acceptance applies it once", async ({ browser }) => {
  test.setTimeout(180_000)
  const f=await seed(),admin=await login(browser,f.origin,f.users.admin.email),page=admin.page,publicContext=await browser.newContext({baseURL:f.origin})
  let invited:Awaited<ReturnType<typeof login>>|undefined
  try {
    const parent=await json(admin.context,"/api/companies",201,"POST",{name:"Invitation group",code:"INV_GROUP"})
    const child=await json(admin.context,"/api/companies",201,"POST",{name:"Invitation region",code:"INV_REGION",parentId:parent.id})
    await json(admin.context,"/api/offices",201,"POST",{name:"Invitation HQ",code:"INV_HQ",companyId:parent.id})
    const branch=await json(admin.context,"/api/offices",201,"POST",{name:"Invitation branch",code:"INV_BRANCH",companyId:child.id})
    await page.goto("/users/invites");await page.getByRole("button",{name:"Invite user",exact:true}).click()
    const dialog=page.getByRole("dialog",{name:"Invite user",exact:true}),email=`office-invite@${f.slug}.test`
    await dialog.getByLabel("Email",{exact:true}).fill(email);await dialog.getByLabel("Role",{exact:true}).selectOption("STAFF")
    await pick(page,"Add access profile","Account fixture access")
    await dialog.getByLabel("Delivery",{exact:true}).selectOption("LINK")
    await pick(page,"Add company","Invitation group")
    await page.getByRole("combobox",{name:"Creation office",exact:true}).click();await page.getByPlaceholder("Type to search...").fill("Invitation branch")
    await expect(page.getByText("0 eligible offices",{exact:true})).toBeVisible();await expect(page.getByRole("option",{name:/Invitation branch/})).toHaveCount(0)
    await page.keyboard.press("Escape");await expect(page.getByRole("listbox")).toHaveCount(0)
    await page.getByRole("checkbox",{name:"Include subsidiary companies for Invitation group",exact:true}).check()
    await pick(page,"Creation office","Invitation branch")
    await expect(dialog.getByRole("button",{name:"Create invite link",exact:true})).toBeEnabled()
    const before=await countUsers(f)
    await page.getByLabel("Company office grants").scrollIntoViewIfNeeded()
    await page.screenshot({path:"test-results/local-access/office-onboarding-invite-desktop.png",animations:"disabled"})
    await page.setViewportSize({width:390,height:844})
    await page.getByRole("combobox",{name:"Creation office",exact:true}).scrollIntoViewIfNeeded()
    await expect(dialog.getByRole("button",{name:"Create invite link",exact:true})).toBeInViewport()
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
    await page.screenshot({path:"test-results/local-access/office-onboarding-invite-mobile.png",animations:"disabled"})
    const submitted=page.waitForResponse(r=>r.url().endsWith("/api/invites")&&r.request().method()==="POST")
    await dialog.getByRole("button",{name:"Create invite link",exact:true}).click();const response=await submitted;expect(response.status()).toBe(201)
    const result=await response.json();await expect(dialog).toHaveCount(0);expect(await countUsers(f)).toBe(before)
    const pending=(await f.db.query('SELECT "accessConfiguration" FROM "Invitation" WHERE "tenantId"=$1 AND email=$2',[f.slug,email])).rows[0]
    expect(pending.accessConfiguration.officeAccess).toEqual({officeIds:[],companies:[{companyId:parent.id,includeSubsidiaries:true}],creationOfficeId:branch.id})
    const acceptPage=await publicContext.newPage();await acceptPage.goto(result.inviteUrl)
    await acceptPage.getByLabel("Full name",{exact:true}).fill("Office invited staff");await acceptPage.getByLabel("Password",{exact:true}).fill(password)
    await acceptPage.getByRole("button",{name:"Create account",exact:true}).click();await expect(acceptPage.getByRole("button",{name:"Go to sign in",exact:true})).toBeVisible()
    invited=await login(browser,f.origin,email)
    const user=(await f.db.query('SELECT id FROM "User" WHERE "tenantId"=$1 AND email=$2',[f.slug,email])).rows[0]
    const saved=await json(admin.context,`/api/access/users/${user.id}/offices`)
    expect(saved.creationOfficeId).toBe(branch.id);expect(saved.offices).toHaveLength(0);expect(saved.companies[0].includeSubsidiaries).toBe(true)
    expect((await json(invited.context,"/api/workspace/office")).creationOffice.id).toBe(branch.id)
    expect((await json(invited.context,"/api/workspace/offices")).total).toBe(2)
    await acceptPage.goto(result.inviteUrl);await acceptPage.getByLabel("Password",{exact:true}).fill(password);await acceptPage.getByRole("button",{name:"Create account",exact:true}).click()
    await expect(acceptPage.getByText("Invitation is invalid or expired. Ask your administrator for a new invitation.",{exact:true})).toBeVisible()
    expect(await countUsers(f)).toBe(before+1)
  } finally {await invited?.context.close();await publicContext.close();await admin.context.close();await f.db.end()}
})


test("failed network requests preserve onboarding drafts and release form controls", async ({ browser }) => {
  const f=await seed(),admin=await login(browser,f.origin,f.users.admin.email),page=admin.page
  try {
    const before=await countUsers(f)
    await page.goto("/users");await page.getByRole("button",{name:"New user",exact:true}).click()
    let dialog=page.getByRole("dialog",{name:"Create user",exact:true})
    await dialog.getByLabel("Full name",{exact:true}).fill("Transport failure draft")
    const email=`network@${f.slug}.test`
    await dialog.getByLabel("Email",{exact:true}).fill(email);await dialog.getByLabel("Temporary password",{exact:true}).fill(password)
    await page.route("**/api/users",route=>route.request().method()==="POST"?route.abort("failed"):route.continue())
    await dialog.getByRole("button",{name:"Create user",exact:true}).click()
    await expect(page.getByText("Unable to confirm the request. Check the list before trying again.",{exact:true})).toBeVisible()
    await expect(dialog.getByLabel("Email",{exact:true})).toHaveValue(email)
    await expect(dialog.getByRole("button",{name:"Cancel",exact:true})).toBeEnabled()
    await dialog.getByRole("button",{name:"Cancel",exact:true}).click();await expect(dialog).toHaveCount(0)
    await page.unroute("**/api/users");expect(await countUsers(f)).toBe(before)
    await page.goto("/users/invites");await page.getByRole("button",{name:"Invite user",exact:true}).click()
    dialog=page.getByRole("dialog",{name:"Invite user",exact:true})
    await dialog.getByLabel("Email",{exact:true}).fill(email);await dialog.getByLabel("Delivery",{exact:true}).selectOption("LINK")
    await page.route("**/api/invites",route=>route.request().method()==="POST"?route.abort("failed"):route.continue())
    await dialog.getByRole("button",{name:"Create invite link",exact:true}).click()
    await expect(dialog.getByRole("button",{name:"Cancel",exact:true})).toBeEnabled()
    await expect(dialog.getByLabel("Email",{exact:true})).toHaveValue(email)
    await dialog.getByRole("button",{name:"Cancel",exact:true}).click();await expect(dialog).toHaveCount(0)
    expect((await f.db.query('SELECT count(*)::int n FROM "Invitation" WHERE "tenantId"=$1 AND email=$2',[f.slug,email])).rows[0].n).toBe(0)
  }finally{await admin.context.close();await f.db.end()}
})
