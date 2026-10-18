export type AppointmentStatus =
  | "SCHEDULED"
  | "CONFIRMED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELED"
  | "NO_SHOW"

export type AppointmentResolveAction = "cancel" | "reassign" | "reschedule"
export type DiscountType = "NONE" | "PERCENT" | "AMOUNT"
export type TaxMode = "EXCLUSIVE" | "INCLUSIVE"
export type CouponAppliesTo = "ORDER" | "SERVICE_LINES" | "PRODUCT_LINES"
export type CouponStackingMode = "STACKABLE" | "EXCLUSIVE"

export type AppointmentCustomerOption = {
  id: string
  name: string | null
  email: string
}

export type AppointmentStaffOption = {
  id: string
  name: string | null
  email: string
}

export type AppointmentServiceOption = {
  id: string
  name: string
  categoryId?: string
  durationMinutes: number
  priceCents?: number
  taxIds?: string[]
  taxMode?: TaxMode
}

export type AppointmentProductOption = {
  id: string
  sku: string
  name: string
  categoryId?: string
  mrpCents: number
  taxIds?: string[]
}

export type AppointmentCore = {
  id: string
  staffProfileId: string
  customerId: string
  serviceId: string
  startAt: string
  endAt: string
  status: AppointmentStatus
  createdAt: string
  updatedAt: string
}

export type AppointmentRow = AppointmentCore & {
  customer?: {
    id: string
    name: string | null
    email: string
  } | null
  service?: {
    id: string
    name: string
    durationMinutes: number
    priceCents?: number
  } | null
  staffProfile?: {
    id: string
    user?: {
      id: string
      name: string | null
      email: string
    } | null
  } | null
  orderLine?: {
    id: string
    order?: {
      id: string
      status: AppointmentOrderStatus
    } | null
  } | null
}

export type AppointmentFormValues = {
  customerId: string
  serviceId: string
  staffId: string
  date: string
  startTime: string
  status: AppointmentStatus
}

export type CreateAppointmentInput = {
  customerId: string
  serviceId: string
  staffId: string
  startAt: string
}

export type UpdateAppointmentInput = Partial<CreateAppointmentInput> & {
  status?: AppointmentStatus
}

export type AppointmentConflict = {
  id: string
  startAt: string
  endAt: string
  customerName?: string | null
  customerEmail?: string | null
  serviceName?: string | null
}

export type ResolveAppointmentsInput = {
  appointmentIds: string[]
  action: AppointmentResolveAction
  targetStaffId?: string
  rescheduleDate?: string
  rescheduleTime?: string
}

export type ResolveAppointmentsResult = {
  updatedCount: number
}

export type AppointmentAvailabilityResult = {
  available: boolean
  reason?: string
}

export type AppointmentOrderLineForm = {
  id: string
  serviceId: string
  staffId: string
  quantity: number
  durationMinutes: number
  unitPriceCents: number
  discountType: DiscountType
  discountValue: number
  taxIds: string[]
  taxMode: TaxMode
  lineTaxCents?: number
  note: string
}

export type AppointmentOrderProductLineForm = {
  id: string
  productId: string
  quantity: number
  unitPriceCents: number
  discountType: DiscountType
  discountValue: number
  taxIds: string[]
  taxMode: TaxMode
  lineTaxCents?: number
  note: string
}

export type AppointmentOrderCouponForm = {
  code: string
}

export type AppointmentOrderTotals = {
  subtotalCents: number
  lineDiscountCents: number
  couponDiscountCents: number
  taxCents: number
  totalCents: number
}

export type AppointmentOrderFormValues = {
  customerId: string
  appointmentDate: string
  appointmentStartTime: string
  couponInput: string
  coupons: AppointmentOrderCouponForm[]
  customerNote: string
  internalNote: string
  status?: "DRAFT" | "CONFIRMED" | "COMPLETED" | "CANCELED"
  lines: AppointmentOrderLineForm[]
  productLines?: AppointmentOrderProductLineForm[]
}

export type AppointmentOrderStatus = "DRAFT" | "CONFIRMED" | "COMPLETED" | "CANCELED"

export type AppointmentOrderCouponHint = { code: string; eligible: boolean; reason?: string; discountCents?: number }
export type AppointmentOrderPricingPreview = {
  source: "saved" | "current"
  totals: AppointmentOrderTotals
  lines: { taxCents: number; totalCents: number }[]
  productLines: { taxCents: number; totalCents: number }[]
  couponHints: AppointmentOrderCouponHint[]
}

export type CouponRow = {
  id: string
  code: string
  name: string | null
  discountType: DiscountType
  discountValue: number
  appliesTo: CouponAppliesTo
  allowedServiceIds: string[]
  allowedCategoryIds: string[]
  allowedProductIds: string[]
  minSubtotalCents: number
  stackingMode: CouponStackingMode
  isActive: boolean
  validFrom: string | null
  validTo: string | null
  maxUses: number | null
  maxUsesPerCustomer: number | null
  usedCount: number
  createdAt: string
  updatedAt: string
}

export type AppointmentOrderLineRow = {
  id: string
  sortOrder: number
  serviceId: string
  staffProfileId: string
  quantity: number
  durationMinutes: number
  unitPriceCents: number
  discountType: DiscountType
  discountValue: number
  lineSubtotalCents: number
  lineDiscountCents: number
  lineTaxCents: number
  lineTotalCents: number
  taxIds: string[]
  taxMode: TaxMode
  startAt: string
  endAt: string
  note: string | null
  service?: {
    id: string
    name: string
    durationMinutes: number
    priceCents: number
  } | null
  staffProfile?: {
    id: string
    user?: {
      id: string
      name: string | null
      email: string
    } | null
  } | null
}

export type AppointmentOrderProductLineRow = {
  id: string
  sortOrder: number
  productId: string
  quantity: number
  unitPriceCents: number
  discountType: DiscountType
  discountValue: number
  lineSubtotalCents: number
  lineDiscountCents: number
  lineTaxCents: number
  lineTotalCents: number
  taxIds: string[]
  taxMode: TaxMode
  note: string | null
  product?: {
    id: string
    sku: string
    name: string
  } | null
}

export type AppointmentOrderCouponRow = {
  id: string
  code: string
  discountType: DiscountType
  discountValue: number
  discountCents: number
}

export type AppointmentOrderTaxRow = {
  id: string
  taxId: string | null
  name: string
  percent: number
  taxCents: number
}

export type AppointmentOrderRow = {
  id: string
  customerId: string
  appointmentDate: string
  appointmentStartAt: string
  status: AppointmentOrderStatus
  customerNote: string | null
  internalNote: string | null
  subtotalCents: number
  lineDiscountCents: number
  couponDiscountCents: number
  taxCents: number
  totalCents: number
  createdAt: string
  updatedAt: string
  customer?: {
    id: string
    name: string | null
    email: string
  } | null
  lines: AppointmentOrderLineRow[]
  productLines?: AppointmentOrderProductLineRow[]
  coupons: AppointmentOrderCouponRow[]
  taxes: AppointmentOrderTaxRow[]
}
