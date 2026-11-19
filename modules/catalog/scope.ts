import type { Prisma } from "@prisma/client"
import type { BusinessActor } from "@/platform/policy"
import type { CatalogExtension } from "./contracts"
type Tx = Prisma.TransactionClient
export async function catalogScope(tx: Tx, actor: BusinessActor, extensions: readonly CatalogExtension[], filter?: { extensionKey?: string; contextId?: string }) {
  const scopes: Prisma.CatalogItemWhereInput[] = filter?.extensionKey ? [] : [{ extensionKey: null }]
  for (const extension of extensions) {
    if (filter?.extensionKey && filter.extensionKey !== extension.key) continue
    const scope = await extension.scope(tx, actor, filter?.contextId)
    if (scope) scopes.push({ AND: [{ extensionKey: extension.key }, scope] })
  }
  return { tenantId: actor.tenantId, OR: scopes }
}
