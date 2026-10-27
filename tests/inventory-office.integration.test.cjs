/* eslint-disable @typescript-eslint/no-require-imports */
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Client}=require('pg'),{AsyncLocalStorage}=require('node:async_hooks')
const raw=process.env.CRM_TEST_DATABASE_URL,url=new URL(raw||'http://invalid');if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!='/ls_salon_crm_test')throw Error('Disposable local database only.')
const root=new Client({connectionString:raw}),sessions=new AsyncLocalStorage();url.username='crm_test_runtime';url.password='';process.env.DATABASE_URL=url.toString()
const authPath=require.resolve('../auth.ts');require.cache[authPath]={id:authPath,filename:authPath,loaded:true,exports:{auth:async()=>sessions.getStore()||null}}
const errors=[];require('../lib/logger.ts').logger.info=()=>{};require('../lib/logger.ts').logger.error=(_,c)=>errors.push(c.error?.message)
const {prisma,runWithTenantDbContext}=require('../lib/prisma.ts'),{runWithDatabaseActor}=require('../lib/database-actor.ts')
const routes=Object.fromEntries(['products','products/[id]','purchases','purchases/[id]','office-choices','catalog-choices'].map(p=>[p,require(`../app/api/inventory/${p}/route.ts`)]))
const seeds=require('../app/api/seeds/route.ts')
const t='inv_office_'+randomUUID().replaceAll('-',''),east=t+'_east',west=t+'_west',both=t+'_both',role=t+'_role',category=t+'_category',supplier=t+'_supplier'
const permissions=['inventoryProducts.read','inventoryProducts.create','inventoryProducts.edit','inventoryProducts.archive','inventoryPurchases.read','inventoryPurchases.create','inventoryPurchases.edit','inventorySuppliers.read','inventorySuppliers.archive']
let a,b,product,purchaseA,purchaseB
async function call(route,method='GET',body,id,user=east,office=a,version=5,query=''){
 const headers={host:`${t}.localhost`,'Content-Type':'application/json',...(office?{'x-office-id':office,'x-office-version':String(version)}:{})}
 return sessions.run({user:{id:user,tenantId:t,role:'MANAGER'}},()=>routes[route][method](new Request(`http://${t}.localhost/api/inventory/${route.replace('/[id]',id?'/'+id:'')}${query}`,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})}),{params:Promise.resolve({id})}))
}
async function ok(response,status=200){const data=await response.json();assert.equal(response.status,status,JSON.stringify({data,errors:errors.slice(-3)}));return data}
const ctx=(user,read)=>runWithTenantDbContext(t,()=>runWithDatabaseActor(user,async()=>await read()))
const balance=async office=>(await root.query('SELECT * FROM "InventoryOfficeStock" WHERE "officeId"=$1 AND "productId"=$2',[office,product.id])).rows[0]
const poBody=(status='RECEIVED')=>({supplierId:supplier,orderDate:'2036-02-01',status,items:[{productId:product.id,quantity:3,unitCostCents:250}]})
before(async()=>{
 await root.connect();await root.query('INSERT INTO "Tenant"(id,name,slug,"updatedAt") VALUES($1,$1,$1,now())',[t]);a=(await root.query('SELECT id FROM "BusinessOffice" WHERE "tenantId"=$1 AND "isInitial"',[t])).rows[0].id;b=t+'_second'
 await root.query('INSERT INTO "BusinessOffice"(id,"tenantId","companyId",code,name,"updatedAt") SELECT $1,$2,"companyId",\'WEST\',\'West office\',now() FROM "BusinessOffice" WHERE id=$3',[b,t,a])
 await root.query('INSERT INTO "TenantAccessRole"(id,"tenantId",name,"nameKey",permissions,"updatedAt") VALUES($1,$2,$1,$1,$3,now())',[role,t,permissions])
 for(const [user,offices]of [[east,[a]],[west,[b]],[both,[a,b]]]){
  await root.query('INSERT INTO "User"(id,"tenantId",email,role,"updatedAt") VALUES($1,$2,$1||\'@example.test\',\'MANAGER\',now())',[user,t]);await root.query('INSERT INTO "TenantRoleAssignment"("tenantId","userId","roleId","updatedAt") VALUES($1,$2,$3,now())',[t,user,role]);await root.query('INSERT INTO "TenantUserAccess"("tenantId","userId",rules,"updatedAt") VALUES($1,$2,$3,now())',[t,user,Object.fromEntries(permissions.map(p=>[p,'ALL']))]);await root.query('INSERT INTO "BusinessOfficePolicy"("tenantId","userId","creationOfficeId",version,"updatedAt") VALUES($1,$2,$3,5,now())',[t,user,offices[0]]);for(const office of offices)await root.query('INSERT INTO "BusinessOfficeGrant"("tenantId","userId","officeId") VALUES($1,$2,$3)',[t,user,office])
 }
 await root.query('INSERT INTO "TenantModule"("tenantId",key,allowed,enabled,"updatedAt") VALUES($1,\'inventory\',true,true,now())',[t]);await root.query('INSERT INTO "InventoryCategory"(id,"tenantId",name,"updatedAt") VALUES($1,$2,\'Shared category\',now())',[category,t]);await root.query('INSERT INTO "Supplier"(id,"tenantId",name,"updatedAt") VALUES($1,$2,\'Shared supplier\',now())',[supplier,t])
})
after(async()=>{await root.end();await prisma.$disconnect();await global.prismaPool?.end()})
test('product definitions stay shared while quantities, costs and zero defaults use one accessible office',async()=>{
 product=(await ok(await call('products','POST',{sku:'OFFICE-STOCK',name:'Office stock',categoryId:category,costPriceCents:100,mrpCents:500,onHandQty:17,reorderPoint:4}),201)).item
 assert.equal(product.officeId,a);assert.equal(product.stockVersion,1);assert.equal(product.onHandQty,17)
 const view=(await ok(await call('products','GET',undefined,undefined,west,b))).items[0];assert.equal(view.id,product.id);assert.equal(view.officeId,b);assert.equal(view.onHandQty,0);assert.equal(view.costPriceCents,0);assert.equal(view.stockVersion,0)
 await ok(await call('products','GET',undefined,undefined,east,a,5,'?officeId='+b),403)
 const choices=await ok(await call('office-choices','GET',undefined,undefined,east,a,5,'?resource=inventoryProducts'));assert.equal(choices.total,1);assert.equal(choices.items[0].id,a)
 await root.query('UPDATE "BusinessOfficePolicy" SET "creationOfficeId"=NULL WHERE "tenantId"=$1 AND "userId"=$2',[t,east]);try{
  await ok(await call('products'),403)
  const catalogue=await ok(await call('catalog-choices'));assert.equal(catalogue.items[0].id,product.id);for(const key of ['onHandQty','costPriceCents','officeId','reorderPoint'])assert.equal(key in catalogue.items[0],false)
 }finally{await root.query('UPDATE "BusinessOfficePolicy" SET "creationOfficeId"=$1 WHERE "tenantId"=$2 AND "userId"=$3',[a,t,east])}
})
test('stock edits require explicit office/version and cannot reroute after a workspace change',async()=>{
 await ok(await call('products/[id]','PATCH',{officeId:b,stockVersion:0,onHandQty:2,costPriceCents:999},product.id,west,b))
 await root.query('UPDATE "BusinessOfficePolicy" SET "creationOfficeId"=$1,version=6 WHERE "tenantId"=$2 AND "userId"=$3',[b,t,both])
 await ok(await call('products/[id]','PATCH',{officeId:a,stockVersion:1,onHandQty:20},product.id,both,b,6));assert.equal((await balance(a)).onHandQty,20);assert.equal((await balance(b)).onHandQty,2)
 await ok(await call('products/[id]','PATCH',{onHandQty:100},product.id),400)
 await ok(await call('products/[id]','PATCH',{officeId:a,stockVersion:1,onHandQty:100,name:'Must roll back'},product.id),409)
 assert.equal((await root.query('SELECT name FROM "InventoryProduct" WHERE id=$1',[product.id])).rows[0].name,'Office stock')
 await ok(await call('products','POST',{sku:'STALE-CREATE',name:'Must roll back',categoryId:category,costPriceCents:100,mrpCents:500},undefined,both,a,5),409)
 assert.equal((await root.query('SELECT id FROM "InventoryProduct" WHERE "tenantId"=$1 AND sku=\'STALE-CREATE\'',[t])).rows.length,0)
})
test('purchase receipts, replay, source labels and stock versions follow their saved office',async()=>{
 purchaseA=(await ok(await call('purchases','POST',poBody()),201)).item;assert.equal(purchaseA.officeId,a);assert.equal(purchaseA.items[0].receivedQty,3);assert.equal((await balance(a)).onHandQty,23)
 purchaseB=(await ok(await call('purchases','POST',poBody(),undefined,west,b),201)).item;assert.equal((await balance(b)).onHandQty,5)
 await ok(await call('purchases/[id]','PATCH',{status:'ORDERED'},purchaseA.id,both,b,6));await ok(await call('purchases/[id]','PATCH',{status:'RECEIVED'},purchaseA.id,both,b,6));assert.equal((await balance(a)).onHandQty,23);assert.equal((await balance(b)).onHandQty,5)
 await ok(await call('products/[id]','PATCH',{officeId:a,stockVersion:2,onHandQty:20},product.id),409)
 const list=await ok(await call('purchases'));assert.equal(list.total,1);assert.equal(list.items[0].office.id,a);assert.equal(list.items[0].items[0].product.name,'Office stock')
 await ok(await call('purchases/[id]','GET',undefined,purchaseB.id),404)
 const [ancestry]=await ctx(east,()=>prisma.$queryRaw`SELECT app.inventory_purchase_link_in_tenant(${purchaseB.id},${product.id}) allowed`);assert.equal(ancestry.allowed,false)
 const all=await ok(await call('purchases','GET',undefined,undefined,both,b,6));assert.equal(all.total,2)
 const filtered=await ok(await call('purchases','GET',undefined,undefined,both,b,6,'?officeId='+b));assert.equal(filtered.total,1)
 const audits=await ctx(east,()=>prisma.auditLog.findMany({where:{tenantId:t}}));assert.ok(!JSON.stringify(audits).includes(purchaseB.id));assert.ok(audits.some(r=>r.entityId===purchaseA.id),JSON.stringify({audits,all:(await root.query('SELECT "entityId",event,metadata,before,after FROM "AuditLog" WHERE "tenantId"=$1',[t])).rows}))
})
test('purchase-only Read resolves minimal saved product labels without granting catalogue or stock access',async()=>{
 await root.query('UPDATE "TenantAccessRole" SET permissions=$1 WHERE id=$2',[['inventoryPurchases.read'],role]);try{
  const data=await ok(await call('purchases/[id]','GET',undefined,purchaseA.id));assert.equal(data.item.items[0].product.id,product.id)
  assert.equal('costPriceCents' in data.item.items[0].product,false)
  await ok(await call('products'),403);await ok(await call('catalog-choices'),403)
  await ok(await call('office-choices','GET',undefined,undefined,east,a,5,'?resource=inventoryPurchases'))
 }finally{await root.query('UPDATE "TenantAccessRole" SET permissions=$1 WHERE id=$2',[permissions,role])}
})
test('closed offices retain read and labels but reject counts and receipts; module revocation hides everything',async()=>{
 await root.query('UPDATE "BusinessOffice" SET archived=true WHERE id=$1',[b]);try{
  const data=await ok(await call('products','GET',undefined,undefined,west,b));assert.equal(data.office.active,false)
  await ok(await call('products/[id]','PATCH',{officeId:b,stockVersion:(await balance(b)).version,onHandQty:99},product.id,west,b),403)
  await ok(await call('purchases/[id]','PATCH',{notes:'Denied'},purchaseB.id,west,b),403)
  await ok(await call('purchases/[id]','GET',undefined,purchaseB.id,west,b))
 }finally{await root.query('UPDATE "BusinessOffice" SET archived=false WHERE id=$1',[b])}
 await root.query('UPDATE "TenantModule" SET enabled=false WHERE "tenantId"=$1',[t]);try{for(const route of ['products','purchases','catalog-choices','office-choices'])await ok(await call(route,'GET',undefined,undefined,east,a,5,route==='office-choices'?'?resource=inventoryProducts':''),403)}finally{await root.query('UPDATE "TenantModule" SET enabled=true WHERE "tenantId"=$1',[t])}
})
test('authorized sample creation uses normal stock posting and reruns preserve existing counts',async()=>{
 const admin=t+'_admin'
 await root.query('INSERT INTO "User"(id,"tenantId",email,role,"updatedAt") VALUES($1,$2,$1||\'@example.test\',\'ADMIN\',now())',[admin,t]);await root.query('INSERT INTO "BusinessOfficePolicy"("tenantId","userId","creationOfficeId",version,"updatedAt") VALUES($1,$2,$3,5,now())',[t,admin,a])
 const seed=()=>sessions.run({user:{id:admin,tenantId:t,role:'ADMIN'}},()=>seeds.POST(new Request(`http://${t}.localhost/api/seeds`,{method:'POST',headers:{host:`${t}.localhost`,'Content-Type':'application/json','x-office-id':a,'x-office-version':'5'},body:JSON.stringify({action:'seed',groups:['purchases']})})))
 await ok(await seed())
 const count=async()=> (await root.query('SELECT s."onHandQty" FROM "InventoryOfficeStock" s JOIN "InventoryProduct" p ON p.id=s."productId" WHERE p."tenantId"=$1 AND p.sku=\'HC-SHAMPOO-001\' AND s."officeId"=$2',[t,a])).rows[0].onHandQty
 assert.equal(await count(),80)
 await root.query('UPDATE "InventoryOfficeStock" SET "onHandQty"=77 WHERE "officeId"=$1 AND "productId" IN (SELECT id FROM "InventoryProduct" WHERE "tenantId"=$2 AND sku=\'HC-SHAMPOO-001\')',[a,t])
 await ok(await seed());assert.equal(await count(),77)
 assert.equal((await root.query('SELECT count(*)::integer n FROM "PurchaseOrder" WHERE "tenantId"=$1 AND notes=\'Sample inventory purchase\'',[t])).rows[0].n,1)
})
test('Archive remains a separate action and preserves even zero-count office configuration',async()=>{
 const empty=(await ok(await call('products','POST',{sku:'ARCHIVE-ZERO',name:'Archive zero stock',categoryId:category,costPriceCents:25,mrpCents:100}),201)).item
 await root.query('UPDATE "TenantAccessRole" SET permissions=$1 WHERE id=$2',[['inventoryProducts.read','inventoryProducts.archive'],role]);try{
  await ok(await call('products/[id]','DELETE',undefined,empty.id))
  assert.equal((await root.query('SELECT status FROM "InventoryProduct" WHERE id=$1',[empty.id])).rows[0].status,'INACTIVE')
  assert.equal((await root.query('SELECT "costPriceCents" FROM "InventoryOfficeStock" WHERE "productId"=$1',[empty.id])).rows[0].costPriceCents,25)
  await ok(await call('products/[id]','PATCH',{name:'No edit grant'},empty.id),403)
 }finally{await root.query('UPDATE "TenantAccessRole" SET permissions=$1 WHERE id=$2',[permissions,role])}
})
