import { canReadAppointmentDetails } from "@/modules/appointments/conflict-access"
import { AppointmentStatus } from "@prisma/client"
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
import { flexibleSlotSchema } from "@/lib/validation"
import type { StaffFlexibleSlot } from "@/types/shifts"

const querySchema = z.object({
  staffIds: z.string().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

const deleteSchema = z.object({
  staffId: z.string().trim().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

const ACTIVE_APPOINTMENT_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.SCHEDULED,
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.IN_PROGRESS,
]

const toMinutes = (value: string) => {
  const [hours, minutes] = value.split(":").map(Number)
  return (Number.isNaN(hours) ? 0 : hours) * 60 + (Number.isNaN(minutes) ? 0 : minutes)
}

const getMinutesInTimeZone = (value: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(value)
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0")
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0")
  return (Number.isNaN(hour) ? 0 : hour) * 60 + (Number.isNaN(minute) ? 0 : minute)
}

const slotContainsRange = (
  slots: Array<{ startTime: string; endTime: string }>,
  startMinutes: number,
  endMinutes: number
) => slots.some((slot) => startMinutes >= toMinutes(slot.startTime) && endMinutes <= toMinutes(slot.endTime))

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
    const response = NextResponse.json({ error: "Start date cannot be after end date." }, { status: 400 })
    logApiRequestSuccess(logContext, 400, { reason: "invalid_date_range" })
    return withRequestId(response, logContext.requestId)
  }

  const userIds = (staffIds ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)

  const staffProfiles = userIds.length
    ? await prisma.staffProfile.findMany({
        where: { userId: { in: userIds }, user: { tenantId } },
        select: { id: true, userId: true },
      })
    : []
  const staffProfileIds = staffProfiles.map((profile) => profile.id)
  const staffProfileMap = new Map(staffProfiles.map((profile) => [profile.id, profile.userId]))

  try {
    const rows = await prisma.staffFlexibleAvailability.findMany({
      where: {
        staffProfile: { user: { tenantId } },
        ...(staffProfileIds.length ? { staffProfileId: { in: staffProfileIds } } : {}),
        date: { gte: new Date(startDate), lte: new Date(endDate) },
      },
      orderBy: [{ date: "asc" }, { sortOrder: "asc" }],
    })
    const items: StaffFlexibleSlot[] = rows
      .map((row) => {
        const staffId = staffProfileMap.get(row.staffProfileId)
        if (!staffId) return null
        return {
          id: row.id,
          staffId,
          staffProfileId: row.staffProfileId,
          date: row.date.toISOString().slice(0, 10),
          startTime: row.startTime,
          endTime: row.endTime,
          sortOrder: row.sortOrder,
        }
      })
      .filter(Boolean) as StaffFlexibleSlot[]

    const response = NextResponse.json({ items })
    logApiRequestSuccess(logContext, 200, { itemCount: items.length })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to load flexible slots." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
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
  const parsed = flexibleSlotSchema.safeParse(payload)
  if (!parsed.success) {
    const response = NextResponse.json(
      { error: "Invalid input.", details: parsed.error.flatten() },
      { status: 400 }
    )
    logApiRequestSuccess(logContext, 400, { reason: "validation_failed" })
    return withRequestId(response, logContext.requestId)
  }

  const data = parsed.data
  const dateValue = new Date(`${data.date}T00:00:00.000Z`)
  const [staffProfile, setting] = await Promise.all([
    prisma.staffProfile.findFirst({
      where: { userId: data.staffId, user: { tenantId, role: "STAFF" } },
      select: { id: true, schedulingMode: true },
    }),
    prisma.appSetting.findUnique({
      where: { tenantId },
      select: { timeZone: true },
    }),
  ])

  if (!staffProfile) {
    const response = NextResponse.json({ error: "Staff profile not found." }, { status: 404 })
    logApiRequestSuccess(logContext, 404, { reason: "staff_profile_not_found" })
    return withRequestId(response, logContext.requestId)
  }
  if (staffProfile.schedulingMode !== "FLEXIBLE") {
    const response = NextResponse.json(
      { error: "Set staff scheduling mode to Flexible before adding slots." },
      { status: 409 }
    )
    logApiRequestSuccess(logContext, 409, { reason: "invalid_scheduling_mode" })
    return withRequestId(response, logContext.requestId)
  }

  const timeZone = setting?.timeZone ?? "UTC"
  const dayStart = new Date(`${data.date}T00:00:00.000Z`)
  const dayEnd = new Date(`${data.date}T23:59:59.999Z`)
  const appointments = await prisma.appointment.findMany({
    where: {
      tenantId,
      staffProfileId: staffProfile.id,
      status: { in: ACTIVE_APPOINTMENT_STATUSES },
      startAt: { gte: dayStart, lte: dayEnd },
    },
    select: {
      id: true,
      startAt: true,
      endAt: true,
      service: { select: { name: true } },
      customer: { select: { name: true, email: true } },
    },
  })

  const conflicts = appointments
    .filter((appointment) => {
      const startMinutes = getMinutesInTimeZone(appointment.startAt, timeZone)
      const endMinutes = getMinutesInTimeZone(appointment.endAt, timeZone)
      return !slotContainsRange(data.slots, startMinutes, endMinutes)
    })
    .map((appointment) => ({
      id: appointment.id,
      startAt: appointment.startAt.toISOString(),
      endAt: appointment.endAt.toISOString(),
      serviceName: appointment.service?.name ?? null,
      customerName: appointment.customer?.name ?? null,
      customerEmail: appointment.customer?.email ?? null,
    }))

  if (conflicts.length) {
    const response = NextResponse.json(
      {
        error: "Flexible slot update conflicts with existing appointments.",
        conflicts: await canReadAppointmentDetails(tenantId, tenantSession.context.sessionUserId) ? conflicts : [],
        conflictCount: conflicts.length,
      },
      { status: 409 }
    )
    logApiRequestSuccess(logContext, 409, { reason: "appointment_conflicts", conflictCount: conflicts.length })
    return withRequestId(response, logContext.requestId)
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.staffFlexibleAvailability.deleteMany({
        where: { staffProfileId: staffProfile.id, date: dateValue },
      })
      await tx.staffFlexibleAvailability.createMany({
        data: data.slots
          .slice()
          .sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime))
          .map((slot, index) => ({
            staffProfileId: staffProfile.id,
            date: dateValue,
            startTime: slot.startTime,
            endTime: slot.endTime,
            sortOrder: slot.sortOrder ?? index,
          })),
      })
      return tx.staffFlexibleAvailability.findMany({
        where: { staffProfileId: staffProfile.id, date: dateValue },
        orderBy: { sortOrder: "asc" },
      })
    })

    const response = NextResponse.json({
      items: result.map((item) => ({
        id: item.id,
        staffId: data.staffId,
        staffProfileId: item.staffProfileId,
        date: item.date.toISOString().slice(0, 10),
        startTime: item.startTime,
        endTime: item.endTime,
        sortOrder: item.sortOrder,
      })),
    })
    logApiRequestSuccess(logContext, 200, { itemCount: result.length })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to save flexible slots." }, { status: 500 })
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

  const staffProfile = await prisma.staffProfile.findFirst({
    where: { userId: parsed.data.staffId, user: { tenantId, role: "STAFF" } },
    select: { id: true },
  })
  if (!staffProfile) {
    const response = NextResponse.json({ error: "Staff profile not found." }, { status: 404 })
    logApiRequestSuccess(logContext, 404, { reason: "staff_profile_not_found" })
    return withRequestId(response, logContext.requestId)
  }

  try {
    const result = await prisma.staffFlexibleAvailability.deleteMany({
      where: {
        staffProfileId: staffProfile.id,
        date: new Date(`${parsed.data.date}T00:00:00.000Z`),
      },
    })
    const response = NextResponse.json({ deletedCount: result.count })
    logApiRequestSuccess(logContext, 200, { deletedCount: result.count })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to delete flexible slots." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

export async function DELETE(request: Request) {
  return withWorkforceApi(request, "shifts", "shiftRoster", "archive", actor => handleDELETE(request, actor), "flexible-slots")
}

export async function POST(request: Request) {
  return withWorkforceApi(request, "shifts", "shiftRoster", "edit", actor => handlePOST(request, actor), "flexible-slots")
}

export async function GET(request: Request) {
  return withWorkforceApi(request, "shifts", "shiftRoster", "read", actor => handleGET(request, actor), "flexible-slots")
}
