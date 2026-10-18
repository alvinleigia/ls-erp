import type { Prisma } from "@prisma/client"
import type { z } from "zod"
import { prisma } from "@/lib/prisma"
import type { ShiftOverrideInput, FlexibleSlotInput } from "@/lib/validation"
import { BusinessError, type BusinessActor } from "@/platform/policy"
import { requirePermission } from "@/platform/access/policy"
import { rosterMutation } from "./roster-mutation"
import { auditPlan } from "./plan-transaction"
import { protectPlanBookings } from "./plan-bookings"
import { scheduleTransaction } from "./schedule-transaction"
import { normalizeHistoryRangeToPast, syncRosterHistoryRange } from "./roster-history"
import { dateKey, enumerateDates, timeMinutes } from "./roster-dates"
import type { WorkforceDateRangeQuery, deleteOverrideSchema, deleteFlexibleSlotSchema } from "./schedule-validation"

function staffWhere(tenantId: string, staffIds?: string) {
  if (!tenantId) throw new BusinessError(403, "Tenant context is required.")
  const ids = (staffIds ?? "").split(",").map(id => id.trim()).filter(Boolean)
  return { user: { tenantId, ...(ids.length ? { id: { in: ids } } : {}) } }
}
async function staffProfile(tx: Prisma.TransactionClient, tenantId: string, staffId: string, flexible = false) {
  const profile = await tx.staffProfile.findFirst({
    where: { userId: staffId, user: { tenantId, ...(flexible ? { role: "STAFF" as const } : {}) } },
    select: { id: true, schedulingMode: true },
  })
  if (!profile) throw new BusinessError(404, "Staff profile not found.")
  return profile
}
async function businessTimeZone(tx: Prisma.TransactionClient, tenantId: string) {
  return (await tx.appSetting.findUnique({ where: { tenantId }, select: { timeZone: true } }))?.timeZone ?? "UTC"
}
async function syncPast(tx: Prisma.TransactionClient, tenantId: string, profileId: string, start: string, end: string, timeZone: string) {
  const range = normalizeHistoryRangeToPast(start, end, timeZone)
  if (range) await syncRosterHistoryRange(tx, { tenantId, staffProfileIds: [profileId], ...range, mode: "replace" })
}

// Group consecutive changed dates to avoid one history query batch per day.
async function syncChangedDays(tx: Prisma.TransactionClient, tenantId: string, profileId: string, days: Date[], timeZone: string) {
  const sorted = [...days].sort((a, b) => a.getTime() - b.getTime())
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i]
    while (i + 1 < sorted.length && sorted[i + 1].getTime() - sorted[i].getTime() === 86400000) i++
    await syncPast(tx, tenantId, profileId, dateKey(start), dateKey(sorted[i]), timeZone)
  }
}

export async function listShiftOverrides(tenantId: string, query: WorkforceDateRangeQuery) {
  const rows = await prisma.staffShiftOverride.findMany({
    where: { staffProfile: staffWhere(tenantId, query.staffIds), date: { gte: new Date(query.startDate), lte: new Date(query.endDate) } },
    select: { id: true, staffProfileId: true, date: true, templateId: true,
      staffProfile: { select: { userId: true } }, template: { select: { id: true, name: true, startTime: true, endTime: true } } },
    orderBy: [{ date: "asc" }, { id: "asc" }],
  })
  return { items: rows.map(({ staffProfile, ...row }) => ({ ...row, staffId: staffProfile.userId })) }
}

