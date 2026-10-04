import { AppointmentStatus, Weekday } from "@prisma/client"
import { NextResponse } from "next/server"
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

const previewBreakSchema = z.object({
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
})

const previewSlotSchema = z.object({
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  breaks: z.array(previewBreakSchema).optional().default([]),
})

const previewDaySchema = z.object({
  day: z.nativeEnum(Weekday),
  isOff: z.boolean().optional().default(false),
  slots: z.array(previewSlotSchema).optional().default([]),
})

const previewWeekSchema = z.object({
  weekIndex: z.coerce.number().int().min(1),
  days: z.array(previewDaySchema).length(7),
})

const impactPreviewSchema = z
  .object({
    mode: z.enum(["DEACTIVATE", "CLONE", "UPDATE"]),
    patternId: z.string().trim().min(1),
    targetStaffId: z.string().trim().min(1).optional(),
    validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    validTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
    activate: z.boolean().optional().default(true),
    cycleLengthWeeks: z.coerce.number().int().min(1).max(12).optional(),
    weeks: z.array(previewWeekSchema).optional(),
  })
  .superRefine((value, ctx) => {
    if ((value.mode === "CLONE" || value.mode === "UPDATE") && !value.validFrom) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "validFrom is required.",
        path: ["validFrom"],
      })
    }
    if (value.validFrom && value.validTo && value.validFrom > value.validTo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "validFrom must be on or before validTo.",
        path: ["validFrom"],
      })
    }
    if ((value.mode === "CLONE" || value.mode === "UPDATE") && value.weeks) {
      if (!value.cycleLengthWeeks) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "cycleLengthWeeks is required when weeks are provided.",
          path: ["cycleLengthWeeks"],
        })
      } else if (value.weeks.length !== value.cycleLengthWeeks) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "weeks length must match cycleLengthWeeks.",
          path: ["weeks"],
        })
      }
    }
  })

const ACTIVE_APPOINTMENT_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.SCHEDULED,
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.IN_PROGRESS,
]

const weekdayByIndex: Weekday[] = [
  Weekday.SUNDAY,
  Weekday.MONDAY,
  Weekday.TUESDAY,
  Weekday.WEDNESDAY,
  Weekday.THURSDAY,
  Weekday.FRIDAY,
  Weekday.SATURDAY,
]

const DAY_MS = 24 * 60 * 60 * 1000
const PREVIEW_HORIZON_DAYS = 90

const toDateOnly = (value: Date) => value.toISOString().slice(0, 10)

const parseDateOnly = (value: string) => new Date(`${value}T00:00:00.000Z`)

const endOfDateOnly = (value: string) => new Date(`${value}T23:59:59.999Z`)

const rangesOverlap = (
  aStart: string,
  aEnd: string | null,
  bStart: string,
  bEnd: string | null
) => {
  const leftStart = parseDateOnly(aStart).getTime()
  const leftEnd = aEnd ? endOfDateOnly(aEnd).getTime() : Number.POSITIVE_INFINITY
  const rightStart = parseDateOnly(bStart).getTime()
  const rightEnd = bEnd ? endOfDateOnly(bEnd).getTime() : Number.POSITIVE_INFINITY
  return leftStart <= rightEnd && rightStart <= leftEnd
}

const toMinutes = (value: string) => {
  const [hours, minutes] = value.split(":").map((part) => Number(part))
  return (Number.isNaN(hours) ? 0 : hours) * 60 + (Number.isNaN(minutes) ? 0 : minutes)
}

const getDayNetMinutes = (
  day: {
    isOff: boolean
    slots: Array<{
      startTime: string
      endTime: string
      breaks: Array<{ startTime: string; endTime: string }>
    }>
  } | null | undefined
) => {
  if (!day || day.isOff) return 0
  return day.slots.reduce((slotSum, slot) => {
    const slotStart = toMinutes(slot.startTime)
    const slotEnd = toMinutes(slot.endTime)
    const slotMinutes = Math.max(0, slotEnd - slotStart)
    const breakMinutes = slot.breaks.reduce((breakSum, currentBreak) => {
      const breakStart = toMinutes(currentBreak.startTime)
      const breakEnd = toMinutes(currentBreak.endTime)
      return breakSum + Math.max(0, breakEnd - breakStart)
    }, 0)
    return slotSum + Math.max(0, slotMinutes - breakMinutes)
  }, 0)
}

