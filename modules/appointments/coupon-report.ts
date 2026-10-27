import type { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { startOfBusinessDate } from "@/lib/business-time"
import { addDaysToDateKey } from "@/application/dashboard/period"
import { authorizeBusinessOperation } from "@/platform/access/operation"
import { BusinessError, type BusinessActor } from "@/platform/policy"
import { lockTenantReads } from "@/platform/transactions/tenant-operation"
import type { RecordOffice } from "@/types/companies"
import type { CouponUsageReportResponse } from "@/types/reports"

export const couponReportQuery = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(160).optional(),
  status: z.enum(["used", "not_used"]).default("used"),
  couponCode: z.string().trim().max(40).transform(value => value.toUpperCase()).optional(),
  officeId: z.string().trim().min(1).max(160).optional(),
  dateFrom: z.iso.date().optional(),
  dateTo: z.iso.date().optional(),
}).refine(value => !value.dateFrom || !value.dateTo || value.dateFrom <= value.dateTo, {
  message: "Date from must be on or before date to.", path: ["dateTo"],
}).refine(value => value.dateTo !== "9999-12-31", { message: "Date to is outside the supported range.", path: ["dateTo"] })

// A customer belongs to this report only through a readable saved booking.
// Absence of a visible coupon is never evidence about hidden bookings or the
// whole customer directory. All predicates and totals use the same cohort.
export function couponUsageReport(identity: Pick<BusinessActor, "tenantId" | "userId" | "requestId">,
  query: z.infer<typeof couponReportQuery>): Promise<CouponUsageReportResponse> {
  return prisma.$transaction(async tx => {
    await lockTenantReads(tx, identity.tenantId)
    await authorizeBusinessOperation(tx, identity, ["appointmentCoupons.read", "appointments.read"], ["appointments"])
    const tenantId = identity.tenantId
    let office: RecordOffice | null = null
    if (query.officeId) {
      const rows = await tx.$queryRaw<{ office: RecordOffice | null }[]>`SELECT app.booking_office_label(${tenantId}, ${query.officeId}) AS office`
      office = rows[0]?.office ?? null
      if (!office) throw new BusinessError(403, "Booking office access is not permitted.")
    }
    const settings = await tx.appSetting.findUnique({ where: { tenantId }, select: { timeZone: true, dateFormat: true, timeFormat: true } })
    const context = { office, timeZone: settings?.timeZone ?? "America/New_York", dateFormat: settings?.dateFormat ?? "MM/dd/yyyy", timeFormat: settings?.timeFormat ?? "H24" } as const
    const createdAt: Prisma.DateTimeFilter = {
      ...(query.dateFrom ? { gte: startOfBusinessDate(query.dateFrom, context.timeZone) } : {}),
      ...(query.dateTo ? { lt: startOfBusinessDate(addDaysToDateKey(query.dateTo, 1), context.timeZone) } : {}),
    }
    const booking: Prisma.AppointmentOrderWhereInput = {
      tenantId, status: { not: "CANCELED" },
      ...(query.officeId ? { officeId: query.officeId } : {}),
      ...(query.dateFrom || query.dateTo ? { createdAt } : {}),
    }
    const code = query.couponCode ? { code: query.couponCode } : {}
    const matching: Prisma.AppointmentOrderWhereInput = { ...booking, coupons: { some: code } }
    const cohort: Prisma.UserWhereInput = {
      tenantId, role: "CUSTOMER", appointmentOrders: { some: booking },
      ...(query.q ? { OR: ["name", "email", "phone"].map(field => ({ [field]: { contains: query.q, mode: "insensitive" } })) } : {}),
    }
    const selected: Prisma.UserWhereInput = { AND: [cohort, { appointmentOrders: query.status === "used" ? { some: matching } : { none: matching } }] }
    const totalCustomers = await tx.user.count({ where: cohort })
    const usedCustomers = await tx.user.count({ where: { AND: [cohort, { appointmentOrders: { some: matching } }] } })
    const total = query.status === "used" ? usedCustomers : totalCustomers - usedCustomers
    const totalRedemptions = await tx.appointmentOrderCoupon.count({ where: { ...code, order: { ...booking, customer: cohort } } })
    const customers = await tx.user.findMany({ where: selected, select: { id: true, name: true, email: true, phone: true, status: true },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize })
    const uses = customers.length && query.status === "used" ? await tx.appointmentOrderCoupon.findMany({
      where: { ...code, order: { ...booking, customerId: { in: customers.map(customer => customer.id) } } },
      select: { code: true, order: { select: { customerId: true, createdAt: true } } },
    }) : []
    const usage = new Map<string, { count: number; codes: Set<string>; last: Date }>()
    for (const row of uses) {
      const current = usage.get(row.order.customerId) ?? { count: 0, codes: new Set<string>(), last: row.order.createdAt }
      current.count++; current.codes.add(row.code)
      if (row.order.createdAt > current.last) current.last = row.order.createdAt
      usage.set(row.order.customerId, current)
    }
    return {
      items: customers.map(customer => {
        const used = usage.get(customer.id)
        return { customerId: customer.id, customerName: customer.name, customerEmail: customer.email, customerPhone: customer.phone,
          customerStatus: customer.status, couponUsageCount: used?.count ?? 0, distinctCouponCount: used?.codes.size ?? 0,
          usedCouponCodes: used ? [...used.codes].sort() : [], lastCouponUsedAt: used?.last.toISOString() ?? null }
      }),
      page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      summary: { totalCustomers, usedCustomers, notUsedCustomers: totalCustomers - usedCustomers, totalRedemptions },
      status: query.status, context,
    }
  }, { timeout: 30_000 })
}
