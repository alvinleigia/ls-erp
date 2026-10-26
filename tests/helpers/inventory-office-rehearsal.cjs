/* eslint-disable @typescript-eslint/no-require-imports */
// Pending cutover only: raw native tests do not run the old Prisma services on
// the proposed schema, and never load local/hosted environment files.
const assert=require('node:assert/strict'),fs=require('node:fs'),{Client}=require('pg')
const url=new URL(process.env.CRM_TEST_DATABASE_URL||'http://invalid')
assert.equal(process.env.R5_HISTORICAL_CONTAINER,'1');assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/ls_salon_crm_test')
const db=new Client({connectionString:url.toString()});url.username='crm_test_runtime';url.password=''
const runtime=new Client({connectionString:url.toString()})
const t='inventory_office_rehearsal',foreign=t+'_other',admin=t+'_admin',east=t+'_east',west=t+'_west',both=t+'_both',plain=t+'_plain',customer=t+'_customer',product=t+'_product',supplier=t+'_supplier',purchase=t+'_purchase',booking=t+'_booking'
let initial,second,count=0
const check=async(name,fn)=>{await fn();count++;console.log(`Inventory office rehearsal ${count}: ${name}`)}
const q=(sql,values)=>db.query(sql,values)
async function transaction(user,fn,{office=initial,version=5,inventoryOp='inventoryPurchases.edit',bookingOp='appointments.edit',client=runtime}={}){
 await client.query('BEGIN');try{
  await client.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.actor_id',$2,true),set_config('app.rls_bypass','off',true),set_config('app.office_id',$3,true),set_config('app.office_version',$4,true),set_config('app.inventory_operation',$5,true),set_config('app.appointment_operation',$6,true)",[t,user,office||'',String(version),inventoryOp,bookingOp])
  const result=await fn(client);await client.query('COMMIT');return result
 }catch(error){await client.query('ROLLBACK');throw error}
}
async function createBooking(c,id,qty){
 await c.query('INSERT INTO "AppointmentOrder"(id,"tenantId","customerId",status,"appointmentDate","appointmentStartAt","updatedAt") VALUES($1,$2,$3,\'CONFIRMED\',\'2036-01-01\',\'2036-01-01 10:00\',now())',[id,t,customer])
 await c.query('INSERT INTO "AppointmentOrderProductLine"(id,"orderId","productId",quantity,"unitPriceCents","updatedAt") VALUES($1,$1,$2,$3,500,now())',[id,product,qty])
 await c.query('SELECT app.inventory_post_booking($1,$2)',[t,id])
}
async function createPurchase(c,id,qty=3,received=0){
 await c.query('INSERT INTO "PurchaseOrder"(id,"tenantId","orderNumber","supplierId",status,"orderDate","updatedAt") VALUES($1,$2,$1,$3,\'RECEIVED\',\'2036-01-01\',now())',[id,t,supplier])
 await c.query('INSERT INTO "PurchaseOrderItem"(id,"orderId","productId",quantity,"receivedQty","unitCostCents","updatedAt") VALUES($1,$1,$2,$3,$4,250,now())',[id,product,qty,received])
 await c.query('SELECT app.inventory_post_receipt($1,$2)',[t,id])
}
const stock=async(office=initial)=> (await q('SELECT * FROM "InventoryOfficeStock" WHERE "officeId"=$1 AND "productId"=$2',[office,product])).rows[0]
const setStock=(user,office,qty,version,cost=null,reorder=null,reorderQty=null)=>transaction(user,c=>c.query('SELECT app.inventory_set_stock($1,$2,$3,$4,$5,$6,$7,$8,$9) version',[t,office,product,qty,cost,reorder,reorderQty,version,'rehearsal-request']))
const snapshot=async()=>{const result={};for(const table of ['InventoryProduct','InventoryOfficeStock','InventoryStockMovement','InventoryBookingStock','InventoryReceiptStock','PurchaseOrder','PurchaseOrderItem','AppointmentOrder','AppointmentOrderProductLine','AuditLog'])result[table]=(await q(`SELECT to_jsonb(r) row FROM "${table}" r WHERE ${table==='PurchaseOrderItem'?'"orderId" IN (SELECT id FROM "PurchaseOrder" WHERE "tenantId"=$1)':table==='AppointmentOrderProductLine'?'"orderId" IN (SELECT id FROM "AppointmentOrder" WHERE "tenantId"=$1)':'"tenantId"=$1'} ORDER BY to_jsonb(r)::text COLLATE "C"`,[t])).rows;return result}
async function main(){
 await db.connect();await runtime.connect()
 try{
  for(const tenant of [t,foreign])await q('INSERT INTO "Tenant"(id,name,slug,"updatedAt") VALUES($1,$1,$1,now())',[tenant])
  initial=(await q('SELECT id FROM "BusinessOffice" WHERE "tenantId"=$1 AND "isInitial"',[t])).rows[0].id;second=t+'_second'
  await q('INSERT INTO "BusinessOffice"(id,"tenantId","companyId",code,name,"updatedAt") SELECT $1,$2,"companyId",\'SECOND\',\'Second office\',now() FROM "BusinessOffice" WHERE id=$3',[second,t,initial])
  for(const user of [admin,east,west,both,plain,customer])await q('INSERT INTO "User"(id,"tenantId",name,email,role,"updatedAt") VALUES($1,$2,$1,$1||\'@example.test\',$3,now())',[user,t,user===admin?'ADMIN':user===customer?'CUSTOMER':'MANAGER'])
  for(const key of ['inventory','appointments'])await q('INSERT INTO "TenantModule"("tenantId",key,allowed,enabled,"updatedAt") VALUES($1,$2,true,true,now())',[t,key])
  const permissions=['inventoryProducts.read','inventoryProducts.create','inventoryProducts.edit','inventoryProducts.archive','inventoryPurchases.read','inventoryPurchases.create','inventoryPurchases.edit','appointments.read','appointments.create','appointments.edit','appointments.archive']
  await q('INSERT INTO "TenantAccessRole"(id,"tenantId",name,"nameKey",permissions,"updatedAt") VALUES($1,$2,$1,$1,$3,now())',[t+'_role',t,permissions])
  for(const user of [east,west,both]){
   await q('INSERT INTO "TenantRoleAssignment"("tenantId","userId","roleId","updatedAt") VALUES($1,$2,$3,now())',[t,user,t+'_role'])
   await q('INSERT INTO "TenantUserAccess"("tenantId","userId",rules,"updatedAt") VALUES($1,$2,$3,now())',[t,user,Object.fromEntries(permissions.map(p=>[p,'ALL']))])
  }
  for(const [user,offices]of [[admin,[initial,second]],[east,[initial]],[west,[second]],[both,[initial,second]],[plain,[initial]]]){
   await q('INSERT INTO "BusinessOfficePolicy"("tenantId","userId","creationOfficeId",version,"updatedAt") VALUES($1,$2,$3,5,now())',[t,user,offices[0]])
   for(const office of offices)await q('INSERT INTO "BusinessOfficeGrant"("tenantId","userId","officeId") VALUES($1,$2,$3)',[t,user,office])
  }
  await q('INSERT INTO "InventoryCategory"(id,"tenantId",name,"updatedAt") VALUES($1,$2,\'Saved category\',\'2020-01-02\')',[t+'_category',t])
  await q('INSERT INTO "Supplier"(id,"tenantId",name,"updatedAt") VALUES($1,$2,\'Saved supplier\',\'2020-01-02\')',[supplier,t])
  // Deliberately incomplete history: current balance is not the movement sum.
  await q('INSERT INTO "InventoryProduct"(id,"tenantId",sku,name,"categoryId","onHandQty","costPriceCents","mrpCents","reorderPoint","reorderQty","createdAt","updatedAt") VALUES($1,$2,\'SAVED\',\'Saved product\',$3,17,100,450,6,10,\'2020-01-01\',\'2020-01-02\')',[product,t,t+'_category'])
  await q('INSERT INTO "PurchaseOrder"(id,"tenantId","orderNumber","supplierId",status,"orderDate","subtotalCents","taxCents","totalCents","updatedAt") VALUES($1,$2,\'SAVED-PO\',$3,\'RECEIVED\',\'2020-01-01\',200,20,220,\'2020-01-02\')',[purchase,t,supplier])
  await q('INSERT INTO "PurchaseOrderItem"(id,"orderId","productId",quantity,"receivedQty","unitCostCents","lineSubtotalCents","lineTaxCents","lineTotalCents","updatedAt") VALUES($1,$2,$3,2,2,100,200,20,220,\'2020-01-02\')',[purchase+'_item',purchase,product])
  await q('INSERT INTO "InventoryStockMovement"(id,"tenantId","productId","orderItemId",type,"quantityDelta","unitCostCents",note,"createdAt","occurredAt") VALUES($1,$2,$3,$4,\'PURCHASE_RECEIPT\',2,100,\'Saved receipt\',\'2020-01-02\',\'2020-01-02\')',[t+'_move',t,product,purchase+'_item'])
  await q('INSERT INTO "AppointmentOrder"(id,"tenantId","officeId","customerId",status,"appointmentDate","appointmentStartAt","totalCents","invoiceBranding","updatedAt") VALUES($1,$2,$3,$4,\'CONFIRMED\',\'2020-01-01\',\'2020-01-01 10:00\',1234,\'{"name":"Saved brand"}\',\'2020-01-02\')',[booking,t,initial,customer])
  await q('INSERT INTO "AppointmentOrderProductLine"(id,"orderId","productId",quantity,"unitPriceCents","lineTotalCents","updatedAt") VALUES($1,$2,$3,3,411,1234,\'2020-01-02\')',[booking+'_line',booking,product])
  await q('INSERT INTO "InventoryStockMovement"(id,"tenantId","productId",type,"quantityDelta",note,"createdAt","occurredAt") VALUES($1,$2,$3,\'BOOKING_PRODUCT_SALE\',-3,$4,\'2020-01-02\',\'2020-01-02\')',[t+'_booking_move',t,product,'Booking order '+booking+' stock deduction'])
  await q('INSERT INTO "InventoryStockMovement"(id,"tenantId","productId",type,"quantityDelta",note,"createdAt","occurredAt") VALUES($1,$2,$3,\'BOOKING_PRODUCT_RESTOCK\',1,\'Imported historical correction\',\'2020-01-02\',\'2020-01-02\')',[t+'_unlinked_move',t,product])
  await q('INSERT INTO "AuditLog"(id,"tenantId",event,"entityType","entityId",before,after,metadata,"createdAt") VALUES($1,$2,\'inventory.inventoryProducts.edit\',\'inventoryProducts\',$3,\'{"onHandQty":16,"name":"Before"}\',\'{"onHandQty":17,"name":"Saved product"}\',\'{"request":"keep"}\',\'2020-01-02\')',[t+'_audit',t,product])
  const tables=(await q("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' ORDER BY tablename")).rows.map(r=>r.tablename)
  const capture=async()=>{const rows={};for(const table of tables)rows[table]=(await q(`SELECT to_jsonb(r) row FROM "${table}" r ORDER BY to_jsonb(r)::text COLLATE "C"`)).rows.map(r=>r.row);return rows}
  const policies=async()=>(await q("SELECT * FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname")).rows
  const functions=async()=>(await q("SELECT p.oid,pg_get_functiondef(p.oid) definition,p.proacl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app' ORDER BY p.oid")).rows
  const before=await capture(),oldPolicies=await policies(),oldFunctions=await functions(),ledger=(await q('SELECT * FROM "_prisma_migrations" ORDER BY id')).rows,sql=fs.readFileSync('prisma/pending/inventory-office-stock.sql','utf8')
  await check('historical reconciliation failures abort without changing data',async()=>{
   for(const [change,undo,error]of [
    ['UPDATE "InventoryProduct" SET "onHandQty"=-1 WHERE id=$1','UPDATE "InventoryProduct" SET "onHandQty"=17 WHERE id=$1',/quantities require reconciliation/],
    ['UPDATE "InventoryProduct" SET "tenantId"=$2 WHERE id=$1','UPDATE "InventoryProduct" SET "tenantId"=$2 WHERE id=$1',/tenant relations disagree/],
   ]){await q(change,change.includes('$2')?[product,foreign]:[product]);await assert.rejects(q(sql),error);await q('ROLLBACK');await q(undo,undo.includes('$2')?[product,t]:[product]);assert.deepEqual(await capture(),before)}
   await q('UPDATE "AppointmentOrder" SET "officeId"=$1 WHERE id=$2',[second,booking]);await assert.rejects(q(sql),/office allocation requires reconciliation/);await q('ROLLBACK');await q('UPDATE "AppointmentOrder" SET "officeId"=$1 WHERE id=$2',[initial,booking]);assert.deepEqual(await capture(),before)
  })
  await check('missing historical tenant identities are inferred only from agreeing sources',async()=>{
   for(const [table,id]of [['InventoryProduct',product],['PurchaseOrder',purchase],['InventoryStockMovement',t+'_move']])await q(`UPDATE "${table}" SET "tenantId"=NULL WHERE id=$1`,[id])
   try{
    await q(sql.replace(/COMMIT;\s*$/,''))
    for(const [table,id]of [['InventoryProduct',product],['PurchaseOrder',purchase],['InventoryStockMovement',t+'_move']])assert.equal((await q(`SELECT "tenantId" FROM "${table}" WHERE id=$1`,[id])).rows[0].tenantId,t)
    assert.equal((await stock()).onHandQty,17)
   }finally{
    await q('ROLLBACK')
    for(const [table,id]of [['InventoryProduct',product],['PurchaseOrder',purchase],['InventoryStockMovement',t+'_move']])await q(`UPDATE "${table}" SET "tenantId"=$1 WHERE id=$2`,[t,id])
   }
   assert.deepEqual(await capture(),before);assert.deepEqual(await policies(),oldPolicies);assert.deepEqual(await functions(),oldFunctions)
  })
  await check('forced late rollback preserves every table, policy, function and grant',async()=>{await assert.rejects(q(sql.replace(/COMMIT;\s*$/,'SELECT 1/0;COMMIT;')),/division by zero/);await q('ROLLBACK');assert.deepEqual(await capture(),before);assert.deepEqual(await policies(),oldPolicies);assert.deepEqual(await functions(),oldFunctions)})
  await q(sql)
  await check('migration preserves saved evidence and moves exact quantities once',async()=>{
   const expected=structuredClone(before)
   for(const row of expected.InventoryProduct)for(const key of ['onHandQty','costPriceCents','reorderPoint','reorderQty'])delete row[key]
   const initials=new Map((await q('SELECT "tenantId",id FROM "BusinessOffice" WHERE "isInitial"')).rows.map(r=>[r.tenantId,r.id]))
   for(const row of expected.PurchaseOrder)row.officeId=initials.get(row.tenantId)
   for(const row of expected.InventoryStockMovement){row.officeId=initials.get(row.tenantId);row.bookingOrderId=row.id===t+'_booking_move'?booking:null}
   for(const row of expected.AuditLog)if(row.entityType==='inventoryPurchases'||(row.entityType==='inventoryProducts'&&['onHandQty','costPriceCents','reorderPoint','reorderQty'].some(k=>Object.hasOwn(row.before||{},k)||Object.hasOwn(row.after||{},k))))row.metadata={...row.metadata,officeId:initials.get(row.tenantId),officeFamily:'inventory'}
   const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x,norm=x=>x.map(v=>JSON.stringify(stable(v))).sort(),after=await capture()
   for(const table of tables)assert.deepEqual(norm(after[table]),norm(expected[table]),table)
   for(const policy of oldPolicies)assert.deepEqual((await policies()).find(p=>p.tablename===policy.tablename&&p.policyname===policy.policyname),policy)
   const currentFunctions=await functions();for(const fn of oldFunctions)assert.deepEqual(currentFunctions.find(f=>f.oid===fn.oid),fn)
   const balance=await stock();assert.equal(balance.onHandQty,17);assert.equal(balance.costPriceCents,100);assert.equal(balance.reorderPoint,6);assert.equal(balance.reorderQty,10);assert.equal(balance.updatedAt.toISOString(),'2020-01-02T00:00:00.000Z');assert.equal(await stock(second),undefined)
   assert.equal((await q('SELECT quantity FROM "InventoryBookingStock" WHERE "orderId"=$1',[booking])).rows[0].quantity,3)
   assert.equal((await q('SELECT quantity FROM "InventoryReceiptStock" WHERE "itemId"=$1',[purchase+'_item'])).rows[0].quantity,2)
  })
  await q('GRANT SELECT,INSERT,UPDATE,DELETE ON "InventoryOfficeStock","InventoryBookingStock","InventoryReceiptStock" TO crm_test_runtime')
  await check('balances, costs, source rows and old stock audits follow office access',async()=>{
   assert.equal((await transaction(east,c=>c.query('SELECT * FROM "InventoryOfficeStock" WHERE "tenantId"=$1',[t]))).rows.length,1)
   for(const table of ['InventoryOfficeStock','InventoryStockMovement','PurchaseOrder','PurchaseOrderItem','InventoryReceiptStock','InventoryBookingStock','AuditLog'])assert.equal((await transaction(west,c=>c.query(`SELECT * FROM "${table}" WHERE ${table==='PurchaseOrderItem'?'"orderId"=$1':'"tenantId"=$1'}`,table==='PurchaseOrderItem'?[purchase]:[t]))).rows.length,0,table)
   const read=await transaction(west,c=>c.query('SELECT id FROM "InventoryProduct" WHERE "tenantId"=$1',[t]));assert.equal(read.rows.length,1,'catalogue stays shared')
   await assert.rejects(transaction(plain,c=>c.query('SELECT app.inventory_read_office($1,$2)',[t,initial])),/selection is required/)
   assert.equal((await transaction(plain,c=>c.query('SELECT id FROM "InventoryProduct" WHERE "tenantId"=$1',[t]))).rows.length,0,'role label alone grants no catalogue access')
   await assert.rejects(transaction(east,c=>c.query('SELECT app.inventory_read_office($1,$2)',[t,second])),/selection is required/)
  })
  await check('runtime cannot forge balances, allocations, movements or call private posting',async()=>{
   const before=await snapshot()
   await assert.rejects(transaction(east,c=>c.query('INSERT INTO "InventoryOfficeStock"("tenantId","officeId","productId","updatedAt") VALUES($1,$2,$3,now())',[t,second,product])),/row-level security/)
   assert.equal((await transaction(east,c=>c.query('UPDATE "InventoryOfficeStock" SET "onHandQty"=999 WHERE "productId"=$1',[product]))).rowCount,0)
   assert.equal((await transaction(east,c=>c.query('UPDATE "InventoryBookingStock" SET quantity=999 WHERE "productId"=$1',[product]))).rowCount,0)
   await assert.rejects(transaction(east,c=>c.query('SELECT app.inventory_move($1,$2,$3,10,\'ADJUSTMENT_ADD\',NULL,NULL,NULL,NULL,NULL)',[t,initial,product])),/permission denied/)
   await assert.rejects(transaction(east,c=>c.query('INSERT INTO "InventoryStockMovement"(id,"tenantId","officeId","productId",type,"quantityDelta") VALUES(\'forged\',$1,$2,$3,\'ADJUSTMENT_ADD\',9)',[t,initial,product])),/row-level security/)
   assert.deepEqual(await snapshot(),before)
  })
  await check('explicit source correction uses optimistic version and one complete strict audit',async()=>{
   await setStock(east,initial,20,1,150,8,12);assert.equal((await stock()).version,2);assert.equal((await stock()).onHandQty,20)
   const audit=(await q('SELECT * FROM "AuditLog" WHERE "tenantId"=$1 AND event=\'inventory.stock.updated\' ORDER BY "createdAt",id',[t])).rows;assert.equal(audit.length,1);assert.equal(audit[0].before.onHandQty,17);assert.equal(audit[0].after.reorderPoint,8);assert.equal(audit[0].requestId,'rehearsal-request');assert.equal(audit[0].metadata.officeId,initial)
   const before=await snapshot();await assert.rejects(setStock(east,initial,80,1),/Stock changed/);await assert.rejects(setStock(east,second,80,0),/office access/);await assert.rejects(setStock(east,initial,-1,2),/nonnegative/);assert.deepEqual(await snapshot(),before)
   await setStock(west,second,2,0,999);assert.equal((await stock()).onHandQty,20);assert.equal((await stock(second)).onHandQty,2)
  })
  await check('existing receipt replay never duplicates movements or stock',async()=>{
   const before=await snapshot();await transaction(east,c=>c.query('SELECT app.inventory_post_receipt($1,$2)',[t,purchase]));assert.deepEqual(await snapshot(),before)
  })
  await check('booking deductions and cancellation restore their saved office after workspace change',async()=>{
   await q('UPDATE "BusinessOfficePolicy" SET "creationOfficeId"=$1,version=6 WHERE "tenantId"=$2 AND "userId"=$3',[second,t,both])
   await transaction(both,async c=>{await c.query('UPDATE "AppointmentOrderProductLine" SET quantity=4 WHERE id=$1',[booking+'_line']);await c.query('SELECT app.inventory_post_booking($1,$2)',[t,booking])},{office:second,version:6})
   assert.equal((await stock()).onHandQty,19);assert.equal((await stock(second)).onHandQty,2)
   await transaction(both,async c=>{await c.query('UPDATE "AppointmentOrder" SET status=\'CANCELED\' WHERE id=$1',[booking]);await c.query('SELECT app.inventory_post_booking($1,$2)',[t,booking])},{office:second,version:6})
   assert.equal((await stock()).onHandQty,23);assert.equal((await stock(second)).onHandQty,2)
   const before=await snapshot();await transaction(both,c=>c.query('SELECT app.inventory_post_booking($1,$2)',[t,booking]));assert.deepEqual(await snapshot(),before)
   const movement=(await q('SELECT "officeId","bookingOrderId","quantityDelta" FROM "InventoryStockMovement" WHERE "bookingOrderId"=$1 ORDER BY "quantityDelta"',[booking])).rows;assert.deepEqual(movement,[{officeId:initial,bookingOrderId:booking,quantityDelta:-3},{officeId:initial,bookingOrderId:booking,quantityDelta:-1},{officeId:initial,bookingOrderId:booking,quantityDelta:4}])
  })
  await check('unposted booking changes and forged source identities fail at commit',async()=>{
   const before=await snapshot()
   await assert.rejects(transaction(east,c=>c.query('UPDATE "AppointmentOrder" SET status=\'CONFIRMED\' WHERE id=$1',[booking])),/must be posted/)
   await assert.rejects(transaction(east,c=>c.query('UPDATE "PurchaseOrderItem" SET "receivedQty"=1 WHERE id=$1',[purchase+'_item'])),/must be posted/)
   await assert.rejects(transaction(both,c=>c.query('UPDATE "PurchaseOrder" SET "officeId"=$1 WHERE id=$2',[second,purchase])),/immutable/)
   await assert.rejects(transaction(east,c=>c.query('UPDATE "PurchaseOrderItem" SET "unitCostCents"=1 WHERE id=$1',[purchase+'_item'])),/immutable/)
   await assert.rejects(transaction(east,async c=>{await c.query('UPDATE "PurchaseOrderItem" SET "receivedQty"=1 WHERE id=$1',[purchase+'_item']);await c.query('SELECT app.inventory_post_receipt($1,$2)',[t,purchase])}),/must be posted/)
   assert.deepEqual(await snapshot(),before)
  })
  await check('new bookings cannot consume another office and concurrent sales cannot oversell',async()=>{
   const before=await snapshot();await assert.rejects(transaction(west,c=>createBooking(c,t+'_oversized',3),{office:second,bookingOp:'appointments.create'}),/Insufficient stock in the source office/);assert.deepEqual(await snapshot(),before)
   const c1=new Client({connectionString:url.toString()}),c2=new Client({connectionString:url.toString()});await c1.connect();await c2.connect()
   try{
    const result=await Promise.allSettled([c1,c2].map((client,i)=>transaction(west,c=>createBooking(c,t+'_race_'+i,2),{client,office:second,bookingOp:'appointments.create'})))
    assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.match(result.find(r=>r.status==='rejected').reason.message,/Insufficient stock/)
    assert.equal((await stock(second)).onHandQty,0);assert.equal((await stock()).onHandQty,23)
    assert.equal((await q('SELECT count(*)::integer n FROM "AppointmentOrder" WHERE id IN ($1,$2)',[t+'_race_0',t+'_race_1'])).rows[0].n,1)
   }finally{await c1.end();await c2.end()}
  })
  await check('new receipts use canonical allocation, captured context and cumulative posting',async()=>{
   const before=await snapshot()
   await assert.rejects(transaction(west,c=>createPurchase(c,t+'_bad_version'),{office:second,version:4,inventoryOp:'inventoryPurchases.create'}),/Office context changed/)
   await assert.rejects(transaction(west,c=>createPurchase(c,t+'_bad_count',3,3),{office:second,inventoryOp:'inventoryPurchases.create'}),/must be posted/)
   assert.deepEqual(await snapshot(),before)
   await transaction(west,c=>createPurchase(c,t+'_new_purchase'),{office:second,inventoryOp:'inventoryPurchases.create'})
   assert.equal((await stock(second)).onHandQty,3);assert.equal((await stock(second)).costPriceCents,250);assert.equal((await stock()).onHandQty,23)
   const posted=await snapshot();await transaction(west,c=>c.query('SELECT app.inventory_post_receipt($1,$2)',[t,t+'_new_purchase']));assert.deepEqual(await snapshot(),posted)
   await assert.rejects(transaction(west,c=>c.query('UPDATE "PurchaseOrder" SET "totalCents"=1 WHERE id=$1',[t+'_new_purchase'])),/immutable/)
  })
  await check('closed offices retain historical read but reject stock and source changes',async()=>{
   const savedBooking=(await q('SELECT id FROM "AppointmentOrder" WHERE "officeId"=$1 AND "tenantId"=$2',[second,t])).rows[0].id
   await q('UPDATE "BusinessOffice" SET archived=true WHERE id=$1',[second]);try{
    assert.equal((await transaction(west,c=>c.query('SELECT id FROM "PurchaseOrder" WHERE id=$1',[t+'_new_purchase']))).rows.length,1)
    assert.equal((await transaction(west,c=>c.query('SELECT app.inventory_office_label($1,$2) office',[t,second]))).rows[0].office.active,false)
    await assert.rejects(setStock(west,second,100,(await stock(second)).version),/office access/)
    await assert.rejects(transaction(west,c=>c.query('SELECT app.inventory_post_booking($1,$2)',[t,savedBooking])),/not permitted/)
    await assert.rejects(transaction(west,c=>c.query('UPDATE "PurchaseOrder" SET notes=\'denied\' WHERE id=$1',[t+'_new_purchase'])),/source access/)
   }finally{await q('UPDATE "BusinessOffice" SET archived=false WHERE id=$1',[second])}
  })
  await check('current profile, Read limits, module and account revocation deny posting',async()=>{
   for(const [change,undo,args]of [
    ['UPDATE "TenantAccessRole" SET archived=true WHERE id=$1','UPDATE "TenantAccessRole" SET archived=false WHERE id=$1',[t+'_role']],
    ['UPDATE "TenantUserAccess" SET rules=rules||\'{"inventoryProducts.read":"NONE"}\' WHERE "tenantId"=$1 AND "userId"=$2','UPDATE "TenantUserAccess" SET rules=rules||\'{"inventoryProducts.read":"ALL"}\' WHERE "tenantId"=$1 AND "userId"=$2',[t,east]],
    ['UPDATE "TenantModule" SET allowed=false,enabled=false WHERE "tenantId"=$1 AND key=\'inventory\'','UPDATE "TenantModule" SET allowed=true,enabled=true WHERE "tenantId"=$1 AND key=\'inventory\'',[t]],
    ['UPDATE "User" SET status=\'SUSPENDED\' WHERE id=$1','UPDATE "User" SET status=\'ACTIVE\' WHERE id=$1',[east]],
   ]){await q(change,args);try{await assert.rejects(setStock(east,initial,100,(await stock()).version),/office access/)}finally{await q(undo,args)}}
   await assert.rejects(transaction(east,c=>c.query('SELECT app.inventory_post_receipt($1,$2)',[foreign,purchase])),/not permitted/)
  })
  await check('a stock command waiting on the shared lock sees committed permission revocation',async()=>{
   const before=await snapshot(),pid=(await runtime.query('SELECT pg_backend_pid() pid')).rows[0].pid
   await q('BEGIN');await q("SELECT pg_advisory_xact_lock(hashtextextended('workforce-schedules:'||$1,0))",[t])
   const pending=setStock(east,initial,100,(await stock()).version).then(()=>({ok:true}),error=>({error}))
   try{
    let waiting=false
    for(let n=0;n<50;n++){waiting=(await q("SELECT wait_event='advisory' blocked FROM pg_stat_activity WHERE pid=$1",[pid])).rows[0]?.blocked;if(waiting)break;await new Promise(r=>setTimeout(r,20))}
    assert.equal(waiting,true,'command reached the native operation lock')
    await q('UPDATE "TenantAccessRole" SET archived=true WHERE id=$1',[t+'_role']);await q('COMMIT')
    const result=await pending;assert.ok(result.error);assert.match(result.error.message,/office access/);assert.deepEqual(await snapshot(),before)
   }finally{await q('ROLLBACK');await q('UPDATE "TenantAccessRole" SET archived=false WHERE id=$1',[t+'_role']);await pending}
  })
  await check('audit failure rolls back correction, booking and complete receipt transactions',async()=>{
   const before=await snapshot();await q(`CREATE FUNCTION app.test_inventory_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."tenantId"='${t}' AND NEW.event='inventory.stock.updated' THEN RAISE EXCEPTION 'rehearsal audit failure';END IF;RETURN NEW;END $$;CREATE TRIGGER test_inventory_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION app.test_inventory_audit_failure()`)
   try{
    await assert.rejects(setStock(east,initial,24,(await stock()).version),/rehearsal audit failure/);assert.deepEqual(await snapshot(),before)
    await assert.rejects(transaction(west,c=>createPurchase(c,t+'_audit_failure'),{office:second,inventoryOp:'inventoryPurchases.create'}),/rehearsal audit failure/);assert.deepEqual(await snapshot(),before)
    await assert.rejects(transaction(east,async c=>{await c.query('UPDATE "AppointmentOrder" SET status=\'CONFIRMED\' WHERE id=$1',[booking]);await c.query('SELECT app.inventory_post_booking($1,$2)',[t,booking])}),/rehearsal audit failure/);assert.deepEqual(await snapshot(),before)
   }finally{await q('DROP TRIGGER test_inventory_audit ON "AuditLog";DROP FUNCTION app.test_inventory_audit_failure()')}
  })
  await check('create-only product access captures office/version and cannot become stock Edit',async()=>{
   const creator=t+'_creator',role=t+'_creator_role',created=t+'_created_product',createPermissions=['inventoryProducts.read','inventoryProducts.create']
   await q('INSERT INTO "User"(id,"tenantId",email,role,"updatedAt") VALUES($1,$2,$1||\'@example.test\',\'MANAGER\',now())',[creator,t])
   await q('INSERT INTO "TenantAccessRole"(id,"tenantId",name,"nameKey",permissions,"updatedAt") VALUES($1,$2,$1,$1,$3,now())',[role,t,createPermissions]);await q('INSERT INTO "TenantRoleAssignment"("tenantId","userId","roleId","updatedAt") VALUES($1,$2,$3,now())',[t,creator,role]);await q('INSERT INTO "TenantUserAccess"("tenantId","userId",rules,"updatedAt") VALUES($1,$2,$3,now())',[t,creator,Object.fromEntries(createPermissions.map(p=>[p,'ALL']))]);await q('INSERT INTO "BusinessOfficePolicy"("tenantId","userId","creationOfficeId",version,"updatedAt") VALUES($1,$2,$3,5,now())',[t,creator,initial]);await q('INSERT INTO "BusinessOfficeGrant"("tenantId","userId","officeId") VALUES($1,$2,$3)',[t,creator,initial])
   const create=(id,version)=>transaction(creator,async c=>{await c.query('INSERT INTO "InventoryProduct"(id,"tenantId",sku,name,"categoryId","updatedAt") VALUES($1,$2,$1,$1,$3,now())',[id,t,t+'_category']);await c.query('SELECT app.inventory_set_stock($1,$2,$3,3,100,2,5,0)',[t,initial,id])},{inventoryOp:'inventoryProducts.create',version})
   await assert.rejects(create(created+'_stale',4),/Office context changed/);assert.equal((await q('SELECT id FROM "InventoryProduct" WHERE id=$1',[created+'_stale'])).rows.length,0)
   await create(created,5);assert.equal((await q('SELECT "onHandQty" FROM "InventoryOfficeStock" WHERE "productId"=$1',[created])).rows[0].onHandQty,3)
   await assert.rejects(transaction(creator,c=>c.query('SELECT app.inventory_set_stock($1,$2,$3,20,NULL,NULL,NULL,1)',[t,initial,created])),/office access/)
   await assert.rejects(transaction(creator,c=>c.query('SELECT app.inventory_set_stock($1,$2,$3,20,NULL,NULL,NULL,1)',[t,initial,created]),{inventoryOp:'inventoryProducts.create'}),/office access/)
  })
  await check('hidden references and purchase numbering use bounded integrity projections',async()=>{
   const referenced=await transaction(west,c=>c.query('SELECT app.inventory_product_referenced($1,$2) used',[t,product]));assert.equal(referenced.rows[0].used,true)
   await assert.rejects(transaction(east,c=>c.query('DELETE FROM "InventoryProduct" WHERE id=$1',[product])),/must be archived/)
   const prefix='PO-'+new Date().toISOString().slice(0,10).replaceAll('-','')+'-'
   await q('UPDATE "PurchaseOrder" SET "orderNumber"=$1 WHERE id=$2',[prefix+'0042',t+'_new_purchase'])
   const result=await transaction(east,c=>c.query('SELECT app.inventory_next_purchase_number($1) number',[t]));assert.equal(result.rows[0].number,prefix+'0043')
   await assert.rejects(transaction(plain,c=>c.query('SELECT app.inventory_next_purchase_number($1)',[t])),/not permitted/)
   assert.deepEqual((await q('SELECT * FROM "_prisma_migrations" ORDER BY id')).rows,ledger)
  })
  console.log(`Pending Inventory office migration: ${count} checks passed. Candidate only; deployed migrations, runtime schema, hosted data and migration ledger unchanged.`)
 }finally{await runtime.end();await db.end()}
}
main().catch(e=>{console.error(e);process.exitCode=1})
