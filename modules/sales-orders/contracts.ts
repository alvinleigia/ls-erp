import type { Prisma } from "@prisma/client"
import type { BusinessActor } from "@/platform/policy"
export type OrderSource = { quotationId: string; revision: number; title: string; customerName: string; currency: string; consideration: string; snapshot: Prisma.InputJsonValue }
export type SalesOrderSource = {
  scope: (actor: BusinessActor) => Prisma.SalesOrderWhereInput
  read: (tx: Prisma.TransactionClient, actor: BusinessActor, quotationId: string, revision: number) => Promise<OrderSource>
  onCancel?: (tx: Prisma.TransactionClient, actor: BusinessActor, orderId: string, reason: string) => Promise<void>
}
