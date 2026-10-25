import { type Prisma, type PrismaClient } from "@prisma/client"
import { BusinessError } from "@/platform/policy"
import { parseDateOnly, dateKey as toDateKey, dateKeyInTimeZone as getDateKeyInTimeZone } from "./roster-dates"

type DbClient = PrismaClient | Prisma.TransactionClient
const DAY = 86400000
const getYesterday = (timeZone?: string | null) => {
  const value = timeZone ? new Date(getDateKeyInTimeZone(new Date(), timeZone)) : new Date()
  value.setUTCHours(0, 0, 0, 0); value.setUTCDate(value.getUTCDate() - 1)
  return value
}
export async function syncRosterHistoryRange(tx: DbClient, params: { tenantId: string; staffProfileIds: string[]; startDate: string; endDate: string; mode?: "insert-missing" | "replace" }) {
  if (!params.tenantId) throw new BusinessError(403, "Tenant context is required.")
  const first = parseDateOnly(params.startDate), last = parseDateOnly(params.endDate)
  if (!first || !last || first > last) return 0
  const ids = [...new Set(params.staffProfileIds.filter(Boolean))]
  let count = 0
  for (let offset = 0; offset < ids.length; offset += 200) for (let start = first.getTime(); start <= last.getTime(); start += 366 * DAY) {
    const end = Math.min(last.getTime(), start + 365 * DAY)
    const [row] = await tx.$queryRaw<{ count: number }[]>`SELECT app.sync_roster_history(${params.tenantId},${ids.slice(offset, offset + 200)}::text[],${toDateKey(new Date(start))}::date,${toDateKey(new Date(end))}::date,${params.mode === "replace"}) AS count`
    count += row.count
  }
  return count
}

export const captureRosterHistoryUpToYesterday = async (
  tx: DbClient,
  params: { staffProfileIds: string[]; startDate?: string | null; timeZone?: string | null; tenantId: string }
) => {
  if (!params.tenantId) throw new BusinessError(403, "Tenant context is required.")
  const yesterday = getYesterday(params.timeZone)
  const endDate = toDateKey(yesterday)
  const startDate = params.startDate ?? endDate
  const parsedStart = parseDateOnly(startDate)
  const parsedEnd = parseDateOnly(endDate)
  if (!parsedStart || !parsedEnd || parsedStart > parsedEnd) {
    return 0
  }
  return syncRosterHistoryRange(tx, {
    staffProfileIds: params.staffProfileIds,
    startDate: toDateKey(parsedStart),
    endDate,
    mode: "insert-missing",
    tenantId: params.tenantId,
  })
}

export const normalizeHistoryRangeToPast = (
  startDate: string,
  endDate: string,
  timeZone?: string | null
) => {
  const parsedStart = parseDateOnly(startDate)
  const parsedEnd = parseDateOnly(endDate)
  if (!parsedStart || !parsedEnd || parsedStart > parsedEnd) {
    return null
  }
  const yesterday = getYesterday(timeZone)
  if (parsedStart > yesterday) {
    return null
  }
  const boundedEnd = parsedEnd > yesterday ? yesterday : parsedEnd
  return {
    startDate: toDateKey(parsedStart),
    endDate: toDateKey(boundedEnd),
  }
}
