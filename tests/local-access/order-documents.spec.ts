import { test,expect,type BrowserContext } from '@playwright/test'
import { seed,login,json } from './fixtures'
import { emptyQuotationContent } from '../../modules/sales-documents/quotation-validation'

async function modules(f:Awaited<ReturnType<typeof seed>>,keys:string[]){for(const key of keys)await f.db.query('INSERT INTO "TenantModule" ("tenantId",key,allowed,enabled,"updatedAt") VALUES ($1,$2,true,true,now()) ON CONFLICT ("tenantId",key) DO UPDATE SET allowed=true,enabled=true',[f.slug,key])}
async function source(context:BrowserContext,userId:string,items:{id:string;version:number;name:string;price:string}[]=[]){
 const a=await json(context,'/api/crm/contacts',201,'POST',{name:'QA Document buyer'}),b=await json(context,'/api/crm/contacts',201,'POST',{name:'QA Document co-applicant'})
 const pipeline=await json(context,'/api/crm/pipelines',201,'POST',{name:'Document sales',stages:[{name:'Open',kind:'OPEN',probability:10,color:'#123456'},{name:'Won',kind:'WON',probability:100,color:'#00aa00'},{name:'Lost',kind:'LOST',probability:0,color:'#aa0000'}]})
 const deal=await json(context,'/api/crm/opportunities',201,'POST',{title:'QA document source',contactId:a.id,assignedUserId:userId,pipelineId:pipeline.id,stageId:pipeline.stages[0].id,amount:'300',currency:'INR',expectedCloseOn:'2027-01-01'})
 await json(context,`/api/crm/opportunities/${deal.id}/participants`,200,'PUT',{version:1,participants:[{role:'ADDITIONAL_CUSTOMER',party:{kind:'PERSON',id:b.id}}]})
 const quote=await json(context,`/api/crm/opportunities/${deal.id}/quotations`,201,'POST',{content:{...structuredClone(emptyQuotationContent),title:'QA accepted sale',supplierName:'QA Industries',currency:'INR',lines:items.length?items.map(item=>({description:item.name,quantity:'1',unit:'each',rate:String(item.price),catalogItemId:item.id,catalogItemVersion:item.version})):[{description:'Shared service',quantity:'1',unit:'each',rate:'300'}]}})
 const order=await json(context,'/api/sales-orders',200,'POST',{quotationId:quote.id,revision:1,orderedOn:'2026-01-01'})
 await json(context,`/api/sales-orders/${order.id}`,200,'PATCH',{action:'confirm',version:1})
 return order
}
async function publish(context:BrowserContext,companyId:string,providerKey:string){const current=await json(context,`/api/document-templates?${new URLSearchParams({companyId,providerKey})}`);await json(context,'/api/document-templates',200,'PUT',{companyId,providerKey,version:current.version,reviewed:true,content:{...current.content,enabled:true,address:'QA office, Pune',terms:'QA approved company terms'}})}

