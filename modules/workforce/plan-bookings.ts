import type { Prisma, StaffSchedulingMode } from "@prisma/client"
import { BusinessError } from "@/platform/policy"
import { dateKeyInTimeZone, appointmentRangeOnDate, dateKey } from "./roster-dates"
import { loadFlexibleAvailability } from "./flexible-availability"
import { loadStandardWorkingTime } from "./standard-working-time"
import { workingSegments } from "./working-segments"
import { approvedLeaveBlocks } from "./availability-blocks"
import { activeStaffBookingSlots, type BusySlot } from "@/modules/appointments/booking-integrity"

const PAGE_SIZE = 200
type ProtectedBooking = BusySlot & { profileId: string; mode: StaffSchedulingMode; day: string; start: number; end: number }
// Carries busy intervals only. Resolution details are fetched after rollback
// through ordinary appointment RLS, never through the integrity projection.
export class PlanBookingConflict extends BusinessError {
  constructor(readonly blockedSlots: BusySlot[]) {
    super(409, "This plan change conflicts with existing appointments. Reassign or cancel those appointments through Appointments before changing the plan.")
  }
}
const contains = (segments: { start: number; end: number }[], booking: { start: number; end: number }) =>
  segments.some(segment => booking.start >= segment.start && booking.end <= segment.end)

async function availability(tx: Prisma.TransactionClient, tenantId: string, bookings: ProtectedBooking[]) {
  const days = bookings.map(booking => booking.day).sort(), start = new Date(days[0]), end = new Date(days[days.length - 1])
  const ids = [...new Set(bookings.map(booking => booking.profileId))]
  const scope = { staffProfileId: { in: ids }, staffProfile: { user: { tenantId } } }
  const [standard, flexible, overrides, leaves] = await Promise.all([
    loadStandardWorkingTime(tx, tenantId, [...new Set(bookings.filter(b => b.mode === "STANDARD").map(b => b.profileId))], start, end),
    loadFlexibleAvailability(tx, tenantId, [...new Set(bookings.filter(b => b.mode === "FLEXIBLE").map(b => b.profileId))], start, end),
    tx.staffShiftOverride.findMany({ where: { ...scope, date: { gte: start, lte: end } },
      select: { staffProfileId: true, date: true, template: { select: { startTime: true, endTime: true, breaks: { select: { startTime: true, endTime: true } } } } } }),
    approvedLeaveBlocks(tx, tenantId, ids, start, end),
  ])
  const overrideMap = new Map(overrides.map(row => [row.staffProfileId + ":" + dateKey(row.date), row]))
  const leavesByStaff = new Map<string, typeof leaves>()
  for (const leave of leaves) { const group = leavesByStaff.get(leave.staffProfileId) ?? []; group.push(leave); leavesByStaff.set(leave.staffProfileId, group) }
  return (booking: ProtectedBooking) => {
    const day = new Date(booking.day)
    if (leavesByStaff.get(booking.profileId)?.some(leave => leave.startDate <= day && leave.endDate >= day)) return []
    const override = overrideMap.get(booking.profileId + ":" + booking.day)
    if (override) return override.template ? workingSegments(override.template) : []
    return (booking.mode === "STANDARD" ? standard : flexible)(booking.profileId, day).segments
  }
}

// Caller holds the shared scheduling lock. Scope candidates to affected staff,
// page all active/future bookings (including overdue in-progress work), and batch
// source reads. No fixed preview horizon, customer fields or per-booking queries.
// Only regressions are blocked, so compatible repairs and renames remain possible.
export async function protectPlanBookings(tx: Prisma.TransactionClient, tenantId: string, staffScope: Prisma.StaffProfileWhereInput, days?: string[]) {
  if (!tenantId) throw new BusinessError(403, "Tenant context is required.")
  if (days && !days.length) return async () => {}
  const selectedDays = days ? new Set(days) : null
  const sortedDays = days ? [...days].sort() : []
  // UTC padding bounds the query; exact tenant calendar dates filter candidates.
  const dayRange = days ? { start: new Date(new Date(sortedDays[0]).getTime() - 86400000),
    end: new Date(new Date(sortedDays[sortedDays.length - 1]).getTime() + 2 * 86400000) } : undefined
  const setting = await tx.appSetting.findUnique({ where: { tenantId }, select: { timeZone: true } })
  const timeZone = setting?.timeZone || "America/New_York"
  const now = new Date(), batches: ProtectedBooking[][] = []
  let profileCursor: string | undefined
  while (true) {
    const profiles: { id: string; schedulingMode: StaffSchedulingMode }[] = await tx.staffProfile.findMany({
      where: { AND: [staffScope, { user: { tenantId } }, ...(profileCursor ? [{ id: { gt: profileCursor } }] : [])] },
      orderBy: { id: "asc" }, take: PAGE_SIZE, select: { id: true, schedulingMode: true },
    })
    if (!profiles.length) break
    const modes = new Map(profiles.map(profile => [profile.id, profile.schedulingMode]))
    let cursor: BusySlot | undefined
    while (true) {
      const rows: BusySlot[] = await activeStaffBookingSlots(tx, tenantId, profiles.map(profile => profile.id), now, cursor, dayRange)
      if (!rows.length) break
      const bookings = rows.flatMap(row => {
        const day = dateKeyInTimeZone(row.startAt, timeZone)
        if (selectedDays && !selectedDays.has(day)) return []
        if (dateKeyInTimeZone(row.endAt, timeZone) !== day) return []
        const range = appointmentRangeOnDate(row.startAt, row.endAt, day, timeZone)
        return range ? [{ ...row, profileId: row.staffProfileId, mode: modes.get(row.staffProfileId)!, day, ...range }] : []
      })
      if (bookings.length) {
        const resolve = await availability(tx, tenantId, bookings)
        const protectedBookings = bookings.filter(booking => contains(resolve(booking), booking))
        if (protectedBookings.length) batches.push(protectedBookings)
      }
      if (rows.length < PAGE_SIZE) break
      cursor = rows[rows.length - 1]
    }
    if (profiles.length < PAGE_SIZE) break
    profileCursor = profiles[profiles.length - 1].id
  }
  return async () => {
    const conflicts: BusySlot[] = []
    for (const bookings of batches) {
      const resolve = await availability(tx, tenantId, bookings)
      conflicts.push(...bookings.filter(booking => !contains(resolve(booking), booking)).map(({ staffProfileId, startAt, endAt }) => ({ staffProfileId, startAt, endAt })))
    }
    if (conflicts.length) throw new PlanBookingConflict(conflicts)
  }
}
