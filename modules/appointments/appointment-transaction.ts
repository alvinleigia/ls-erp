import { authorizeBusinessOperation } from "@/platform/access/operation"
import type { Prisma } from "@prisma/client"



import { type BusinessActor } from "@/platform/policy"
import { scheduleTransaction } from "@/modules/workforce/schedule-transaction"

export function appointmentTransaction<T>(actor: BusinessActor, action: "create" | "edit" | "archive",
  write: (tx: Prisma.TransactionClient, currentActor: BusinessActor) => Promise<T>, resource: "appointments" | "appointmentCoupons" = "appointments") {
  return scheduleTransaction(actor.tenantId, async tx => {
    const current = await authorizeBusinessOperation(tx, actor, `${resource}.${action}`, ["appointments"])
    return write(tx, current)
  })
}
