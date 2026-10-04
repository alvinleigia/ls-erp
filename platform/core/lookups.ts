import { prisma } from "@/lib/prisma"
import { moduleEnabled, type BusinessModuleKey } from "../modules"
import { permits } from "../access/policy"
import type { Permission } from "../access/catalog"
import { BusinessError, type BusinessActor } from "../policy"

export async function requireLookup(actor: BusinessActor, choices: readonly [BusinessModuleKey, Permission][], core?: Permission) {
  if (!["ADMIN", "MANAGER"].includes(actor.role)) throw new BusinessError(403, "Management access is required.")
  if (core && permits(actor, core)) return
  const flags = await prisma.tenantModule.findMany({ where: { tenantId: actor.tenantId }, select: { key: true, allowed: true, enabled: true } })
  if (!choices.some(([key, permission]) => moduleEnabled(flags, key) && permits(actor, permission))) throw new BusinessError(403, "Your access role does not permit this lookup.")
}
