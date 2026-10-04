import { withAppointmentsApi } from "@/modules/appointments/api"
import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"

import {
  createApiLogContext,
  logApiRequestError,
  logApiRequestStart,
  logApiRequestSuccess,
  withRequestId,
} from "@/lib/api-logging"
import { prisma } from "@/lib/prisma"
import { canManageUsers, type Role } from "@/lib/permissions"
import { requireTenantSession } from "@/lib/tenant-auth"
import { couponUpdateSchema } from "@/lib/validation"
import type { CouponRow } from "@/types/appointments"

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

const serializeCoupon = (coupon: {
  id: string
  code: string
  name: string | null
  discountType: "NONE" | "PERCENT" | "AMOUNT"
  discountValue: number
  appliesTo?: "ORDER" | "SERVICE_LINES" | "PRODUCT_LINES"
  allowedServiceIds?: string[]
  allowedCategoryIds?: string[]
  allowedProductIds?: string[]
  minSubtotalCents?: number
  stackingMode?: "STACKABLE" | "EXCLUSIVE"
  isActive: boolean
  validFrom: Date | null
  validTo: Date | null
  maxUses: number | null
  maxUsesPerCustomer: number | null
  usedCount: number
  createdAt: Date
  updatedAt: Date
}): CouponRow => ({
  id: coupon.id,
  code: coupon.code,
  name: coupon.name,
  discountType: coupon.discountType,
  discountValue: coupon.discountValue,
  appliesTo: coupon.appliesTo ?? "ORDER",
  allowedServiceIds: coupon.allowedServiceIds ?? [],
  allowedCategoryIds: coupon.allowedCategoryIds ?? [],
  allowedProductIds: coupon.allowedProductIds ?? [],
  minSubtotalCents: coupon.minSubtotalCents ?? 0,
  stackingMode: coupon.stackingMode ?? "STACKABLE",
  isActive: coupon.isActive,
  validFrom: coupon.validFrom ? coupon.validFrom.toISOString().slice(0, 10) : null,
  validTo: coupon.validTo ? coupon.validTo.toISOString().slice(0, 10) : null,
  maxUses: coupon.maxUses,
  maxUsesPerCustomer: coupon.maxUsesPerCustomer,
  usedCount: coupon.usedCount,
  createdAt: coupon.createdAt.toISOString(),
  updatedAt: coupon.updatedAt.toISOString(),
})

async function handlePATCH(
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
    const payload = await request.json()
    const parsed = couponUpdateSchema.safeParse(payload)
    if (!parsed.success) {
      const response = NextResponse.json(
        { error: "Invalid input.", details: parsed.error.flatten() },
        { status: 400 }
      )
      logApiRequestSuccess(logContext, 400, { reason: "validation_failed" })
      return withRequestId(response, logContext.requestId)
    }

    const data = parsed.data
    const validFrom =
      data.validFrom === undefined
        ? undefined
        : data.validFrom
          ? new Date(`${data.validFrom}T00:00:00.000Z`)
          : null
    const validTo =
      data.validTo === undefined
        ? undefined
        : data.validTo
          ? new Date(`${data.validTo}T00:00:00.000Z`)
          : null

    if (
      validFrom !== undefined &&
      validTo !== undefined &&
      validFrom !== null &&
      validTo !== null &&
      validFrom > validTo
    ) {
      const response = NextResponse.json({ error: "Valid from must be before valid to." }, { status: 400 })
      logApiRequestSuccess(logContext, 400, { reason: "invalid_date_range" })
      return withRequestId(response, logContext.requestId)
    }

    const existing = await prisma.coupon.findFirst({
      where: { id, tenantId },
      select: { id: true },
    })
    if (!existing) {
      const response = NextResponse.json({ error: "Coupon not found." }, { status: 404 })
      logApiRequestSuccess(logContext, 404, { reason: "not_found" })
      return withRequestId(response, logContext.requestId)
    }

    const coupon = await prisma.coupon.update({
      where: { id: existing.id },
      data: {
        ...(data.code !== undefined ? { code: data.code.toUpperCase() } : {}),
        ...(data.name !== undefined ? { name: data.name?.trim() || null } : {}),
        ...(data.discountType !== undefined ? { discountType: data.discountType } : {}),
        ...(data.discountValue !== undefined ? { discountValue: data.discountValue } : {}),
        ...(data.appliesTo !== undefined ? { appliesTo: data.appliesTo } : {}),
        ...(data.allowedServiceIds !== undefined ? { allowedServiceIds: data.allowedServiceIds } : {}),
        ...(data.allowedCategoryIds !== undefined ? { allowedCategoryIds: data.allowedCategoryIds } : {}),
        ...(data.allowedProductIds !== undefined ? { allowedProductIds: data.allowedProductIds } : {}),
        ...(data.minSubtotalCents !== undefined ? { minSubtotalCents: data.minSubtotalCents } : {}),
        ...(data.stackingMode !== undefined ? { stackingMode: data.stackingMode } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
        ...(validFrom !== undefined ? { validFrom } : {}),
        ...(validTo !== undefined ? { validTo } : {}),
        ...(data.maxUses !== undefined ? { maxUses: data.maxUses } : {}),
        ...(data.maxUsesPerCustomer !== undefined
          ? { maxUsesPerCustomer: data.maxUsesPerCustomer }
          : {}),
      } as unknown as Prisma.CouponUncheckedUpdateInput,
    })

    const response = NextResponse.json({ coupon: serializeCoupon(coupon) })
    logApiRequestSuccess(logContext, 200, { couponId: id })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const response = NextResponse.json({ error: "Coupon code already exists." }, { status: 409 })
      logApiRequestSuccess(logContext, 409, { reason: "code_conflict" })
      return withRequestId(response, logContext.requestId)
    }
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to update coupon." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

async function handleDELETE(
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
    const current = await prisma.coupon.findFirst({ where: { id, tenantId } })
    const used = current && (current.usedCount > 0 || await prisma.appointmentOrderCoupon.count({ where: { code: current.code, order: { tenantId } } }) > 0)
    const deleted = used
      ? await prisma.coupon.updateMany({ where: { id, tenantId }, data: { isActive: false } })
      : await prisma.coupon.deleteMany({ where: { id, tenantId } })
    if (deleted.count === 0) {
      const response = NextResponse.json({ error: "Coupon not found." }, { status: 404 })
      logApiRequestSuccess(logContext, 404, { reason: "not_found" })
      return withRequestId(response, logContext.requestId)
    }
    const response = NextResponse.json({ ok: true })
    logApiRequestSuccess(logContext, 200, { couponId: id })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to delete coupon." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return withAppointmentsApi(request, "appointmentCoupons", "edit", async () => {
    return handlePATCH(request, context)
  }, { kind: "coupon", id: (await context.params).id })
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return withAppointmentsApi(request, "appointmentCoupons", "archive", async () => {
    return handleDELETE(request, context)
  }, { kind: "coupon", id: (await context.params).id })
}
