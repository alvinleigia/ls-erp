import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { BusinessError } from "@/platform/policy"

import { lockTenantOperations } from "./tenant-lock"
export { lockTenantOperations, lockTenantReads } from "./tenant-lock"

export function tenantOperationTransaction<T>(tenantId: string, operation: (tx: Prisma.TransactionClient) => Promise<T>) {
  if (!tenantId) throw new BusinessError(403, "Tenant context is required.")
  return prisma.$transaction(async tx => {
    await lockTenantOperations(tx, tenantId)
    return operation(tx)
  }, { timeout: 30_000 })
}