export async function saveShiftOverrides(actor: BusinessActor, data: ShiftOverrideInput) {
  const { tenantId } = actor
  return rosterMutation(actor, "edit", async (tx, actor) => {
    const profile = await staffProfile(tx, tenantId, data.staffId)
    const start = new Date(data.startDate), end = new Date(data.endDate)
    const timeZone = await businessTimeZone(tx, tenantId)
    if (data.templateId) requirePermission(actor, "shiftTemplates.read")
    const template = data.isUnavailable ? null : await tx.shiftTemplate.findFirst({
      where: { tenantId, id: data.templateId }, include: { breaks: { orderBy: { sortOrder: "asc" } } },
    })
    if (!data.isUnavailable && !template) throw new BusinessError(404, "Shift template not found.")
    const [defaultSchedule, assignments, holidays] = await Promise.all([
      tx.shiftSchedule.findFirst({ where: { tenantId, isDefault: true } }),
      tx.staffScheduleAssignment.findMany({ where: { staffProfileId: profile.id, staffProfile: { user: { tenantId } }, schedule: { tenantId },
        startDate: { lte: end }, OR: [{ endDate: null }, { endDate: { gte: start } }] }, include: { schedule: true }, orderBy: [{ startDate: "desc" }, { id: "desc" }] }),
      data.skipHolidays ? tx.appSettingOverride.findMany({ where: { setting: { tenantId }, isOpen: false, date: { gte: start, lte: end } }, select: { date: true } }) : [],
    ])
    const holidayDates = new Set(holidays.map(day => dateKey(day.date)))
    const weekdays = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"]
    const days = enumerateDates(start, end).filter(day => {
      if (holidayDates.has(dateKey(day))) return false
      if (!data.skipWeekOff) return true
      const schedule = assignments.find(a => a.startDate <= day && (!a.endDate || a.endDate >= day))?.schedule ?? defaultSchedule
      if (!schedule || schedule.startDate > day) return true
      const weekday = weekdays[day.getUTCDay()]
      if (weekday === schedule.weekOffDay1) return false
      const weeks = schedule.weekOff2Weeks.length ? schedule.weekOff2Weeks : [1, 2, 3, 4, 5]
      return weekday !== schedule.weekOffDay2 || !weeks.includes(Math.floor((day.getUTCDate() - 1) / 7) + 1)
    })
    if (!days.length) return { createdCount: 0 }
    const where = { staffProfileId: profile.id, staffProfile: { user: { tenantId } }, date: { in: days } }
    const before = await tx.staffShiftOverride.findMany({ where, orderBy: { date: "asc" } })
    const checkBookings = await protectPlanBookings(tx, tenantId, { id: profile.id }, days.map(dateKey))
    for (const day of days) await tx.staffShiftOverride.upsert({
      where: { staffProfileId_date: { staffProfileId: profile.id, date: day } },
      update: { templateId: template?.id ?? null },
      create: { staffProfileId: profile.id, date: day, templateId: template?.id ?? null },
    })
    await checkBookings()
    // Only refresh dates actually changed; skipped holidays/week-offs keep their snapshots.
    await syncChangedDays(tx, tenantId, profile.id, days, timeZone)
    const after = await tx.staffShiftOverride.findMany({ where, orderBy: { date: "asc" } })
    await auditPlan(tx, actor, "shiftRoster", "edit", profile.id, before, after)
    return { createdCount: days.length }
  })
}

export async function deleteShiftOverrides(actor: BusinessActor, data: z.infer<typeof deleteOverrideSchema>) {
  return rosterMutation(actor, "archive", async (tx, actor) => {
    const profile = await staffProfile(tx, actor.tenantId, data.staffId)
    const timeZone = await businessTimeZone(tx, actor.tenantId)
    const where = { staffProfileId: profile.id, staffProfile: { user: { tenantId: actor.tenantId } }, date: { gte: new Date(data.startDate), lte: new Date(data.endDate) } }
    const changed = await tx.staffShiftOverride.findMany({ where, orderBy: { date: "asc" } })
    if (!changed.length) return { deletedCount: 0 }
    const checkBookings = await protectPlanBookings(tx, actor.tenantId, { id: profile.id }, changed.map(row => dateKey(row.date)))
    const result = await tx.staffShiftOverride.deleteMany({ where })
    await checkBookings()
    await syncChangedDays(tx, actor.tenantId, profile.id, changed.map(row => row.date), timeZone)
    await auditPlan(tx, actor, "shiftRoster", "archive", profile.id, changed, [])
    return { deletedCount: result.count }
  })
}

export async function listFlexibleSlots(tenantId: string, query: WorkforceDateRangeQuery) {
  const rows = await prisma.staffFlexibleAvailability.findMany({
    where: { staffProfile: staffWhere(tenantId, query.staffIds), date: { gte: new Date(query.startDate), lte: new Date(query.endDate) } },
    include: { staffProfile: { select: { userId: true } } }, orderBy: [{ date: "asc" }, { sortOrder: "asc" }],
  })
  return { items: rows.map(row => ({ id: row.id, staffId: row.staffProfile.userId, staffProfileId: row.staffProfileId,
    date: dateKey(row.date), startTime: row.startTime, endTime: row.endTime, sortOrder: row.sortOrder })) }
}

