/* eslint-disable @typescript-eslint/no-require-imports */
const {grantPgFixtureUsers}=require("./helpers/access-fixtures.cjs")
const { test, before, after } = require("node:test")
const assert = require("node:assert/strict")
const path = require("node:path")
const { AsyncLocalStorage } = require("node:async_hooks")
const { Client } = require("pg")

const rawUrl = process.env.CRM_TEST_DATABASE_URL
if (!rawUrl) throw new Error("Use the disposable local CRM test database.")
const url = new URL(rawUrl)
if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/ls_salon_crm_test") throw new Error("Only a local CRM test database is permitted.")
const root = new Client({ connectionString: rawUrl })
url.username = "crm_test_runtime"; url.password = ""
process.env.DATABASE_URL = url.toString()
process.env.RLS_POOL_MAX = "2"
const sessions = new AsyncLocalStorage()
// Only authentication is stubbed. Routes, authorization, Prisma and RLS are real.
const authPath = path.resolve(__dirname, "../auth.ts")
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: { auth: async () => { await Promise.resolve(); return sessions.getStore() || null } } }
const { logger } = require("../lib/logger.ts")
const errors = []
logger.info = () => {}
logger.error = (_event, context) => { errors.push(context.error?.message || "Unknown server error") }

const { prisma, runWithTenantDbContext } = require("../lib/prisma.ts")
const { allPermissions, workspaceRead } = require("../platform/access/catalog.ts")
const { satisfies } = require("../platform/access/policy.ts")
const { inventoryNavigation } = require("../application/navigation.ts")
const { applyStockDelta } = require("../modules/appointments/order-stock.ts")
const { resolveOrderData } = require("../modules/appointments/order-resolution.ts")
const seedRoute = require("../app/api/seeds/route.ts")
const bookingOrders = require("../app/api/appointments/orders/route.ts")
const dashboard = require("../app/api/dashboard/summary/route.ts")
const routes = Object.fromEntries(["products", "categories", "suppliers", "purchases"].map(name => [name, {
  list: require(`../app/api/inventory/${name}/route.ts`), detail: require(`../app/api/inventory/${name}/[id]/route.ts`),
}]))
const suffix = require("node:crypto").randomUUID().replaceAll("-", "")
const tenantA = `inventory_a_${suffix}`, tenantB = `inventory_b_${suffix}`
const roleId = `inventory_role_${suffix}`
const session = (tenantId = tenantA, role = "ADMIN") => ({ user: { tenantId, role, id: `${tenantId}_${role.toLowerCase()}` } })
const request = (method, body, tenantId = tenantA, endpoint = "/inventory/categories") => new Request(`http://${tenantId}.localhost/api${endpoint}`, {
  method, headers: { host: `${tenantId}.localhost`, "Content-Type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
})
const invoke = (name, method, body, id, tenant = tenantA, role = "ADMIN") => sessions.run(session(tenant, role), () =>
  (id ? routes[name].detail : routes[name].list)[method](request(method, body, tenant, `/inventory/${name}`), { params: Promise.resolve({ id }) }))
const permissions = values => root.query('UPDATE "TenantAccessRole" SET permissions=$1 WHERE id=$2', [values, roleId])
const flag = (enabled, allowed = true) => root.query('UPDATE "TenantModule" SET enabled=$1,allowed=$2 WHERE "tenantId"=$3 AND key=\'inventory\'', [enabled, allowed, tenantA])
async function ok(response, status = 200) { const data = await response.json(); assert.equal(response.status, status, JSON.stringify({ data, errors })); return data }
let category, supplier, product, purchase
before(async () => {
  await root.connect()
  for (const tenant of [tenantA, tenantB]) {
    await root.query('INSERT INTO "Tenant" (id,name,slug,"updatedAt") VALUES ($1,$1,$1,NOW())', [tenant])
    for (const role of ["ADMIN", "MANAGER", "STAFF"]) {
      const id = `${tenant}_${role.toLowerCase()}`
      await root.query('INSERT INTO "User" (id,name,email,role,"tenantId","updatedAt") VALUES ($1,$1,$2,$3,$4,NOW())', [id, `${id}@example.test`, role, tenant])
    }
    await root.query('INSERT INTO "TenantModule" ("tenantId",key,allowed,enabled,"updatedAt") VALUES ($1,\'inventory\',true,true,NOW())', [tenant])
  }
  await root.query('INSERT INTO "TenantAccessRole" (id,"tenantId",name,"nameKey",permissions,"updatedAt") VALUES ($1,$2,\'Inventory test\',\'inventory test\',$3,NOW())', [roleId, tenantA, []])
  await root.query('INSERT INTO "TenantRoleAssignment" ("tenantId","userId","roleId","updatedAt") VALUES ($1,$2,$3,NOW())', [tenantA, `${tenantA}_manager`, roleId])

 await grantPgFixtureUsers(root,[tenantA,tenantB])
})
after(async () => {
  for (const table of ["PurchaseOrder", "InventoryStockMovement", "InventoryProduct", "InventoryCategory", "Supplier"]) await root.query(`DELETE FROM "${table}" WHERE "tenantId" IN ($1,$2)`, [tenantA, tenantB])
  for (const table of ["RealEstateProjectStatus", "RealEstatePropertyCategory", "RealEstateBuyingTimeframe"]) await root.query(`DELETE FROM "${table}" WHERE "tenantId" IN ($1,$2)`, [tenantA, tenantB])
  await root.query('DELETE FROM "TenantRoleAssignment" WHERE "tenantId"=$1', [tenantA])
  await root.query('DELETE FROM "Tenant" WHERE id IN ($1,$2)', [tenantA, tenantB])
  await root.end()
  await Promise.all([global.prisma, global.prismaBypassClient, ...[...(global.prismaScopedClientCache?.values() || [])].map(entry => entry.client)].filter(Boolean).map(client => client.$disconnect()))
  await global.prismaPool?.end()
})

test("every inventory endpoint fails closed when disabled, revoked or missing", async () => {
  for (const state of ["disabled", "revoked", "missing"]) {
    if (state === "missing") await root.query('DELETE FROM "TenantModule" WHERE "tenantId"=$1', [tenantA])
    else await flag(false, state !== "revoked")
    for (const [name, pair] of Object.entries(routes)) {
      for (const method of ["GET", "POST"]) assert.equal((await invoke(name, method, method === "POST" ? {} : undefined)).status, 403, `${state} ${name} ${method}`)
      for (const method of Object.keys(pair.detail)) assert.equal((await invoke(name, method, {}, "unknown")).status, 403, `${state} ${name} ${method}`)
    }
  }
  await root.query('INSERT INTO "TenantModule" ("tenantId",key,allowed,enabled,"updatedAt") VALUES ($1,\'inventory\',true,true,NOW())', [tenantA])
})

test("legacy administrator can create and list inventory through enforced RLS", async () => {
  category = (await ok(await invoke("categories", "POST", { name: "Inventory test category" }), 201)).item
  supplier = (await ok(await invoke("suppliers", "POST", { name: "Inventory test supplier", notes: "Preserve supplier notes" }), 201)).item
  product = (await ok(await invoke("products", "POST", { sku: "TEST-STOCK", name: "Inventory test product", categoryId: category.id, costPriceCents: 100, mrpCents: 150, onHandQty: 5, reorderPoint: 10 }), 201)).item
  purchase = (await ok(await invoke("purchases", "POST", { supplierId: supplier.id, orderDate: "2026-10-03", notes: "Deliver to office", items: [{ productId: product.id, quantity: 2, unitCostCents: 100 }] }), 201)).item
  assert.equal(supplier.notes, "Preserve supplier notes")
  assert.equal(purchase.notes, "Deliver to office")
  await ok(await invoke("suppliers", "PATCH", { contactPerson: "New contact" }, supplier.id))
  assert.equal((await ok(await invoke("suppliers", "GET"))).items[0].notes, "Preserve supplier notes")
  for (const name of Object.keys(routes)) {
    const data = await ok(await invoke(name, "GET"))
    assert.equal(data.total, 1); assert.equal(data.items.length, 1)
    assert.equal((await ok(await invoke(name, "GET", undefined, undefined, tenantB))).total, 0)
  }
})

test("read-only roles cannot write or access ungranted entities; permissions do not promote staff", async () => {
  await permissions(["inventoryCategories.read"])
  await ok(await invoke("categories", "GET", undefined, undefined, tenantA, "MANAGER"))
  assert.equal((await invoke("products", "GET", undefined, undefined, tenantA, "MANAGER")).status, 403)
  assert.equal((await invoke("categories", "POST", { name: "Denied" }, undefined, tenantA, "MANAGER")).status, 403)
  assert.equal((await invoke("categories", "PATCH", { name: "Denied" }, category.id, tenantA, "MANAGER")).status, 403)
  assert.equal((await invoke("categories", "DELETE", undefined, category.id, tenantA, "MANAGER")).status, 403)
  assert.equal((await invoke("categories", "GET", undefined, undefined, tenantA, "STAFF")).status, 403)
})

test("edit permits unchanged status but archive/reactivation requires archive permission", async () => {
  await permissions(["inventoryCategories.read", "inventoryCategories.edit"])
  await ok(await invoke("categories", "PATCH", { name: "Edited category", status: "ACTIVE" }, category.id, tenantA, "MANAGER"))
  assert.equal((await invoke("categories", "PATCH", { status: "INACTIVE" }, category.id, tenantA, "MANAGER")).status, 403)
  await permissions(["inventoryCategories.read", "inventoryCategories.edit", "inventoryCategories.archive"])
  await ok(await invoke("categories", "PATCH", { status: "INACTIVE" }, category.id, tenantA, "MANAGER"))
  await ok(await invoke("categories", "PATCH", { status: "ACTIVE" }, category.id))
})

test("record IDs cannot cross tenants; audit records identify the manager and snapshots", async () => {
  assert.equal((await invoke("categories", "PATCH", { name: "Cross tenant" }, category.id, tenantB)).status, 404)
  const audit = (await root.query('SELECT * FROM "AuditLog" WHERE "entityId"=$1 AND "actorUserId"=$2 ORDER BY "createdAt" DESC', [category.id, `${tenantA}_manager`])).rows
  assert.equal(audit.length, 2)
  assert.equal(audit[0].before.status, "ACTIVE"); assert.equal(audit[0].after.status, "INACTIVE")
})

test("purchase receiving requires stock edit and changes stock exactly once on repeated receive", async () => {
  await permissions(["inventoryPurchases.read", "inventoryPurchases.create", "inventoryPurchases.edit"])
  assert.equal((await invoke("purchases", "PATCH", { status: "RECEIVED" }, purchase.id, tenantA, "MANAGER")).status, 403)
  assert.equal((await invoke("purchases", "POST", { supplierId: supplier.id, orderDate: "2026-10-03", status: "RECEIVED", items: [{ productId: product.id, quantity: 2, unitCostCents: 100 }] }, undefined, tenantA, "MANAGER")).status, 403)
  await permissions(["inventoryPurchases.read", "inventoryPurchases.edit", "inventoryProducts.read", "inventoryProducts.edit"])
  await ok(await invoke("purchases", "PATCH", { status: "RECEIVED" }, purchase.id, tenantA, "MANAGER"))
  await ok(await invoke("purchases", "PATCH", { status: "RECEIVED" }, purchase.id, tenantA, "MANAGER"))
  assert.equal((await root.query('SELECT "onHandQty" FROM "InventoryProduct" WHERE id=$1', [product.id])).rows[0].onHandQty, 7)
})

test("disabled inventory blocks product resolution and stock changes without touching stock", async () => {
  await flag(false)
  const actor = { tenantId: tenantA, userId: `${tenantA}_admin`, role: "ADMIN" }
  await runWithTenantDbContext(tenantA, async () => {
    await assert.rejects(resolveOrderData({ productLines: [{ productId: product.id }] }, { tenantId: tenantA, actor }), error => error.status === 403)
    await assert.rejects(prisma.$transaction(tx => applyStockDelta({ tx, actor, tenantId: tenantA, orderId: "test", deltaByProduct: new Map([[product.id, -1]]) })), error => error.status === 403)
    // Service-only/no-op stock operations need no inventory activation.
    await prisma.$transaction(tx => applyStockDelta({ tx, actor, tenantId: tenantA, orderId: "test", deltaByProduct: new Map() }))
  })
  assert.equal((await root.query('SELECT "onHandQty" FROM "InventoryProduct" WHERE id=$1', [product.id])).rows[0].onHandQty, 7)
  await flag(true)
  await runWithTenantDbContext(tenantA, () => assert.rejects(prisma.$transaction(tx => applyStockDelta({ tx, actor: { ...actor, permissions: ["inventoryProducts.read"] }, tenantId: tenantA, orderId: "test", deltaByProduct: new Map([[product.id, -1]]) })), error => error.status === 403))
})

test("stock deduction/restoration is transactional for an authorized appointment operation", async () => {
  const actor = { tenantId: tenantA, userId: `${tenantA}_admin`, role: "ADMIN" }
  for (const delta of [-1, 1]) await runWithTenantDbContext(tenantA, () => prisma.$transaction(tx => applyStockDelta({ tx, actor, tenantId: tenantA, orderId: "test", deltaByProduct: new Map([[product.id, delta]]) })))
  assert.equal((await root.query('SELECT "onHandQty" FROM "InventoryProduct" WHERE id=$1', [product.id])).rows[0].onHandQty, 7)
})

test("shared stock service accepts non-booking movements and rolls back with its caller", async () => {
  const { applyInventoryStockDelta, StockConflictError } = require("../modules/inventory/stock-service.ts")
  const actor = { tenantId: tenantA, userId: `${tenantA}_admin`, role: "ADMIN" }
  const note = "Operational stock check"
  const movement = delta => ({ type: delta < 0 ? "ADJUSTMENT_SUB" : "ADJUSTMENT_ADD", note })
  const apply = (delta, extra = {}) => runWithTenantDbContext(tenantA, () => prisma.$transaction(tx =>
    applyInventoryStockDelta({ tx, actor, tenantId: tenantA, deltaByProduct: new Map([[product.id, delta]]), movement, ...extra })))
  await apply(-1)
  await apply(1)
  const rows = (await root.query('SELECT type,"quantityDelta",note FROM "InventoryStockMovement" WHERE "tenantId"=$1 AND note=$2 ORDER BY "quantityDelta"', [tenantA, note])).rows
  assert.deepEqual(rows, [{ type: "ADJUSTMENT_SUB", quantityDelta: -1, note }, { type: "ADJUSTMENT_ADD", quantityDelta: 1, note }])
  await assert.rejects(apply(-100), error => error instanceof StockConflictError)
  await assert.rejects(apply(-1, { tenantId: tenantB }), error => error.status === 403)
  await assert.rejects(runWithTenantDbContext(tenantA, () => prisma.$transaction(async tx => {
    await applyInventoryStockDelta({ tx, actor, tenantId: tenantA, deltaByProduct: new Map([[product.id, -1]]), movement })
    throw new Error("Source record failed")
  })), /Source record failed/)
  assert.equal((await root.query('SELECT "onHandQty" FROM "InventoryProduct" WHERE id=$1', [product.id])).rows[0].onHandQty, 7)
  assert.equal((await root.query('SELECT count(*)::int n FROM "InventoryStockMovement" WHERE "tenantId"=$1 AND note=$2', [tenantA, note])).rows[0].n, 2)
})

test("maintenance cannot bypass module activation or restricted roles", async () => {
  await flag(false)
  for (const body of [{ action: "seed", groups: ["purchases"] }, { action: "clear" }, { action: "clearModules", modules: ["taxes"] }]) {
    const response = await sessions.run(session(), () => seedRoute.POST(request("POST", body)))
    assert.equal(response.status, 403)
  }
  await flag(true)
  assert.equal((await sessions.run(session(tenantA, "MANAGER"), () => seedRoute.POST(request("POST", { action: "seed", groups: ["users"] })))).status, 403)
})

test("dashboard stock respects activation and product view permission", async () => {
  const load = role => sessions.run(session(tenantA, role), () => dashboard.GET(request("GET", undefined, tenantA, "/dashboard/summary")))
  const enabled = await ok(await load("ADMIN")); assert.equal(enabled.lowStock.length, 1)
  await flag(false)
  assert.equal((await ok(await load("ADMIN"))).lowStock.length, 0)
  await flag(true); await permissions(["dashboard.read", "inventoryCategories.read"])
  assert.equal((await ok(await load("MANAGER"))).lowStock.length, 0)
})

test("stale sessions cannot retain management access after demotion", async () => {
  await root.query('UPDATE "User" SET role=\'STAFF\' WHERE id=$1', [`${tenantA}_admin`])
  assert.equal((await invoke("categories", "GET")).status, 403)
  assert.equal((await sessions.run(session(), () => bookingOrders.POST(request("POST", {})))).status, 403)
  await root.query('UPDATE "User" SET role=\'ADMIN\' WHERE id=$1', [`${tenantA}_admin`])
})

test("inventory navigation is independent of CRM and uses the first permitted view", () => {
  const flags = [{ key: "inventory", enabled: true, allowed: true }]
  assert.equal(inventoryNavigation(flags).length, 1)
  assert.deepEqual(inventoryNavigation(flags, ["inventorySuppliers.read"])[0].items.map(item => item.href), ["/inventory/suppliers"])
  assert.equal(inventoryNavigation(flags, ["inventorySuppliers.read"])[0].href, "/inventory/suppliers")
  assert.deepEqual(inventoryNavigation(flags, []), [])
  assert.deepEqual(inventoryNavigation([{ key: "inventory", enabled: true, allowed: false }]), [])
  assert.equal(satisfies({ permissions: ["inventoryProducts.read"] }, workspaceRead), false)
  assert.ok(allPermissions.includes("inventoryProducts.archive"))
})

test("catalog keeps shared relationship validation, duplicate protection and bounded paging", async () => {
  const foreignCategory = (await ok(await invoke("categories", "POST", { name: "Foreign catalog" }, undefined, tenantB), 201)).item
  const input = { sku: "CATALOG-A", name: "Catalog A", categoryId: category.id, costPriceCents: 100, mrpCents: 150, supplierLinks: [{ supplierId: supplier.id, isPreferred: true }] }
  const item = (await ok(await invoke("products", "POST", input), 201)).item
  assert.equal((await invoke("products", "POST", input)).status, 409)
  assert.equal((await invoke("products", "POST", { ...input, sku: "FOREIGN", categoryId: foreignCategory.id })).status, 404)
  assert.equal((await invoke("products", "PATCH", { categoryId: foreignCategory.id }, item.id)).status, 404)
  for (const body of [{ supplierLinks: [{ supplierId: "missing" }] }, { taxIds: ["missing"] }]) {
    assert.equal((await invoke("products", "POST", { ...input, sku: "INVALID", ...body })).status, 400)
    assert.equal((await invoke("products", "PATCH", body, item.id)).status, 400)
  }
  const edited = (await ok(await invoke("products", "PATCH", { supplierLinks: [], name: "Catalog Updated" }, item.id))).item
  assert.equal(edited.name, "Catalog Updated"); assert.deepEqual(edited.supplierLinks, [])
  await ok(await invoke("products", "POST", { ...input, sku: "CATALOG-B", name: "Catalog B" }), 201)
  const result = await ok(await sessions.run(session(), () => routes.products.list.GET(request("GET", undefined, tenantA, "/inventory/products?pageSize=1&sort=name&order=asc&q=Catalog"))))
  assert.equal(result.total, 2); assert.equal(result.items.length, 1); assert.equal(result.items[0].name, "Catalog B")
  await ok(await invoke("products", "DELETE", undefined, item.id))
  assert.equal((await root.query('SELECT count(*)::int n FROM "InventoryProduct" WHERE id=$1', [item.id])).rows[0].n, 0)
})

test("concurrent purchase receipts and reopened statuses never receive the same quantity twice", async () => {
  const taxId = `${tenantA}_receipt_tax`
  await root.query('INSERT INTO "Tax" (id,"tenantId",name,percent,"updatedAt") VALUES ($1,$2,\'Receipt tax\',18,now())', [taxId, tenantA])
  const item = (await ok(await invoke("products", "POST", { sku: "RECEIPT", name: "Receipt kit", categoryId: category.id, costPriceCents: 0, mrpCents: 150, taxIds: [taxId] }), 201)).item
  const body = { supplierId: supplier.id, orderDate: "2026-10-16", items: [{ productId: item.id, quantity: 3, unitCostCents: 101 }] }
  const order = (await ok(await invoke("purchases", "POST", body), 201)).item
  assert.equal(order.subtotalCents, 303); assert.equal(order.taxCents, 55); assert.equal(order.totalCents, 358)
  let calls, waiting = 0
  await root.query("BEGIN")
  try {
    await root.query('SELECT id FROM "PurchaseOrder" WHERE id=$1 FOR UPDATE', [order.id])
    calls = Promise.all([1, 2].map(() => invoke("purchases", "PATCH", { status: "RECEIVED" }, order.id)))
    const deadline = Date.now() + 3000
    while (Date.now() < deadline && waiting < 2) {
      await root.query("SELECT pg_stat_clear_snapshot()")
      waiting = (await root.query("SELECT count(*)::int n FROM pg_stat_activity WHERE usename='crm_test_runtime' AND wait_event_type='Lock'")).rows[0].n
      if (waiting < 2) await new Promise(resolve => setTimeout(resolve, 20))
    }
  } finally { await root.query("COMMIT") }
  const responses = await calls
  assert.equal(waiting, 2, "Both receipt transactions must contend for the locked purchase")
  for (const response of responses) {
    const received = (await ok(response)).item
    assert.equal(received.items[0].receivedQty, 3)
  }
  for (let cycle = 0; cycle < 2; cycle++) {
    await ok(await invoke("purchases", "PATCH", { status: "ORDERED" }, order.id))
    const received = (await ok(await invoke("purchases", "PATCH", { status: "RECEIVED", notes: "Retain receipt" }, order.id))).item
    assert.equal(received.items[0].receivedQty, 3); assert.equal(received.notes, "Retain receipt")
  }
  assert.equal((await root.query('SELECT "onHandQty" FROM "InventoryProduct" WHERE id=$1', [item.id])).rows[0].onHandQty, 3)
  assert.equal((await root.query('SELECT count(*)::int n FROM "InventoryStockMovement" WHERE "productId"=$1', [item.id])).rows[0].n, 1)
  const direct = (await ok(await invoke("purchases", "POST", { ...body, status: "RECEIVED" }), 201)).item
  assert.equal(direct.items[0].receivedQty, 3)
  assert.equal((await root.query('SELECT "onHandQty" FROM "InventoryProduct" WHERE id=$1', [item.id])).rows[0].onHandQty, 6)
  assert.equal((await invoke("purchases", "PATCH", { status: "RECEIVED" }, order.id, tenantB)).status, 404)
})


test("inventory categories retain duplicate checks, paging and referenced archive behavior", async () => {
  const first=(await ok(await invoke("categories","POST",{name:"Batch three stock",description:"Original",sortOrder:5}),201)).item
  const second=(await ok(await invoke("categories","POST",{name:"Batch three spare"}),201)).item
  await ok(await invoke("categories","POST",{name:first.name}),409)
  await ok(await invoke("categories","PATCH",{name:first.name},second.id),409)
  const changed=(await ok(await invoke("categories","PATCH",{description:"",sortOrder:0},first.id))).item
  assert.equal(changed.description,null);assert.equal(changed.sortOrder,0);assert.equal(changed.name,first.name)
  const list=query=>sessions.run(session(),()=>routes.categories.list.GET(request("GET",undefined,tenantA,`/inventory/categories${query}`)))
  const page=await ok(await list("?q=batch%20three&pageSize=1&sort=name"))
  assert.equal(page.total,2);assert.equal(page.items.length,1);assert.equal(page.totalPages,2)
  await ok(await list("?pageSize=101"),400)
  const linked=(await ok(await invoke("products","POST",{sku:"CAT-REFERENCE",name:"Linked stock",categoryId:first.id,costPriceCents:10,mrpCents:20}),201)).item
  await ok(await invoke("categories","DELETE",undefined,first.id,tenantB),404)
  await ok(await invoke("categories","DELETE",undefined,first.id))
  assert.equal((await root.query('SELECT status FROM "InventoryCategory" WHERE id=$1',[first.id])).rows[0].status,"INACTIVE")
  assert.equal((await root.query('SELECT "categoryId" FROM "InventoryProduct" WHERE id=$1',[linked.id])).rows[0].categoryId,first.id)
  await ok(await invoke("categories","DELETE",undefined,second.id))
  assert.equal((await root.query('SELECT id FROM "InventoryCategory" WHERE id=$1',[second.id])).rowCount,0)
})

test("supplier partial edits, search and referenced archives retain purchase links", async () => {
  const vendor=(await ok(await invoke("suppliers","POST",{name:"Batch three vendor",contactPerson:"Original",email:"vendor@example.test",city:"Pune",notes:"Keep note",leadTimeDays:3}),201)).item
  const changed=(await ok(await invoke("suppliers","PATCH",{contactPerson:"",email:"",leadTimeDays:0},vendor.id))).item
  assert.equal(changed.contactPerson,null);assert.equal(changed.email,null);assert.equal(changed.leadTimeDays,0)
  assert.equal(changed.city,"Pune");assert.equal(changed.notes,"Keep note")
  await ok(await invoke("suppliers","PATCH",{name:"Foreign change"},vendor.id,tenantB),404)
  const list=query=>sessions.run(session(),()=>routes.suppliers.list.GET(request("GET",undefined,tenantA,`/inventory/suppliers${query}`)))
  const page=await ok(await list("?q=batch%20three&pageSize=1&sort=name"))
  assert.equal(page.total,1);assert.equal(page.items[0].id,vendor.id)
  await ok(await list("?pageSize=101"),400)
  const order=(await ok(await invoke("purchases","POST",{supplierId:vendor.id,orderDate:"2026-10-16",items:[{productId:product.id,quantity:1,unitCostCents:10}]}),201)).item
  await ok(await invoke("suppliers","DELETE",undefined,vendor.id))
  assert.equal((await root.query('SELECT status FROM "Supplier" WHERE id=$1',[vendor.id])).rows[0].status,"INACTIVE")
  assert.equal((await root.query('SELECT "supplierId" FROM "PurchaseOrder" WHERE id=$1',[order.id])).rows[0].supplierId,vendor.id)
  const spare=(await ok(await invoke("suppliers","POST",{name:"Unreferenced vendor"}),201)).item
  await ok(await invoke("suppliers","DELETE",undefined,spare.id))
  assert.equal((await root.query('SELECT id FROM "Supplier" WHERE id=$1',[spare.id])).rowCount,0)
  const events=(await root.query('SELECT event,after FROM "AuditLog" WHERE "entityId"=$1',[vendor.id])).rows
  assert.ok(events.some(row=>row.event==='inventory.inventorySuppliers.archive'&&row.after.status==='INACTIVE'))
})
