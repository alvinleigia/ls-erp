import type { Prisma } from "@prisma/client"
import type { BusinessActor } from "@/platform/policy"
export type ReceivablePlan = { total: string; blocked: string | null; lines: { label: string; amount: string; dueOn: string | null }[] }
export type ReceivableSource = {
  scope: (actor: BusinessActor) => Prisma.SalesOrderWhereInput
  visibleOrderIds: (actor: BusinessActor) => Prisma.Sql
  plan: (snapshot: Prisma.JsonValue) => ReceivablePlan
}
