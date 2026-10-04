import { withAppointmentsApi } from "@/modules/appointments/api"
import type { BusinessActor } from "@/platform/policy"
import { readJson } from "@/platform/business-api"
import { requirePermission } from "@/platform/access/policy"
import { requireServicesAccess } from "@/modules/services/api"
import { NextResponse } from "next/server"

import { AppointmentStatus } from "@prisma/client"
import {
  createApiLogContext,
  logApiRequestError,
  logApiRequestStart,
  logApiRequestSuccess,
  withRequestId,
} from "@/lib/api-logging"
import { recordDomainAuditEventSafe } from "@/lib/domain-audit"
import { checkStaffAppointmentAvailability } from "@/app/api/appointments/_availability"
import { prisma } from "@/lib/prisma"
import { canManageUsers, type Role } from "@/lib/permissions"
import { requireTenantSession } from "@/lib/tenant-auth"
import { appointmentResolveSchema } from "@/lib/validation"
import type { ResolveAppointmentsInput } from "@/types/appointments"

const ACTIVE_APPOINTMENT_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.SCHEDULED,
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.IN_PROGRESS,
]

const buildDateTime = (date: string, time: string) => {
  if (!date || !time) return null
  return new Date(`${date}T${time}:00.000Z`)
}

async function handlePOST(request: Request, actor: BusinessActor) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)

  const tenantSession = await requireTenantSession(request)
  if (tenantSession.error) {
    logApiRequestSuccess(logContext, tenantSession.error.status, { reason: "unauthorized_or_invalid_tenant" })
    return withRequestId(tenantSession.error, logContext.requestId)
  }
  const { tenantId, role } = tenantSession.context

  if (!canManageUsers(role as Role)) {
    const response = NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    logApiRequestSuccess(logContext, 401, { reason: "unauthorized" })
    return withRequestId(response, logContext.requestId)
  }

  try {
    const payload = await request.json()
    const parsed = appointmentResolveSchema.safeParse(payload)
    if (!parsed.success) {
      const response = NextResponse.json(
        { error: "Invalid request.", details: parsed.error.flatten() },
        { status: 400 }
      )
      logApiRequestSuccess(logContext, 400, { reason: "validation_failed" })
      return withRequestId(response, logContext.requestId)
    }

  const body: ResolveAppointmentsInput = parsed.data
  const appointmentIds = body.appointmentIds
    if (!appointmentIds.length || !body.action) {
      const response = NextResponse.json({ error: "Invalid request." }, { status: 400 })
      logApiRequestSuccess(logContext, 400, { reason: "invalid_payload" })
      return withRequestId(response, logContext.requestId)
    }

  const beforeAppointments = await prisma.appointment.findMany({
    where: { tenantId, id: { in: appointmentIds } },
    select: { id: true, status: true, staffProfileId: true, startAt: true, endAt: true },
  })
  if (body.action === "cancel") {
    const result = await prisma.appointment.updateMany({
      where: { id: { in: appointmentIds }, tenantId },
      data: { status: AppointmentStatus.CANCELED },
    })
      await recordDomainAuditEventSafe(prisma, {
        tenantId,
        before: JSON.parse(JSON.stringify(beforeAppointments)),
        event: "appointment.bulk_canceled",
        entityType: "Appointment",
        actorUserId: actor.userId,
        actorRole: actor.role,
        requestId: logContext.requestId,
        metadata: {
          appointmentIds,
          updatedCount: result.count,
        },
        after: {
          status: AppointmentStatus.CANCELED,
        },
      })
      const response = NextResponse.json({ updatedCount: result.count })
      logApiRequestSuccess(logContext, 200, { action: body.action, updatedCount: result.count })
      return withRequestId(response, logContext.requestId)
    }

  if (body.action === "reassign") {
    if (!body.targetStaffId) {
      const response = NextResponse.json({ error: "Target staff is required." }, { status: 400 })
      logApiRequestSuccess(logContext, 400, { reason: "missing_target_staff" })
      return withRequestId(response, logContext.requestId)
    }
    const staffProfile = await prisma.staffProfile.findFirst({
      where: { userId: body.targetStaffId, user: { tenantId, role: "STAFF", status: "ACTIVE" } },
      select: { id: true },
    })
    if (!staffProfile) {
      const response = NextResponse.json({ error: "Target staff profile not found." }, { status: 404 })
      logApiRequestSuccess(logContext, 404, { reason: "target_staff_not_found" })
      return withRequestId(response, logContext.requestId)
    }
    const result = await prisma.appointment.updateMany({
      where: { id: { in: appointmentIds }, tenantId },
      data: { staffProfileId: staffProfile.id },
    })
      await recordDomainAuditEventSafe(prisma, {
        tenantId,
        before: JSON.parse(JSON.stringify(beforeAppointments)),
        event: "appointment.bulk_reassigned",
        entityType: "Appointment",
        actorUserId: actor.userId,
        actorRole: actor.role,
        requestId: logContext.requestId,
        metadata: {
          appointmentIds,
          targetStaffId: body.targetStaffId,
          targetStaffProfileId: staffProfile.id,
          updatedCount: result.count,
        },
      })
      const response = NextResponse.json({ updatedCount: result.count })
      logApiRequestSuccess(logContext, 200, { action: body.action, updatedCount: result.count })
      return withRequestId(response, logContext.requestId)
    }

  if (body.action === "reschedule") {
    if (!body.rescheduleDate || !body.rescheduleTime) {
      const response = NextResponse.json({ error: "Reschedule date and time are required." }, { status: 400 })
      logApiRequestSuccess(logContext, 400, { reason: "missing_reschedule_datetime" })
      return withRequestId(response, logContext.requestId)
    }
    const nextStart = buildDateTime(body.rescheduleDate, body.rescheduleTime)
    if (!nextStart || Number.isNaN(nextStart.getTime())) {
      const response = NextResponse.json({ error: "Invalid reschedule date/time." }, { status: 400 })
      logApiRequestSuccess(logContext, 400, { reason: "invalid_reschedule_datetime" })
      return withRequestId(response, logContext.requestId)
    }

    const appointments = await prisma.appointment.findMany({
      where: { id: { in: appointmentIds }, tenantId },
      select: { id: true, startAt: true, endAt: true, staffProfileId: true },
      orderBy: { startAt: "asc" },
    })
    if (!appointments.length) {
      const response = NextResponse.json({ updatedCount: 0 })
      logApiRequestSuccess(logContext, 200, { action: body.action, updatedCount: 0 })
      return withRequestId(response, logContext.requestId)
    }

    const firstStartAt = appointments[0].startAt.getTime()
    const plannedMoves = appointments.map((appointment) => {
      const deltaMinutes = Math.round((appointment.startAt.getTime() - firstStartAt) / 60000)
      const startAt = new Date(nextStart)
      startAt.setMinutes(startAt.getMinutes() + deltaMinutes)
      const durationMinutes = Math.max(
        1,
        Math.round((appointment.endAt.getTime() - appointment.startAt.getTime()) / 60000)
      )
      const endAt = new Date(startAt)
      endAt.setMinutes(endAt.getMinutes() + durationMinutes)
      return {
        id: appointment.id,
        staffProfileId: appointment.staffProfileId,
        startAt,
        endAt,
      }
    })

    for (const move of plannedMoves) {
      if (move.startAt <= new Date()) {
        const response = NextResponse.json(
          { error: "Cannot reschedule appointments to the past." },
          { status: 400 }
        )
        logApiRequestSuccess(logContext, 400, { reason: "past_reschedule_datetime" })
        return withRequestId(response, logContext.requestId)
      }
      const availability = await checkStaffAppointmentAvailability(
        move.staffProfileId,
        move.startAt,
        move.endAt,
        tenantId
      )
      if (!availability.ok) {
        const response = NextResponse.json(
          {
            error: `Reschedule failed for appointment ${move.id}: ${availability.reason}`,
          },
          { status: 409 }
        )
        logApiRequestSuccess(logContext, 409, { reason: "staff_unavailable", appointmentId: move.id })
        return withRequestId(response, logContext.requestId)
      }
      const conflict = await prisma.appointment.findFirst({
        where: {
          id: { notIn: appointmentIds },
          tenantId,
          staffProfileId: move.staffProfileId,
          status: { in: ACTIVE_APPOINTMENT_STATUSES },
          startAt: { lt: move.endAt },
          endAt: { gt: move.startAt },
        },
        select: { id: true },
      })
      if (conflict) {
        const response = NextResponse.json(
          {
            error: `Reschedule failed for appointment ${move.id}: staff has another appointment conflict.`,
          },
          { status: 409 }
        )
        logApiRequestSuccess(logContext, 409, { reason: "staff_conflict", appointmentId: move.id })
        return withRequestId(response, logContext.requestId)
      }
    }

    const updates = await prisma.$transaction(
      plannedMoves.map((move) =>
        prisma.appointment.updateMany({
          where: { id: move.id, tenantId },
          data: { startAt: move.startAt, endAt: move.endAt },
        })
      )
    )
    const updatedCount = updates.reduce((total, result) => total + result.count, 0)
      await recordDomainAuditEventSafe(prisma, {
        tenantId,
        before: JSON.parse(JSON.stringify(beforeAppointments)),
        event: "appointment.bulk_rescheduled",
        entityType: "Appointment",
        actorUserId: actor.userId,
        actorRole: actor.role,
        requestId: logContext.requestId,
        metadata: {
          appointmentIds,
          updatedCount,
          rescheduleDate: body.rescheduleDate,
          rescheduleTime: body.rescheduleTime,
        },
      })
      const response = NextResponse.json({ updatedCount })
      logApiRequestSuccess(logContext, 200, { action: body.action, updatedCount })
      return withRequestId(response, logContext.requestId)
  }

    const response = NextResponse.json({ error: "Unsupported action." }, { status: 400 })
    logApiRequestSuccess(logContext, 400, { reason: "unsupported_action", action: body.action })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to resolve appointments." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

export function POST(request: Request) {
  return withAppointmentsApi(request, "appointments", "read", async actor => {
    const input = await readJson(request.clone()) as { action?: string }
    requirePermission(actor, input?.action === "cancel" ? "appointments.archive" : "appointments.edit")
    if (input?.action !== "cancel") await requireServicesAccess(actor)
    return handlePOST(request, actor)
  })
}
