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
import { flexibleWeekPlanSchema } from "@/lib/validation"
import type { StaffFlexibleWeekPlan } from "@/types/shifts"

const querySchema = {
  parse(searchParams: URLSearchParams) {
    const staffId = searchParams.get("staffId")?.trim() ?? ""
    const staffIds = (searchParams.get("staffIds") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
    const weekStartDate = searchParams.get("weekStartDate")?.trim() ?? ""
    return { staffId, staffIds, weekStartDate }
  },
}

const dateRegex = /^\d{4}-\d{2}-\d{2}$/
const deleteSchema = z.object({
  staffId: z.string().trim().min(1),
  weekStartDate: z.string().trim().regex(dateRegex),
})
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

const isMondayDate = (value: string) => {
  if (!dateRegex.test(value)) return false
  const utcDate = new Date(`${value}T00:00:00.000Z`)
  return utcDate.getUTCDay() === 1
}

const mapPlanResponse = (
  row: {
    id: string
    staffProfileId: string
    weekStartDate: Date
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
  },
  staffId: string
): StaffFlexibleWeekPlan => ({
  id: row.id,
  staffId,
  staffProfileId: row.staffProfileId,
  weekStartDate: toDateOnly(row.weekStartDate),
  days: row.days
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

  const { staffId, staffIds, weekStartDate } = querySchema.parse(new URL(request.url).searchParams)
  const targetStaffIds = staffIds.length ? Array.from(new Set(staffIds)) : staffId ? [staffId] : []
  if (!targetStaffIds.length || !weekStartDate || !dateRegex.test(weekStartDate)) {
    const response = NextResponse.json(
      { error: "staffId/staffIds and weekStartDate (YYYY-MM-DD) are required." },
      { status: 400 }
    )
    logApiRequestSuccess(logContext, 400, { reason: "missing_or_invalid_query" })
    return withRequestId(response, logContext.requestId)
  }

  const staffProfiles = await prisma.staffProfile.findMany({
    where: { userId: { in: targetStaffIds }, user: { tenantId, role: "STAFF" } },
    select: { id: true, userId: true },
  })
  if (!staffProfiles.length) {
    const response = NextResponse.json({ error: "Staff profile not found." }, { status: 404 })
    logApiRequestSuccess(logContext, 404, { reason: "staff_profile_not_found" })
    return withRequestId(response, logContext.requestId)
  }
  const userIdByProfileId = new Map(staffProfiles.map((profile) => [profile.id, profile.userId]))

  try {
    const plans = await prisma.staffFlexibleWeekPlan.findMany({
      where: {
        staffProfileId: { in: staffProfiles.map((profile) => profile.id) },
        weekStartDate: new Date(`${weekStartDate}T00:00:00.000Z`),
      },
      include: {
        days: {
          include: {
            slots: {
              include: { breaks: true },
            },
          },
        },
      },
    })

    const items = plans
      .map((plan) => {
        const currentStaffId = userIdByProfileId.get(plan.staffProfileId)
        if (!currentStaffId) return null
        return mapPlanResponse(plan, currentStaffId)
      })
      .filter(Boolean) as StaffFlexibleWeekPlan[]

    const response = NextResponse.json({
      item: staffId && !staffIds.length ? items[0] ?? null : null,
      items,
    })
    logApiRequestSuccess(logContext, 200, { found: items.length > 0, itemCount: items.length })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to load flexible week plan." }, { status: 500 })
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
  const parsed = flexibleWeekPlanSchema.safeParse(payload)
  if (!parsed.success) {
    const response = NextResponse.json(
      { error: "Invalid input.", details: parsed.error.flatten() },
      { status: 400 }
    )
    logApiRequestSuccess(logContext, 400, { reason: "validation_failed" })
    return withRequestId(response, logContext.requestId)
  }

  const data = parsed.data
  if (!isMondayDate(data.weekStartDate)) {
    const response = NextResponse.json(
      { error: "weekStartDate must be a Monday (YYYY-MM-DD)." },
      { status: 400 }
    )
    logApiRequestSuccess(logContext, 400, { reason: "invalid_week_start" })
    return withRequestId(response, logContext.requestId)
  }

  const staffProfile = await prisma.staffProfile.findFirst({
    where: { userId: data.staffId, user: { tenantId, role: "STAFF" } },
    select: { id: true, schedulingMode: true },
  })
  if (!staffProfile) {
    const response = NextResponse.json({ error: "Staff profile not found." }, { status: 404 })
    logApiRequestSuccess(logContext, 404, { reason: "staff_profile_not_found" })
    return withRequestId(response, logContext.requestId)
  }
  if (staffProfile.schedulingMode !== "FLEXIBLE") {
    const response = NextResponse.json(
      { error: "Set staff scheduling mode to Flexible before updating weekly plan." },
      { status: 409 }
    )
    logApiRequestSuccess(logContext, 409, { reason: "invalid_scheduling_mode" })
    return withRequestId(response, logContext.requestId)
  }

  try {
    const plan = await prisma.$transaction(async (tx) => {
      const upserted = await tx.staffFlexibleWeekPlan.upsert({
        where: {
          staffProfileId_weekStartDate: {
            staffProfileId: staffProfile.id,
            weekStartDate: new Date(`${data.weekStartDate}T00:00:00.000Z`),
          },
        },
        update: {},
        create: {
          staffProfileId: staffProfile.id,
          weekStartDate: new Date(`${data.weekStartDate}T00:00:00.000Z`),
        },
        select: { id: true },
      })

      await tx.staffFlexibleWeekDay.deleteMany({
        where: { planId: upserted.id },
      })

      for (const [dayIndex, day] of data.days.entries()) {
        const createdDay = await tx.staffFlexibleWeekDay.create({
          data: {
            planId: upserted.id,
            day: day.day,
            isOff: day.isOff,
            sortOrder: day.sortOrder ?? dayIndex,
          },
          select: { id: true },
        })

        if (day.isOff || !day.slots.length) continue

        for (const [slotIndex, slot] of day.slots.entries()) {
          const createdSlot = await tx.staffFlexibleWeekSlot.create({
            data: {
              dayId: createdDay.id,
              startTime: slot.startTime,
              endTime: slot.endTime,
              sortOrder: slot.sortOrder ?? slotIndex,
            },
            select: { id: true },
          })

          if (!slot.breaks.length) continue

          await tx.staffFlexibleWeekBreak.createMany({
            data: slot.breaks.map((slotBreak, breakIndex) => ({
              slotId: createdSlot.id,
              startTime: slotBreak.startTime,
              endTime: slotBreak.endTime,
              sortOrder: slotBreak.sortOrder ?? breakIndex,
            })),
          })
        }
      }

      return tx.staffFlexibleWeekPlan.findUniqueOrThrow({
        where: { id: upserted.id },
        include: {
          days: {
            include: {
              slots: {
                include: { breaks: true },
              },
            },
          },
        },
      })
    })

    const response = NextResponse.json({
      item: mapPlanResponse(plan, data.staffId),
    })
    logApiRequestSuccess(logContext, 200, { dayCount: plan.days.length })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to save flexible week plan." }, { status: 500 })
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

  const data = parsed.data
  if (!isMondayDate(data.weekStartDate)) {
    const response = NextResponse.json(
      { error: "weekStartDate must be a Monday (YYYY-MM-DD)." },
      { status: 400 }
    )
    logApiRequestSuccess(logContext, 400, { reason: "invalid_week_start" })
    return withRequestId(response, logContext.requestId)
  }

  const staffProfile = await prisma.staffProfile.findFirst({
    where: { userId: data.staffId, user: { tenantId, role: "STAFF" } },
    select: { id: true, schedulingMode: true },
  })
  if (!staffProfile) {
    const response = NextResponse.json({ error: "Staff profile not found." }, { status: 404 })
    logApiRequestSuccess(logContext, 404, { reason: "staff_profile_not_found" })
    return withRequestId(response, logContext.requestId)
  }
  if (staffProfile.schedulingMode !== "FLEXIBLE") {
    const response = NextResponse.json(
      { error: "Set staff scheduling mode to Flexible before clearing weekly plan." },
      { status: 409 }
    )
    logApiRequestSuccess(logContext, 409, { reason: "invalid_scheduling_mode" })
    return withRequestId(response, logContext.requestId)
  }

  try {
    const result = await prisma.staffFlexibleWeekPlan.deleteMany({
      where: {
        staffProfileId: staffProfile.id,
        weekStartDate: new Date(`${data.weekStartDate}T00:00:00.000Z`),
      },
    })
    const response = NextResponse.json({ deletedCount: result.count })
    logApiRequestSuccess(logContext, 200, { deletedCount: result.count })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to clear flexible week plan." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

export async function DELETE(request: Request) {
  return withWorkforceApi(request, "shifts", "shiftRoster", "archive", actor => handleDELETE(request, actor), "flexible-week-plans")
}

export async function PUT(request: Request) {
  return withWorkforceApi(request, "shifts", "shiftRoster", "edit", actor => handlePUT(request, actor), "flexible-week-plans")
}

export async function GET(request: Request) {
  return withWorkforceApi(request, "shifts", "shiftRoster", "read", actor => handleGET(request, actor), "flexible-week-plans")
}
