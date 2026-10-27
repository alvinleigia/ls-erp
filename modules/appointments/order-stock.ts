import type { AppointmentOrderStatus, Prisma } from "@prisma/client"
import type { BusinessActor } from "@/platform/policy"

import { postBookingStock } from "@/modules/inventory/booking-stock"

type ProductQtyLine = {
  productId: string
  quantity: number
}

const STOCK_IMPACT_STATUSES = new Set<AppointmentOrderStatus>([
  "CONFIRMED",
  "COMPLETED",
])

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

// Appointments owns status transitions and the booking-specific movement labels.
export const applyStockDelta = (params: {
  tx: Prisma.TransactionClient
  deltaByProduct: Map<string, number>
  orderId: string
  tenantId: string
  actor: BusinessActor
}) => postBookingStock(params)
