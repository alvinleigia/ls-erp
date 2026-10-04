import { requirePermission } from "@/platform/access/policy"
import { BusinessError } from "@/platform/policy"
import { recordDomainAuditEvent } from "@/lib/domain-audit"
import { NextResponse } from "next/server"
import { Weekday } from "@prisma/client"
import { z } from "zod"

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
import { flexiblePatternSchema } from "@/lib/validation"
import type { StaffFlexiblePattern } from "@/types/shifts"

const deleteSchema = z.object({
  patternId: z.string().trim().min(1),
})

const dateRegex = /^\d{4}-\d{2}-\d{2}$/
const weekdayOrder: Weekday[] = [
  Weekday.MONDAY,
  Weekday.TUESDAY,
  Weekday.WEDNESDAY,
  Weekday.THURSDAY,
  Weekday.FRIDAY,
  Weekday.SATURDAY,
  Weekday.SUNDAY,
]

const parseList = (value: string | null) =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)

const toDateOnly = (value: Date) => value.toISOString().slice(0, 10)

const rangesOverlap = (aStart: string, aEnd: string | null, bStart: string, bEnd: string | null) => {
  const leftStart = new Date(`${aStart}T00:00:00.000Z`).getTime()
  const leftEnd = aEnd ? new Date(`${aEnd}T23:59:59.999Z`).getTime() : Number.POSITIVE_INFINITY
  const rightStart = new Date(`${bStart}T00:00:00.000Z`).getTime()
  const rightEnd = bEnd ? new Date(`${bEnd}T23:59:59.999Z`).getTime() : Number.POSITIVE_INFINITY
  return leftStart <= rightEnd && rightStart <= leftEnd
}

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

