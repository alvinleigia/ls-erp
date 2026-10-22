import type { Prisma, SalesOrder } from "@prisma/client"
import type { BusinessActor } from "@/platform/policy"
export type ReservationOrderSource = {
  // Supplied by application composition; core catalog owns no CRM/property logic.
  find: (tx: Prisma.TransactionClient, actor: BusinessActor, orderId: string) => Promise<SalesOrder>
  units: (order: SalesOrder) => { itemId: string; code: string; name: string }[]
}