test('visual template editor inserts dynamic fields, previews without publication and persists a reviewed layout on mobile',async({browser})=>{
 test.setTimeout(180000)
 const f=await seed(),{page,context}=await login(browser,f.origin,f.users.admin.email)
 try{
  await modules(f,['salesOrders','catalog','realEstate'])
  await page.goto('/settings/documents')
  const editor=page.getByRole('textbox',{name:'Document layout',exact:true})
  await expect(editor).toBeVisible()
  await expect(page.getByLabel('Document type',{exact:true})).toBeEnabled()
  await page.getByLabel('Document type',{exact:true}).click();await page.getByRole('menuitemradio',{name:'Booking intimation letter',exact:true}).click()
  await expect(page.getByLabel('Document title',{exact:true})).toHaveValue('Booking intimation letter')
  await page.getByLabel('Document type',{exact:true}).click();await page.getByRole('menuitemradio',{name:'Order acknowledgement',exact:true}).click()
  await expect(page.getByLabel('Document title',{exact:true})).toHaveValue('Order acknowledgement')
  await page.getByRole('button',{name:'Add paragraph',exact:true}).click();await page.keyboard.type('Dear ')
  await page.getByLabel('Dynamic field',{exact:true}).click();await page.getByRole('menuitemradio',{name:'Customer name',exact:true}).click()
  await page.getByRole('button',{name:'Insert field',exact:true}).click()
  await expect(editor.getByText('Customer name',{exact:true})).toBeVisible()
  const previewRequest=page.waitForRequest(r=>r.url().endsWith('/api/document-templates/preview'))
  const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Download sample preview',exact:true}).click()
  const download=await downloading;await download.saveAs(test.info().outputPath('p8-template-sample.pdf'))
  const draft=(await previewRequest).postDataJSON();expect(JSON.stringify(draft.content.layout)).toContain('customer.name')
  const unchanged=await json(context,`/api/document-templates?${new URLSearchParams({companyId:draft.companyId,providerKey:draft.providerKey})}`)
  expect(unchanged.version).toBe(0)
  await page.getByRole('button',{name:'Use starter layout',exact:true}).click();await page.getByRole('button',{name:'Cancel',exact:true}).click()
  await expect(editor.getByText('Customer name',{exact:true})).toBeVisible()
  await page.getByLabel('Enable new issuance with this version').check();await page.getByLabel('I have reviewed the wording').check()
  await page.getByRole('button',{name:'Publish template version',exact:true}).click();await expect(page.getByRole('heading',{name:/version 1$/})).toBeVisible()
  await expect(page.getByLabel('Document type',{exact:true})).toBeEnabled()
  await page.reload();await expect(editor.getByText('Customer name',{exact:true})).toBeVisible()
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await editor.scrollIntoViewIfNeeded();await page.screenshot({path:test.info().outputPath('p8-template-editor-mobile.png'),fullPage:true,animations:'disabled'})
  await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:test.info().outputPath('p8-template-editor-desktop.png'),fullPage:true,animations:'disabled'})
 }finally{await context.close();await f.db.end()}
})

