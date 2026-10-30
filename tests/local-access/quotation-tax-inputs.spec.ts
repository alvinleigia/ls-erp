import { test,expect } from '@playwright/test'
import { seed,login,json } from './fixtures'
import { emptyQuotationContent } from '../../modules/sales-documents/quotation-validation'

test('quotation tax preparation captures reviewed source facts and remains readable without tax administration',async({browser},info)=>{
 test.setTimeout(180_000)
 const f=await seed(),a=await login(browser,f.origin,f.users.admin.email)
 let staff:Awaited<ReturnType<typeof login>>|undefined
 try{
  await f.db.query('INSERT INTO "TenantModule"("tenantId",key,allowed,enabled,"updatedAt") VALUES($1,\'salesOrders\',true,true,now())',[f.slug])
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
  staff=await login(browser,f.origin,f.users.staff.email);await staff.page.goto(`/crm/quotations/${q.id}`);await staff.page.getByRole('tab',{name:'Tax preparation',exact:true}).click();await expect(staff.page.getByRole('heading',{name:'Prepared tax inputs — immutable',exact:true})).toBeVisible();await expect(staff.page.getByRole('button',{name:'Save reviewed tax inputs',exact:true})).toHaveCount(0)
  await json(staff.context,`/api/crm/quotations/${q.id}/tax-inputs/choices?revision=1&kind=profiles`,403)
 }finally{await staff?.context.close();await a.context.close();await f.db.end()}
})
