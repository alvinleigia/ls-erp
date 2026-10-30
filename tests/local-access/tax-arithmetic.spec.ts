import {test,expect} from '@playwright/test'
import {seed,login,json,assignOffices} from './fixtures'

test('exact rate entry, service preview and purchase posting share decimal arithmetic',async({browser},info)=>{
 test.setTimeout(150_000);const f=await seed(),a=await login(browser,f.origin,f.users.admin.email)
 try{
  const office=(await json(a.context,'/api/offices')).items[0];await assignOffices(a.context,f.users.admin.id,[office.id],office.id)
  await a.page.goto('/settings/taxes');await a.page.getByRole('button',{name:'New tax',exact:true}).click()
  await a.page.getByLabel('Name',{exact:true}).fill('QA precise rate');await a.page.getByLabel('Percent (%)',{exact:true}).fill('0.123456789012')
  await a.page.getByRole('button',{name:'Create tax',exact:true}).click();await expect(a.page.getByRole('dialog')).toHaveCount(0)
  const precise=(await json(a.context,'/api/settings/taxes?q=QA%20precise')).items[0];expect(precise.percent).toBe('0.123456789012')
  await json(a.context,`/api/settings/taxes/${precise.id}`,400,'PATCH',{percent:'0.1234567890123'})
  const rate=(await json(a.context,'/api/settings/taxes',201,'POST',{name:'QA exact rounding',percent:'64.6'})).tax
  const category=(await json(a.context,'/api/service-categories',200,'POST',{name:'QA exact service category'})).item
  await json(a.context,'/api/services',200,'POST',{name:'QA exact tax service',categoryId:category.id,durationMinutes:60,priceCents:250,taxMode:'EXCLUSIVE',taxIds:[rate.id]})
  await a.page.goto('/services');const row=a.page.getByRole('row').filter({hasText:'QA exact tax service'})
  await expect(row).toContainText('1.62');await expect(row).toContainText('4.12')
  await a.page.screenshot({path:info.outputPath('shared-exact-tax-services.png'),fullPage:true,animations:'disabled'})
  const stockCategory=(await json(a.context,'/api/inventory/categories',201,'POST',{name:'QA exact goods category'})).item
  const supplier=(await json(a.context,'/api/inventory/suppliers',201,'POST',{name:'QA exact supplier'})).item
  const product=(await json(a.context,'/api/inventory/products',201,'POST',{sku:'EXACT',name:'QA exact taxed goods',categoryId:stockCategory.id,costPriceCents:250,mrpCents:250,taxIds:[rate.id]})).item
  const purchase=(await json(a.context,'/api/inventory/purchases',201,'POST',{supplierId:supplier.id,orderDate:'2036-02-01',items:[{productId:product.id,quantity:1,unitCostCents:250}]})).item
  expect(purchase.taxCents).toBe(162);expect(purchase.totalCents).toBe(412);expect(purchase.items[0].taxPercent).toBe('64.6')
  await json(a.context,`/api/settings/taxes/${rate.id}`,200,'PATCH',{percent:'65',isActive:false})
  const saved=(await json(a.context,`/api/inventory/purchases/${purchase.id}`,200,'PATCH',{notes:'QA metadata only'})).item
  expect(saved.taxCents).toBe(162);expect(saved.totalCents).toBe(412);expect(saved.items[0].taxPercent).toBe('64.6')
  await a.page.goto('/settings/taxes');await expect(a.page.getByRole('heading',{name:'Taxes',exact:true})).toBeVisible();await expect(a.page.getByRole('cell',{name:'0.123456789012%',exact:true})).toBeVisible();await a.page.setViewportSize({width:390,height:844});await a.page.screenshot({path:info.outputPath('exact-rate-mobile.png'),fullPage:true,animations:'disabled'})
  expect(await a.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 }finally{await a.context.close();await f.db.end()}
})
