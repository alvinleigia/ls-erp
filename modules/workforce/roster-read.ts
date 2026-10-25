import { z } from "zod"
import { authorizeBusinessOperation } from "@/platform/access/operation"
import type { BusinessActor } from "@/platform/policy"
import { scheduleTransaction } from "./schedule-transaction"
import { normalizeHistoryRangeToPast, syncRosterHistoryRange } from "./roster-history"
import { dateKey } from "./roster-dates"
import { workingSegments } from "./working-segments"
import type { RosterDay, StaffOption } from "@/types/shifts"

export const rosterReadSchema = z.object({
  startDate: z.iso.date(), endDate: z.iso.date(), q: z.string().trim().max(160).default(""),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(100),
}).strict().refine(v => v.startDate <= v.endDate && new Date(v.endDate).getTime() - new Date(v.startDate).getTime() <= 61 * 86400000,
  { message: "Select at most 62 consecutive dates.", path: ["endDate"] })

type Slot = { startTime: string; endTime: string; breaks: { startTime: string; endTime: string }[] }
export async function readRoster(actor: BusinessActor, query: z.infer<typeof rosterReadSchema>) {
  return scheduleTransaction(actor.tenantId, async tx => {
    await authorizeBusinessOperation(tx, actor, "shiftRoster.read", ["shifts"])
    const { page, pageSize, startDate, endDate, q } = query
    const [row] = await tx.$queryRaw<{ view: { items: (StaffOption & { staffProfileId: string })[]; total: number } }[]>`SELECT app.roster_staff_page(${actor.tenantId},${startDate}::date,${endDate}::date,${q},${pageSize}::integer,${(page - 1) * pageSize}::integer) AS view`
    const items = row.view.items, profiles = items.map(item => item.staffProfileId)
    const setting = await tx.appSetting.findUnique({ where: { tenantId: actor.tenantId }, select: { timeZone: true } })
    const past = normalizeHistoryRangeToPast(startDate, endDate, setting?.timeZone ?? "UTC")
    if (past && profiles.length) await syncRosterHistoryRange(tx, { tenantId: actor.tenantId, staffProfileIds: profiles, ...past, mode: "insert-missing" })
    const rows = profiles.length ? await tx.$queryRaw<(Omit<RosterDay, "staffId" | "periods" | "date"> & { staffProfileId: string; date: Date; slots: Slot[] })[]>`SELECT * FROM app.roster_days(${actor.tenantId},${profiles}::text[],${startDate}::date,${endDate}::date)` : []
    const people = new Map(items.map(item => [item.staffProfileId, item.id]))
    const clock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`
    const days: RosterDay[] = rows.map(({ staffProfileId, slots, date, ...day }) => ({ ...day, staffId: people.get(staffProfileId)!, date: dateKey(date),
      periods: slots.flatMap(workingSegments).map(period => ({ startTime: clock(period.start), endTime: clock(period.end) })),
    }))
    return { items, days, page, pageSize, total: row.view.total, totalPages: Math.max(1, Math.ceil(row.view.total / pageSize)) }
  })
}
