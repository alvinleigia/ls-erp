import { withAppointmentsApi } from "@/modules/appointments/api"
import { BusinessError, type BusinessActor } from "@/platform/policy"
import { requireServicesAccess } from "@/modules/services/api"
import { NextResponse } from "next/server"
import { AppointmentStatus, Prisma } from "@prisma/client"
import { z } from "zod"

import {
  createApiLogContext,
  logApiRequestError,
  logApiRequestStart,
  logApiRequestSuccess,
  withRequestId,
} from "@/lib/api-logging"
import { recordDomainAuditEventSafe } from "@/lib/domain-audit"
import { prisma } from "@/lib/prisma"
import { appointmentCreateSchema } from "@/lib/validation"
import type { ListResponse } from "@/types/api"
import type { AppointmentRow } from "@/types/appointments"
import { checkStaffAppointmentAvailability } from "./_availability"

const appointmentListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().optional(),
  staffId: z.string().trim().optional(),
  customerId: z.string().trim().optional(),
  status: z
    .enum(["SCHEDULED", "CONFIRMED", "IN_PROGRESS", "COMPLETED", "CANCELED", "NO_SHOW"])
    .optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  sort: z.enum(["startAt", "endAt", "createdAt", "updatedAt", "status"]).default("startAt"),
  order: z.enum(["asc", "desc"]).default("asc"),
})

const ACTIVE_APPOINTMENT_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.SCHEDULED,
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.IN_PROGRESS,
]

const serializeAppointment = <
  T extends Omit<AppointmentRow, "startAt" | "endAt" | "createdAt" | "updatedAt"> & {
    startAt: Date
    endAt: Date
    createdAt: Date
    updatedAt: Date
  },
>(
  appointment: T
) => ({
    ...appointment,
    startAt: appointment.startAt.toISOString(),
    endAt: appointment.endAt.toISOString(),
    createdAt: appointment.createdAt.toISOString(),
    updatedAt: appointment.updatedAt.toISOString(),
  })

