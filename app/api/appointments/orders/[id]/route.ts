import { withAppointmentsApi } from "@/modules/appointments/api"
import { BusinessError, type BusinessActor } from "@/platform/policy"
import { AppointmentStatus } from "@prisma/client"
import { NextResponse } from "next/server"

import {
  createApiLogContext,
  logApiRequestError,
  logApiRequestStart,
  logApiRequestSuccess,
  withRequestId,
} from "@/lib/api-logging"
import { prisma } from "@/lib/prisma"
import {
  appointmentOrderCreateSchema,
  appointmentOrderUpdateSchema,
} from "@/lib/validation"
import { canManageUsers, type Role } from "@/lib/permissions"
import { requireTenantSession } from "@/lib/tenant-auth"
import {
  appointmentOrderInclude,
  serializeAppointmentOrder,
} from "../_helpers"
import {
  applyStockDelta,
  buildStockDeltaForOrderUpdate,
  StockConflictError,
} from "../_inventory"
import { resolveOrderData } from "../_resolve"
import {
  AvailabilityConflictError,
  scheduleConfirmedOrderLines,
} from "../_scheduling"

const ACTIVE_APPOINTMENT_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.SCHEDULED,
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.IN_PROGRESS,
]

const ensureAuthorized = async (request: Request) => {
  const tenantSession = await requireTenantSession(request)
  if (tenantSession.error) {
    return { error: tenantSession.error }
  }
  if (!canManageUsers(tenantSession.context.role as Role)) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  }
  return { context: tenantSession.context }
}

