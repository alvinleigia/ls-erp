import type { Prisma } from "@prisma/client"
import { BusinessError, hasBusinessAccess, type BusinessActor } from "../policy"
import { businessModules, moduleEnabled, type BusinessModuleKey } from "../modules"
import type { Requirement } from "./catalog"
import { accessContext, findAccessUser } from "./server"
import { authorizeOperation } from "./policy"

// Call inside the transaction that reads or changes business records. Identity
// comes from the tenant session; current permissions never come from the caller.
export async function authorizeBusinessOperation(tx: Prisma.TransactionClient,
  identity: Pick<BusinessActor, "tenantId" | "userId" | "requestId">,
  requirement: Requirement, requiredModules: readonly BusinessModuleKey[] = []): Promise<BusinessActor> {
  const user = await findAccessUser(tx, identity.tenantId, identity.userId)
  if (!user || !hasBusinessAccess(user.role) || user.tenant.status !== "ACTIVE" || user.tenant.slug === (process.env.PLATFORM_ADMIN_TENANT_SLUG?.trim().toLowerCase() || "platform")) throw new BusinessError(403, "Business workspace access is not permitted.")
  const actor = authorizeOperation({ ...identity, ...accessContext(user) }, requirement)
  if (requiredModules.length) {
    const flags = await tx.tenantModule.findMany({ where: { tenantId: identity.tenantId }, select: { key: true, allowed: true, enabled: true } })
    for (const key of requiredModules) if (!moduleEnabled(flags, key)) throw new BusinessError(403, `${businessModules[key].name} is not enabled for this business.`)
  }
  return actor
}
