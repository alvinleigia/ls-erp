import { test, expect, type Page } from "@playwright/test"
import { seed, login, json, assignProfiles } from "./fixtures"

test.use({ actionTimeout: 15_000 })

async function pick(page: Page, name: string) {
  await page.getByRole("combobox", { name: "Choose participant", exact: true }).click()
  await page.getByPlaceholder("Type to search...").fill(name)
  await page.getByRole("option", { name, exact: true }).click()
}
test("participants use a generic repeatable editor, preserve conflict drafts and saved unavailable references on desktop/mobile", async ({ browser }) => {
  test.setTimeout(180_000)
  const f = await seed(), admin = await login(browser, f.origin, f.users.admin.email), { page, context } = admin
  try {
    await f.db.query('UPDATE "TenantModule" SET enabled=false WHERE "tenantId"=$1 AND key=\'realEstate\'', [f.slug])
    const primary = await json(context, "/api/crm/contacts", 201, "POST", { name: "Primary customer" })
    const extra = await json(context, "/api/crm/contacts", 201, "POST", { name: "Additional customer" })
    await json(context, "/api/crm/contacts", 201, "POST", { name: "Second representative" })
    const pipeline = `${f.slug}-pipeline`, stage = `${f.slug}-stage`
    await f.db.query('INSERT INTO "CrmPipeline" (id,"tenantId",name,"updatedAt") VALUES ($1,$2,\'Generic sales\',now())', [pipeline,f.slug])
    await f.db.query('INSERT INTO "CrmStage" (id,"tenantId","pipelineId",name,position,probability,color) VALUES ($1,$2,$3,\'Open\',0,10,\'#123456\')', [stage,f.slug,pipeline])
    const deal = await json(context,"/api/crm/opportunities",201,"POST",{title:"Shared customer transaction",contactId:primary.id,assignedUserId:f.users.admin.id,pipelineId:pipeline,stageId:stage,amount:"100",currency:"INR",expectedCloseOn:"2027-01-01"})
    const endpoint = `/api/crm/opportunities/${deal.id}/participants`
    await page.goto(`/crm/opportunities/${deal.id}`)
    await expect(page.getByRole("heading",{name:"Shared customer transaction",exact:true})).toBeVisible()
    // Another editor changes the root after this page loads. The participant
    // tab reads the new version; saving must reload all root fields with it.
    await json(context,`/api/crm/opportunities/${deal.id}`,200,"PATCH",{title:"Changed by another editor",contactId:primary.id,accountId:"",assignedUserId:f.users.admin.id,pipelineId:pipeline,stageId:stage,amount:"150",currency:"INR",expectedCloseOn:"2027-01-01",version:deal.version})
    await page.getByRole("tab",{name:"Participants",exact:true}).click()
    await expect(page.getByText("Main customer · Person",{exact:true})).toBeVisible()
    await page.getByRole("button",{name:"Edit participants",exact:true}).click()
    await pick(page,"Additional customer");await page.getByRole("button",{name:"Add participant",exact:true}).click()
    await pick(page,"Second representative");await page.getByRole("button",{name:"Add participant",exact:true}).click()
    await page.getByRole("button",{name:"Role for Second representative",exact:true}).click()
    await page.getByRole("menuitemradio",{name:"Representative",exact:true}).click()
    await page.screenshot({path:test.info().outputPath("participants-desktop-edit.png"),fullPage:true})
    await page.getByRole("button",{name:"Save participants",exact:true}).click()
    await expect(page.getByRole("dialog",{name:"Edit participants",exact:true})).toHaveCount(0)
    expect((await json(context,endpoint)).participants.map((row:{role:string})=>row.role)).toEqual(["ADDITIONAL_CUSTOMER","REPRESENTATIVE"])
    await page.getByRole("tab",{name:"Overview",exact:true}).click()
    await page.getByRole("button",{name:"Edit opportunity details",exact:true}).click()
    await page.getByLabel("Opportunity title",{exact:true}).fill("After participant synchronization")
    await page.getByRole("button",{name:"Save changes",exact:true}).click()
    await expect(page.getByRole("dialog")).toHaveCount(0)
    expect((await json(context,`/api/crm/opportunities/${deal.id}`)).amount).toBe("150")
    await page.reload();await page.getByRole("tab",{name:"Participants",exact:true}).click()
    await expect(page.getByText("Second representative",{exact:true})).toBeVisible()
    await page.getByRole("button",{name:"Edit participants",exact:true}).click()
    await page.getByRole("button",{name:"Remove Additional customer",exact:true}).click()
    const current=await json(context,endpoint)
    await json(context,endpoint,200,"PUT",{version:current.version,participants:current.participants.map((row:{role:string;party:{kind:string;id:string}})=>({role:row.role,party:{kind:row.party.kind,id:row.party.id}}))})
    const failed=page.waitForResponse(response=>response.url().endsWith(endpoint)&&response.request().method()==="PUT")
    await page.getByRole("button",{name:"Save participants",exact:true}).click();expect((await failed).status()).toBe(409)
    await expect(page.getByRole("dialog",{name:"Edit participants",exact:true}).getByRole("alert")).toContainText("changed")
    await expect(page.getByRole("button",{name:"Remove Additional customer",exact:true})).toHaveCount(0)
    await expect(page.getByRole("button",{name:"Remove Second representative",exact:true})).toBeVisible()
    await expect(page.getByRole("button",{name:"Save participants",exact:true})).toBeDisabled()
    await page.setViewportSize({width:390,height:844})
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
    await page.screenshot({path:test.info().outputPath("participants-mobile-conflict.png"),fullPage:true})
    page.once("dialog",dialog=>dialog.accept())
    await page.getByRole("button",{name:"Reload saved participants",exact:true}).click()
    await expect(page.getByText("Additional customer",{exact:true})).toBeVisible()
    await f.db.query('UPDATE "CrmContact" SET archived=true WHERE id=$1',[extra.id])
    await page.reload();await page.getByRole("tab",{name:"Participants",exact:true}).click()
    await expect(page.getByText("Saved selection. Unavailable for a new selection or refresh.",{exact:true})).toBeVisible()
    await page.screenshot({path:test.info().outputPath("participants-mobile-saved.png"),fullPage:true})
    await page.getByRole("button",{name:"Edit participants",exact:true}).click()
    await page.getByRole("button",{name:"Remove Additional customer",exact:true}).click()
    await page.getByRole("button",{name:"Save participants",exact:true}).click()
    await expect(page.getByRole("dialog",{name:"Edit participants",exact:true})).toHaveCount(0)
    expect((await json(context,endpoint)).participants).toHaveLength(1)
    // The next ordinary root edit must use the participant save's new version.
    await page.getByRole("tab",{name:"Overview",exact:true}).click()
    await page.getByRole("button",{name:"Edit opportunity details",exact:true}).click()
    await page.getByLabel("Opportunity title",{exact:true}).fill("After participant edit")
    await page.getByRole("button",{name:"Save changes",exact:true}).click()
    await expect(page.getByRole("dialog")).toHaveCount(0)
    expect((await json(context,`/api/crm/opportunities/${deal.id}`)).title).toBe("After participant edit")
  } finally { await context.close(); await f.db.end() }
})

