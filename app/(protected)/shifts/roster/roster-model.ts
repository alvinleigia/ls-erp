import { buildStandardScheduleMap, isStandardWeekOff } from "@/modules/workforce/standard-schedule"
import { workingSegments } from "@/modules/workforce/working-segments"
import { toISODate } from "@/lib/date"
import type { RosterHistoryDay, ShiftSchedule, ShiftTemplateRow } from "@/types/shifts"

export type TimeRange = {
  startTime: string
  endTime: string
}

export const RESOURCE_COLORS = ["#64748b", "#64748b", "#64748b", "#64748b", "#64748b"]

export const TEMPLATE_COLORS = [
  "#0ea5e9",
  "#22c55e",
  "#f97316",
  "#a855f7",
  "#ec4899",
  "#14b8a6",
  "#f59e0b",
  "#0f766e",
  "#e11d48",
]

export const UNAVAILABLE_COLOR = "#ef4444"
export const APPROVED_LEAVE_COLOR = "#f59e0b"

export const formatDateKey = (value: Date) => toISODate(value)

export const resolveDayKey = (value: Date) => {
  const mapping = [
    "SUNDAY",
    "MONDAY",
    "TUESDAY",
    "WEDNESDAY",
    "THURSDAY",
    "FRIDAY",
    "SATURDAY",
  ]
  return mapping[value.getDay()] ?? "SUNDAY"
}

export const parseMinutes = (timeValue: string) => {
  const [hour, minute] = timeValue.split(":").map((chunk) => Number(chunk))
  return (Number.isNaN(hour) ? 0 : hour) * 60 + (Number.isNaN(minute) ? 0 : minute)
}

export const buildTemplateMap = (templates: ShiftTemplateRow[]) => {
  const map: Record<string, ShiftTemplateRow> = {}
  for (const template of templates) {
    map[template.id] = template
  }
  return map
}

export const buildTemplateColorMap = (
  templates: ShiftTemplateRow[],
  palette: string[] = TEMPLATE_COLORS
) => {
  const map: Record<string, string> = {}
  const used = new Set<string>()
  const sorted = [...templates].sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id))

  const colorCounts = sorted.reduce<Record<string, number>>((acc, template) => {
    const color = template.color?.trim()
    if (!color) return acc
    acc[color] = (acc[color] ?? 0) + 1
    return acc
  }, {})

  sorted.forEach((template) => {
    const color = template.color?.trim()
    if (color && colorCounts[color] === 1) {
      map[template.id] = color
      used.add(color)
      return
    }
    const available = palette.find((value) => !used.has(value))
    if (available) {
      map[template.id] = available
      used.add(available)
      return
    }
    const fallbackIndex = template.id.length % palette.length
    map[template.id] = palette[fallbackIndex]
  })

  return map
}

export const buildShiftSegments = (template: ShiftTemplateRow): TimeRange[] => {
  const clock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`
  return workingSegments(template).map(segment => ({ startTime: clock(segment.start), endTime: clock(segment.end) }))
}

// Browser dates represent local calendar days; convert their keys before using
// the shared DATE-only rules, never their instant (which may be another UTC day).
export const isScheduleWeekOff = (value: Date, schedule: ShiftSchedule) =>
  isStandardWeekOff(new Date(formatDateKey(value)), schedule)

export const buildScheduleMap = (schedule: ShiftSchedule, dates: Date[]) => {
  if (!dates.length) return {} as Record<string, string | null>
  return Object.fromEntries(buildStandardScheduleMap(schedule,
    new Date(formatDateKey(dates[0])), new Date(formatDateKey(dates[dates.length - 1]))))
}

// Historical rows contain saved bounds and paid minutes, not an exact break layout.
// Never reinterpret them with a template's current hours or break definitions.
export function historyPeriods(history: Pick<RosterHistoryDay, "startTime" | "endTime">): TimeRange[] {
  return history.startTime && history.endTime ? [{ startTime: history.startTime, endTime: history.endTime }] : []
}
export function rosterPaidMinutes(history: Pick<RosterHistoryDay, "paidMinutes"> | null, periods: TimeRange[]) {
  return history ? history.paidMinutes : periods.reduce((sum, period) => sum + Math.max(0, parseMinutes(period.endTime) - parseMinutes(period.startTime)), 0)
}
