import { loadStandardAvailability } from "./standard-availability"
import { workingSegments } from "./working-segments"
import { loadFlexibleAvailability } from "./flexible-availability"
import { type Prisma, type PrismaClient, type StaffRosterDaySource } from "@prisma/client"

import { BusinessError } from "@/platform/policy"
import { parseDateOnly, dateKey as toDateKey, enumerateDates, dateKeyInTimeZone as getDateKeyInTimeZone } from "./roster-dates"

type DbClient = PrismaClient | Prisma.TransactionClient

type ShiftTemplateWithBreaks = {
  id: string
  name: string
  startTime: string
  endTime: string
  breaks: { startTime: string; endTime: string }[]
}

type BuildRosterHistoryParams = {
  staffProfileIds: string[]
  startDate: string
  endDate: string
  tenantId: string
}

type SyncMode = "insert-missing" | "replace"

type SyncRosterHistoryParams = BuildRosterHistoryParams & {
  mode?: SyncMode
}

const getPaidMinutes = (template: ShiftTemplateWithBreaks) =>
  workingSegments(template).reduce((sum, segment) => sum + segment.end - segment.start, 0)

const getYesterday = (timeZone?: string | null) => {
  if (timeZone) {
    const todayKey = getDateKeyInTimeZone(new Date(), timeZone)
    const todayInTz = parseDateOnly(todayKey)
    if (todayInTz) {
      todayInTz.setUTCDate(todayInTz.getUTCDate() - 1)
      return todayInTz
    }
  }
  const value = new Date()
  value.setUTCHours(0, 0, 0, 0)
  value.setUTCDate(value.getUTCDate() - 1)
  return value
}

