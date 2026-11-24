import type { Prisma } from "@prisma/client"
import type { BusinessActor } from "@/platform/policy"

// An addon owns its validation, record visibility and detail storage.
export type CatalogExtension = {
  key: string
  scope: (tx: Prisma.TransactionClient, actor: BusinessActor, contextId?: string) => Promise<Prisma.CatalogItemWhereInput | null>
  read: (tx: Prisma.TransactionClient, actor: BusinessActor, itemId: string) => Promise<unknown>
  save: (tx: Prisma.TransactionClient, actor: BusinessActor, itemId: string, input: unknown) => Promise<void>
  validateCreate?: (tx: Prisma.TransactionClient, actor: BusinessActor, input: unknown) => Promise<void>
  defaultName?: (tx: Prisma.TransactionClient, actor: BusinessActor, input: unknown) => Promise<string>
  search?: (query: string) => Prisma.CatalogItemWhereInput
  presentation?: (tx: Prisma.TransactionClient, actor: BusinessActor, itemIds: string[]) => Promise<Map<string, CatalogPresentation>>
  documentEvidence?: (tx: Prisma.TransactionClient, actor: BusinessActor, itemId: string) => Promise<Prisma.InputJsonValue>
  reservationBlocks?: (tx: Prisma.TransactionClient, actor: BusinessActor, itemIds: string[]) => Promise<Map<string, string>>
}

export type CatalogPresentation = { displayName: string; displayCode: string | null; selectionLabel: string; documentDescription: string }
