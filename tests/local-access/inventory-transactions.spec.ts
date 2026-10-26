import { test, expect } from "@playwright/test"
import { seed, login, json, assignProfiles } from "./fixtures"

test("real tenant sign-ins retain receipt idempotency, stock audits and fresh access checks", async ({ browser }) => {
  test.setTimeout(120_000)
  const f = await seed(), admin = await login(browser, f.origin, f.users.admin.email)
  let manager: typeof admin | undefined
  try {
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
    await json(manager.context, `/api/inventory/products/${product.id}`, 200, "PATCH", { onHandQty: 9 })
    await manager.page.reload()
    await expect(manager.page.getByRole("cell", { name: "9", exact: true })).toBeVisible()
    await manager.page.screenshot({ path: "test-results/local-access/inventory-transactions.png", fullPage: true })
    const movements = (await f.db.query('SELECT "quantityDelta" FROM "InventoryStockMovement" WHERE "productId"=$1 ORDER BY "createdAt",id', [product.id])).rows
    expect(movements.map(row => row.quantityDelta)).toEqual([5, 2, 2])
    const audit = (await f.db.query(`SELECT "actorUserId","before","after" FROM "AuditLog" WHERE "entityId"=$1 AND event='inventory.inventoryProducts.edit'`, [product.id])).rows[0]
    expect(audit.actorUserId).toBe(f.users.manager.id); expect(audit.before.onHandQty).toBe(7); expect(audit.after.onHandQty).toBe(9)
    await assignProfiles(admin.context, f.users.manager.id, [])
    await json(manager.context, `/api/inventory/products/${product.id}`, 403, "PATCH", { onHandQty: 99 })
    expect((await json(admin.context, "/api/inventory/products")).items[0].onHandQty).toBe(9)
  } finally { await manager?.context.close(); await admin.context.close(); await f.db.end() }
})
