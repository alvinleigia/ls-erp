import type { Prisma } from "@prisma/client"
import type { BusinessActor } from "@/platform/policy"

// An addon owns its validation, record visibility and detail storage.
export type CatalogExtension = {
  key: string
  scope: (tx: Prisma.TransactionClient, actor: BusinessActor, contextId?: string) => Promise<Prisma.CatalogItemWhereInput | null>
  read: (tx: Prisma.TransactionClient, actor: BusinessActor, itemId: string) => Promise<unknown>
  save: (tx: Prisma.TransactionClient, actor: BusinessActor, itemId: string, input: unknown) => Promise<void>
}