async function handleGET(request: Request, actor: BusinessActor) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)

  const { tenantId } = actor

  try {
    const url = new URL(request.url)
    const parsed = appointmentListSchema.safeParse(Object.fromEntries(url.searchParams.entries()))
    if (!parsed.success) {
      const response = NextResponse.json(
        { error: "Invalid query parameters.", details: parsed.error.flatten() },
        { status: 400 }
      )
      logApiRequestSuccess(logContext, 400, { reason: "validation_failed" })
      return withRequestId(response, logContext.requestId)
    }

  const { page, pageSize, q, staffId, customerId, status, startDate, endDate, sort, order } =
    parsed.data

  const where: Prisma.AppointmentWhereInput = { tenantId }

  if (staffId) {
    where.staffProfile = { userId: staffId }
  }
  if (customerId) {
    where.customerId = customerId
  }
  if (status) {
    where.status = status
  }
  if (startDate || endDate) {
    where.startAt = {}
    if (startDate) {
      where.startAt.gte = new Date(`${startDate}T00:00:00.000Z`)
    }
    if (endDate) {
      where.startAt.lte = new Date(`${endDate}T23:59:59.999Z`)
    }
  }
  if (q) {
    where.OR = [
      { customer: { name: { contains: q, mode: Prisma.QueryMode.insensitive } } },
      { customer: { email: { contains: q, mode: Prisma.QueryMode.insensitive } } },
      { service: { name: { contains: q, mode: Prisma.QueryMode.insensitive } } },
      { staffProfile: { user: { name: { contains: q, mode: Prisma.QueryMode.insensitive } } } },
      { staffProfile: { user: { email: { contains: q, mode: Prisma.QueryMode.insensitive } } } },
    ]
  }

  let orderBy: Prisma.AppointmentOrderByWithRelationInput
  switch (sort) {
    case "endAt":
      orderBy = { endAt: order }
      break
    case "createdAt":
      orderBy = { createdAt: order }
      break
    case "updatedAt":
      orderBy = { updatedAt: order }
      break
    case "status":
      orderBy = { status: order }
      break
    default:
      orderBy = { startAt: order }
  }

  const skip = (page - 1) * pageSize
  const [total, appointments] = await prisma.$transaction([
    prisma.appointment.count({ where }),
    prisma.appointment.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true, email: true } },
        service: { select: { id: true, name: true, durationMinutes: true } },
        staffProfile: {
          select: {
            id: true,
            user: { select: { id: true, name: true, email: true } },
          },
        },
        orderLine: {
          select: {
            id: true,
            order: { select: { id: true, status: true } },
          },
        },
      },
      orderBy,
      skip,
      take: pageSize,
    }),
  ])

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const response: ListResponse<AppointmentRow> = {
    items: appointments.map(serializeAppointment),
    page,
    pageSize,
    total,
    totalPages,
  }

    const jsonResponse = NextResponse.json(response)
    logApiRequestSuccess(logContext, 200, { page, pageSize, total })
    return withRequestId(jsonResponse, logContext.requestId)
  } catch (error) {
    if (error instanceof BusinessError) throw error
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to load appointments." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

async function handlePOST(request: Request, actor: BusinessActor) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)

  const { tenantId, role, userId: sessionUserId } = actor

  try {
    const payload = await request.json()
    const parsed = appointmentCreateSchema.safeParse(payload)
    if (!parsed.success) {
      const response = NextResponse.json(
        { error: "Invalid input.", details: parsed.error.flatten() },
        { status: 400 }
      )
      logApiRequestSuccess(logContext, 400, { reason: "validation_failed" })
      return withRequestId(response, logContext.requestId)
    }

  const data = parsed.data
  const startAt = new Date(data.startAt)
    if (Number.isNaN(startAt.getTime())) {
      const response = NextResponse.json({ error: "Invalid startAt value." }, { status: 400 })
      logApiRequestSuccess(logContext, 400, { reason: "invalid_start_at" })
      return withRequestId(response, logContext.requestId)
    }
    if (startAt <= new Date()) {
      const response = NextResponse.json({ error: "Cannot book appointments in the past." }, { status: 400 })
      logApiRequestSuccess(logContext, 400, { reason: "past_start_at" })
      return withRequestId(response, logContext.requestId)
    }

  const [customer, service, staffProfile] = await Promise.all([
    prisma.user.findFirst({
      where: { id: data.customerId, tenantId },
      select: { id: true, role: true, status: true, name: true, email: true },
    }),
    prisma.service.findFirst({
      where: { id: data.serviceId, tenantId },
      select: { id: true, name: true, durationMinutes: true, status: true },
    }),
    prisma.staffProfile.findFirst({
      where: { userId: data.staffId, user: { role: "STAFF", tenantId } },
      select: { id: true, user: { select: { id: true, name: true, email: true, status: true } } },
    }),
  ])

    if (!customer) {
      const response = NextResponse.json({ error: "Customer not found." }, { status: 404 })
      logApiRequestSuccess(logContext, 404, { reason: "customer_not_found" })
      return withRequestId(response, logContext.requestId)
    }
  if (customer.role !== "CUSTOMER") {
    const response = NextResponse.json({ error: "Selected user is not a customer." }, { status: 400 })
    logApiRequestSuccess(logContext, 400, { reason: "invalid_customer_role" })
    return withRequestId(response, logContext.requestId)
  }
  if (customer.status !== "ACTIVE") {
    const response = NextResponse.json({ error: "Customer is not active." }, { status: 400 })
    logApiRequestSuccess(logContext, 400, { reason: "customer_inactive" })
    return withRequestId(response, logContext.requestId)
  }

  if (!service) {
    const response = NextResponse.json({ error: "Service not found." }, { status: 404 })
    logApiRequestSuccess(logContext, 404, { reason: "service_not_found" })
    return withRequestId(response, logContext.requestId)
  }
  if (service.status !== "ACTIVE") {
    const response = NextResponse.json({ error: "Service is not active." }, { status: 400 })
    logApiRequestSuccess(logContext, 400, { reason: "service_inactive" })
    return withRequestId(response, logContext.requestId)
  }

  if (!staffProfile) {
    const response = NextResponse.json({ error: "Staff profile not found." }, { status: 404 })
    logApiRequestSuccess(logContext, 404, { reason: "staff_profile_not_found" })
    return withRequestId(response, logContext.requestId)
  }
  if (staffProfile.user.status !== "ACTIVE") {
    const response = NextResponse.json({ error: "Staff member is not active." }, { status: 400 })
    logApiRequestSuccess(logContext, 400, { reason: "staff_inactive" })
    return withRequestId(response, logContext.requestId)
  }

  const endAt = new Date(startAt)
  endAt.setMinutes(endAt.getMinutes() + service.durationMinutes)

  const availability = await checkStaffAppointmentAvailability(
    staffProfile.id,
    startAt,
    endAt,
    tenantId
  )
  if (!availability.ok) {
    const response = NextResponse.json({ error: availability.reason }, { status: 409 })
    logApiRequestSuccess(logContext, 409, { reason: "staff_unavailable" })
    return withRequestId(response, logContext.requestId)
  }

  const [staffConflict, customerConflict] = await Promise.all([
    prisma.appointment.findFirst({
      where: {
        staffProfileId: staffProfile.id,
        tenantId,
        status: { in: ACTIVE_APPOINTMENT_STATUSES },
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
      select: { id: true },
    }),
    prisma.appointment.findFirst({
      where: {
        customerId: customer.id,
        tenantId,
        status: { in: ACTIVE_APPOINTMENT_STATUSES },
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
      select: { id: true },
    }),
  ])

  if (staffConflict) {
    const response = NextResponse.json(
      { error: "Staff member already has an appointment in this time range." },
      { status: 409 }
    )
    logApiRequestSuccess(logContext, 409, { reason: "staff_conflict" })
    return withRequestId(response, logContext.requestId)
  }
  if (customerConflict) {
    const response = NextResponse.json(
      { error: "Customer already has an appointment in this time range." },
      { status: 409 }
    )
    logApiRequestSuccess(logContext, 409, { reason: "customer_conflict" })
    return withRequestId(response, logContext.requestId)
  }

  const appointment = await prisma.appointment.create({
    data: {
      customerId: customer.id,
      tenantId,
      serviceId: service.id,
      staffProfileId: staffProfile.id,
      startAt,
      endAt,
      status: data.status ?? AppointmentStatus.SCHEDULED,
    },
    include: {
      customer: { select: { id: true, name: true, email: true } },
      service: { select: { id: true, name: true, durationMinutes: true } },
      staffProfile: {
        select: {
          id: true,
          user: { select: { id: true, name: true, email: true } },
        },
      },
      orderLine: {
        select: {
          id: true,
          order: { select: { id: true, status: true } },
        },
      },
    },
  })
    await recordDomainAuditEventSafe(prisma, {
      tenantId,
      event: "appointment.created",
      entityType: "Appointment",
      entityId: appointment.id,
      actorUserId: sessionUserId ?? null,
      actorRole: role ?? null,
      requestId: logContext.requestId,
      metadata: {
        customerId: appointment.customerId,
        staffProfileId: appointment.staffProfileId,
        serviceId: appointment.serviceId,
      },
      after: {
        status: appointment.status,
        startAt: appointment.startAt.toISOString(),
        endAt: appointment.endAt.toISOString(),
      },
    })

    const response = NextResponse.json({ appointment: serializeAppointment(appointment) }, { status: 201 })
    logApiRequestSuccess(logContext, 201, { appointmentId: appointment.id })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    if (error instanceof BusinessError) throw error
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to create appointment." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

export function GET(request: Request) {
  return withAppointmentsApi(request, "appointments", "read", async actor => {

    return handleGET(request, actor)
  })
}

export function POST(request: Request) {
  return withAppointmentsApi(request, "appointments", "create", async actor => {
    await requireServicesAccess(actor)
    return handlePOST(request, actor)
  })
}
