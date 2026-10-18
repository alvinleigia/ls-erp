import type { Prisma } from "@prisma/client"
import { requireBusinessModule } from "@/platform/module-server"
import { requirePermission } from "@/platform/access/policy"
import { BusinessError, type BusinessActor } from "@/platform/policy"

export class StockConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "StockConflictError"
  }
}

// The caller owns the transaction so stock and its source record commit together.
export const applyInventoryStockDelta = async (params: {
  tx: Prisma.TransactionClient
  deltaByProduct: Map<string, number>
  movement: (delta: number) => Pick<Prisma.InventoryStockMovementCreateManyInput, "type" | "note">
  tenantId: string
  actor: BusinessActor
}) => {
  const { tx, deltaByProduct, tenantId } = params
  if (!deltaByProduct.size) return
  if (params.actor.tenantId !== tenantId) throw new BusinessError(403, "Inventory access is required for stock changes.")
  await requireBusinessModule(tx, tenantId, "inventory")
  requirePermission(params.actor, "inventoryProducts.edit")

  const productIds = [...deltaByProduct.keys()]
  const products = await tx.inventoryProduct.findMany({
    where: { tenantId, id: { in: productIds } },
    select: { id: true, name: true, onHandQty: true },
  })
  const productMap = new Map(products.map((product) => [product.id, product]))

  productIds.forEach((productId) => {
    const product = productMap.get(productId)
    const delta = deltaByProduct.get(productId) ?? 0
    if (!product) {
      throw new StockConflictError(`Product not found for stock update (${productId}).`)
    }
    if (product.onHandQty + delta < 0) {
      throw new StockConflictError(
        `Insufficient stock for product "${product.name}". Available: ${product.onHandQty}.`
      )
    }
  })

  // A conditional increment is checked by Postgres against the latest locked row.
  // Stable ordering also avoids deadlocks when two orders touch the same products.
  for (const productId of [...productIds].sort()) {
    const delta = deltaByProduct.get(productId) ?? 0
    if (!delta) continue
    const updated = await tx.inventoryProduct.updateMany({
      where: { id: productId, tenantId, ...(delta < 0 ? { onHandQty: { gte: -delta } } : {}) },
      data: { onHandQty: { increment: delta } },
    })
    if (updated.count !== 1) throw new StockConflictError("Stock changed or is insufficient. Refresh before saving.")
  }

  await tx.inventoryStockMovement.createMany({
    data: productIds
      .map((productId) => {
        const delta = deltaByProduct.get(productId) ?? 0
        if (delta === 0) return null
        return {
          tenantId,
          productId,
          quantityDelta: delta,
          ...params.movement(delta),
        } as const
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item)),
  })
}
