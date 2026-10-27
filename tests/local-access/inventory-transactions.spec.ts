import { test, expect } from "@playwright/test"
import { seed, login, json, assignProfiles, assignOffices } from "./fixtures"

test("real tenant sign-ins retain receipt idempotency, stock audits and fresh access checks", async ({ browser }) => {
  test.setTimeout(120_000)
  const f = await seed(), admin = await login(browser, f.origin, f.users.admin.email)
  let manager: typeof admin | undefined
  try {
    const initial = (await json(admin.context, "/api/offices")).items[0]
    await assignOffices(admin.context, f.users.admin.id, [initial.id], initial.id)
    await assignOffices(admin.context, f.users.manager.id, [initial.id], initial.id)
    const category = (await json(admin.context, "/api/inventory/categories", 201, "POST", { name: "Atomic stock category" })).item
    const supplier = (await json(admin.context, "/api/inventory/suppliers", 201, "POST", { name: "Atomic stock supplier" })).item
    const product = (await json(admin.context, "/api/inventory/products", 201, "POST", { sku: "ATOMIC-STOCK", name: "Atomic inventory stock", categoryId: category.id, costPriceCents: 100, mrpCents: 150, onHandQty: 5 })).item
    const purchase = (await json(admin.context, "/api/inventory/purchases", 201, "POST", { supplierId: supplier.id, orderDate: "2036-02-01", items: [{ productId: product.id, quantity: 2, unitCostCents: 100 }] })).item
    await json(admin.context, `/api/inventory/purchases/${purchase.id}`, 200, "PATCH", { status: "RECEIVED" })
    await json(admin.context, `/api/inventory/purchases/${purchase.id}`, 200, "PATCH", { status: "RECEIVED" })
    expect((await json(admin.context, "/api/inventory/products")).items[0].onHandQty).toBe(7)
    manager = await login(browser, f.origin, f.users.manager.email)
    await manager.page.goto("/inventory")
    await expect(manager.page.getByRole("heading", { name: "Inventory products", exact: true })).toBeVisible()
    await expect(manager.page.getByRole("cell", { name: "ATOMIC-STOCK", exact: true })).toBeVisible()
    const current=(await json(manager.context, `/api/inventory/products/${product.id}`)).item
    await json(manager.context, `/api/inventory/products/${product.id}`, 200, "PATCH", { onHandQty: 9,officeId:current.officeId,stockVersion:current.stockVersion })
    await manager.page.reload()
    await expect(manager.page.getByRole("cell", { name: "9", exact: true })).toBeVisible()
    await manager.page.screenshot({ path: "test-results/local-access/inventory-transactions.png", fullPage: true })
    const summary=await json(manager.context,"/api/dashboard/summary")
    expect(summary.stockOffice.id).toBe(current.officeId)
    await manager.page.goto("/dashboard")
    await expect(manager.page.getByText(new RegExp("Stock office:.*"+summary.stockOffice.name))).toBeVisible()
    await manager.page.screenshot({path:"test-results/local-access/inventory-dashboard-office.png",fullPage:true,animations:"disabled"})
    const movements = (await f.db.query('SELECT "quantityDelta" FROM "InventoryStockMovement" WHERE "productId"=$1 ORDER BY "createdAt",id', [product.id])).rows
    expect(movements.map(row => row.quantityDelta)).toEqual([5, 2, 2])
    const audit = (await f.db.query(`SELECT "actorUserId","before","after" FROM "AuditLog" WHERE "entityId"=$1 AND event='inventory.stock.updated' AND "actorUserId"=$2`, [product.id,f.users.manager.id])).rows[0]
    expect(audit.actorUserId).toBe(f.users.manager.id); expect(audit.before.onHandQty).toBe(7); expect(audit.after.onHandQty).toBe(9)
    await assignProfiles(admin.context, f.users.manager.id, [])
    await json(manager.context, `/api/inventory/products/${product.id}`, 403, "PATCH", { onHandQty: 99 })
    expect((await json(admin.context, "/api/inventory/products")).items[0].onHandQty).toBe(9)
  } finally { await manager?.context.close(); await admin.context.close(); await f.db.end() }
})

