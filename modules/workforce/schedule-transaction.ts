import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { BusinessError } from "@/platform/policy"

// Standard schedules, assignments, overrides, daily slots and flexible plans share this lock.
// Appointment create/edit/cancel, bulk resolution, order create/edit and coupon mutations participate.
// Leave transitions and user edits (including staff scheduling mode) also participate.
// Acquire this lock before user-security tenant row locks whenever both are needed.
export function scheduleTransaction<T>(tenantId: string, action: (tx: Prisma.TransactionClient) => Promise<T>) {
  if (!tenantId) throw new BusinessError(403, "Tenant context is required.")
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`workforce-schedules:${tenantId}`}, 0))`
    return action(tx)
  }, { timeout: 30_000 })
}
