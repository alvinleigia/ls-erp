import type { AppointmentOrderStatus, Prisma } from "@prisma/client"
import { requireBusinessModule } from "@/platform/module-server"
import { requirePermission } from "@/platform/access/policy"
import { BusinessError, type BusinessActor } from "@/platform/policy"

type ProductQtyLine = {
  productId: string
  quantity: number
}

const STOCK_IMPACT_STATUSES = new Set<AppointmentOrderStatus>([
  "CONFIRMED",
  "COMPLETED",
])

export class StockConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "StockConflictError"
  }
}

export const hasStockImpact = (status: AppointmentOrderStatus) =>
  STOCK_IMPACT_STATUSES.has(status)

const toQuantityMap = (lines: ProductQtyLine[]) => {
  const map = new Map<string, number>()
  lines.forEach((line) => {
    map.set(line.productId, (map.get(line.productId) ?? 0) + Math.max(0, line.quantity))
  })
  return map
}

export const buildStockDeltaForOrderUpdate = (params: {
  previousStatus: AppointmentOrderStatus
  nextStatus: AppointmentOrderStatus
  previousLines: ProductQtyLine[]
  nextLines: ProductQtyLine[]
}) => {
  const { previousStatus, nextStatus, previousLines, nextLines } = params
  const previousImpacts = hasStockImpact(previousStatus)
  const nextImpacts = hasStockImpact(nextStatus)

  if (!previousImpacts && !nextImpacts) return new Map<string, number>()

  const previousQtyMap = toQuantityMap(previousLines)
  const nextQtyMap = toQuantityMap(nextLines)
  const productIds = new Set([
    ...previousQtyMap.keys(),
    ...nextQtyMap.keys(),
  ])
  const deltaByProduct = new Map<string, number>()

  productIds.forEach((productId) => {
    const previousQty = previousQtyMap.get(productId) ?? 0
    const nextQty = nextQtyMap.get(productId) ?? 0

    let delta = 0
    if (!previousImpacts && nextImpacts) {
      delta = -nextQty
    } else if (previousImpacts && !nextImpacts) {
      delta = previousQty
    } else {
      delta = previousQty - nextQty
    }

    if (delta !== 0) {
      deltaByProduct.set(productId, delta)
    }
  })

  return deltaByProduct
}

export const applyStockDelta = async (params: {
  tx: Prisma.TransactionClient
  deltaByProduct: Map<string, number>
  orderId: string
  tenantId: string
  actor: BusinessActor
}) => {
  const { tx, deltaByProduct, orderId, tenantId } = params
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

  await Promise.all(
    productIds.map((productId) =>
      tx.inventoryProduct.updateMany({
        where: { id: productId, tenantId },
        data: {
          onHandQty: { increment: deltaByProduct.get(productId) ?? 0 },
        },
      })
    )
  )

  await tx.inventoryStockMovement.createMany({
    data: productIds
      .map((productId) => {
        const delta = deltaByProduct.get(productId) ?? 0
        if (delta === 0) return null
        return {
          tenantId,
          productId,
          type:
            delta < 0
              ? "BOOKING_PRODUCT_SALE"
              : "BOOKING_PRODUCT_RESTOCK",
          quantityDelta: delta,
          note:
            delta < 0
              ? `Booking order ${orderId} stock deduction`
              : `Booking order ${orderId} stock restore`,
        } as const
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item)),
  })
}
