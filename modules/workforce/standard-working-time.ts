import type { Prisma } from "@prisma/client"
import { BusinessError } from "@/platform/policy"
import { dateKey } from "./roster-dates"
import { workingSegments } from "./working-segments"

type Period = { start: number; end: number }
type Day = { staffProfileId: string; date: Date; startTime: string; endTime: string; breaks: { startTime: string; endTime: string }[] }
const DAY = 86400000
const finiteDay = (value: Date) => Number.isFinite(value.getTime()) && value.getUTCHours() === 0 && value.getUTCMinutes() === 0 && value.getUTCSeconds() === 0 && value.getUTCMilliseconds() === 0

// Integrity only: never use an ordinary schedule query to decide booking hours.
// Source identifiers/labels stay in the source adapter, not in this projection.
export async function loadStandardWorkingTime(db: Prisma.TransactionClient, tenantId: string, staffProfileIds: string[], start: Date, end: Date) {
  if (!tenantId) throw new BusinessError(403, "Tenant context is required.")
  if (!finiteDay(start) || !finiteDay(end) || start > end || staffProfileIds.some(id => !id)) throw new BusinessError(400, "Invalid working-time selection.")
  const ids = [...new Set(staffProfileIds)], periods = new Map<string, Period[]>()
  for (let offset = 0; offset < ids.length; offset += 200) {
    const batch = ids.slice(offset, offset + 200)
    for (let first = start.getTime(); first <= end.getTime(); first += 366 * DAY) {
      const last = Math.min(end.getTime(), first + 365 * DAY)
      try {
        const rows = await db.$queryRaw<Day[]>`SELECT * FROM app.standard_working_time(${tenantId},${batch}::text[],${dateKey(new Date(first))}::date,${dateKey(new Date(last))}::date)`
        for (const row of rows) periods.set(row.staffProfileId + ":" + dateKey(row.date), workingSegments(row))
      } catch (error) {
        const value = error as { meta?: { code?: string; driverAdapterError?: { cause?: { originalCode?: string } } } }
        if (value.meta?.code === "42501" || value.meta?.driverAdapterError?.cause?.originalCode === "42501") throw new BusinessError(403, "Working-time access is not permitted.")
        throw error
      }
    }
  }
  return (staffProfileId: string, day: Date) => ({ segments: periods.get(staffProfileId + ":" + dateKey(day)) ?? [], reason: "Staff is unavailable on this date." })
}