test('reviewed company template, generic preview, immutable issuance, stale draft and linked replacement on desktop/mobile',async({browser})=>{
 test.setTimeout(180000)
 const f=await seed(),{page,context}=await login(browser,f.origin,f.users.admin.email)
 try{
  await modules(f,['salesOrders']);await f.db.query('UPDATE "TenantModule" SET enabled=false WHERE "tenantId"=$1 AND key=\'realEstate\'',[f.slug])
  const order=await source(context,f.users.staff.id),company=(await json(context,'/api/document-templates/catalog')).items[0]
  await page.goto('/settings/documents')
  await expect(page.getByRole('heading',{name:'Company document templates'})).toBeVisible()
  await expect(page.getByLabel('Document title',{exact:true})).toHaveValue('Order acknowledgement')
  await page.getByLabel('Issuing company address',{exact:true}).fill('QA office\nPune, India')
  await page.getByLabel('Terms and notes',{exact:true}).fill('QA reviewed plain company terms.')
  await page.getByLabel('Enable new issuance with this version').check()
  await page.getByLabel('I have reviewed the wording').check()
  await page.getByRole('button',{name:'Publish template version',exact:true}).click()
  await expect(page.getByRole('heading',{name:new RegExp('version 1$')})).toBeVisible()
  await page.goto(`/sales-orders/${order.id}`)
  await page.getByRole('button',{name:'Prepare document',exact:true}).click()
  await expect(page.getByRole('button',{name:'Download draft preview',exact:true})).toBeVisible()
  const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Download draft preview',exact:true}).click();const download=await downloading;await download.saveAs(test.info().outputPath('generic-draft.pdf'))
  // A new template version invalidates only this prepared review, preserving its draft.
  await publish(context,company.id,'order-acknowledgement')
  await page.getByRole('button',{name:'Issue document',exact:true}).click();await page.getByRole('button',{name:'Confirm issuance',exact:true}).click()
  await expect(page.getByRole('alert').filter({hasText:'The document facts changed.'})).toBeVisible()
  await expect(page.getByRole('button',{name:'Refresh prepared preview',exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Refresh prepared preview',exact:true}).click()
  await page.getByRole('button',{name:'Issue document',exact:true}).click();await page.getByRole('button',{name:'Confirm issuance',exact:true}).click()
  const issued=page.getByRole('link',{name:'Download issued PDF',exact:true});await expect(issued).toHaveCount(1)
  const firstHref=await issued.getAttribute('href'),response=await context.request.get(firstHref!,{maxRedirects:0});expect(response.status()).toBe(303);expect(response.headers().location).toContain('documentstest.supabase.co')
  await page.getByLabel('Replacement reason',{exact:true}).fill('QA corrected company wording')
  await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Prepare document',exact:true}).click();await expect(page.getByRole('button',{name:'Download draft preview',exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.screenshot({path:test.info().outputPath('order-document-prepare-mobile.png'),fullPage:true,animations:'disabled'})
  await page.getByRole('button',{name:'Issue document',exact:true}).click();await page.getByRole('button',{name:'Confirm issuance',exact:true}).click();await expect(issued).toHaveCount(2)
  await expect(page.getByText(/ACK\/001 - replaced version/)).toBeVisible()
  expect((await context.request.get(firstHref!,{maxRedirects:0})).status()).toBe(303)
  await page.setViewportSize({width:1280,height:900});await page.screenshot({path:test.info().outputPath('order-document-history-desktop.png'),fullPage:true,animations:'disabled'})
 }finally{await context.close();await f.db.end()}
})

test('two-unit Real Estate letters preserve repeatable applicants and require allocation independently from payment',async({browser})=>{
 test.setTimeout(180000)
 const f=await seed(),{page,context}=await login(browser,f.origin,f.users.admin.email)
 try{
  await modules(f,['salesOrders','catalog','receivables'])
  const project=await json(context,'/api/real-estate/projects',201,'POST',{name:'QA Property Garden',code:'QA-PG',location:'QA Pune'})
  const category=(await f.db.query('SELECT id FROM "RealEstatePropertyCategory" WHERE "tenantId"=$1 AND "nameKey"=\'apartment\'',[f.slug])).rows[0]
  const items=[]
  for(let i=1;i<=2;i++)items.push(await json(context,'/api/catalog/items',201,'POST',{code:`QA-P${i}`,name:`QA Property ${i}`,kind:'UNIT',price:String(i*100),currency:'INR',unit:'each',extensionKey:'realEstate',extension:{projectId:project.id,categoryId:category.id,area:String(1200+i*100),areaUnit:'SQ_FT',bedrooms:2}}))
  const order=await source(context,f.users.admin.id,items),endpoint=`/api/sales-orders/${order.id}/documents`,company=(await json(context,'/api/document-templates/catalog')).items[0]
  for(const provider of ['real-estate.booking-intimation','real-estate.unit-allotment'])await publish(context,company.id,provider)
  const held=[];for(const item of items)held.push(await json(context,`/api/sales-orders/${order.id}/reservations`,200,'POST',{itemId:item.id,expiresAt:new Date(Date.now()+86400000).toISOString()}))
  const bi=await json(context,`${endpoint}/prepare`,200,'POST',{providerKey:'real-estate.booking-intimation'})
  await json(context,`${endpoint}/issue`,200,'POST',{providerKey:bi.providerKey,previewHash:bi.previewHash,requestKey:crypto.randomUUID()})
  await json(context,`${endpoint}/prepare`,409,'POST',{providerKey:'real-estate.unit-allotment'})
  for(const row of held)await json(context,`/api/sales-orders/${order.id}/reservations/${row.id}`,200,'PATCH',{action:'allocate',version:1})
  await page.goto(`/sales-orders/${order.id}`)
  await page.getByRole('button',{name:'Document type',exact:true}).click();await page.getByRole('menuitemradio',{name:'Unit allotment letter',exact:true}).click()
  await page.getByRole('button',{name:'Prepare document',exact:true}).click()
  await expect(page.getByText(/Unit allotment letter - SO-/)).toBeVisible()
  const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Download draft preview',exact:true}).click();await (await downloading).saveAs(test.info().outputPath('allotment-draft.pdf'))
  await page.getByRole('button',{name:'Issue document',exact:true}).click();await page.getByRole('button',{name:'Confirm issuance',exact:true}).click();await expect(page.getByRole('link',{name:'Download issued PDF',exact:true})).toHaveCount(2)
  await page.screenshot({path:test.info().outputPath('property-document-history-desktop.png'),fullPage:true,animations:'disabled'})
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:test.info().outputPath('property-document-history-mobile.png'),fullPage:true,animations:'disabled'})
 }finally{await context.close();await f.db.end()}
})
