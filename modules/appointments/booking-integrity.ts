import type { Prisma } from "@prisma/client"
import { BusinessError } from "@/platform/policy"

export type BusySlot = { staffProfileId: string; startAt: Date; endAt: Date }
type Slot = BusySlot & { customerId?: string }
type ConflictSummary = { slotIndex: number; staffConflict: boolean; customerConflict: boolean; conflictCount: number }
const finite = (value: Date) => Number.isFinite(value.getTime())

async function project<T>(query: PromiseLike<T>): Promise<T> {
  try { return await query } catch (error) {
    const value = error as { meta?: { code?: string; driverAdapterError?: { cause?: { originalCode?: string } } } }
    if (value.meta?.code === "42501" || value.meta?.driverAdapterError?.cause?.originalCode === "42501") throw new BusinessError(403, "Scheduling conflict access is not permitted.")
    throw error
  }
}

// Exclusions must come from records already resolved through the caller's ordinary
// read/write scope. This projection grants no action or source-record access.
export async function appointmentConflictSummary(db: Prisma.TransactionClient, tenantId: string, slots: Slot[], excludedIds: string[] = []) {
  if (!tenantId) throw new BusinessError(403, "Tenant context is required.")
  if (slots.length > 200 || excludedIds.length > 200 || slots.some(slot => !finite(slot.startAt) || !finite(slot.endAt) || slot.startAt >= slot.endAt)) throw new BusinessError(400, "Invalid booking conflict selection.")
  if (!slots.length) return []
  const input = slots.map(({ staffProfileId, customerId, startAt, endAt }) => ({ staffProfileId, customerId, startAt, endAt }))
  return project(db.$queryRaw<ConflictSummary[]>`SELECT * FROM app.appointment_conflict_summary(${tenantId},${JSON.stringify(input)}::jsonb,${excludedIds}::text[])`)
}

// Keyset paging carries only busy intervals, never appointment/customer IDs. The
// caller holds the scheduling lock and authorizes the affected staff selection.
export async function activeStaffBookingSlots(db: Prisma.TransactionClient, tenantId: string, profiles: string[], now: Date, cursor?: BusySlot, range?: { start: Date; end: Date }) {
  if (!tenantId) throw new BusinessError(403, "Tenant context is required.")
  if (profiles.length > 200 || !finite(now) || (range && (!finite(range.start) || !finite(range.end) || range.start >= range.end))) throw new BusinessError(400, "Invalid booking conflict selection.")
  if (!profiles.length) return []
  return project(db.$queryRaw<BusySlot[]>`SELECT * FROM app.active_staff_booking_slots(${tenantId},${profiles}::text[],${now.toISOString()}::timestamptz AT TIME ZONE 'UTC',${JSON.stringify(cursor ?? null)}::jsonb,${range?.start.toISOString() ?? null}::timestamptz AT TIME ZONE 'UTC',${range?.end.toISOString() ?? null}::timestamptz AT TIME ZONE 'UTC')`)
}
