import type { Prisma } from "@prisma/client"
import { BusinessError } from "@/platform/policy"
import { captureRosterHistoryUpToYesterday, normalizeHistoryRangeToPast, syncRosterHistoryRange } from "./roster-history"

export const scheduleHistorySelect = {
  id: true, isDefault: true, startDate: true,
  assignments: { select: { staffProfileId: true, startDate: true } },
} satisfies Prisma.ShiftScheduleSelect
type ScheduleHistory = Prisma.ShiftScheduleGetPayload<{ select: typeof scheduleHistorySelect }>

export async function captureScheduleHistory(tx: Prisma.TransactionClient, tenantId: string, schedule: ScheduleHistory) {
  if (schedule.isDefault) {
    await tx.$queryRaw`SELECT app.capture_schedule_history(${tenantId},${schedule.id})`
    return
  }
  if (!schedule.assignments.length) return
  const startDate = schedule.assignments.map(item => item.startDate.toISOString().slice(0, 10)).sort()[0]
  const setting = await tx.appSetting.findUnique({ where: { tenantId }, select: { timeZone: true } })
  await captureRosterHistoryUpToYesterday(tx, { tenantId, timeZone: setting?.timeZone ?? "UTC", staffProfileIds: [...new Set(schedule.assignments.map(item => item.staffProfileId))], startDate })
}


// Preserve the old effective roster before changing/removing a saved Flexible plan.
// New backdated records may fill missing history; existing snapshots are never replaced.
// Bound each source read/write batch and merge overlap without filling unrelated gaps.
export async function captureFlexiblePlanHistory(tx: Prisma.TransactionClient, tenantId: string, profileId: string,
  ranges: { startDate: Date; endDate?: Date | null }[]) {
  if (!tenantId) throw new BusinessError(403, "Tenant context is required.")
  if (!ranges.length) return
  const profile = await tx.staffProfile.findFirst({ where: { id: profileId, user: { tenantId }, schedulingMode: "FLEXIBLE" }, select: { id: true } })
  if (!profile) return // A dormant Flexible plan must not snapshot Standard history.
  const setting = await tx.appSetting.findUnique({ where: { tenantId }, select: { timeZone: true } })
  const normalized = ranges.flatMap(range => {
    const past = normalizeHistoryRangeToPast(range.startDate.toISOString().slice(0, 10),
      (range.endDate ?? new Date()).toISOString().slice(0, 10), setting?.timeZone ?? "UTC")
    return past ? [{ start: new Date(past.startDate).getTime(), end: new Date(past.endDate).getTime() }] : []
  }).sort((a, b) => a.start - b.start)
  const merged: typeof normalized = []
  for (const range of normalized) {
    const last = merged[merged.length - 1]
    if (last && range.start <= last.end + 86400000) last.end = Math.max(last.end, range.end)
    else merged.push({ ...range })
  }
  for (const range of merged) for (let start = range.start; start <= range.end; start += 366 * 86400000) {
    await syncRosterHistoryRange(tx, { tenantId, staffProfileIds: [profileId], mode: "insert-missing",
      startDate: new Date(start).toISOString().slice(0, 10),
      endDate: new Date(Math.min(range.end, start + 365 * 86400000)).toISOString().slice(0, 10),
    })
  }
}
