import type {
  AppointmentOrderCouponForm,
  AppointmentOrderFormValues,
  AppointmentOrderLineForm,
  AppointmentOrderProductLineForm,
  AppointmentOrderRow,
} from "@/types/appointments"

const toTimeInput = (value: Date) => {
  const hours = String(value.getHours()).padStart(2, "0")
  const minutes = String(value.getMinutes()).padStart(2, "0")
  return `${hours}:${minutes}`
}

export const createEmptyOrderLine = (): AppointmentOrderLineForm => ({
  id: crypto.randomUUID(),
  serviceId: "",
  staffId: "",
  quantity: 1,
  durationMinutes: 0,
  unitPriceCents: 0,
  discountType: "NONE",
  discountValue: 0,
  taxIds: [],
  taxMode: "EXCLUSIVE",
  lineTaxCents: 0,
  note: "",
})

export const createEmptyProductLine = (): AppointmentOrderProductLineForm => ({
  id: crypto.randomUUID(),
  productId: "",
  quantity: 1,
  unitPriceCents: 0,
  discountType: "NONE",
  discountValue: 0,
  taxIds: [],
  taxMode: "EXCLUSIVE",
  lineTaxCents: 0,
  note: "",
})

export const defaultAppointmentOrderFormValues = (): AppointmentOrderFormValues => {
  const now = new Date()
  return {
    customerId: "",
    appointmentDate: now.toISOString().slice(0, 10),
    appointmentStartTime: toTimeInput(now),
    couponInput: "",
    coupons: [],
    status: "DRAFT",
    customerNote: "",
    internalNote: "",
    lines: [createEmptyOrderLine()],
    productLines: [],
  }
}

export const addCouponCode = (
  coupons: AppointmentOrderCouponForm[],
  rawCode: string
) => {
  const code = rawCode.trim().toUpperCase()
  if (!code) return coupons
  const exists = coupons.some((coupon) => coupon.code === code)
  if (exists) return coupons
  return [...coupons, { code }]
}

export const formatCurrencyCents = (value: number) => (value / 100).toFixed(2)

// Use one payload for preview and saving, including only persisted line IDs.
export function orderFormInput(values: AppointmentOrderFormValues, appointmentStartAt: string, saved: AppointmentOrderRow | null) {
  return { customerId: values.customerId, appointmentDate: values.appointmentDate, appointmentStartTime: values.appointmentStartTime,
    status: values.status, customerNote: values.customerNote, internalNote: values.internalNote, appointmentStartAt, coupons: values.coupons.map(coupon => coupon.code),
    lines: values.lines.map(line => ({ ...line, id: saved?.lines.some(item => item.id === line.id) ? line.id : undefined })),
    productLines: (values.productLines ?? []).map(line => ({ ...line, id: saved?.productLines?.some(item => item.id === line.id) ? line.id : undefined })),
  }
}
