import type { Prisma } from "@prisma/client"
import { authorizeBusinessOperation } from "@/platform/access/operation"
import { lockTenantOperations } from "@/platform/transactions/tenant-operation"
import { requirePermission } from "@/platform/access/policy"
import { BusinessError, type BusinessActor } from "@/platform/policy"
import { inventoryError } from "./office"
import { officeBoundaryError } from "@/platform/companies/record-office"

export class StockConflictError extends Error {
  constructor(message: string) { super(message); this.name = "StockConflictError" }
}
async function stockAuthority(tx: Prisma.TransactionClient, actor: BusinessActor, tenantId: string) {
  if (actor.tenantId !== tenantId) throw new BusinessError(403,"Inventory access is required for stock changes.")
  requirePermission(actor,"inventoryProducts.edit")
  await lockTenantOperations(tx,tenantId)
  await authorizeBusinessOperation(tx,actor,"inventoryProducts.edit",["inventory"])
}
// The delta map only identifies a no-op. Native posting derives actual amounts
// from the saved booking and private allocation, in its immutable source office.
export async function postBookingStock(params: { tx: Prisma.TransactionClient; actor: BusinessActor; tenantId: string; orderId: string; deltaByProduct: Map<string,number> }) {
  if (!params.deltaByProduct.size) return
  try {
    await stockAuthority(params.tx,params.actor,params.tenantId)
    await params.tx.$executeRaw`SELECT app.inventory_post_booking(${params.tenantId},${params.orderId},${params.actor.requestId ?? null})`
  } catch(error) { inventoryError(error) }
}
// Explicit office adjustments are independent of booking/receipt workflows.
export async function applyInventoryStockDelta(params: { tx: Prisma.TransactionClient; actor: BusinessActor; tenantId: string; officeId: string; deltaByProduct: Map<string,number> }) {
  if (!params.deltaByProduct.size) return
  try {
    await stockAuthority(params.tx,params.actor,params.tenantId)
    for (const [productId,delta] of [...params.deltaByProduct].sort(([a],[b])=>a.localeCompare(b))) {
      if (delta) await params.tx.$executeRaw`SELECT app.inventory_adjust_stock(${params.tenantId},${params.officeId},${productId},${delta}::integer,${params.actor.requestId ?? null})`
    }
  } catch(error) {
    const mapped = officeBoundaryError(error)
    if (mapped?.status === 409) throw new StockConflictError(mapped.message)
    throw mapped ?? error
  }
}
