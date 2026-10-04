import { NextResponse } from "next/server"
import { Weekday } from "@prisma/client"

import {
  createApiLogContext,
  logApiRequestError,
  logApiRequestStart,
  logApiRequestSuccess,
  withRequestId,
} from "@/lib/api-logging"
import { canManageUsers, type Role } from "@/lib/permissions"
import { prisma } from "@/lib/prisma"
import { withWorkforceApi, workforceSession } from "@/modules/workforce/api"
import type { BusinessActor } from "@/platform/policy"
import type { StaffFlexiblePattern } from "@/types/shifts"

const weekdayOrder: Weekday[] = [
  Weekday.MONDAY,
  Weekday.TUESDAY,
  Weekday.WEDNESDAY,
  Weekday.THURSDAY,
  Weekday.FRIDAY,
  Weekday.SATURDAY,
  Weekday.SUNDAY,
]

const toDateOnly = (value: Date) => value.toISOString().slice(0, 10)

const mapPattern = (
  row: {
    id: string
    staffProfileId: string
    name: string | null
    cycleLengthWeeks: number
    validFrom: Date
    validTo: Date | null
    isActive: boolean
    weeks: Array<{
      id: string
      weekIndex: number
      days: Array<{
        id: string
        day: Weekday
        isOff: boolean
        sortOrder: number
        slots: Array<{
          id: string
          startTime: string
          endTime: string
          sortOrder: number
          breaks: Array<{
            id: string
            startTime: string
            endTime: string
            sortOrder: number
          }>
        }>
      }>
    }>
  },
  staffId: string
): StaffFlexiblePattern => ({
  id: row.id,
  staffId,
  staffProfileId: row.staffProfileId,
  name: row.name,
  cycleLengthWeeks: row.cycleLengthWeeks,
  validFrom: toDateOnly(row.validFrom),
  validTo: row.validTo ? toDateOnly(row.validTo) : null,
  isActive: row.isActive,
  weeks: row.weeks
    .slice()
    .sort((a, b) => a.weekIndex - b.weekIndex)
    .map((week) => ({
      id: week.id,
      weekIndex: week.weekIndex,
      days: week.days
        .slice()
        .sort((a, b) => {
          const bySort = a.sortOrder - b.sortOrder
          if (bySort !== 0) return bySort
          return weekdayOrder.indexOf(a.day) - weekdayOrder.indexOf(b.day)
        })
        .map((day) => ({
          id: day.id,
          day: day.day,
          isOff: day.isOff,
          sortOrder: day.sortOrder,
          slots: day.slots
            .slice()
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((slot) => ({
              id: slot.id,
              startTime: slot.startTime,
              endTime: slot.endTime,
              sortOrder: slot.sortOrder,
              breaks: slot.breaks
                .slice()
                .sort((a, b) => a.sortOrder - b.sortOrder)
                .map((slotBreak) => ({
                  id: slotBreak.id,
                  startTime: slotBreak.startTime,
                  endTime: slotBreak.endTime,
                  sortOrder: slotBreak.sortOrder,
                })),
            })),
        })),
    })),
})

async function handleGET(
  request: Request,
  context: { params: Promise<{ id: string }> }, actor: BusinessActor) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)

  const tenantSession = workforceSession(actor)
  if (tenantSession.error) {
    logApiRequestSuccess(logContext, tenantSession.error.status, { reason: "tenant_or_auth_failed" })
    return withRequestId(tenantSession.error, logContext.requestId)
  }
  const { tenantId, role } = tenantSession.context
  if (!canManageUsers(role as Role)) {
    const response = NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    logApiRequestSuccess(logContext, 401, { reason: "unauthorized" })
    return withRequestId(response, logContext.requestId)
  }

  const { id } = await context.params
  try {
    const row = await prisma.staffFlexiblePattern.findFirst({
      where: {
        id,
        staffProfile: {
          user: {
            tenantId,
            role: "STAFF",
          },
        },
      },
      include: {
        staffProfile: {
          select: {
            userId: true,
          },
        },
        weeks: {
          include: {
            days: {
              include: {
                slots: {
                  include: {
                    breaks: true,
                  },
                },
              },
            },
          },
        },
      },
    })

    if (!row) {
      const response = NextResponse.json({ error: "Recurring pattern not found." }, { status: 404 })
      logApiRequestSuccess(logContext, 404, { reason: "not_found" })
      return withRequestId(response, logContext.requestId)
    }

    const response = NextResponse.json({
      item: mapPattern(row, row.staffProfile.userId),
    })
    logApiRequestSuccess(logContext, 200, { patternId: id })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to load recurring pattern detail." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}


export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return withWorkforceApi(request, "shifts", "shiftPlans", "read", actor => handleGET(request, context, actor), "flexible-patterns/[id]", (await context.params).id)
}
