import type { z } from "zod"
import { prisma } from "@/lib/prisma"
import { startOfBusinessDate } from "@/lib/business-time"
import { BusinessError, type BusinessActor } from "@/platform/policy"
import { flexiblePatternSchema } from "@/lib/validation"
import { findPattern } from "./flexible-plan-service"
import { planStaffScope, patternOverlap, weekdayOrder } from "./flexible-plan-record"
import { dateKey, dateKeyInTimeZone, enumerateDates, timeMinutes } from "./roster-dates"
import type { impactPreviewSchema } from "./flexible-plan-validation"
import { appointmentConflictSummary } from "@/modules/appointments/booking-integrity"

const DAY_MS = 86400000
const PREVIEW_HORIZON_DAYS = 90

// Advisory impact estimate. This preserves the existing response contract; the
// estimatedBooked* fields describe planned working time, not booked revenue or
// confirmed conflict resolution. No appointments or plans are changed here.
export async function previewPatternImpact(actor: BusinessActor, data: z.infer<typeof impactPreviewSchema>) {
  const { tenantId } = actor
  const source = await findPattern(prisma, tenantId, data.patternId)
  const target = data.mode === "CLONE"
    ? await prisma.staffProfile.findFirst({ where: { ...planStaffScope(tenantId), userId: data.targetStaffId ?? source.staffProfile.userId },
        select: { id: true, schedulingMode: true, user: { select: { name: true, email: true } } } })
    : source.staffProfile
  if (!target) throw new BusinessError(404, "Target staff profile not found.")
  if (data.mode === "CLONE" && target.schedulingMode !== "FLEXIBLE") throw new BusinessError(409, "Target staff must be in Flexible scheduling mode before assignment.")
  const setting = await prisma.appSetting.findUnique({ where: { tenantId }, select: { timeZone: true } })
  const timeZone = setting?.timeZone ?? "UTC"
  const today = dateKeyInTimeZone(new Date(), timeZone)
  const sourceStart = dateKey(source.validFrom)
  const start = data.mode === "DEACTIVATE" ? (today > sourceStart ? today : sourceStart) : data.validFrom!
  const end = data.mode === "DEACTIVATE" ? (source.validTo ? dateKey(source.validTo) : null) : data.validTo || null
  const base = { mode: data.mode, patternId: source.id, staffName: target.user.name, staffEmail: target.user.email }
  if (end && start > end) return { preview: { ...base,
    window: { startDate: start, endDate: end, truncatedAt: null, isOpenEnded: false },
    estimatedBookedMinutesInWindow: 0, estimatedBookedHoursInWindow: 0, affectedAppointmentsCount: 0,
    overlappingActivePatternsCount: 0, notes: ["No effective dates in preview window."],
  } }
  const horizonStart = new Date(start)
  // Inclusive calendar range: day zero through day 89 is 90 days.
  const cap = new Date(horizonStart.getTime() + (PREVIEW_HORIZON_DAYS - 1) * DAY_MS)
  const effectiveEnd = end && new Date(end) < cap ? new Date(end) : cap
  const truncated = !end || new Date(end) > cap
  const weeks = data.weeks ?? source.weeks
  const cycleLengthWeeks = data.cycleLengthWeeks ?? source.cycleLengthWeeks
  if (data.mode !== "DEACTIVATE") flexiblePatternSchema.parse({ staffId: source.staffProfile.userId, validFrom: start, validTo: end ?? "", cycleLengthWeeks, weeks })
  const cycleStart = new Date(data.mode === "DEACTIVATE" ? sourceStart : start).getTime()
  const weeksByIndex = new Map(weeks.map(week => [week.weekIndex, week]))
  let minutes = 0
  for (const day of enumerateDates(horizonStart, effectiveEnd)) {
    const weekIndex = Math.floor(Math.max(0, (day.getTime() - cycleStart) / DAY_MS) / 7) % cycleLengthWeeks + 1
    const weekday = weekdayOrder[(day.getUTCDay() + 6) % 7]
    const planDay = weeksByIndex.get(weekIndex)?.days.find(item => item.day === weekday)
    if (!planDay || planDay.isOff) continue
    for (const slot of planDay.slots) minutes += Math.max(0, timeMinutes(slot.endTime) - timeMinutes(slot.startTime)
      - slot.breaks.reduce((sum, pause) => sum + Math.max(0, timeMinutes(pause.endTime) - timeMinutes(pause.startTime)), 0))
  }
  const nextDay = dateKey(new Date(effectiveEnd.getTime() + DAY_MS))
  const [summary, overlappingActivePatternsCount] = await Promise.all([
    appointmentConflictSummary(prisma, tenantId, [{ staffProfileId: target.id,
      startAt: startOfBusinessDate(start, timeZone), endAt: startOfBusinessDate(nextDay, timeZone) }]),
    data.mode !== "DEACTIVATE" && data.activate ? prisma.staffFlexiblePattern.count({ where: {
      staffProfileId: target.id, staffProfile: planStaffScope(tenantId), isActive: true, ...patternOverlap(start, end),
      ...(data.mode === "UPDATE" ? { id: { not: source.id } } : {}),
    } }) : 0,
  ])
  const affectedAppointmentsCount = summary[0].conflictCount
  const notes: string[] = []
  if (truncated) notes.push(`Preview is limited to ${PREVIEW_HORIZON_DAYS} days.`)
  if (overlappingActivePatternsCount) notes.push(`${overlappingActivePatternsCount} active pattern(s) will be deactivated due to overlap.`)
  if (affectedAppointmentsCount) notes.push(`${affectedAppointmentsCount} active appointment(s) fall inside this window.`)
  return { preview: { ...base, window: { startDate: start, endDate: end, truncatedAt: truncated ? dateKey(effectiveEnd) : null, isOpenEnded: end === null },
    estimatedBookedMinutesInWindow: minutes, estimatedBookedHoursInWindow: Number((minutes / 60).toFixed(2)), affectedAppointmentsCount, overlappingActivePatternsCount, notes,
  } }
}
