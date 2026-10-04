import { withAppointmentsApi } from "@/modules/appointments/api"
import { requirePermission } from "@/platform/access/policy"
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
import { canManageUsers, type Role } from "@/lib/permissions"
import { prisma } from "@/lib/prisma"
import { requireTenantSession } from "@/lib/tenant-auth"
import type { ListResponse } from "@/types/api"
import type {
  CouponUsageReportRow,
  CouponUsageReportStatus,
  CouponUsageReportSummary,
} from "@/types/reports"

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().optional(),
  status: z.enum(["used", "not_used"]).default("used"),
  couponCode: z.string().trim().max(40).optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
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

const buildCustomerWhere = (tenantId: string, q?: string): Prisma.UserWhereInput => {
  if (!q) {
    return { role: "CUSTOMER", tenantId }
  }
  return {
    role: "CUSTOMER",
    tenantId,
    OR: [
      { name: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
      { phone: { contains: q, mode: "insensitive" } },
    ],
  }
}

const buildQualifyingOrderWhere = (
  tenantId: string,
  couponCode?: string,
  dateFrom?: string,
  dateTo?: string
): Prisma.AppointmentOrderWhereInput => {
  const createdAt: Prisma.DateTimeFilter = {}
  if (dateFrom) {
    createdAt.gte = new Date(`${dateFrom}T00:00:00.000Z`)
  }
  if (dateTo) {
    createdAt.lte = new Date(`${dateTo}T23:59:59.999Z`)
  }

  const normalizedCouponCode = couponCode?.trim().toUpperCase()

  return {
    tenantId,
    status: { not: "CANCELED" },
    ...(dateFrom || dateTo ? { createdAt } : {}),
    coupons: normalizedCouponCode
      ? { some: { code: normalizedCouponCode } }
      : { some: {} },
  }
}

const makeUsageMap = (
  rows: Array<{
    code: string
    order: { customerId: string; createdAt: Date }
  }>
) => {
  const map = new Map<
    string,
    { usageCount: number; lastUsedAt: Date | null; couponCodes: Set<string> }
  >()

  rows.forEach((row) => {
    const current = map.get(row.order.customerId) ?? {
      usageCount: 0,
      lastUsedAt: null,
      couponCodes: new Set<string>(),
    }
    current.usageCount += 1
    current.couponCodes.add(row.code)
    if (!current.lastUsedAt || row.order.createdAt > current.lastUsedAt) {
      current.lastUsedAt = row.order.createdAt
    }
    map.set(row.order.customerId, current)
  })

  return map
}

async function handleGET(request: Request) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)

  const authorized = await ensureAuthorized(request)
  if (authorized.error) {
    logApiRequestSuccess(logContext, authorized.error.status, { reason: "unauthorized_or_tenant_failed" })
    return withRequestId(authorized.error, logContext.requestId)
  }
  const { tenantId } = authorized.context

  const url = new URL(request.url)
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()))
  if (!parsed.success) {
    const response = NextResponse.json(
      { error: "Invalid query parameters.", details: parsed.error.flatten() },
      { status: 400 }
    )
    logApiRequestSuccess(logContext, 400, { reason: "validation_failed" })
    return withRequestId(response, logContext.requestId)
  }

  try {
    const { page, pageSize, q, status, couponCode, dateFrom, dateTo } = parsed.data
    if (dateFrom && dateTo && dateFrom > dateTo) {
      const response = NextResponse.json(
        { error: "dateFrom must be before or equal to dateTo." },
        { status: 400 }
      )
      logApiRequestSuccess(logContext, 400, { reason: "invalid_date_range" })
      return withRequestId(response, logContext.requestId)
    }

    const customerWhere = buildCustomerWhere(tenantId, q)
    const qualifyingOrderWhere = buildQualifyingOrderWhere(
      tenantId,
      couponCode,
      dateFrom,
      dateTo
    )
    const usageFilterKey = status === "used" ? "some" : "none"
    const usageCustomerWhere: Prisma.UserWhereInput = {
      ...customerWhere,
      appointmentOrders: { [usageFilterKey]: qualifyingOrderWhere },
    }

    const skip = (page - 1) * pageSize
    const [total, customers, totalCustomers, usedCustomers, totalRedemptions] =
      await prisma.$transaction([
      prisma.user.count({ where: usageCustomerWhere }),
      prisma.user.findMany({
        where: usageCustomerWhere,
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          status: true,
        },
      }),
      prisma.user.count({ where: customerWhere }),
      prisma.user.count({
        where: {
          ...customerWhere,
          appointmentOrders: { some: qualifyingOrderWhere },
        },
      }),
      prisma.appointmentOrderCoupon.count({
        where: {
          ...(couponCode ? { code: couponCode.trim().toUpperCase() } : {}),
          order: {
            tenantId,
            status: { not: "CANCELED" },
            customer: customerWhere,
            ...(dateFrom || dateTo
              ? {
                  createdAt: {
                    ...(dateFrom ? { gte: new Date(`${dateFrom}T00:00:00.000Z`) } : {}),
                    ...(dateTo ? { lte: new Date(`${dateTo}T23:59:59.999Z`) } : {}),
                  },
                }
              : {}),
          },
        },
      }),
      ])

    let usageMap = new Map<
      string,
      { usageCount: number; lastUsedAt: Date | null; couponCodes: Set<string> }
    >()
    if (status === "used" && customers.length) {
      const rows = await prisma.appointmentOrderCoupon.findMany({
      where: {
        ...(couponCode ? { code: couponCode.trim().toUpperCase() } : {}),
        order: {
          tenantId,
          customerId: { in: customers.map((customer) => customer.id) },
          status: { not: "CANCELED" },
          ...(dateFrom || dateTo
            ? {
                createdAt: {
                  ...(dateFrom ? { gte: new Date(`${dateFrom}T00:00:00.000Z`) } : {}),
                  ...(dateTo ? { lte: new Date(`${dateTo}T23:59:59.999Z`) } : {}),
                },
              }
            : {}),
        },
      },
      select: {
        code: true,
        order: { select: { customerId: true, createdAt: true } },
      },
      })
      usageMap = makeUsageMap(rows)
    }

    const items: CouponUsageReportRow[] = customers.map((customer) => {
      const usage = usageMap.get(customer.id)
      return {
        customerId: customer.id,
        customerName: customer.name,
        customerEmail: customer.email,
        customerPhone: customer.phone,
        customerStatus: customer.status,
        couponUsageCount: usage?.usageCount ?? 0,
        distinctCouponCount: usage?.couponCodes.size ?? 0,
        usedCouponCodes: usage ? [...usage.couponCodes].sort() : [],
        lastCouponUsedAt: usage?.lastUsedAt ? usage.lastUsedAt.toISOString() : null,
      }
    })

    const summary: CouponUsageReportSummary = {
      totalCustomers,
      usedCustomers,
      notUsedCustomers: Math.max(0, totalCustomers - usedCustomers),
      totalRedemptions,
    }

    const response: ListResponse<CouponUsageReportRow> & {
      summary: CouponUsageReportSummary
      status: CouponUsageReportStatus
    } = {
      items,
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      summary,
      status,
    }

    const json = NextResponse.json(response)
    logApiRequestSuccess(logContext, 200, { page, pageSize, total, status })
    return withRequestId(json, logContext.requestId)
  } catch (error) {
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to load coupon usage report." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

export async function GET(request: Request) {
  return withAppointmentsApi(request, "appointmentCoupons", "read", async actor => {
    requirePermission(actor, "appointments.read")
    return handleGET(request)
  })
}
