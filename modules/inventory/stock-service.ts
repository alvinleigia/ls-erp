import { stockAuthority } from "./stock-authority"
import type { Prisma } from "@prisma/client"
import type { BusinessActor } from "@/platform/policy"
import { officeBoundaryError } from "@/platform/companies/record-office"

export class StockConflictError extends Error {
  constructor(message: string) { super(message); this.name = "StockConflictError" }
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
