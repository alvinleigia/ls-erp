import { test,expect } from '@playwright/test'
import { seed,login,json } from './fixtures'

test('saved profile preview reconciles partial amounts, rejects stale versions and works on mobile',async({browser},info)=>{
 test.setTimeout(180_000)
 const f=await seed(),a=await login(browser,f.origin,f.users.admin.email)
 let staff:Awaited<ReturnType<typeof login>>|undefined
 try{
  const company=(await json(a.context,'/api/companies')).items[0],rates=[]
  for(let i=0;i<2;i++)rates.push((await json(a.context,'/api/settings/taxes',201,'POST',{name:'QA preview component '+i,percent:'9'})).tax)
  const body={name:'QA shared agreement preview',scheme:'IN_GST',enabled:true,supplyKind:'SERVICES',treatment:'TAXABLE',classificationKind:'SAC',classificationCode:'998311',basisReference:'QA synthetic test, not statutory guidance',priceBasis:'EXCLUSIVE',zeroRatedMode:'NOT_APPLICABLE',variants:[{key:'INTRA_STATE',components:[{code:'CGST',rateId:rates[0].id},{code:'SGST',rateId:rates[1].id}]}]}
  const p=await json(a.context,'/api/tax-configuration/profiles',200,'POST',{companyId:company.id,code:'QA-PREVIEW',version:0,reviewed:true,body})
  await a.page.goto('/settings/tax-profiles');await a.page.locator('#tax-company').click();await a.page.getByRole('option',{name:new RegExp(company.name)}).click();await a.page.getByRole('button',{name:'Tax profiles',exact:true}).click()
  await a.page.getByRole('button',{name:'Preview calculations',exact:true}).click();await expect(a.page.getByRole('dialog')).toBeVisible()
  await a.page.getByLabel('Eligible line discount',{exact:true}).fill('10');await a.page.getByLabel('First portion gross (optional)',{exact:true}).fill('50')
  await a.page.getByRole('button',{name:'Calculate preview',exact:true}).click()
  const result=a.page.getByRole('region',{name:'Calculated tax preview',exact:true})
  await expect(result.getByText('106.20',{exact:true})).toBeVisible();await expect(a.page.getByRole('table',{name:'Partial tax allocation preview',exact:true})).toContainText('56.20')
  await a.page.screenshot({path:info.outputPath('agreement-preview-desktop.png'),fullPage:true,animations:'disabled'})
  await a.page.getByLabel('Line price before discount',{exact:true}).fill('120');await expect(result).toHaveCount(0)
  await json(a.context,'/api/tax-configuration/profiles',200,'POST',{companyId:company.id,id:p.id,code:p.code,version:1,reviewed:true,body:{...body,name:'QA revised agreement preview'}})
  await a.page.getByRole('button',{name:'Calculate preview',exact:true}).click();await expect(a.page.getByRole('alert')).toContainText('profile changed');await expect(a.page.getByLabel('Line price before discount',{exact:true})).toHaveValue('120')
  await a.page.getByRole('button',{name:'Reload saved profile',exact:true}).click();await expect(a.page.getByText(/QA revised agreement preview.*Saved version 2/)).toBeVisible()
  await a.page.getByLabel('Preview currency',{exact:true}).fill('JPY');await a.page.getByLabel('Line price before discount',{exact:true}).fill('120.01');await a.page.getByRole('button',{name:'Calculate preview',exact:true}).click();await expect(a.page.getByRole('alert')).toContainText('not rounded')
  await a.page.getByLabel('Line price before discount',{exact:true}).fill('120');await a.page.getByRole('button',{name:'Calculate preview',exact:true}).click();await expect(result.getByText('130',{exact:true})).toBeVisible()
  await a.page.setViewportSize({width:390,height:844});await a.page.getByRole('dialog').evaluate(el=>{el.scrollTop=0});await a.page.screenshot({path:info.outputPath('agreement-preview-mobile.png'),fullPage:true,animations:'disabled'});expect(await a.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await a.page.getByRole('button',{name:'Close preview',exact:true}).click()
  staff=await login(browser,f.origin,f.users.manager.email)
  await json(staff.context,`/api/tax-configuration/profiles/${p.id}/preview`,403,'POST',{version:2,currency:'INR',amount:'100',discount:'0',variant:'INTRA_STATE',firstPortion:null})
  expect((await json(a.context,'/api/crm/quotations')).total).toBe(0)
 }finally{await staff?.context.close();await a.context.close();await f.db.end()}
})
