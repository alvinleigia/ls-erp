import type { ResolvedOrderLine, ResolvedOrderProductLine } from "./order-resolution"
import type { Prisma } from "@prisma/client"

import type { AppointmentOrderRow } from "@/types/appointments"

export const appointmentOrderInclude = {
  customer: { select: { id: true, name: true, email: true } },
  coupons: true,
  taxes: true,
  productLines: {
    include: {
      product: { select: { id: true, sku: true, name: true } },
    },
    orderBy: { sortOrder: "asc" },
  },
  lines: {
    include: {
      service: { select: { id: true, name: true, durationMinutes: true, priceCents: true } },
      staffProfile: {
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      },
    },
    orderBy: { sortOrder: "asc" },
  },
} satisfies Prisma.AppointmentOrderInclude

export const serializeAppointmentOrder = (
  order: Prisma.AppointmentOrderGetPayload<{ include: typeof appointmentOrderInclude }>
): AppointmentOrderRow => ({
  id: order.id,
  customerId: order.customerId,
  appointmentDate: order.appointmentDate.toISOString().slice(0, 10),
  appointmentStartAt: order.appointmentStartAt.toISOString(),
  status: order.status,
  customerNote: order.customerNote,
  internalNote: order.internalNote,
  subtotalCents: order.subtotalCents,
  lineDiscountCents: order.lineDiscountCents,
  couponDiscountCents: order.couponDiscountCents,
  taxCents: order.taxCents,
  totalCents: order.totalCents,
  createdAt: order.createdAt.toISOString(),
  updatedAt: order.updatedAt.toISOString(),
  customer: order.customer,
  coupons: order.coupons.map((coupon) => ({
    id: coupon.id,
    code: coupon.code,
    discountType: coupon.discountType,
    discountValue: coupon.discountValue,
    discountCents: coupon.discountCents,
  })),
  taxes: order.taxes.map((tax) => ({
    id: tax.id,
    taxId: tax.taxId,
    name: tax.name,
    percent: tax.percent,
    taxCents: tax.taxCents,
  })),
  lines: order.lines.map((line) => ({
    id: line.id,
    sortOrder: line.sortOrder,
    serviceId: line.serviceId,
    staffProfileId: line.staffProfileId,
    quantity: line.quantity,
    durationMinutes: line.durationMinutes,
    unitPriceCents: line.unitPriceCents,
    discountType: line.discountType,
    discountValue: line.discountValue,
    lineSubtotalCents: line.lineSubtotalCents,
    lineDiscountCents: line.lineDiscountCents,
    lineTaxCents: line.lineTaxCents,
    lineTotalCents: line.lineTotalCents,
    taxIds: line.taxIds,
    taxMode: line.taxMode,
    startAt: line.startAt.toISOString(),
    endAt: line.endAt.toISOString(),
    note: line.note,
    service: line.service,
    staffProfile: line.staffProfile,
  })),
  productLines: order.productLines.map((line) => ({
    id: line.id,
    sortOrder: line.sortOrder,
    productId: line.productId,
    quantity: line.quantity,
    unitPriceCents: line.unitPriceCents,
    discountType: line.discountType,
    discountValue: line.discountValue,
    lineSubtotalCents: line.lineSubtotalCents,
    lineDiscountCents: line.lineDiscountCents,
    lineTaxCents: line.lineTaxCents,
    lineTotalCents: line.lineTotalCents,
    taxIds: line.taxIds,
    taxMode: line.taxMode,
    note: line.note,
    product: line.product,
  })),
})

export const toDateOnlyUtc = (value: string) => new Date(`${value}T00:00:00.000Z`)

export const orderLineData = (line: Omit<ResolvedOrderLine, "taxPercents">) => ({
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
})

export const orderProductLineData = (line: Omit<ResolvedOrderProductLine, "taxPercents">) => ({
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
})