async function handleGET(request: Request, actor: BusinessActor) {
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

  const url = new URL(request.url)
  const staffIds = Array.from(
    new Set([
      ...parseList(url.searchParams.get("staffIds")),
      ...(url.searchParams.get("staffId")?.trim() ? [url.searchParams.get("staffId")!.trim()] : []),
    ])
  )
  const startDate = url.searchParams.get("startDate")?.trim() ?? ""
  const endDate = url.searchParams.get("endDate")?.trim() ?? ""

  if (!staffIds.length) {
    const response = NextResponse.json({ error: "staffId/staffIds is required." }, { status: 400 })
    logApiRequestSuccess(logContext, 400, { reason: "missing_staff_ids" })
    return withRequestId(response, logContext.requestId)
  }
  if ((startDate && !dateRegex.test(startDate)) || (endDate && !dateRegex.test(endDate))) {
    const response = NextResponse.json({ error: "startDate/endDate must be YYYY-MM-DD." }, { status: 400 })
    logApiRequestSuccess(logContext, 400, { reason: "invalid_date_filter" })
    return withRequestId(response, logContext.requestId)
  }

  const staffProfiles = await prisma.staffProfile.findMany({
    where: {
      userId: { in: staffIds },
      user: { tenantId, role: "STAFF" },
      schedulingMode: "FLEXIBLE",
    },
    select: { id: true, userId: true },
  })
  if (!staffProfiles.length) {
    const response = NextResponse.json({ items: [] as StaffFlexiblePattern[] })
    logApiRequestSuccess(logContext, 200, { itemCount: 0 })
    return withRequestId(response, logContext.requestId)
  }

  const staffIdByProfileId = new Map(staffProfiles.map((profile) => [profile.id, profile.userId]))

  try {
    const rows = await prisma.staffFlexiblePattern.findMany({
      where: {
        staffProfileId: { in: staffProfiles.map((profile) => profile.id) },
        ...(startDate || endDate
          ? {
              OR: [
                {
                  validFrom: { lte: new Date(`${endDate || startDate}T00:00:00.000Z`) },
                  validTo: null,
                },
                {
                  validFrom: { lte: new Date(`${endDate || startDate}T00:00:00.000Z`) },
                  validTo: { gte: new Date(`${startDate || endDate}T00:00:00.000Z`) },
                },
              ],
            }
          : {}),
      },
      include: {
        weeks: {
          include: {
            days: {
              include: {
                slots: {
                  include: { breaks: true },
                },
              },
            },
          },
        },
      },
      orderBy: [{ isActive: "desc" }, { validFrom: "desc" }],
    })

    const items = rows
      .map((row) => {
        const staffId = staffIdByProfileId.get(row.staffProfileId)
        if (!staffId) return null
        return mapPattern(row, staffId)
      })
      .filter(Boolean) as StaffFlexiblePattern[]

    const response = NextResponse.json({ items })
    logApiRequestSuccess(logContext, 200, { itemCount: items.length })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    if (error instanceof BusinessError) throw error
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to load flexible patterns." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

async function handlePUT(request: Request, actor: BusinessActor) {
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

  const payload = await request.json().catch(() => null)
  const parsed = flexiblePatternSchema.safeParse(payload)
  if (!parsed.success) {
    const response = NextResponse.json(
      { error: "Invalid input.", details: parsed.error.flatten() },
      { status: 400 }
    )
    logApiRequestSuccess(logContext, 400, { reason: "validation_failed" })
    return withRequestId(response, logContext.requestId)
  }

  const data = parsed.data
  const staffProfile = await prisma.staffProfile.findFirst({
    where: {
      userId: data.staffId,
      user: { tenantId, role: "STAFF" },
      schedulingMode: "FLEXIBLE",
    },
    select: { id: true },
  })
  if (!staffProfile) {
    const response = NextResponse.json({ error: "Flexible staff profile not found." }, { status: 404 })
    logApiRequestSuccess(logContext, 404, { reason: "staff_profile_not_found_or_not_flexible" })
    return withRequestId(response, logContext.requestId)
  }

  if (data.patternId) {
    const existingPattern = await prisma.staffFlexiblePattern.findFirst({
      where: {
        id: data.patternId,
        staffProfileId: staffProfile.id,
      },
      select: { id: true },
    })
    if (!existingPattern) {
      const response = NextResponse.json({ error: "Flexible recurring pattern not found." }, { status: 404 })
      logApiRequestSuccess(logContext, 404, { reason: "pattern_not_found" })
      return withRequestId(response, logContext.requestId)
    }
  }

  try {
    const saved = await prisma.$transaction(async (tx) => {
      const targetPatternId = data.patternId ?? null
      if (data.isActive) {
        const activePatterns = await tx.staffFlexiblePattern.findMany({
          where: {
            staffProfileId: staffProfile.id,
            isActive: true,
            ...(targetPatternId ? { id: { not: targetPatternId } } : {}),
          },
          select: { id: true, validFrom: true, validTo: true },
        })
        const overlappingIds = activePatterns
          .filter((existing) =>
            rangesOverlap(
              toDateOnly(existing.validFrom),
              existing.validTo ? toDateOnly(existing.validTo) : null,
              data.validFrom,
              data.validTo || null
            )
          )
          .map((existing) => existing.id)
        if (overlappingIds.length) {
          requirePermission(actor, "shiftPlans.archive")
          await recordDomainAuditEvent(tx, { tenantId: actor.tenantId, actorUserId: actor.userId, actorRole: actor.role, requestId: actor.requestId, event: "workforce.shiftPlans.archive", entityType: "shiftPlans", before: { activePatternIds: overlappingIds }, after: { inactivePatternIds: overlappingIds } })
          await tx.staffFlexiblePattern.updateMany({
            where: { id: { in: overlappingIds } },
            data: { isActive: false },
          })
        }
      }

      const pattern = targetPatternId
        ? await tx.staffFlexiblePattern.update({
            where: { id: targetPatternId },
            data: {
              name: data.name?.trim() || null,
              cycleLengthWeeks: data.cycleLengthWeeks,
              validFrom: new Date(`${data.validFrom}T00:00:00.000Z`),
              validTo: data.validTo ? new Date(`${data.validTo}T00:00:00.000Z`) : null,
              isActive: data.isActive,
            },
            select: { id: true },
          })
        : await tx.staffFlexiblePattern.create({
            data: {
              staffProfileId: staffProfile.id,
              name: data.name?.trim() || null,
              cycleLengthWeeks: data.cycleLengthWeeks,
              validFrom: new Date(`${data.validFrom}T00:00:00.000Z`),
              validTo: data.validTo ? new Date(`${data.validTo}T00:00:00.000Z`) : null,
              isActive: data.isActive,
            },
            select: { id: true },
          })

      await tx.staffFlexiblePatternWeek.deleteMany({
        where: { patternId: pattern.id },
      })

      for (const week of data.weeks) {
        const createdWeek = await tx.staffFlexiblePatternWeek.create({
          data: {
            patternId: pattern.id,
            weekIndex: week.weekIndex,
          },
          select: { id: true },
        })
        for (const [dayIndex, day] of week.days.entries()) {
          const createdDay = await tx.staffFlexiblePatternDay.create({
            data: {
              weekId: createdWeek.id,
              day: day.day,
              isOff: day.isOff,
              sortOrder: day.sortOrder ?? dayIndex,
            },
            select: { id: true },
          })
          if (day.isOff || !day.slots.length) continue
          for (const [slotIndex, slot] of day.slots.entries()) {
            const createdSlot = await tx.staffFlexiblePatternSlot.create({
              data: {
                dayId: createdDay.id,
                startTime: slot.startTime,
                endTime: slot.endTime,
                sortOrder: slot.sortOrder ?? slotIndex,
              },
              select: { id: true },
            })
            if (!slot.breaks.length) continue
            await tx.staffFlexiblePatternBreak.createMany({
              data: slot.breaks.map((slotBreak, breakIndex) => ({
                slotId: createdSlot.id,
                startTime: slotBreak.startTime,
                endTime: slotBreak.endTime,
                sortOrder: slotBreak.sortOrder ?? breakIndex,
              })),
            })
          }
        }
      }

      return tx.staffFlexiblePattern.findUniqueOrThrow({
        where: { id: pattern.id },
        include: {
          weeks: {
            include: {
              days: {
                include: {
                  slots: {
                    include: { breaks: true },
                  },
                },
              },
            },
          },
        },
      })
    })

    const response = NextResponse.json({
      item: mapPattern(saved, data.staffId),
    })
    logApiRequestSuccess(logContext, 200, { patternId: saved.id })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    if (error instanceof BusinessError) throw error
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to save flexible pattern." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

async function handleDELETE(request: Request, actor: BusinessActor) {
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

  const payload = await request.json().catch(() => null)
  const parsed = deleteSchema.safeParse(payload)
  if (!parsed.success) {
    const response = NextResponse.json(
      { error: "Invalid input.", details: parsed.error.flatten() },
      { status: 400 }
    )
    logApiRequestSuccess(logContext, 400, { reason: "validation_failed" })
    return withRequestId(response, logContext.requestId)
  }

  try {
    const result = await prisma.staffFlexiblePattern.updateMany({
      where: {
        id: parsed.data.patternId,
        staffProfile: {
          user: {
            tenantId,
            role: "STAFF",
          },
        },
      },
      data: {
        isActive: false,
      },
    })

    if (!result.count) {
      const response = NextResponse.json({ error: "Flexible recurring pattern not found." }, { status: 404 })
      logApiRequestSuccess(logContext, 404, { reason: "pattern_not_found" })
      return withRequestId(response, logContext.requestId)
    }

    const response = NextResponse.json({ success: true })
    logApiRequestSuccess(logContext, 200, { patternId: parsed.data.patternId })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    if (error instanceof BusinessError) throw error
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json(
      { error: "Unable to deactivate flexible recurring pattern." },
      { status: 500 }
    )
    return withRequestId(response, logContext.requestId)
  }
}

export async function DELETE(request: Request) {
  return withWorkforceApi(request, "shifts", "shiftPlans", "archive", actor => handleDELETE(request, actor), "flexible-patterns")
}

export async function PUT(request: Request) {
  return withWorkforceApi(request, "shifts", "shiftPlans", "edit", actor => handlePUT(request, actor), "flexible-patterns")
}

export async function GET(request: Request) {
  return withWorkforceApi(request, "shifts", "shiftPlans", "read", actor => handleGET(request, actor), "flexible-patterns")
}
