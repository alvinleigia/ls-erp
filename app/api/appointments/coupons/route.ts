import { withAppointmentsApi } from "@/modules/appointments/api"
import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { z } from "zod"

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
import { couponCreateSchema } from "@/lib/validation"
import type { ListResponse } from "@/types/api"
import type { CouponRow } from "@/types/appointments"

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().optional(),
  active: z
    .string()
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "true")),
})

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

async function handleGET(request: Request) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)
  const authorized = await ensureAuthorized(request)
  if (authorized.error) {
    logApiRequestSuccess(logContext, authorized.error.status, { reason: "unauthorized_or_tenant_failed" })
    return withRequestId(authorized.error, logContext.requestId)
  }
  const { tenantId } = authorized.context

  try {
    const url = new URL(request.url)
    const parsed = listSchema.safeParse(Object.fromEntries(url.searchParams.entries()))
    if (!parsed.success) {
      const response = NextResponse.json(
        { error: "Invalid query parameters.", details: parsed.error.flatten() },
        { status: 400 }
      )
      logApiRequestSuccess(logContext, 400, { reason: "validation_failed" })
      return withRequestId(response, logContext.requestId)
    }

  const { page, pageSize, q, active } = parsed.data
  const where: Prisma.CouponWhereInput = { tenantId }
  if (q) {
    where.OR = [
      { code: { contains: q, mode: "insensitive" } },
      { name: { contains: q, mode: "insensitive" } },
    ]
  }
  if (active !== undefined) {
    where.isActive = active
  }

  const skip = (page - 1) * pageSize
  const [total, items] = await prisma.$transaction([
    prisma.coupon.count({ where }),
    prisma.coupon.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip,
      take: pageSize,
    }),
  ])

  const response: ListResponse<CouponRow> = {
    items: items.map(serializeCoupon),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  }

    const jsonResponse = NextResponse.json(response)
    logApiRequestSuccess(logContext, 200, { page, pageSize, total })
    return withRequestId(jsonResponse, logContext.requestId)
  } catch (error) {
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to load coupons." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

async function handlePOST(request: Request) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)
  const authorized = await ensureAuthorized(request)
  if (authorized.error) {
    logApiRequestSuccess(logContext, authorized.error.status, { reason: "unauthorized_or_tenant_failed" })
    return withRequestId(authorized.error, logContext.requestId)
  }
  const { tenantId } = authorized.context

  try {
    const payload = await request.json()
    const parsed = couponCreateSchema.safeParse(payload)
    if (!parsed.success) {
      const response = NextResponse.json(
        { error: "Invalid input.", details: parsed.error.flatten() },
        { status: 400 }
      )
      logApiRequestSuccess(logContext, 400, { reason: "validation_failed" })
      return withRequestId(response, logContext.requestId)
    }

  const data = parsed.data
  const code = data.code.toUpperCase()
  const validFrom = data.validFrom ? new Date(`${data.validFrom}T00:00:00.000Z`) : null
  const validTo = data.validTo ? new Date(`${data.validTo}T00:00:00.000Z`) : null
    if (validFrom && validTo && validFrom > validTo) {
      const response = NextResponse.json({ error: "Valid from must be before valid to." }, { status: 400 })
      logApiRequestSuccess(logContext, 400, { reason: "invalid_date_range" })
      return withRequestId(response, logContext.requestId)
    }

  const coupon = await prisma.coupon.create({
    data: {
      tenantId,
      code,
      name: data.name?.trim() || null,
      discountType: data.discountType,
      discountValue: data.discountValue,
      appliesTo: data.appliesTo,
      allowedServiceIds: data.allowedServiceIds,
      allowedCategoryIds: data.allowedCategoryIds,
      allowedProductIds: data.allowedProductIds,
      minSubtotalCents: data.minSubtotalCents,
      stackingMode: data.stackingMode,
      isActive: data.isActive ?? true,
      validFrom,
      validTo,
      maxUses: data.maxUses ?? null,
      maxUsesPerCustomer: data.maxUsesPerCustomer ?? null,
    } as unknown as Prisma.CouponUncheckedCreateInput,
  })

    const response = NextResponse.json({ coupon: serializeCoupon(coupon) }, { status: 201 })
    logApiRequestSuccess(logContext, 201, { couponId: coupon.id, code: coupon.code })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const response = NextResponse.json({ error: "Coupon code already exists." }, { status: 409 })
      logApiRequestSuccess(logContext, 409, { reason: "code_conflict" })
      return withRequestId(response, logContext.requestId)
    }
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to create coupon." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

export async function GET(request: Request) {
  return withAppointmentsApi(request, "appointmentCoupons", "read", async () => {
    return handleGET(request)
  })
}

export async function POST(request: Request) {
  return withAppointmentsApi(request, "appointmentCoupons", "create", async () => {
    return handlePOST(request)
  }, { kind: "coupon" })
}
