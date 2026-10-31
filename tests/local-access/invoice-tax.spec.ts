import { test,expect } from '@playwright/test'
import { seed,login,json } from './fixtures'
import { emptyQuotationContent } from '../../modules/sales-documents/quotation-validation'

test('tax-aware partial billing and credit freeze original component allocations',async({browser},info)=>{
 test.setTimeout(180_000)
 const f=await seed(),a=await login(browser,f.origin,f.users.admin.email)
 let staff:Awaited<ReturnType<typeof login>>|undefined
 try{
  await f.db.query('INSERT INTO "TenantModule"("tenantId",key,allowed,enabled,"updatedAt") SELECT $1,k,true,true,now() FROM unnest(ARRAY[\'salesOrders\',\'receivables\',\'invoicing\']) k',[f.slug])
  const w=await json(a.context,'/api/workspace/office'),office=w.creationOffice,companyId=office.companyId
  const issuer=await json(a.context,'/api/tax-configuration/registrations',201,'POST',{companyId,scheme:'IN_GST',registrationNumber:'27AAPFU0939F1ZV',label:'QA source issuer',legalName:'QA Source Industries',addressLine1:'QA street',addressLine2:'',city:'Pune',postalCode:'411001',effectiveFrom:'2026-01-01',effectiveTo:null,category:'REGULAR',eInvoicePolicy:'UNASSESSED',archived:false,reviewed:true})
  await json(a.context,`/api/tax-configuration/offices/${office.id}`,200,'PUT',{version:0,registrationId:issuer.id})
  const contact=await json(a.context,'/api/crm/contacts',201,'POST',{name:'QA source customer'})
  await json(a.context,`/api/crm/contacts/${contact.id}/tax-identities`,200,'POST',{scheme:'IN_GST',status:'UNREGISTERED',registrationNumber:'',regionCode:'29',category:'NOT_APPLICABLE',legalName:'QA customer tax identity',addressLine1:'QA customer street',addressLine2:'',city:'Bengaluru',postalCode:'560001',effectiveFrom:'2026-01-01',effectiveTo:null,archived:false,reviewed:true})
  const rate=(await json(a.context,'/api/settings/taxes',201,'POST',{name:'QA source tax rate',percent:'18'})).tax
  await json(a.context,'/api/tax-configuration/profiles',200,'POST',{companyId,code:'QA-SOURCE',version:0,reviewed:true,body:{name:'QA source profile',scheme:'IN_GST',enabled:true,supplyKind:'SERVICES',treatment:'TAXABLE',classificationKind:'SAC',classificationCode:'998311',basisReference:'QA synthetic supply evidence',priceBasis:'INCLUSIVE',zeroRatedMode:'NOT_APPLICABLE',variants:[{key:'INTER_STATE',components:[{code:'IGST',rateId:rate.id}]}]}})
  const pipeline=f.slug+'-pipeline',stage=f.slug+'-stage'
  await f.db.query('INSERT INTO "CrmPipeline"(id,"tenantId",name,"updatedAt") VALUES($1,$2,\'QA source sales\',now())',[pipeline,f.slug]);await f.db.query('INSERT INTO "CrmStage"(id,"tenantId","pipelineId",name,position,probability,color) VALUES($1,$2,$3,\'Open\',0,10,\'#123456\')',[stage,f.slug,pipeline])
  const deal=await json(a.context,'/api/crm/opportunities',201,'POST',{title:'QA generic agreement',contactId:contact.id,assignedUserId:f.users.staff.id,pipelineId:pipeline,stageId:stage,amount:'118',currency:'INR',expectedCloseOn:'2027-01-01'})
  const q=await json(a.context,`/api/crm/opportunities/${deal.id}/quotations`,201,'POST',{content:{...emptyQuotationContent,supplierName:'QA Source Industries',currency:'INR',lines:[{description:'Shared service',quantity:'1',unit:'each',rate:'118'}]}}),before=await json(a.context,`/api/crm/quotations/${q.id}`)
  const cross=await a.context.request.post(`/api/crm/quotations/${q.id}/tax-inputs`,{headers:{origin:'https://untrusted.example.test'},data:{}});expect(cross.status()).toBe(403)
  await a.page.goto(`/crm/quotations/${q.id}`);await a.page.getByRole('tab',{name:'Tax preparation',exact:true}).click()
  await expect(a.page.getByText(/Mapped issuer: QA Source Industries/)).toBeVisible()
  await a.page.getByLabel('Proposed supply date',{exact:true}).fill('2026-10-01')
  await a.page.locator('#tax-input-recipient').click();await a.page.getByRole('option',{name:/QA customer tax identity/}).click()
  await a.page.locator('#tax-input-profile-0').click();await a.page.getByRole('option',{name:/QA source profile/}).click()
  await a.page.getByLabel('Line 1 place-of-supply state/territory code',{exact:true}).fill('29');await a.page.getByLabel('Line 1 reviewed place-of-supply basis',{exact:true}).fill('QA customer-confirmed delivery and reviewed source location.')
  await expect(a.page.getByRole('button',{name:'Save reviewed tax inputs',exact:true})).toBeDisabled()
  await a.page.getByText('I reviewed the identities, dates, profile versions and place-of-supply evidence. This preparation does not approve tax-aware pricing.',{exact:true}).click()
  await a.page.getByRole('button',{name:'Save reviewed tax inputs',exact:true}).click();await expect(a.page.getByRole('heading',{name:'Prepared tax inputs — immutable',exact:true})).toBeVisible()
  await expect(a.page.getByText(/Illustrated gross: INR 118.00/)).toBeVisible();await a.page.screenshot({path:info.outputPath('source-tax-desktop.png'),fullPage:true,animations:'disabled'})
  await a.page.setViewportSize({width:390,height:844});await a.page.screenshot({path:info.outputPath('source-tax-mobile.png'),fullPage:true,animations:'disabled'});expect(await a.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  expect((await json(a.context,`/api/crm/quotations/${q.id}`)).snapshot).toEqual(before.snapshot)
  const blocked=await a.context.request.post('/api/sales-orders',{headers:{origin:f.origin},data:{quotationId:q.id,revision:1}});expect(blocked.status(),await blocked.text()).toBe(409)
  await a.page.setViewportSize({width:1440,height:1050})
  await a.page.getByLabel('Pricing review basis',{exact:true}).fill('QA confirmed fixed gross customer agreement and reviewed tax-inclusive basis.')
  await expect(a.page.getByRole('button',{name:'Approve reconciled pricing',exact:true})).toBeDisabled()
  await a.page.getByText('I reviewed the pricing basis, allocated discounts and tax breakdown, and confirm they reconcile with the unchanged agreed amount.',{exact:true}).click()
  await a.page.getByRole('button',{name:'Approve reconciled pricing',exact:true}).click()
  await expect(a.page.getByRole('heading',{name:'Approved tax-aware pricing',exact:true})).toBeVisible()
  await a.page.screenshot({path:info.outputPath('pricing-approved-desktop.png'),fullPage:true,animations:'disabled'})
  const orderResponse=await a.context.request.post('/api/sales-orders',{headers:{origin:f.origin},data:{quotationId:q.id,revision:1}});expect(orderResponse.status(),await orderResponse.text()).toBe(200);const order=await orderResponse.json()
  const accepted=await json(a.context,`/api/sales-orders/${order.id}/tax-agreement`);expect(accepted.acceptance.snapshot.agreement.grossMinor).toBe(11800)
  await a.page.goto(`/sales-orders/${order.id}`);await expect(a.page.getByRole('heading',{name:'Accepted tax agreement',exact:true})).toBeVisible()
  await a.page.setViewportSize({width:390,height:844});expect(await a.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await a.page.screenshot({path:info.outputPath('tax-order-mobile.png'),fullPage:true,animations:'disabled'})


  await json(a.context,`/api/sales-orders/${order.id}`,200,'PATCH',{action:'confirm',version:1})
  await json(a.context,`/api/sales-orders/${order.id}/receivables`,200,'POST',{dueDates:[null]})
  await a.page.setViewportSize({width:1440,height:1050});await a.page.goto(`/sales-orders/${order.id}`)
  await a.page.getByRole('button',{name:'Create invoice draft',exact:true}).click();await a.page.getByLabel('Bill by',{exact:true}).selectOption('AMOUNT');await a.page.getByLabel('Invoice amount',{exact:true}).fill('50');await a.page.getByRole('button',{name:'Create draft',exact:true}).click();await expect(a.page).toHaveURL(/\/sales-orders\/invoices\//)
  const invoiceId=a.page.url().split('/').pop()!;await expect(a.page.getByRole('heading',{name:'Frozen tax allocation',exact:true})).toBeVisible();await a.page.getByRole('button',{name:'Post invoice',exact:true}).click();await a.page.getByRole('button',{name:'Confirm posting',exact:true}).click();await expect(a.page.getByRole('heading',{name:/INV\//})).toBeVisible()
  await a.page.getByRole('region',{name:'Frozen invoice tax allocation',exact:true}).screenshot({path:info.outputPath('invoice-tax-desktop.png'),animations:'disabled'})
  const first=await json(a.context,`/api/customer-invoices/${invoiceId}`),last=await json(a.context,`/api/sales-orders/${order.id}/invoices`,200,'POST',{requestKey:crypto.randomUUID(),invoiceDate:order.orderedOn.slice(0,10),dueOn:null,note:'Final portion',billing:{mode:'BALANCE',label:''}})
  expect(first.billing.tax.netMinor+last.billing.tax.netMinor).toBe(10000);expect(first.billing.tax.taxMinor+last.billing.tax.taxMinor).toBe(1800)
  await a.page.getByRole('button',{name:'Full credit note',exact:true}).click();await a.page.getByLabel('Credit date',{exact:true}).fill(order.orderedOn.slice(0,10));await a.page.getByLabel('Reason',{exact:true}).fill('QA exact component credit');await a.page.getByRole('button',{name:'Confirm full credit',exact:true}).click();await expect(a.page.getByRole('heading',{name:'Reversed tax allocation',exact:true})).toBeVisible();await a.page.setViewportSize({width:390,height:844});expect(await a.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await a.page.getByRole('region',{name:'Frozen invoice tax allocation',exact:true}).last().screenshot({path:info.outputPath('invoice-tax-credit-mobile.png'),animations:'disabled'})
  const credit=await json(a.context,`/api/customer-invoices/${invoiceId}`);expect(credit.creditTax.snapshot).toEqual(first.billing.tax);const documents=await json(a.context,`/api/customer-invoices/${invoiceId}/documents`);expect(documents.canIssue).toBe(false);expect(documents.providers).toHaveLength(0)
  staff=await login(browser,f.origin,f.users.staff.email);await staff.page.goto(`/crm/quotations/${q.id}`);await staff.page.getByRole('tab',{name:'Tax preparation',exact:true}).click();await expect(staff.page.getByRole('heading',{name:'Prepared tax inputs — immutable',exact:true})).toBeVisible();await expect(staff.page.getByRole('button',{name:'Save reviewed tax inputs',exact:true})).toHaveCount(0)
  await json(staff.context,`/api/crm/quotations/${q.id}/tax-inputs/choices?revision=1&kind=profiles`,403)
 }finally{await staff?.context.close();await a.context.close();await f.db.end()}
})
