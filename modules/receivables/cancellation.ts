import type { Prisma } from "@prisma/client"
import { BusinessError, type BusinessActor } from "@/platform/policy"
export async function requireResolvedPayments(tx: Prisma.TransactionClient, actor: BusinessActor, orderId: string) {
  if (await tx.orderReceipt.count({ where: { tenantId: actor.tenantId, orderId, status: "POSTED" } })) {
    throw new BusinessError(409, "Resolve recorded payments with a correction or full refund before cancelling this order.")
  }
}
