import { inventoryError } from "./office"
import { Prisma } from "@prisma/client"
import { authorizeBusinessOperation } from "@/platform/access/operation"
import { tenantOperationTransaction } from "@/platform/transactions/tenant-operation"
import { recordDomainAuditEvent } from "@/lib/domain-audit"
import { requirePermission } from "@/platform/access/policy"
import { BusinessError, type BusinessActor } from "@/platform/policy"

export type InventoryResource = "inventoryProducts" | "inventoryCategories" | "inventorySuppliers" | "inventoryPurchases"
const tables = { inventoryProducts: "InventoryProduct", inventoryCategories: "InventoryCategory", inventorySuppliers: "Supplier", inventoryPurchases: "PurchaseOrder" } as const
function snapshot(tx: Prisma.TransactionClient, tenantId: string, resource: InventoryResource, id: string) {
  const where = { tenantId, id }
  switch (resource) {
    case "inventoryProducts": return tx.inventoryProduct.findFirst({ where, include: { taxes: true, suppliers: true } })
    case "inventoryCategories": return tx.inventoryCategory.findFirst({ where })
    case "inventorySuppliers": return tx.supplier.findFirst({ where })
    case "inventoryPurchases": return tx.purchaseOrder.findFirst({ where, include: { items: true } })
  }
}
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value))

export function inventoryMutation<T>(identity: BusinessActor, resource: InventoryResource, action: "create" | "edit" | "archive",
  input: { id?: string; status?: string }, write: (tx: Prisma.TransactionClient, actor: BusinessActor) => Promise<T>) {
  return tenantOperationTransaction(identity.tenantId, async tx => {
    // Acquire source row locks before refreshing authority: a request may have
    // waited behind a receipt or an administrative correction.
    if (input.id) await tx.$queryRaw(Prisma.sql`SELECT id FROM ${Prisma.raw(`"${tables[resource]}"`)} WHERE "tenantId"=${identity.tenantId} AND id=${input.id} FOR UPDATE`)
    const actor = await authorizeBusinessOperation(tx, identity, `${resource}.${action}`, ["inventory"])
    await tx.$executeRaw`SELECT set_config('app.inventory_operation', ${`${resource}.${action}`}, true)`
    const before = input.id ? await snapshot(tx, actor.tenantId, resource, input.id) : null
    if (input.id && !before) throw new BusinessError(404, "Inventory record not found.")
    if (resource !== "inventoryPurchases" && input.status !== undefined && input.status !== (before?.status ?? "ACTIVE")) requirePermission(actor, `${resource}.archive`)
    const result = await write(tx, actor)
    const id = input.id ?? (result as { id?: string } | null)?.id
    if (!id) throw new Error("Inventory mutation did not return its record identity.")
    const after = await snapshot(tx, actor.tenantId, resource, id)
    await recordDomainAuditEvent(tx, {
      tenantId: actor.tenantId, actorUserId: actor.userId, actorRole: actor.role, requestId: actor.requestId,
      event: `inventory.${resource}.${action}`, entityType: resource, entityId: id,
      ...(resource === "inventoryPurchases" ? { metadata: { officeId: ((after ?? before) as { officeId: string }).officeId, officeFamily: "inventory" } } : {}),
      ...(before ? { before: json(before) } : {}), ...(after ? { after: json(after) } : {}),
    })
    return result
  }).catch(inventoryError)
}
