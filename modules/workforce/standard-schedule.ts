import type { Weekday } from "@/types/scheduling"
import { dateKey, enumerateDates } from "./roster-dates"

type WeekOffRules = { weekOffDay1: Weekday; weekOffDay2: Weekday | null; weekOff2Weeks: number[] }
type Schedule = WeekOffRules & {
  startDate: Date | string
  blocks: { templateId: string; repeatDays: number; sortOrder?: number }[]
}
const weekdays: Weekday[] = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"]

export function isStandardWeekOff(day: Date, schedule: WeekOffRules) {
  const weekday = weekdays[day.getUTCDay()]
  if (weekday === schedule.weekOffDay1) return true
  const weeks = schedule.weekOff2Weeks.length ? schedule.weekOff2Weeks : [1, 2, 3, 4, 5]
  return weekday === schedule.weekOffDay2 && weeks.includes(Math.floor((day.getUTCDate() - 1) / 7) + 1)
}

// DATE values and ranges are UTC calendar days. Assignment dates select a
// schedule; they never restart its rotation. Week-offs do not advance the cycle.
export function buildStandardScheduleMap(schedule: Schedule, start: Date, end: Date) {
  const map = new Map<string, string | null>(enumerateDates(start, end).map(day => [dateKey(day), null]))
  const blocks = [...schedule.blocks].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
  if (!blocks.length) return map
  const cursor = new Date(schedule.startDate)
  cursor.setUTCHours(0, 0, 0, 0)
  let blockIndex = 0, dayInBlock = 0
  for (; cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    if (isStandardWeekOff(cursor, schedule)) continue
    const block = blocks[blockIndex]
    if (cursor >= start) map.set(dateKey(cursor), block.templateId)
    if (++dayInBlock >= block.repeatDays) {
      dayInBlock = 0
      blockIndex = (blockIndex + 1) % blocks.length
    }
  }
  return map
}
