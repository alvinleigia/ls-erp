import type { Prisma } from "@prisma/client"
import type { BusinessActor } from "@/platform/policy"
import type { ParticipantConfirmationProof } from "@/platform/participants/requirements"
export type OrderSource = { quotationId: string; revision: number; title: string; customerName: string; currency: string; consideration: string; snapshot: Prisma.InputJsonValue }
export type OrderConfirmationReview = { configurationVersion: number; missing: { participant: string; label: string }[] }
export type SalesOrderSource = {
  scope: (actor: BusinessActor) => Prisma.SalesOrderWhereInput
  read: (tx: Prisma.TransactionClient, actor: BusinessActor, quotationId: string, revision: number) => Promise<OrderSource>
  // Every commercial source must install the shared acceptance boundary.
  onConfirm: (tx: Prisma.TransactionClient, actor: BusinessActor, snapshot: Prisma.JsonValue) => Promise<ParticipantConfirmationProof>
  reviewConfirmation?: (tx: Prisma.TransactionClient, actor: BusinessActor, snapshot: Prisma.JsonValue) => Promise<OrderConfirmationReview>
  onCancel?: (tx: Prisma.TransactionClient, actor: BusinessActor, orderId: string, reason: string) => Promise<void>
}