const buildRosterHistoryRows = async (
  tx: DbClient,
  params: BuildRosterHistoryParams
) => {
  if (!params.tenantId) throw new BusinessError(403, "Tenant context is required.")
  const uniqueStaffIds = Array.from(new Set(params.staffProfileIds.filter(Boolean)))
  if (!uniqueStaffIds.length) {
    return []
  }

  const parsedStart = parseDateOnly(params.startDate)
  const parsedEnd = parseDateOnly(params.endDate)
  if (!parsedStart || !parsedEnd || parsedStart > parsedEnd) {
    return []
  }

  const dates = enumerateDates(parsedStart, parsedEnd)
  const [overrides, leaves, staffProfiles] = await Promise.all([
    tx.staffShiftOverride.findMany({
      where: {
        staffProfileId: { in: uniqueStaffIds },
        staffProfile: { user: { tenantId: params.tenantId } },
        date: { gte: parsedStart, lte: parsedEnd },
      },
      include: {
        template: {
          include: { breaks: { orderBy: { sortOrder: "asc" } } },
        },
      },
    }),
    tx.leaveRequest.findMany({
      where: {
        staffProfileId: { in: uniqueStaffIds },
        staffProfile: { user: { tenantId: params.tenantId } },
        tenantId: params.tenantId,
        status: "APPROVED",
        startDate: { lte: parsedEnd },
        endDate: { gte: parsedStart },
      },
      include: {
        leaveDefinition: { select: { code: true, name: true } },
      },
      orderBy: [{ startDate: "asc" }, { createdAt: "asc" }],
    }),
    tx.staffProfile.findMany({
      where: { id: { in: uniqueStaffIds }, user: { tenantId: params.tenantId } },
      select: { id: true, schedulingMode: true },
    }),
  ])

  const overrideMap = new Map<string, typeof overrides[number]>()
  for (const override of overrides) {
    overrideMap.set(`${override.staffProfileId}:${toDateKey(override.date)}`, override)
  }

  const leaveMap = new Map<string, typeof leaves[number]>()
  for (const leave of leaves) {
    const start = new Date(leave.startDate)
    start.setUTCHours(0, 0, 0, 0)
    const end = new Date(leave.endDate)
    end.setUTCHours(0, 0, 0, 0)
    const cursor = new Date(start)
    while (cursor <= end) {
      const key = `${leave.staffProfileId}:${toDateKey(cursor)}`
      if (!leaveMap.has(key)) {
        leaveMap.set(key, leave)
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    }
  }

  const schedulingModeByStaff = new Map(staffProfiles.map((item) => [item.id, item.schedulingMode]))

  const [resolveStandard, resolveFlexible] = await Promise.all([
    loadStandardAvailability(tx, params.tenantId,
      staffProfiles.filter(profile => profile.schedulingMode === "STANDARD").map(profile => profile.id), parsedStart, parsedEnd),
    loadFlexibleAvailability(tx, params.tenantId,
      staffProfiles.filter(profile => profile.schedulingMode === "FLEXIBLE").map(profile => profile.id), parsedStart, parsedEnd),
  ])

  const rows: {
    staffProfileId: string
    date: Date
    source: StaffRosterDaySource
    templateId: string | null
    templateName: string | null
    startTime: string | null
    endTime: string | null
    paidMinutes: number
    leaveRequestId: string | null
    leaveDefinitionCode: string | null
    leaveDefinitionName: string | null
    leaveReason: string | null
  }[] = []

  for (const { id: staffProfileId } of staffProfiles) {
    for (const day of dates) {
      const dateKey = toDateKey(day)
      const leave = leaveMap.get(`${staffProfileId}:${dateKey}`)
      if (leave) {
        rows.push({
          staffProfileId,
          date: new Date(day),
          source: "LEAVE",
          templateId: null,
          templateName: null,
          startTime: null,
          endTime: null,
          paidMinutes: 0,
          leaveRequestId: leave.id,
          leaveDefinitionCode: leave.leaveDefinition.code,
          leaveDefinitionName: leave.leaveDefinition.name,
          leaveReason: leave.reason ?? null,
        })
        continue
      }

      const override = overrideMap.get(`${staffProfileId}:${dateKey}`)
      if (override) {
        if (!override.template) {
          rows.push({
            staffProfileId,
            date: new Date(day),
            source: "UNAVAILABLE",
            templateId: null,
            templateName: null,
            startTime: null,
            endTime: null,
            paidMinutes: 0,
            leaveRequestId: null,
            leaveDefinitionCode: null,
            leaveDefinitionName: null,
            leaveReason: null,
          })
          continue
        }
        rows.push({
          staffProfileId,
          date: new Date(day),
          source: "OVERRIDE",
          templateId: override.template.id,
          templateName: override.template.name,
          startTime: override.template.startTime,
          endTime: override.template.endTime,
          paidMinutes: getPaidMinutes(override.template),
          leaveRequestId: null,
          leaveDefinitionCode: null,
          leaveDefinitionName: null,
          leaveReason: null,
        })
        continue
      }

      if (schedulingModeByStaff.get(staffProfileId) === "FLEXIBLE") {
        const flexible = resolveFlexible(staffProfileId, day)
        if (!flexible.segments.length) {
          rows.push({
            staffProfileId,
            date: new Date(day),
            source: "OFF",
            templateId: null,
            templateName: null,
            startTime: null,
            endTime: null,
            paidMinutes: 0,
            leaveRequestId: null,
            leaveDefinitionCode: null,
            leaveDefinitionName: null,
            leaveReason: null,
          })
          continue
        }
        const paidMinutes = flexible.segments.reduce((sum, segment) => sum + segment.end - segment.start, 0)
        rows.push({
          staffProfileId,
          date: new Date(day),
          source: "SCHEDULE",
          templateId: null,
          templateName: "Flexible",
          startTime: flexible.startTime,
          endTime: flexible.endTime,
          paidMinutes,
          leaveRequestId: null,
          leaveDefinitionCode: null,
          leaveDefinitionName: null,
          leaveReason: null,
        })
        continue
      }
      const { template } = resolveStandard(staffProfileId, day)
      if (!template) {
        rows.push({
          staffProfileId,
          date: new Date(day),
          source: "OFF",
          templateId: null,
          templateName: null,
          startTime: null,
          endTime: null,
          paidMinutes: 0,
          leaveRequestId: null,
          leaveDefinitionCode: null,
          leaveDefinitionName: null,
          leaveReason: null,
        })
        continue
      }

      rows.push({
        staffProfileId,
        date: new Date(day),
        source: "SCHEDULE",
        templateId: template.id,
        templateName: template.name,
        startTime: template.startTime,
        endTime: template.endTime,
        paidMinutes: getPaidMinutes(template),
        leaveRequestId: null,
        leaveDefinitionCode: null,
        leaveDefinitionName: null,
        leaveReason: null,
      })
    }
  }

  return rows
}

export const syncRosterHistoryRange = async (
  tx: DbClient,
  params: SyncRosterHistoryParams
) => {
  if (!params.tenantId) throw new BusinessError(403, "Tenant context is required.")
  const rosterHistoryDelegate = tx.staffRosterHistoryDay
  const mode = params.mode ?? "insert-missing"
  const rows = await buildRosterHistoryRows(tx, params)
  if (!rows.length) return 0

  if (mode === "replace") {
    await Promise.all(
      rows.map((row) =>
        rosterHistoryDelegate.upsert({
          where: {
            staffProfileId_date: {
              staffProfileId: row.staffProfileId,
              date: row.date,
            },
          },
          update: {
            source: row.source,
            templateId: row.templateId,
            templateName: row.templateName,
            startTime: row.startTime,
            endTime: row.endTime,
            paidMinutes: row.paidMinutes,
            leaveRequestId: row.leaveRequestId,
            leaveDefinitionCode: row.leaveDefinitionCode,
            leaveDefinitionName: row.leaveDefinitionName,
            leaveReason: row.leaveReason,
          },
          create: row,
        })
      )
    )
    return rows.length
  }

  const parsedStart = parseDateOnly(params.startDate)
  const parsedEnd = parseDateOnly(params.endDate)
  if (!parsedStart || !parsedEnd || parsedStart > parsedEnd) {
    return 0
  }

  const existing = await rosterHistoryDelegate.findMany({
    where: {
      staffProfileId: { in: params.staffProfileIds },
      staffProfile: { user: { tenantId: params.tenantId } },
      date: { gte: parsedStart, lte: parsedEnd },
    },
    select: { staffProfileId: true, date: true },
  })
  const existingSet = new Set(existing.map((item) => `${item.staffProfileId}:${toDateKey(item.date)}`))
  const inserts = rows.filter(
    (row) => !existingSet.has(`${row.staffProfileId}:${toDateKey(row.date)}`)
  )
  if (!inserts.length) {
    return 0
  }
  await rosterHistoryDelegate.createMany({
    data: inserts,
    skipDuplicates: true,
  })
  return inserts.length
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