test("office stock forms keep saved sources and reject stale creation drafts",async({browser})=>{
  test.setTimeout(120_000)
  const f=await seed(),admin=await login(browser,f.origin,f.users.admin.email),manager=await login(browser,f.origin,f.users.manager.email)
  try{
    const initial=(await f.db.query('SELECT id,"companyId" FROM "BusinessOffice" WHERE "tenantId"=$1 AND "isInitial"',[f.slug])).rows[0]
    await assignOffices(admin.context,f.users.admin.id,[initial.id],initial.id)
    const west=f.slug+'_west'
    await f.db.query('UPDATE "BusinessOffice" SET name=\'East warehouse\' WHERE id=$1',[initial.id])
    await f.db.query('INSERT INTO "BusinessOffice"(id,"tenantId","companyId",code,name,"updatedAt") VALUES($1,$2,$3,\'WEST\',\'West warehouse\',now())',[west,f.slug,initial.companyId])
    await assignOffices(admin.context,f.users.manager.id,[initial.id,west],initial.id)
    const category=(await json(admin.context,"/api/inventory/categories",201,"POST",{name:"Office stock category"})).item
    const supplier=(await json(admin.context,"/api/inventory/suppliers",201,"POST",{name:"Office stock supplier"})).item
    const product=(await json(manager.context,"/api/inventory/products",201,"POST",{sku:"OFFICE-FORM",name:"Office stock form",categoryId:category.id,costPriceCents:100,mrpCents:500,onHandQty:5})).item
    const purchase=(await json(manager.context,"/api/inventory/purchases",201,"POST",{supplierId:supplier.id,orderDate:"2036-02-01",items:[{productId:product.id,quantity:2,unitCostCents:100}]})).item
    const page=manager.page
    await page.goto("/inventory")
    const row=page.getByRole("row").filter({hasText:"OFFICE-FORM"})
    await row.getByRole("button",{name:"Record actions"}).click()
    await page.getByRole("menuitem",{name:"Edit",exact:true}).click()
    await expect(page.getByText(/Stock office:.*East warehouse/).last()).toBeVisible()
    await page.getByText("Pricing and stock",{exact:true}).click()
    await page.getByLabel("Stock on hand",{exact:true}).fill("8")
    const current=await json(manager.context,"/api/workspace/office")
    await json(manager.context,"/api/workspace/office",200,"PATCH",{officeId:west,version:current.version})
    await page.getByRole("button",{name:"Save changes",exact:true}).click()
    await expect(page.getByText("Product updated.",{exact:true})).toBeVisible()
    const balances=async()=> (await f.db.query('SELECT "officeId","onHandQty" FROM "InventoryOfficeStock" WHERE "productId"=$1 ORDER BY "officeId"',[product.id])).rows
    expect(await balances()).toEqual([{officeId:initial.id,onHandQty:8}])
    await page.goto("/inventory/purchases")
    await page.getByRole("row").filter({hasText:purchase.orderNumber}).getByRole("button",{name:"Record actions"}).click()
    await page.getByRole("menuitem",{name:"Mark as received",exact:true}).click()
    await expect(page.getByText(/This adds the ordered quantities to.*East warehouse/)).toBeVisible()
    await page.getByRole("button",{name:"Receive stock",exact:true}).click()
    await expect(page.getByText("Purchase order received. Stock updated.",{exact:true})).toBeVisible()
    expect(await balances()).toEqual([{officeId:initial.id,onHandQty:10}])
    await page.getByRole("button",{name:purchase.orderNumber,exact:true}).click()
    await expect(page.getByRole("dialog").getByText(/East warehouse/)).toBeVisible()
    await page.screenshot({path:"test-results/local-access/inventory-source-office.png",fullPage:true,animations:"disabled"})
    await page.goto("/inventory")
    await expect(page.getByText(/Stock office:.*West warehouse/)).toBeVisible()
    await page.locator("#inventory-office").click()
    await page.getByRole("option",{name:"East warehouse",exact:true}).click()
    await expect(page.getByText(/Stock office:.*East warehouse/).last()).toBeVisible()
    await expect(page.getByRole("cell",{name:"10",exact:true})).toBeVisible()
    await page.getByRole("button",{name:"New product",exact:true}).click()
    await expect(page.getByText(/Stock office:.*West warehouse/)).toBeVisible()
    await page.getByLabel("SKU",{exact:true}).fill("STALE-OFFICE-DRAFT")
    await page.getByLabel("Product name",{exact:true}).fill("Stale office draft")
    await page.locator("#product-category").click()
    await page.getByRole("option",{name:category.name,exact:true}).click()
    const selected=await json(manager.context,"/api/workspace/office")
    await json(manager.context,"/api/workspace/office",200,"PATCH",{officeId:initial.id,version:selected.version})
    await page.getByRole("button",{name:"Create product",exact:true}).click()
    await expect(page.getByRole("alert")).toContainText("Office context changed")
    expect((await f.db.query('SELECT id FROM "InventoryProduct" WHERE "tenantId"=$1 AND sku=\'STALE-OFFICE-DRAFT\'',[f.slug])).rows).toHaveLength(0)
    await page.screenshot({path:"test-results/local-access/inventory-stale-office.png",fullPage:true,animations:"disabled"})
  }finally{await manager.context.close();await admin.context.close();await f.db.end()}
})
