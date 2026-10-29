import { test,expect } from '@playwright/test'
import { seed,login,json } from './fixtures'
import { emptyQuotationContent } from '../../modules/sales-documents/quotation-validation'

test('posted partial payment issues a receipt, preserves the balance, then warns on historical download after refund',async({browser})=>{
 test.setTimeout(180000)
 const f=await seed(),{context,page}=await login(browser,f.origin,f.users.admin.email)
 try{
  page.setDefaultTimeout(15000)
  await f.db.query('INSERT INTO "TenantModule" ("tenantId",key,allowed,enabled,"updatedAt") VALUES ($1,\'salesOrders\',true,true,now()),($1,\'receivables\',true,true,now())',[f.slug])
  const contact=await json(context,'/api/crm/contacts',201,'POST',{name:'QA Receipt Customer'}),pipeline=await json(context,'/api/crm/pipelines',201,'POST',{name:'QA receipt sales',stages:[{name:'Open',kind:'OPEN',probability:10,color:'#123456'},{name:'Won',kind:'WON',probability:100,color:'#00aa00'},{name:'Lost',kind:'LOST',probability:0,color:'#aa0000'}]})
  const deal=await json(context,'/api/crm/opportunities',201,'POST',{title:'QA generic receipt source',contactId:contact.id,assignedUserId:f.users.admin.id,pipelineId:pipeline.id,stageId:pipeline.stages[0].id,amount:'100',currency:'INR',expectedCloseOn:'2027-01-01'}),quote=await json(context,`/api/crm/opportunities/${deal.id}/quotations`,201,'POST',{content:{...structuredClone(emptyQuotationContent),supplierName:'QA Shared Industries',currency:'INR',lines:[{description:'Shared service',quantity:'1',unit:'each',rate:'100'}],instalments:[{label:'Initial',percent:'20',days:0,note:''},{label:'Balance',percent:'80',days:30,note:''}]}})
  const order=await json(context,'/api/sales-orders',200,'POST',{quotationId:quote.id,revision:1,orderedOn:'2026-01-01'});await json(context,`/api/sales-orders/${order.id}`,200,'PATCH',{action:'confirm',version:1})
  await json(context,`/api/sales-orders/${order.id}/receivables`,200,'POST',{dueDates:[null,null]})
  const payment=await json(context,`/api/sales-orders/${order.id}/receivables/payments`,200,'POST',{requestKey:crypto.randomUUID(),version:1,amount:'30',receivedOn:'2026-01-01',method:'BANK_TRANSFER',reference:'QA-TXN',note:''}),endpoint=`/api/payment-receipts/${payment.id}/documents`
  const company=(await json(context,'/api/document-templates/catalog')).items[0],current=await json(context,`/api/document-templates?${new URLSearchParams({companyId:company.id,providerKey:'payment-receipt'})}`)
  await page.goto('/settings/documents');await page.getByLabel('Document type',{exact:true}).click();await page.getByRole('menuitemradio',{name:'Payment receipt',exact:true}).click();await expect(page.getByLabel('Document title',{exact:true})).toHaveValue('Payment receipt')
  await page.getByLabel('Issuing company address',{exact:true}).fill('QA office, Pune');await page.getByLabel('Enable new issuance with this version').check();await page.getByLabel('I have reviewed the wording').check();await page.getByRole('button',{name:'Publish template version',exact:true}).click();await expect(page.getByRole('heading',{name:/version 1$/})).toBeVisible()
  expect(current.version).toBe(0)
  await page.goto(`/sales-orders/${order.id}`)
  const card=page.getByRole('article',{name:'Payment QA-TXN',exact:true});await card.getByRole('button',{name:'Receipt documents',exact:true}).click()
  const receipt=card.getByRole('region',{name:'Payment receipt documents',exact:true})
  await receipt.getByRole('button',{name:'Prepare document',exact:true}).click();await expect(receipt.getByRole('button',{name:'Download draft preview',exact:true})).toBeVisible()
  const downloading=page.waitForEvent('download');await receipt.getByRole('button',{name:'Download draft preview',exact:true}).click();await(await downloading).saveAs(test.info().outputPath('receipt-draft.pdf'));expect((await json(context,endpoint)).total).toBe(0)
  await receipt.getByRole('button',{name:'Issue document',exact:true}).click();await page.getByRole('button',{name:'Confirm issuance',exact:true}).click();await expect(receipt.getByRole('link',{name:'Download issued PDF',exact:true})).toHaveCount(1)
  const issued=(await json(context,endpoint)).items[0],state=await json(context,`/api/sales-orders/${order.id}/receivables`);expect(state.paid).toBe('30');expect(state.outstanding).toBe('70');expect(state.account.version).toBe(2)
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await receipt.scrollIntoViewIfNeeded();await page.screenshot({path:test.info().outputPath('receipt-issued-mobile.png'),fullPage:true,animations:'disabled'})
  await json(context,`/api/sales-orders/${order.id}/receivables/payments/${payment.id}/reverse`,200,'POST',{requestKey:crypto.randomUUID(),version:2,kind:'REFUND',reason:'QA refund',reference:'QA-REFUND',effectiveOn:'2026-01-01'})
  await page.reload();await card.getByRole('button',{name:'Receipt documents',exact:true}).click();await expect(receipt.getByRole('status')).toContainText('payment was reversed');await expect(receipt.getByRole('button',{name:'Prepare document',exact:true})).toHaveCount(0)
  const silent=await context.request.get(`${endpoint}/${issued.id}/pdf?providerKey=payment-receipt`,{maxRedirects:0});expect(silent.status()).toBe(409)
  const historical=receipt.getByRole('link',{name:'Download historical original PDF',exact:true}),href=await historical.getAttribute('href');expect(href).toContain('acknowledgeReversal=true');expect((await context.request.get(href!,{maxRedirects:0})).status()).toBe(303)
  await page.setViewportSize({width:1440,height:1000});await receipt.scrollIntoViewIfNeeded();await page.screenshot({path:test.info().outputPath('receipt-reversed-desktop.png'),fullPage:true,animations:'disabled'})
 }finally{await context.close();await f.db.end()}
})