test("Real Estate supplies applicant labels and a source reader sees saved rows without directory or edit access", async ({ browser }) => {
  const f=await seed(),admin=await login(browser,f.origin,f.users.admin.email)
  let reader: Awaited<ReturnType<typeof login>> | undefined
  try{
    const context=admin.context
    const person=await json(context,"/api/crm/contacts",201,"POST",{name:"Primary applicant"})
    const extra=await json(context,"/api/crm/contacts",201,"POST",{name:"Saved co-applicant"})
    const pipeline=`${f.slug}-pipeline`,stage=`${f.slug}-stage`
    await f.db.query('INSERT INTO "CrmPipeline" (id,"tenantId",name,"updatedAt") VALUES ($1,$2,\'Applicant sales\',now())',[pipeline,f.slug])
    await f.db.query('INSERT INTO "CrmStage" (id,"tenantId","pipelineId",name,position,probability,color) VALUES ($1,$2,$3,\'Open\',0,10,\'#123456\')',[stage,f.slug,pipeline])
    const deal=await json(context,"/api/crm/opportunities",201,"POST",{title:"Applicant label check",contactId:person.id,assignedUserId:f.users.staff.id,pipelineId:pipeline,stageId:stage,amount:"100",currency:"INR",expectedCloseOn:"2027-01-01"})
    const endpoint=`/api/crm/opportunities/${deal.id}/participants`
    await json(context,endpoint,200,"PUT",{version:1,participants:[{role:"ADDITIONAL_CUSTOMER",party:{kind:"PERSON",id:extra.id}}]})
    const role=await json(context,"/api/access/roles",201,"POST",{name:"Participant reader",permissions:["opportunities.read"]})
    await assignProfiles(context,f.users.staff.id,[role.id])
    reader=await login(browser,f.origin,f.users.staff.email)
    await reader.page.goto(`/crm/opportunities/${deal.id}`)
    await reader.page.getByRole("tab",{name:"Participants",exact:true}).click()
    await expect(reader.page.getByText("Primary applicant · Person",{exact:true})).toBeVisible()
    await expect(reader.page.getByText("Co-applicant · Person",{exact:true})).toBeVisible()
    await expect(reader.page.getByText("Saved co-applicant",{exact:true})).toBeVisible()
    await expect(reader.page.getByRole("button",{name:"Edit participants",exact:true})).toHaveCount(0)
    await json(reader.context,endpoint,403,"PUT",{version:2,participants:[]})
    await json(reader.context,`${endpoint}/choices?kind=PERSON`,403)
    await reader.page.screenshot({path:test.info().outputPath("participants-readonly-applicants.png"),fullPage:true})
  }finally{await reader?.context.close();await admin.context.close();await f.db.end()}
})