async function handlePOST(request: Request, actor: BusinessActor) {
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
  const parsed = impactPreviewSchema.safeParse(payload)
  if (!parsed.success) {
    const response = NextResponse.json(
      { error: "Invalid input.", details: parsed.error.flatten() },
      { status: 400 }
    )
    logApiRequestSuccess(logContext, 400, { reason: "validation_failed" })
    return withRequestId(response, logContext.requestId)
  }

  const data = parsed.data

  try {
    const source = await prisma.staffFlexiblePattern.findFirst({
      where: {
        id: data.patternId,
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
            id: true,
            userId: true,
            user: {
              select: {
                name: true,
                email: true,
              },
            },
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

    if (!source) {
      const response = NextResponse.json({ error: "Recurring pattern not found." }, { status: 404 })
      logApiRequestSuccess(logContext, 404, { reason: "pattern_not_found" })
      return withRequestId(response, logContext.requestId)
    }

    const targetStaffProfile =
      data.mode === "CLONE" && data.targetStaffId && data.targetStaffId !== source.staffProfile.userId
        ? await prisma.staffProfile.findFirst({
            where: {
              userId: data.targetStaffId,
              user: {
                tenantId,
                role: "STAFF",
              },
            },
            select: {
              id: true,
              schedulingMode: true,
              user: {
                select: {
                  name: true,
                  email: true,
                },
              },
            },
          })
        : null

    if (data.mode === "CLONE" && data.targetStaffId && data.targetStaffId !== source.staffProfile.userId) {
      if (!targetStaffProfile) {
        const response = NextResponse.json({ error: "Target staff profile not found." }, { status: 404 })
        logApiRequestSuccess(logContext, 404, { reason: "target_staff_not_found" })
        return withRequestId(response, logContext.requestId)
      }
      if (targetStaffProfile.schedulingMode !== "FLEXIBLE") {
        const response = NextResponse.json(
          { error: "Target staff must be in Flexible scheduling mode before assignment." },
          { status: 409 }
        )
        logApiRequestSuccess(logContext, 409, { reason: "target_staff_not_flexible" })
        return withRequestId(response, logContext.requestId)
      }
    }

    const effectiveStaffProfileId = targetStaffProfile?.id ?? source.staffProfile.id
    const effectiveStaffName = targetStaffProfile?.user.name ?? source.staffProfile.user.name
    const effectiveStaffEmail = targetStaffProfile?.user.email ?? source.staffProfile.user.email

    const today = new Date()
    const todayDateOnly = toDateOnly(today)
    const sourceValidFrom = toDateOnly(source.validFrom)
    const sourceValidTo = source.validTo ? toDateOnly(source.validTo) : null

    const windowStart =
      data.mode === "DEACTIVATE"
        ? (todayDateOnly > sourceValidFrom ? todayDateOnly : sourceValidFrom)
        : (data.validFrom as string)
    const windowEnd =
      data.mode === "DEACTIVATE"
        ? sourceValidTo
        : data.validTo || null

    if (windowEnd && windowStart > windowEnd) {
      const response = NextResponse.json({
        preview: {
          mode: data.mode,
          patternId: source.id,
          staffName: effectiveStaffName,
          staffEmail: effectiveStaffEmail,
          window: {
            startDate: windowStart,
            endDate: windowEnd,
            truncatedAt: null,
            isOpenEnded: false,
          },
          estimatedBookedMinutesInWindow: 0,
          estimatedBookedHoursInWindow: 0,
          affectedAppointmentsCount: 0,
          overlappingActivePatternsCount: 0,
          notes: ["No effective dates in preview window."],
        },
      })
      logApiRequestSuccess(logContext, 200, { patternId: source.id, mode: data.mode, emptyWindow: true })
      return withRequestId(response, logContext.requestId)
    }

    const horizonStart = parseDateOnly(windowStart)
    const computedEnd = windowEnd ? parseDateOnly(windowEnd) : new Date(horizonStart.getTime() + PREVIEW_HORIZON_DAYS * DAY_MS)
    const horizonCap = new Date(horizonStart.getTime() + PREVIEW_HORIZON_DAYS * DAY_MS)
    const effectiveEnd = computedEnd.getTime() > horizonCap.getTime() ? horizonCap : computedEnd
    const isTruncated = !windowEnd || computedEnd.getTime() > horizonCap.getTime()

    const previewWeeks = data.weeks
      ? data.weeks.map((week) => ({
          weekIndex: week.weekIndex,
          days: week.days.map((day) => ({
            day: day.day,
            isOff: day.isOff,
            slots: day.slots.map((slot) => ({
              startTime: slot.startTime,
              endTime: slot.endTime,
              breaks: slot.breaks.map((slotBreak) => ({
                startTime: slotBreak.startTime,
                endTime: slotBreak.endTime,
              })),
            })),
          })),
        }))
      : source.weeks.map((week) => ({
          weekIndex: week.weekIndex,
          days: week.days.map((day) => ({
            day: day.day,
            isOff: day.isOff,
            slots: day.slots.map((slot) => ({
              startTime: slot.startTime,
              endTime: slot.endTime,
              breaks: slot.breaks.map((slotBreak) => ({
                startTime: slotBreak.startTime,
                endTime: slotBreak.endTime,
              })),
            })),
          })),
        }))

    const weeksSorted = previewWeeks.slice().sort((a, b) => a.weekIndex - b.weekIndex)
    const cycleLengthWeeks = Math.max(1, data.cycleLengthWeeks ?? source.cycleLengthWeeks)
    const cycleStartReference =
      data.mode === "DEACTIVATE"
        ? parseDateOnly(sourceValidFrom).getTime()
        : parseDateOnly(data.validFrom as string).getTime()

    let estimatedBookedMinutesInWindow = 0
    for (let cursor = horizonStart.getTime(); cursor <= effectiveEnd.getTime(); cursor += DAY_MS) {
      const date = new Date(cursor)
      const day = weekdayByIndex[date.getUTCDay()]
      const weekOffset = Math.floor(Math.max(0, (cursor - cycleStartReference) / DAY_MS) / 7)
      const weekIndex = (weekOffset % cycleLengthWeeks) + 1
      const week = weeksSorted.find((item) => item.weekIndex === weekIndex)
      const weekDay = week?.days.find((item) => item.day === day)
      estimatedBookedMinutesInWindow += getDayNetMinutes(weekDay)
    }

    const appointmentStart = parseDateOnly(windowStart)
    const appointmentEnd = endOfDateOnly(toDateOnly(effectiveEnd))

    const affectedAppointmentsCount = await prisma.appointment.count({
      where: {
        tenantId,
        staffProfileId: effectiveStaffProfileId,
        status: { in: ACTIVE_APPOINTMENT_STATUSES },
        startAt: {
          gte: appointmentStart,
          lte: appointmentEnd,
        },
      },
    })

    let overlappingActivePatternsCount = 0
    if ((data.mode === "CLONE" || data.mode === "UPDATE") && data.activate) {
      const activePatterns = await prisma.staffFlexiblePattern.findMany({
        where: {
          staffProfileId: effectiveStaffProfileId,
          isActive: true,
          id: { not: source.id },
        },
        select: { id: true, validFrom: true, validTo: true },
      })
      overlappingActivePatternsCount = activePatterns.filter((pattern) =>
        rangesOverlap(
          toDateOnly(pattern.validFrom),
          pattern.validTo ? toDateOnly(pattern.validTo) : null,
          data.validFrom as string,
          data.validTo || null
        )
      ).length
    }

    const notes: string[] = []
    if (isTruncated) {
      notes.push(`Preview is limited to ${PREVIEW_HORIZON_DAYS} days.`)
    }
    if ((data.mode === "CLONE" || data.mode === "UPDATE") && data.activate && overlappingActivePatternsCount > 0) {
      notes.push(`${overlappingActivePatternsCount} active pattern(s) will be deactivated due to overlap.`)
    }
    if (affectedAppointmentsCount > 0) {
      notes.push(`${affectedAppointmentsCount} active appointment(s) fall inside this window.`)
    }

    const response = NextResponse.json({
      preview: {
        mode: data.mode,
        patternId: source.id,
        staffName: effectiveStaffName,
        staffEmail: effectiveStaffEmail,
        window: {
          startDate: windowStart,
          endDate: windowEnd,
          truncatedAt: isTruncated ? toDateOnly(effectiveEnd) : null,
          isOpenEnded: windowEnd === null,
        },
        estimatedBookedMinutesInWindow,
        estimatedBookedHoursInWindow: Number((estimatedBookedMinutesInWindow / 60).toFixed(2)),
        affectedAppointmentsCount,
        overlappingActivePatternsCount,
        notes,
      },
    })

    logApiRequestSuccess(logContext, 200, {
      patternId: source.id,
      mode: data.mode,
      affectedAppointmentsCount,
      overlappingActivePatternsCount,
    })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to preview recurring pattern impact." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

export async function POST(request: Request) {
  return withWorkforceApi(request, "shifts", "shiftPlans", "read", actor => handlePOST(request, actor), "flexible-patterns/impact-preview")
}