async function handleGET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)

  const authorized = await ensureAuthorized(request)
  if (authorized.error) {
    logApiRequestSuccess(logContext, authorized.error.status, { reason: "unauthorized_or_tenant_failed" })
    return withRequestId(authorized.error, logContext.requestId)
  }
  const { tenantId } = authorized.context

  try {
    const { id } = await params
    const order = await prisma.appointmentOrder.findFirst({
      where: { id, tenantId },
      include: appointmentOrderInclude,
    })
    if (!order) {
      const response = NextResponse.json({ error: "Appointment order not found." }, { status: 404 })
      logApiRequestSuccess(logContext, 404, { orderId: id, reason: "not_found" })
      return withRequestId(response, logContext.requestId)
    }
    const response = NextResponse.json({ order: serializeAppointmentOrder(order) })
    logApiRequestSuccess(logContext, 200, { orderId: id, status: order.status })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    if (error instanceof BusinessError) return NextResponse.json({ error: error.message }, { status: error.status })
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to load booking order." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

async function handlePATCH(
  request: Request, actor: BusinessActor,
  { params }: { params: Promise<{ id: string }> }
) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)

  const authorized = await ensureAuthorized(request)
  if (authorized.error) {
    logApiRequestSuccess(logContext, authorized.error.status, { reason: "unauthorized_or_tenant_failed" })
    return withRequestId(authorized.error, logContext.requestId)
  }
  const { tenantId } = authorized.context

  const { id } = await params
  const payload = await request.json().catch(() => null)
  if (!payload) {
    const response = NextResponse.json({ error: "Invalid JSON body." }, { status: 400 })
    logApiRequestSuccess(logContext, 400, { orderId: id, reason: "invalid_json" })
    return withRequestId(response, logContext.requestId)
  }
  const parsed = appointmentOrderUpdateSchema.safeParse(payload)
  if (!parsed.success) {
    const response = NextResponse.json(
      { error: "Invalid input.", details: parsed.error.flatten() },
      { status: 400 }
    )
    logApiRequestSuccess(logContext, 400, { orderId: id, reason: "validation_failed" })
    return withRequestId(response, logContext.requestId)
  }

  const currentOrder = await prisma.appointmentOrder.findFirst({
    where: { id, tenantId },
    include: {
      ...appointmentOrderInclude,
      lines: {
        include: {
          service: { select: { id: true, name: true, durationMinutes: true, priceCents: true } },
          staffProfile: {
            include: { user: { select: { id: true, name: true, email: true } } },
          },
        },
        orderBy: { sortOrder: "asc" },
      },
    },
  })
  if (!currentOrder) {
    const response = NextResponse.json({ error: "Appointment order not found." }, { status: 404 })
    logApiRequestSuccess(logContext, 404, { orderId: id, reason: "not_found" })
    return withRequestId(response, logContext.requestId)
  }

  const timeFromCurrent = `${String(currentOrder.appointmentStartAt.getHours()).padStart(2, "0")}:${String(currentOrder.appointmentStartAt.getMinutes()).padStart(2, "0")}`
  const nextInput = appointmentOrderCreateSchema.parse({
    customerId: parsed.data.customerId ?? currentOrder.customerId,
    appointmentDate:
      parsed.data.appointmentDate ?? currentOrder.appointmentDate.toISOString().slice(0, 10),
    appointmentStartTime: parsed.data.appointmentStartTime ?? timeFromCurrent,
    appointmentStartAt: parsed.data.appointmentStartAt ?? currentOrder.appointmentStartAt.toISOString(),
    status: parsed.data.status ?? currentOrder.status,
    customerNote: parsed.data.customerNote ?? currentOrder.customerNote ?? "",
    internalNote: parsed.data.internalNote ?? currentOrder.internalNote ?? "",
    coupons: parsed.data.coupons ?? currentOrder.coupons.map((coupon) => coupon.code),
    lines:
      parsed.data.lines ??
      currentOrder.lines.map((line) => ({
        serviceId: line.serviceId,
        staffId: line.staffProfile.user.id,
        quantity: line.quantity,
        durationMinutes: line.durationMinutes,
        unitPriceCents: line.unitPriceCents,
        discountType: line.discountType,
        discountValue: line.discountValue,
        taxMode: line.taxMode,
        taxIds: line.taxIds,
        note: line.note ?? "",
      })),
    productLines:
      parsed.data.productLines ??
      currentOrder.productLines.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
        discountType: line.discountType,
        discountValue: line.discountValue,
        taxMode: line.taxMode,
        taxIds: line.taxIds,
        note: line.note ?? "",
      })),
  })

  if (nextInput.status === "DRAFT" && currentOrder.status !== "DRAFT") {
    const response = NextResponse.json(
      { error: "Confirmed/completed orders cannot be moved back to draft." },
      { status: 400 }
    )
    logApiRequestSuccess(logContext, 400, { orderId: id, reason: "invalid_status_transition" })
    return withRequestId(response, logContext.requestId)
  }

  try {
    const resolved = await resolveOrderData(nextInput, { existingOrderId: id, tenantId, actor })
    const existingOrderLineIds = currentOrder.lines.map((line) => line.id)
    const existingAppointments = await prisma.appointment.findMany({
      where: {
        tenantId,
        orderLineId:
          existingOrderLineIds.length > 0 ? { in: existingOrderLineIds } : undefined,
      },
      select: { id: true },
    })
    const excludedIds = existingAppointments.map((item) => item.id)
    const scheduledLines =
      resolved.status === "CONFIRMED"
        ? await scheduleConfirmedOrderLines(resolved.lines, resolved.customerId, excludedIds, tenantId)
        : resolved.lines

    const updated = await prisma.$transaction(async (tx) => {
      const order = await tx.appointmentOrder.update({
        where: { id },
        data: {
          tenantId,
          customerId: resolved.customerId,
          appointmentDate: resolved.appointmentDate,
          appointmentStartAt: resolved.appointmentStartAt,
          status: resolved.status,
          customerNote: resolved.customerNote,
          internalNote: resolved.internalNote,
          subtotalCents: resolved.totals.subtotalCents,
          lineDiscountCents: resolved.totals.lineDiscountCents,
          couponDiscountCents: resolved.totals.couponDiscountCents,
          taxCents: resolved.totals.taxCents,
          totalCents: resolved.totals.totalCents,
          lines: {
            deleteMany: {},
            create: scheduledLines.map((line) => ({
              serviceId: line.serviceId,
              staffProfileId: line.staffProfileId,
              quantity: line.quantity,
              durationMinutes: line.durationMinutes,
              unitPriceCents: line.unitPriceCents,
              discountType: line.discountType,
              discountValue: line.discountValue,
              taxMode: line.taxMode,
              taxIds: line.taxIds,
              lineSubtotalCents: line.lineSubtotalCents,
              lineDiscountCents: line.lineDiscountCents,
              lineTaxCents: line.lineTaxCents,
              lineTotalCents: line.lineTotalCents,
              startAt: line.startAt,
              endAt: line.endAt,
              note: line.note,
              sortOrder: line.sortOrder,
            })),
          },
          productLines: {
            deleteMany: {},
            create: resolved.productLines.map((line) => ({
              productId: line.productId,
              quantity: line.quantity,
              unitPriceCents: line.unitPriceCents,
              discountType: line.discountType,
              discountValue: line.discountValue,
              taxMode: line.taxMode,
              taxIds: line.taxIds,
              lineSubtotalCents: line.lineSubtotalCents,
              lineDiscountCents: line.lineDiscountCents,
              lineTaxCents: line.lineTaxCents,
              lineTotalCents: line.lineTotalCents,
              note: line.note,
              sortOrder: line.sortOrder,
            })),
          },
          coupons: {
            deleteMany: {},
            create: resolved.coupons.map((coupon) => ({
              code: coupon.code,
              discountType: coupon.discountType,
              discountValue: coupon.discountValue,
              discountCents: coupon.discountCents,
            })),
          },
          taxes: {
            deleteMany: {},
            create: resolved.taxes.map((tax) => ({
              taxId: tax.taxId,
              name: tax.name,
              percent: tax.percent,
              taxCents: tax.taxCents,
            })),
          },
        },
        include: appointmentOrderInclude,
      })

      if (resolved.status === "CONFIRMED") {
        await tx.appointment.deleteMany({
          where: { id: { in: excludedIds }, tenantId },
        })
        const createdLineBySortOrder = new Map(
          order.lines.map((line) => [line.sortOrder, line])
        )
        await tx.appointment.createMany({
          data: scheduledLines
            .flatMap((line) => {
              const createdLine = createdLineBySortOrder.get(line.sortOrder)
              if (!createdLine) return []
              return [{
                tenantId,
                staffProfileId: line.staffProfileId,
                customerId: order.customerId,
                serviceId: line.serviceId,
                startAt: line.startAt,
                endAt: line.endAt,
                status: AppointmentStatus.SCHEDULED,
                orderLineId: createdLine.id,
              }]
            })
        })
      } else if (resolved.status === "CANCELED") {
        await tx.appointment.updateMany({
          where: { id: { in: excludedIds }, tenantId },
          data: { status: AppointmentStatus.CANCELED },
        })
      } else if (resolved.status === "COMPLETED") {
        await tx.appointment.updateMany({
          where: {
            id: { in: excludedIds },
            tenantId,
            status: { in: ACTIVE_APPOINTMENT_STATUSES },
          },
          data: { status: AppointmentStatus.COMPLETED },
        })
      } else {
        await tx.appointment.deleteMany({
          where: { id: { in: excludedIds }, tenantId },
        })
      }

      const stockDelta = buildStockDeltaForOrderUpdate({
        previousStatus: currentOrder.status,
        nextStatus: resolved.status,
        previousLines: currentOrder.productLines.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
        })),
        nextLines: resolved.productLines.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
        })),
      })
      await applyStockDelta({
        actor,
        tx,
        deltaByProduct: stockDelta,
        orderId: order.id,
        tenantId,
      })

      return order
    })

    const response = NextResponse.json({ order: serializeAppointmentOrder(updated) })
    logApiRequestSuccess(logContext, 200, { orderId: id, status: updated.status })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    if (error instanceof BusinessError) return NextResponse.json({ error: error.message }, { status: error.status })
    if (error instanceof AvailabilityConflictError) {
      const response = NextResponse.json(
        {
          error: error.message,
          suggestedStartAt: error.suggestedStartAt,
          canApplySuggestion: Boolean(error.suggestedStartAt),
        },
        { status: 409 }
      )
      logApiRequestSuccess(logContext, 409, { orderId: id, reason: "availability_conflict" })
      return withRequestId(response, logContext.requestId)
    }
    if (error instanceof StockConflictError) {
      const response = NextResponse.json({ error: error.message }, { status: 409 })
      logApiRequestSuccess(logContext, 409, { orderId: id, reason: "stock_conflict" })
      return withRequestId(response, logContext.requestId)
    }
    logApiRequestError(logContext, error, 400, { orderId: id })
    const response = NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to update booking order." },
      { status: 400 }
    )
    return withRequestId(response, logContext.requestId)
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return withAppointmentsApi(request, "appointments", "edit", actor => {
    return handlePATCH(request, actor, context)
  }, { kind: "order", id: (await context.params).id })
}

export function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return withAppointmentsApi(request, "appointments", "read", () => {
    return handleGET(request, context)
  })
}
