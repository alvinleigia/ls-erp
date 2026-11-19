import type { Prisma } from "@prisma/client"
import type { BusinessActor } from "@/platform/policy"
import type { CatalogExtension } from "./contracts"

export async function reservationBlocks(tx: Prisma.TransactionClient, actor: BusinessActor, extensions: readonly CatalogExtension[], items: { id: string; extensionKey: string | null }[]) {
  const result = new Map<string, string>()
  for (const extension of extensions) {
    const ids = items.filter(item => item.extensionKey === extension.key).map(item => item.id)
    if (!ids.length || !extension.reservationBlocks) continue
    for (const [id, reason] of await extension.reservationBlocks(tx, actor, ids)) result.set(id, reason)
  }
  return result
}
