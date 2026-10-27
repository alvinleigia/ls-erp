import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { BusinessError } from "@/platform/policy"

// One lock coordinates scheduling, account security and stock writers. Keep the
// key identical to the native R10 guards so a nested stock operation is reentrant.
export async function lockTenantOperations(tx: Prisma.TransactionClient, tenantId: string) {
  if (!tenantId) throw new BusinessError(403, "Tenant context is required.")
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`workforce-schedules:${tenantId}`}, 0))`
}
// Reports share the writer lock so their counts and rows see one authorized
// source population. Acquire before resolving permissions, using Read Committed.
export async function lockTenantReads(tx: Prisma.TransactionClient, tenantId: string) {
  if (!tenantId) throw new BusinessError(403, "Tenant context is required.")
  await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${`workforce-schedules:${tenantId}`}, 0))`
}
export function tenantOperationTransaction<T>(tenantId: string, operation: (tx: Prisma.TransactionClient) => Promise<T>) {
  if (!tenantId) throw new BusinessError(403, "Tenant context is required.")
  return prisma.$transaction(async tx => {
    await lockTenantOperations(tx, tenantId)
    return operation(tx)
  }, { timeout: 30_000 })
}
