import { workingSegments } from "./working-segments"
import type { Prisma, Weekday } from "@prisma/client"
import { BusinessError } from "@/platform/policy"
import { dateKey, timeMinutes } from "./roster-dates"

type Slot = { startTime: string; endTime: string; breaks?: Array<{ startTime: string; endTime: string }> }
type Day = { day: Weekday; isOff: boolean; slots: Slot[] }
type Segment = { start: number; end: number }
type FlexibleDay = { segments: Segment[]; startTime: string | null; endTime: string | null; reason: string }
const weekdays: Weekday[] = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"]
const slotSelect = { startTime: true, endTime: true, breaks: { select: { startTime: true, endTime: true } } } as const
const daySelect = { day: true, isOff: true, slots: { select: slotSelect } } as const

function monday(value: Date) {
  const result = new Date(value)
  result.setUTCDate(result.getUTCDate() - (result.getUTCDay() + 6) % 7)
  return result
}
function off(reason: string): FlexibleDay { return { segments: [], startTime: null, endTime: null, reason } }
function working(slots: Slot[]): FlexibleDay {
  const sorted = [...slots].sort((a, b) => timeMinutes(a.startTime) - timeMinutes(b.startTime))
  const segments = sorted.flatMap(workingSegments)
  return { segments, startTime: sorted[0]?.startTime ?? null,
    endTime: sorted.reduce<string | null>((last, slot) => !last || slot.endTime > last ? slot.endTime : last, null), reason: "" }
}
function planned(day: Day | undefined, reason: string) {
  if (day?.isOff) return off(reason)
  return day?.slots.length ? working(day.slots) : null
}

// One bounded range load per source. Both live checks and history use the same
// precedence/cycle/break calculation; resolving another day requires no DB work.
export async function loadFlexibleAvailability(db: Prisma.TransactionClient, tenantId: string,
  staffProfileIds: string[], start: Date, end: Date) {
  if (!tenantId) throw new BusinessError(403, "Tenant context is required.")
  const ids = [...new Set(staffProfileIds.filter(Boolean))]
  if (!ids.length) return () => off("No flexible slots configured for this date.")
  const scope = { staffProfileId: { in: ids }, staffProfile: { user: { tenantId } } }
  const [weeks, patterns, slots] = await Promise.all([
    db.staffFlexibleWeekPlan.findMany({ where: { ...scope, weekStartDate: { gte: monday(start), lte: monday(end) } },
      select: { staffProfileId: true, weekStartDate: true, days: { select: daySelect } } }),
    db.staffFlexiblePattern.findMany({ where: { ...scope, isActive: true, validFrom: { lte: end }, OR: [{ validTo: null }, { validTo: { gte: start } }] },
      orderBy: [{ validFrom: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      select: { staffProfileId: true, validFrom: true, validTo: true, cycleLengthWeeks: true,
        weeks: { select: { weekIndex: true, days: { select: daySelect } } } } }),
    db.staffFlexibleAvailability.findMany({ where: { ...scope, date: { gte: start, lte: end } },
      select: { staffProfileId: true, date: true, startTime: true, endTime: true } }),
  ])
  const weekMap = new Map(weeks.map(week => [`${week.staffProfileId}:${dateKey(week.weekStartDate)}`, week]))
  const patternMap = new Map<string, typeof patterns>()
  for (const pattern of patterns) {
    const group = patternMap.get(pattern.staffProfileId) ?? []
    group.push(pattern); patternMap.set(pattern.staffProfileId, group)
  }
  const slotMap = new Map<string, Slot[]>()
  for (const slot of slots) {
    const key = `${slot.staffProfileId}:${dateKey(slot.date)}`, group = slotMap.get(key) ?? []
    group.push(slot); slotMap.set(key, group)
  }
  return (staffProfileId: string, date: Date): FlexibleDay => {
    const key = dateKey(date), weekday = weekdays[date.getUTCDay()]
    const weekly = planned(weekMap.get(`${staffProfileId}:${dateKey(monday(date))}`)?.days.find(day => day.day === weekday), "This day is marked off in the weekly flexible plan.")
    if (weekly) return weekly
    const pattern = patternMap.get(staffProfileId)?.find(item => item.validFrom <= date && (!item.validTo || item.validTo >= date))
    if (pattern) {
      const weekIndex = Math.floor((date.getTime() - pattern.validFrom.getTime()) / (7 * 86400000)) % pattern.cycleLengthWeeks + 1
      const recurring = planned(pattern.weeks.find(week => week.weekIndex === weekIndex)?.days.find(day => day.day === weekday), "This day is off in the recurring flexible pattern.")
      if (recurring) return recurring
    }
    const daily = slotMap.get(`${staffProfileId}:${key}`)
    return daily?.length ? working(daily) : off("No flexible slots configured for this date.")
  }
}
