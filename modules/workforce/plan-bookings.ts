import type { Prisma, StaffSchedulingMode } from "@prisma/client"
import { BusinessError } from "@/platform/policy"
import { dateKeyInTimeZone, appointmentRangeOnDate, dateKey } from "./roster-dates"
import { loadFlexibleAvailability } from "./flexible-availability"
import { loadStandardAvailability } from "./standard-availability"
import { workingSegments } from "./working-segments"
import { approvedLeaveBlocks } from "./availability-blocks"

const PAGE_SIZE = 200
type Booking = { id: string; staffProfileId: string; staffProfile: { schedulingMode: StaffSchedulingMode }; startAt: Date; endAt: Date }
type ProtectedBooking = { id: string; profileId: string; mode: StaffSchedulingMode; day: string; start: number; end: number }
// Carries identifiers internally so authorized roster callers can offer resolution
// after the transaction has rolled back. Other APIs expose only BusinessError.message.
export class PlanBookingConflict extends BusinessError {
  constructor(readonly appointmentIds: string[]) {
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
    loadStandardAvailability(tx, tenantId, [...new Set(bookings.filter(b => b.mode === "STANDARD").map(b => b.profileId))], start, end),
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
  const dayRange = days ? { startAt: { gte: new Date(new Date(sortedDays[0]).getTime() - 86400000),
    lt: new Date(new Date(sortedDays[sortedDays.length - 1]).getTime() + 2 * 86400000) } } : {}
  const setting = await tx.appSetting.findUnique({ where: { tenantId }, select: { timeZone: true } })
  const timeZone = setting?.timeZone || "America/New_York"
  const now = new Date(), batches: ProtectedBooking[][] = []
  let cursor: string | undefined
  while (true) {
    const rows: Booking[] = await tx.appointment.findMany({ where: { tenantId, ...dayRange,
      staffProfile: { AND: [staffScope, { user: { tenantId } }] }, ...(cursor ? { id: { gt: cursor } } : {}),
      OR: [{ status: "IN_PROGRESS" }, { status: { in: ["SCHEDULED", "CONFIRMED"] }, endAt: { gt: now } }],
    }, orderBy: { id: "asc" }, take: PAGE_SIZE,
    select: { id: true, staffProfileId: true, staffProfile: { select: { schedulingMode: true } }, startAt: true, endAt: true } })
    if (!rows.length) break
    const bookings = rows.flatMap(row => {
      const day = dateKeyInTimeZone(row.startAt, timeZone)
      if (selectedDays && !selectedDays.has(day)) return []
      if (dateKeyInTimeZone(row.endAt, timeZone) !== day) return []
      const range = appointmentRangeOnDate(row.startAt, row.endAt, day, timeZone)
      return range ? [{ id: row.id, profileId: row.staffProfileId, mode: row.staffProfile.schedulingMode, day, ...range }] : []
    })
    if (bookings.length) {
      const resolve = await availability(tx, tenantId, bookings)
      const protectedBookings = bookings.filter(booking => contains(resolve(booking), booking))
      if (protectedBookings.length) batches.push(protectedBookings)
    }
    if (rows.length < PAGE_SIZE) break
    cursor = rows[rows.length - 1].id
  }
  return async () => {
    const conflicts: string[] = []
    for (const bookings of batches) {
      const resolve = await availability(tx, tenantId, bookings)
      conflicts.push(...bookings.filter(booking => !contains(resolve(booking), booking)).map(booking => booking.id))
    }
    if (conflicts.length) throw new PlanBookingConflict(conflicts)
  }
}
