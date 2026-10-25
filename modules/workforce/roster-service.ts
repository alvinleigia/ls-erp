import type { Prisma } from "@prisma/client"
import type { z } from "zod"
import { prisma } from "@/lib/prisma"
import type { ShiftOverrideInput, FlexibleSlotInput } from "@/lib/validation"
import { BusinessError, type BusinessActor } from "@/platform/policy"
import { requirePermission } from "@/platform/access/policy"
import { rosterMutation } from "./roster-mutation"
import { dailyWriteOffice, dailyTarget, dailyOfficeLabels, auditDaily } from "./daily-roster-office"
import { protectPlanBookings } from "./plan-bookings"
import { authorizeBusinessOperation } from "@/platform/access/operation"
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
    where: { tenantId, staffProfile: staffWhere(tenantId, query.staffIds), date: { gte: new Date(query.startDate), lte: new Date(query.endDate) } },
    select: { id: true, officeId: true, staffProfileId: true, date: true, templateId: true,
      staffProfile: { select: { userId: true } }, template: { select: { id: true, name: true, startTime: true, endTime: true } } },
    orderBy: [{ date: "asc" }, { id: "asc" }],
  })
  return { items: (await dailyOfficeLabels(prisma, tenantId, "OVERRIDE", rows)).map(({ staffProfile, ...row }) => ({ ...row, staffId: staffProfile.userId })) }
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
    const [workdays, holidays] = await Promise.all([
      data.skipWeekOff ? tx.$queryRaw<{ date: Date }[]>`SELECT * FROM app.override_workdays(${tenantId},${profile.id},${data.startDate}::date,${data.endDate}::date)` : null,
      data.skipHolidays ? tx.appSettingOverride.findMany({ where: { setting: { tenantId }, isOpen: false, date: { gte: start, lte: end } }, select: { date: true } }) : [],
    ])
    const holidayDates = new Set(holidays.map(day => dateKey(day.date)))
    const days = (workdays ? workdays.map(row => row.date) : enumerateDates(start, end)).filter(day => !holidayDates.has(dateKey(day)))
    if (!days.length) return { createdCount: 0 }
    const where = { tenantId, staffProfileId: profile.id, staffProfile: { user: { tenantId } }, date: { in: days } }
    const before = await tx.staffShiftOverride.findMany({ where, orderBy: { date: "asc" } })
    const byDate = new Map(before.map(row => [dateKey(row.date), row]))
    for (const officeId of new Set(before.map(row => row.officeId))) await dailyWriteOffice(tx, actor, officeId)
    const newDays = days.filter(day => !byDate.has(dateKey(day)))
    const newOffice = newDays.length ? await dailyWriteOffice(tx, actor) : null
    if (newOffice) await dailyTarget(tx, tenantId, newOffice, profile.id, newDays.map(dateKey), "OVERRIDE")
    const checkBookings = await protectPlanBookings(tx, tenantId, { id: profile.id }, days.map(dateKey))
    const fields = { templateId: template?.id ?? null }
    if (before.length) await tx.staffShiftOverride.updateMany({ where: { tenantId, id: { in: before.map(row => row.id) } }, data: fields })
    if (newOffice) await tx.staffShiftOverride.createMany({ data: newDays.map(date => ({ ...fields, tenantId, officeId: newOffice, staffProfileId: profile.id, date })) })
    await checkBookings()
    // Only refresh dates actually changed; skipped holidays/week-offs keep their snapshots.
    await syncChangedDays(tx, tenantId, profile.id, days, timeZone)
    const after = await tx.staffShiftOverride.findMany({ where, orderBy: { date: "asc" } })
    await auditDaily(tx, actor, "edit", profile.id, before, after)
    return { createdCount: days.length }
  })
}

export async function deleteShiftOverrides(actor: BusinessActor, data: z.infer<typeof deleteOverrideSchema>) {
  return rosterMutation(actor, "archive", async (tx, actor) => {
    const profile = await staffProfile(tx, actor.tenantId, data.staffId)
    const timeZone = await businessTimeZone(tx, actor.tenantId)
    const where = { tenantId: actor.tenantId, staffProfileId: profile.id, staffProfile: { user: { tenantId: actor.tenantId } }, date: { gte: new Date(data.startDate), lte: new Date(data.endDate) } }
    const changed = await tx.staffShiftOverride.findMany({ where, orderBy: { date: "asc" } })
    if (!changed.length) return { deletedCount: 0 }
    for (const officeId of new Set(changed.map(row => row.officeId))) await dailyWriteOffice(tx, actor, officeId)
    const checkBookings = await protectPlanBookings(tx, actor.tenantId, { id: profile.id }, changed.map(row => dateKey(row.date)))
    const result = await tx.staffShiftOverride.deleteMany({ where })
    await checkBookings()
    await syncChangedDays(tx, actor.tenantId, profile.id, changed.map(row => row.date), timeZone)
    await auditDaily(tx, actor, "archive", profile.id, changed, [])
    return { deletedCount: result.count }
  })
}

export async function listFlexibleSlots(tenantId: string, query: WorkforceDateRangeQuery) {
  const rows = await prisma.staffFlexibleAvailability.findMany({
    where: { tenantId, staffProfile: staffWhere(tenantId, query.staffIds), date: { gte: new Date(query.startDate), lte: new Date(query.endDate) } },
    include: { staffProfile: { select: { userId: true } } }, orderBy: [{ date: "asc" }, { sortOrder: "asc" }],
  })
  return { items: (await dailyOfficeLabels(prisma, tenantId, "SLOT", rows)).map(row => ({ id: row.id, officeId: row.officeId, office: row.office, staffId: row.staffProfile.userId, staffProfileId: row.staffProfileId,
    date: dateKey(row.date), startTime: row.startTime, endTime: row.endTime, sortOrder: row.sortOrder })) }
}

