import type { Prisma } from "@prisma/client"
import type { BusinessActor } from "@/platform/policy"
import { stockAuthority } from "./stock-authority"
import { inventoryError } from "./office"

// The delta map only identifies a no-op. Native posting derives actual amounts
// from the saved booking and private allocation, in its immutable source office.
export async function postBookingStock(params: { tx: Prisma.TransactionClient; actor: BusinessActor; tenantId: string; orderId: string; deltaByProduct: Map<string,number> }) {
  if (!params.deltaByProduct.size) return
  try {
    await stockAuthority(params.tx,params.actor,params.tenantId)
    await params.tx.$executeRaw`SELECT app.inventory_post_booking(${params.tenantId},${params.orderId},${params.actor.requestId ?? null})`
  } catch(error) { inventoryError(error) }
}
