import type { Prisma } from "@prisma/client"
import { businessModules, moduleEnabled, type BusinessModuleKey } from "./modules"
import { BusinessError } from "./policy"

export async function requireBusinessModule(db: Pick<Prisma.TransactionClient, "tenantModule">, tenantId: string, key: BusinessModuleKey) {
  const flags = await db.tenantModule.findMany({ where: { tenantId }, select: { key: true, allowed: true, enabled: true } })
  if (!moduleEnabled(flags, key)) throw new BusinessError(403, `${businessModules[key].name} is not enabled for this workspace.`)
}