export async function saveFlexibleSlots(actor: BusinessActor, data: FlexibleSlotInput) {
  const { tenantId } = actor
  return rosterMutation(actor, "edit", async (tx, actor) => {
    const profile = await staffProfile(tx, tenantId, data.staffId, true)
    if (profile.schedulingMode !== "FLEXIBLE") throw new BusinessError(409, "Set staff scheduling mode to Flexible before adding slots.")
    const timeZone = await businessTimeZone(tx, tenantId)
    const where = { tenantId, staffProfileId: profile.id, staffProfile: { user: { tenantId } }, date: new Date(data.date) }
    const before = await tx.staffFlexibleAvailability.findMany({ where, orderBy: { sortOrder: "asc" } })
    const officeId = await dailyWriteOffice(tx, actor, before[0]?.officeId)
    if (!before.length) await dailyTarget(tx, tenantId, officeId, profile.id, data.date, "SLOT")
    const checkBookings = await protectPlanBookings(tx, tenantId, { id: profile.id, schedulingMode: "FLEXIBLE" }, [data.date])
    const retained: string[] = []
    for (const [index, slot] of [...data.slots].sort((a, b) => timeMinutes(a.startTime) - timeMinutes(b.startTime)).entries()) {
      const sortOrder = slot.sortOrder ?? index, current = before.find(row => row.sortOrder === sortOrder)
      const fields = { startTime: slot.startTime, endTime: slot.endTime }
      const saved = current
        ? await tx.staffFlexibleAvailability.update({ where: { id: current.id, tenantId }, data: fields })
        : await tx.staffFlexibleAvailability.create({ data: { ...fields, tenantId, officeId, staffProfileId: profile.id, date: new Date(data.date), sortOrder } })
      retained.push(saved.id)
    }
    await tx.staffFlexibleAvailability.deleteMany({ where: { ...where, id: { notIn: retained } } })
    await checkBookings()
    await syncPast(tx, tenantId, profile.id, data.date, data.date, timeZone)
    const rows = await tx.staffFlexibleAvailability.findMany({ where, orderBy: { sortOrder: "asc" } })
    await auditDaily(tx, actor, "edit", profile.id, before, rows)
    return { items: (await dailyOfficeLabels(tx, tenantId, "SLOT", rows)).map(row => ({ id: row.id, officeId: row.officeId, office: row.office, staffId: data.staffId, staffProfileId: row.staffProfileId,
      date: dateKey(row.date), startTime: row.startTime, endTime: row.endTime, sortOrder: row.sortOrder })) }
  })
}

export async function deleteFlexibleSlots(actor: BusinessActor, data: z.infer<typeof deleteFlexibleSlotSchema>) {
  return rosterMutation(actor, "archive", async (tx, actor) => {
    const profile = await staffProfile(tx, actor.tenantId, data.staffId, true)
    const timeZone = await businessTimeZone(tx, actor.tenantId)
    const where = { tenantId: actor.tenantId, staffProfileId: profile.id, staffProfile: { user: { tenantId: actor.tenantId } }, date: new Date(data.date) }
    const before = await tx.staffFlexibleAvailability.findMany({ where, orderBy: { sortOrder: "asc" } })
    if (!before.length) return { deletedCount: 0 }
    await dailyWriteOffice(tx, actor, before[0].officeId)
    const checkBookings = await protectPlanBookings(tx, actor.tenantId, { id: profile.id, schedulingMode: "FLEXIBLE" }, [data.date])
    const result = await tx.staffFlexibleAvailability.deleteMany({ where })
    await checkBookings()
    await syncPast(tx, actor.tenantId, profile.id, data.date, data.date, timeZone)
    await auditDaily(tx, actor, "archive", profile.id, before, [])
    return { deletedCount: result.count }
  })
}

export async function listRosterHistory(actor: BusinessActor, query: WorkforceDateRangeQuery) {
  const { tenantId } = actor
  const where = staffWhere(tenantId, query.staffIds)
  if (!query.staffIds?.split(",").some(id => id.trim())) return { items: [] }
  return scheduleTransaction(tenantId, async tx => {
    await authorizeBusinessOperation(tx, actor, "shiftRoster.read", ["shifts"])
    const profiles = await tx.staffProfile.findMany({ where, select: { id: true, userId: true } })
    if (!profiles.length) return { items: [] }
    const timeZone = await businessTimeZone(tx, tenantId)
    const range = normalizeHistoryRangeToPast(query.startDate, query.endDate, timeZone)
    if (range) await syncRosterHistoryRange(tx, { tenantId, staffProfileIds: profiles.map(p => p.id), ...range, mode: "insert-missing" })
    const rows = await tx.staffRosterHistoryDay.findMany({ where: { staffProfile: where, date: { gte: new Date(query.startDate), lte: new Date(query.endDate) } },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
      select: { staffProfile: { select: { userId: true } }, date: true, source: true, templateId: true, templateName: true,
        startTime: true, endTime: true, paidMinutes: true, privateLeave: { select: { source: true, leaveDefinitionCode: true, leaveDefinitionName: true, leaveReason: true } } },
    })
    return { items: rows.map(({ staffProfile, privateLeave, ...row }) => ({ ...row, source: privateLeave?.source ?? row.source, leaveDefinitionCode: privateLeave?.leaveDefinitionCode ?? null, leaveDefinitionName: privateLeave?.leaveDefinitionName ?? null, leaveReason: privateLeave?.leaveReason ?? null, staffId: staffProfile.userId, date: dateKey(row.date) })) }
  })
}
