import type { Prisma } from "@prisma/client"
import { BusinessError } from "@/platform/policy"

export type AvailabilityBlock = { staffProfileId: string; startDate: Date; endDate: Date }

// Booking checks and plan integrity guards use this projection instead of private
// leave data. Source RLS can hide a request without making the employee free.
// The caller still authorizes the business action and assignment targets.
export async function approvedLeaveBlocks(db: Prisma.TransactionClient, tenantId: string, profiles: string[], start: Date, end: Date): Promise<AvailabilityBlock[]> {
  if (!tenantId) throw new BusinessError(403, "Tenant context is required.")
  const ids = [...new Set(profiles)]
  if (ids.length > 200 || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > end) throw new BusinessError(400, "Invalid availability range or staff selection.")
  if (!ids.length) return []
  try {
    return await db.$queryRaw<AvailabilityBlock[]>`SELECT * FROM app.approved_leave_blocks(${tenantId},${ids}::text[],${start.toISOString().slice(0, 10)}::date,${end.toISOString().slice(0, 10)}::date)`
  } catch (error) {
    const value = error as { meta?: { code?: string; driverAdapterError?: { cause?: { originalCode?: string } } } }
    if (value.meta?.code === "42501" || value.meta?.driverAdapterError?.cause?.originalCode === "42501") throw new BusinessError(403, "Scheduling availability access is not permitted.")
    throw error
  }
}
