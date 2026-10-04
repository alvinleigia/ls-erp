import { NextResponse } from "next/server"
import { z } from "zod"

import {
  createApiLogContext,
  logApiRequestError,
  logApiRequestStart,
  logApiRequestSuccess,
  withRequestId,
} from "@/lib/api-logging"
import { toISODate } from "@/lib/date"
import { canManageUsers, type Role } from "@/lib/permissions"
import { prisma } from "@/lib/prisma"
import { withWorkforceApi, workforceSession } from "@/modules/workforce/api"
import type { BusinessActor } from "@/platform/policy"
import {
  normalizeHistoryRangeToPast,
  syncRosterHistoryRange,
} from "@/lib/roster-history"
import type { RosterHistoryDay } from "@/types/shifts"

const querySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  staffIds: z.string().optional(),
})

type RosterHistoryDelegate = {
  findMany: (args: unknown) => Promise<
    Array<{
      staffProfileId: string
      date: Date
      source: RosterHistoryDay["source"]
      templateId: string | null
      templateName: string | null
      startTime: string | null
      endTime: string | null
      paidMinutes: number
      leaveDefinitionCode: string | null
      leaveDefinitionName: string | null
      leaveReason: string | null
    }>
  >
}

const parseDateOnly = (value: string) => {
  const [year, month, day] = value.split("-").map((chunk) => Number(chunk))
  if (!year || !month || !day) return null
  const parsed = new Date(year, month - 1, day)
  parsed.setHours(0, 0, 0, 0)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

async function handleGET(request: Request, actor: BusinessActor) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)

  const tenantSession = workforceSession(actor)
  if (tenantSession.error) {
    logApiRequestSuccess(logContext, tenantSession.error.status, { reason: "tenant_or_auth_failed" })
    return withRequestId(tenantSession.error, logContext.requestId)
  }
  const { tenantId, role } = tenantSession.context
  if (!canManageUsers((role as Role | null) ?? null)) {
    const response = NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    logApiRequestSuccess(logContext, 401, { reason: "unauthorized" })
    return withRequestId(response, logContext.requestId)
  }

  const parsed = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries())
  )
  if (!parsed.success) {
    const response = NextResponse.json(
      { error: "Invalid query parameters.", details: parsed.error.flatten() },
      { status: 400 }
    )
    logApiRequestSuccess(logContext, 400, { reason: "validation_failed" })
    return withRequestId(response, logContext.requestId)
  }

  const { startDate, endDate, staffIds } = parsed.data
  if (startDate > endDate) {
    const response = NextResponse.json(
      { error: "Start date cannot be after end date." },
      { status: 400 }
    )
    logApiRequestSuccess(logContext, 400, { reason: "invalid_date_range" })
    return withRequestId(response, logContext.requestId)
  }

  const userIds = (staffIds ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
  if (!userIds.length) {
    const response = NextResponse.json({ items: [] as RosterHistoryDay[] })
    logApiRequestSuccess(logContext, 200, { itemCount: 0, reason: "no_staff_ids" })
    return withRequestId(response, logContext.requestId)
  }

  const staffProfiles = await prisma.staffProfile.findMany({
    where: { userId: { in: userIds }, user: { tenantId } },
    select: { id: true, userId: true },
  })
  if (!staffProfiles.length) {
    const response = NextResponse.json({ items: [] as RosterHistoryDay[] })
    logApiRequestSuccess(logContext, 200, { itemCount: 0, reason: "no_staff_profiles" })
    return withRequestId(response, logContext.requestId)
  }

  const staffProfileIds = staffProfiles.map((item) => item.id)
  const profileToUser = new Map(staffProfiles.map((item) => [item.id, item.userId]))
  const settings = await prisma.appSetting.findUnique({
    where: { tenantId },
    select: { timeZone: true },
  })
  const timeZone = settings?.timeZone ?? null

  const normalizedPastRange = normalizeHistoryRangeToPast(startDate, endDate, timeZone)
  try {
    if (normalizedPastRange) {
      await syncRosterHistoryRange(prisma, {
        staffProfileIds,
        startDate: normalizedPastRange.startDate,
        endDate: normalizedPastRange.endDate,
        mode: "insert-missing",
        tenantId,
      })
    }

  const parsedStart = parseDateOnly(startDate)
  const parsedEnd = parseDateOnly(endDate)
    if (!parsedStart || !parsedEnd) {
      const response = NextResponse.json(
        { error: "Invalid query parameters." },
        { status: 400 }
      )
      logApiRequestSuccess(logContext, 400, { reason: "invalid_parsed_dates" })
      return withRequestId(response, logContext.requestId)
    }

  const rosterHistoryDelegate = (
    prisma as { staffRosterHistoryDay?: RosterHistoryDelegate }
  ).staffRosterHistoryDay
    if (!rosterHistoryDelegate) {
      const response = NextResponse.json({ items: [] as RosterHistoryDay[] })
      logApiRequestSuccess(logContext, 200, { itemCount: 0, reason: "delegate_unavailable" })
      return withRequestId(response, logContext.requestId)
    }

    const items = await rosterHistoryDelegate.findMany({
      where: {
        staffProfileId: { in: staffProfileIds },
        date: {
          gte: parsedStart,
          lte: parsedEnd,
        },
      },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
      select: {
        staffProfileId: true,
        date: true,
        source: true,
        templateId: true,
        templateName: true,
        startTime: true,
        endTime: true,
        paidMinutes: true,
        leaveDefinitionCode: true,
        leaveDefinitionName: true,
        leaveReason: true,
      },
    })

    const response: RosterHistoryDay[] = items
      .map((item) => {
        const staffId = profileToUser.get(item.staffProfileId)
        if (!staffId) return null
        return {
          staffId,
          date: toISODate(item.date),
          source: item.source,
          templateId: item.templateId,
          templateName: item.templateName,
          startTime: item.startTime,
          endTime: item.endTime,
          paidMinutes: item.paidMinutes,
          leaveDefinitionCode: item.leaveDefinitionCode,
          leaveDefinitionName: item.leaveDefinitionName,
          leaveReason: item.leaveReason,
        }
      })
      .filter(Boolean) as RosterHistoryDay[]

    const json = NextResponse.json({ items: response })
    logApiRequestSuccess(logContext, 200, { itemCount: response.length })
    return withRequestId(json, logContext.requestId)
  } catch (error) {
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to load roster history." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

export async function GET(request: Request) {
  return withWorkforceApi(request, "shifts", "shiftRoster", "read", actor => handleGET(request, actor), "history")
}