export async function saveFlexibleSlots(actor: BusinessActor, data: FlexibleSlotInput) {
  const { tenantId } = actor
  return rosterMutation(actor, "edit", async (tx, actor) => {
    const profile = await staffProfile(tx, tenantId, data.staffId, true)
    if (profile.schedulingMode !== "FLEXIBLE") throw new BusinessError(409, "Set staff scheduling mode to Flexible before adding slots.")
    const timeZone = await businessTimeZone(tx, tenantId)
    const where = { staffProfileId: profile.id, staffProfile: { user: { tenantId } }, date: new Date(data.date) }
    const before = await tx.staffFlexibleAvailability.findMany({ where, orderBy: { sortOrder: "asc" } })
    const checkBookings = await protectPlanBookings(tx, tenantId, { id: profile.id, schedulingMode: "FLEXIBLE" }, [data.date])
    await tx.staffFlexibleAvailability.deleteMany({ where })
    await tx.staffFlexibleAvailability.createMany({ data: [...data.slots].sort((a, b) => timeMinutes(a.startTime) - timeMinutes(b.startTime)).map((slot, index) => ({
      staffProfileId: profile.id, date: new Date(data.date), startTime: slot.startTime, endTime: slot.endTime, sortOrder: slot.sortOrder ?? index,
    })) })
    await checkBookings()
    await syncPast(tx, tenantId, profile.id, data.date, data.date, timeZone)
    const rows = await tx.staffFlexibleAvailability.findMany({ where, orderBy: { sortOrder: "asc" } })
    await auditPlan(tx, actor, "shiftRoster", "edit", profile.id, before, rows)
    return { items: rows.map(row => ({ id: row.id, staffId: data.staffId, staffProfileId: row.staffProfileId,
      date: dateKey(row.date), startTime: row.startTime, endTime: row.endTime, sortOrder: row.sortOrder })) }
  })
}

export async function deleteFlexibleSlots(actor: BusinessActor, data: z.infer<typeof deleteFlexibleSlotSchema>) {
  return rosterMutation(actor, "archive", async (tx, actor) => {
    const profile = await staffProfile(tx, actor.tenantId, data.staffId, true)
    const timeZone = await businessTimeZone(tx, actor.tenantId)
    const where = { staffProfileId: profile.id, staffProfile: { user: { tenantId: actor.tenantId } }, date: new Date(data.date) }
    const before = await tx.staffFlexibleAvailability.findMany({ where, orderBy: { sortOrder: "asc" } })
    if (!before.length) return { deletedCount: 0 }
    const checkBookings = await protectPlanBookings(tx, actor.tenantId, { id: profile.id, schedulingMode: "FLEXIBLE" }, [data.date])
    const result = await tx.staffFlexibleAvailability.deleteMany({ where })
    await checkBookings()
    await syncPast(tx, actor.tenantId, profile.id, data.date, data.date, timeZone)
    await auditPlan(tx, actor, "shiftRoster", "archive", profile.id, before, [])
    return { deletedCount: result.count }
  })
}

export async function listRosterHistory(tenantId: string, query: WorkforceDateRangeQuery) {
  const where = staffWhere(tenantId, query.staffIds)
  if (!query.staffIds?.split(",").some(id => id.trim())) return { items: [] }
  return scheduleTransaction(tenantId, async tx => {
    const profiles = await tx.staffProfile.findMany({ where, select: { id: true, userId: true } })
    if (!profiles.length) return { items: [] }
    const timeZone = await businessTimeZone(tx, tenantId)
    const range = normalizeHistoryRangeToPast(query.startDate, query.endDate, timeZone)
    if (range) await syncRosterHistoryRange(tx, { tenantId, staffProfileIds: profiles.map(p => p.id), ...range, mode: "insert-missing" })
    const rows = await tx.staffRosterHistoryDay.findMany({ where: { staffProfile: where, date: { gte: new Date(query.startDate), lte: new Date(query.endDate) } },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
      select: { staffProfile: { select: { userId: true } }, date: true, source: true, templateId: true, templateName: true,
        startTime: true, endTime: true, paidMinutes: true, leaveDefinitionCode: true, leaveDefinitionName: true, leaveReason: true },
    })
    return { items: rows.map(({ staffProfile, ...row }) => ({ ...row, staffId: staffProfile.userId, date: dateKey(row.date) })) }
  })
}
