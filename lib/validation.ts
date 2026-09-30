import { z } from "zod"
import { tenantModuleSelection } from "@/platform/module-validation"
// Module-owned schemas are re-exported here for the existing validation convention.
export * from "@/modules/crm/validation"
import { INVENTORY_UNIT_OPTIONS } from "@/lib/constants/inventory"
import { getStateOptionsByCountry } from "@/lib/constants/countries"

export const roleSchema = z.enum(["ADMIN", "MANAGER", "STAFF", "CUSTOMER"])
export const organizationMembershipRoleSchema = z.enum(["OWNER", "ADMIN", "VIEWER"])
export const genderSchema = z.enum([
  "MALE",
  "FEMALE",
  "NON_BINARY",
  "OTHER",
  "PREFER_NOT_TO_SAY",
])
export const statusSchema = z.enum(["ACTIVE", "SUSPENDED", "INVITED", "ARCHIVED"])
export const serviceCategoryStatusSchema = z.enum(["ACTIVE", "INACTIVE"])
export const serviceStatusSchema = z.enum(["ACTIVE", "INACTIVE"])
export const serviceTypeSchema = z.enum(["STANDARD", "PACKAGE"])
export const taxModeSchema = z.enum(["EXCLUSIVE", "INCLUSIVE"])
export const inventoryCategoryStatusSchema = z.enum(["ACTIVE", "INACTIVE"])
export const supplierStatusSchema = z.enum(["ACTIVE", "INACTIVE"])
export const leaveDefinitionTypeSchema = z.enum([
  "PAID",
  "LAY_OFF",
  "UNPAID",
  "RESTRICTED",
  "COMPENSATORY",
  "TOUR_ON_DUTY",
])
export const leaveDefinitionAllowedUsersSchema = z.enum(["MALE", "FEMALE", "ALL"])
export const leaveDefinitionStatusSchema = z.enum(["ACTIVE", "INACTIVE"])
export const leaveGroupAssignmentModeSchema = z.enum(["ALL_STAFF", "SELECTED_STAFF"])
export const leaveGroupStatusSchema = z.enum(["ACTIVE", "INACTIVE"])
export const taxRegistrationTypeSchema = z.enum([
  "VAT",
  "GST",
  "SALES_TAX_ID",
  "EIN",
  "OTHER",
])
export const inventoryProductStatusSchema = z.enum(["ACTIVE", "INACTIVE"])
export const purchaseOrderStatusSchema = z.enum([
  "DRAFT",
  "ORDERED",
  "RECEIVED",
  "CANCELED",
])
export const appointmentStatusSchema = z.enum([
  "SCHEDULED",
  "CONFIRMED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELED",
  "NO_SHOW",
])
export const staffDocumentTypeSchema = z.enum(["ADDRESS", "ID", "OTHER"])
export const weekdaySchema = z.enum([
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
])
export const appSettingPeriodTypeSchema = z.enum(["WORK", "BREAK"])
export const currencySymbolPlacementSchema = z.enum(["BEFORE", "AFTER"])
export const timeFormatSchema = z.enum(["H12", "H24"])
export const numberFormatStyleSchema = z.enum([
  "US_UK",
  "EUROPEAN",
  "ISO_DECIMAL_POINT",
  "ISO_DECIMAL_COMMA",
  "COMPACT_DECIMAL_POINT",
  "COMPACT_DECIMAL_COMMA",
])
export const couponAppliesToSchema = z.enum([
  "ORDER",
  "SERVICE_LINES",
  "PRODUCT_LINES",
])
export const couponStackingModeSchema = z.enum(["STACKABLE", "EXCLUSIVE"])

const optionalDate = z
  .preprocess((value) => {
    if (!value) return undefined
    if (value instanceof Date) return value
    const date = new Date(String(value))
    return Number.isNaN(date.getTime()) ? undefined : date
  }, z.date().optional())

const optionalString = z.string().trim().optional().or(z.literal(""))

const addCountryStateValidation = <T extends z.ZodRawShape>(schema: z.ZodObject<T>) =>
  schema.superRefine((values, ctx) => {
    const data = values as Record<string, unknown>
    const country = String(data.country ?? "").trim()
    const state = String(data.state ?? "").trim()
    const stateOptions = getStateOptionsByCountry(country)
    if (stateOptions && state && !stateOptions.includes(state)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select a valid state/province for the selected country.",
        path: ["state"],
      })
    }
  })

export const signUpSchema = addCountryStateValidation(z.object({
  name: z.string().trim().min(1).max(100).optional().or(z.literal("")),
  email: z.string().trim().email(),
  password: z.string().trim().min(6).max(100),
  phone: z.string().trim().min(7).max(20).optional().or(z.literal("")),
  image: z.string().trim().url().optional().or(z.literal("")),
  dateOfBirth: optionalDate,
  gender: genderSchema.optional(),
  marketingOptIn: z.boolean().optional(),
  addressLine1: optionalString,
  addressLine2: optionalString,
  city: optionalString,
  state: optionalString,
  postalCode: optionalString,
  country: optionalString,
}))

export const createUserSchema = addCountryStateValidation(z.object({
  accessRoleId: z.string().trim().max(100).optional(),
  name: z.string().trim().min(1).max(100).optional().or(z.literal("")),
  email: z.string().trim().email(),
  role: roleSchema.optional(),
  password: z.string().trim().min(6).max(100),
  eligibleServiceIds: z.array(z.string().trim().min(1)).optional(),
  phone: z.string().trim().min(7).max(20).optional().or(z.literal("")),
  image: z.string().trim().url().optional().or(z.literal("")),
  dateOfBirth: optionalDate,
  gender: genderSchema.optional(),
  status: statusSchema.optional(),
  marketingOptIn: z.boolean().optional(),
  addressLine1: optionalString,
  addressLine2: optionalString,
  city: optionalString,
  state: optionalString,
  postalCode: optionalString,
  country: optionalString,
}))

export const updateUserSchema = addCountryStateValidation(z.object({
  name: z.string().trim().min(1).max(100).optional().or(z.literal("")),
  email: z.string().trim().email().optional().or(z.literal("")),
  role: roleSchema.optional(),
  password: z.string().trim().min(6).max(100).optional().or(z.literal("")),
  eligibleServiceIds: z.array(z.string().trim().min(1)).optional(),
  phone: z.string().trim().min(7).max(20).optional().or(z.literal("")),
  image: z.string().trim().url().optional().or(z.literal("")),
  dateOfBirth: optionalDate,
  gender: genderSchema.optional(),
  status: statusSchema.optional(),
  marketingOptIn: z.boolean().optional(),
  addressLine1: optionalString,
  addressLine2: optionalString,
  city: optionalString,
  state: optionalString,
  postalCode: optionalString,
  country: optionalString,
  staffProfile: z
    .object({
      documents: z
        .array(
          z.object({
            id: z.string().optional(),
            type: staffDocumentTypeSchema,
            number: z.string().trim().max(60).optional().or(z.literal("")),
            imageUrl: z.string().trim().url(),
            validFrom: z.string().optional().or(z.literal("")),
            validTo: z.string().optional().or(z.literal("")),
          })
        )
        .optional(),
      certifications: z
        .array(
          z.object({
            id: z.string().optional(),
            title: z.string().trim().min(1).max(120),
            issuer: z.string().trim().max(120).optional().or(z.literal("")),
            issuedAt: z.string().optional().or(z.literal("")),
            expiresAt: z.string().optional().or(z.literal("")),
          })
        )
        .optional(),
      managerUserId: z.string().trim().min(1).optional().or(z.literal("")),
      schedulingMode: z.enum(["STANDARD", "FLEXIBLE"]).optional(),
    })
    .optional(),
}))

export const inviteUserSchema = z.object({
  email: z.string().trim().email(),
  role: roleSchema.optional(),
})

export const acceptInviteSchema = z.object({
  token: z.string().trim().min(10),
  name: z.string().trim().min(1).max(100).optional().or(z.literal("")),
  password: z.string().trim().min(6).max(100),
})

export const forgotPasswordSchema = z.object({
  email: z.string().trim().email(),
})

export const resetPasswordSchema = z.object({
  token: z.string().trim().min(20),
  password: z.string().trim().min(6).max(100),
})

export const createServiceCategorySchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(500).optional().or(z.literal("")),
  status: serviceCategoryStatusSchema.optional(),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
})

export const updateServiceCategorySchema = createServiceCategorySchema.partial()

export type CreateServiceCategoryInput = z.infer<
  typeof createServiceCategorySchema
>
export type UpdateServiceCategoryInput = z.infer<
  typeof updateServiceCategorySchema
>

export const createServiceSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).optional().or(z.literal("")),
  categoryId: z.string().trim().min(1),
  durationMinutes: z.coerce.number().int().min(5).max(600),
  priceCents: z.coerce.number().int().min(0).max(1000000),
  status: serviceStatusSchema.optional(),
  type: serviceTypeSchema.optional(),
  packageItemIds: z.array(z.string().trim().min(1)).optional(),
  taxIds: z.array(z.string().trim().min(1)).optional().default([]),
  taxMode: taxModeSchema.default("EXCLUSIVE"),
})

export const updateServiceSchema = createServiceSchema.partial()

export type CreateServiceInput = z.infer<typeof createServiceSchema>
export type UpdateServiceInput = z.infer<typeof updateServiceSchema>

const toMinutes = (value: string) => {
  const [hours, minutes] = value.split(":").map(Number)
  return hours * 60 + minutes
}

const hasOverlaps = (periods: { startTime: string; endTime: string }[]) => {
  const sorted = [...periods].sort(
    (a, b) => toMinutes(a.startTime) - toMinutes(b.startTime)
  )
  for (let i = 0; i < sorted.length - 1; i += 1) {
    if (toMinutes(sorted[i].endTime) > toMinutes(sorted[i + 1].startTime)) {
      return true
    }
  }
  return false
}

export const appSettingsSchema = z
  .object({
  locale: z.string().trim().min(2).max(20),
  currency: z.string().trim().min(3).max(3),
  timeZone: z.string().trim().min(2).max(64),
  dateFormat: z.string().trim().min(4).max(20),
  timeFormat: timeFormatSchema.default("H24"),
  firstDayOfWeek: weekdaySchema.default("SUNDAY"),
  emailNotificationsEnabled: z.boolean().default(false),
  currencySymbolPlacement: currencySymbolPlacementSchema.default("BEFORE"),
  numberFormat: numberFormatStyleSchema.default("US_UK"),
  workingHours: z
    .array(
      z.object({
        id: z.string().optional(),
        day: weekdaySchema,
        isOpen: z.boolean(),
        periods: z.array(
          z.object({
            id: z.string().optional(),
            kind: appSettingPeriodTypeSchema,
            startTime: z.string().regex(/^\d{2}:\d{2}$/),
            endTime: z.string().regex(/^\d{2}:\d{2}$/),
            sortOrder: z.coerce.number().int().min(0).optional(),
          })
        ),
      })
    )
    .optional(),
  overrides: z
    .array(
      z.object({
        id: z.string().optional(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        isOpen: z.boolean(),
        periods: z.array(
          z.object({
            id: z.string().optional(),
            kind: appSettingPeriodTypeSchema,
            startTime: z.string().regex(/^\d{2}:\d{2}$/),
            endTime: z.string().regex(/^\d{2}:\d{2}$/),
            sortOrder: z.coerce.number().int().min(0).optional(),
          })
        ),
      })
    )
    .optional(),
})
  .superRefine((values, ctx) => {
    if (values.workingHours) {
      values.workingHours.forEach((day, dayIndex) => {
        if (!day.isOpen) return
        if (day.periods.length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Add at least one period for open days.",
            path: ["workingHours", dayIndex, "periods"],
          })
          return
        }
        day.periods.forEach((period, periodIndex) => {
          if (toMinutes(period.startTime) >= toMinutes(period.endTime)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Start time must be before end time.",
              path: ["workingHours", dayIndex, "periods", periodIndex, "startTime"],
            })
          }
        })
        if (hasOverlaps(day.periods)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Periods cannot overlap.",
            path: ["workingHours", dayIndex, "periods"],
          })
        }
      })
    }

    if (values.overrides) {
      values.overrides.forEach((override, overrideIndex) => {
        if (!override.isOpen) return
        if (override.periods.length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Add at least one period for open days.",
            path: ["overrides", overrideIndex, "periods"],
          })
          return
        }
        override.periods.forEach((period, periodIndex) => {
          if (toMinutes(period.startTime) >= toMinutes(period.endTime)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Start time must be before end time.",
              path: ["overrides", overrideIndex, "periods", periodIndex, "startTime"],
            })
          }
        })
        if (hasOverlaps(override.periods)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Periods cannot overlap.",
            path: ["overrides", overrideIndex, "periods"],
          })
        }
      })
    }
  })

export type AppSettingsInput = z.infer<typeof appSettingsSchema>

export const taxCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  percent: z.coerce.number().min(0).max(100),
  isActive: z.boolean().optional().default(true),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
})

export const taxUpdateSchema = taxCreateSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: "At least one field is required." }
)

export type TaxCreateInput = z.infer<typeof taxCreateSchema>
export type TaxUpdateInput = z.infer<typeof taxUpdateSchema>

export const createInventoryCategorySchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional().or(z.literal("")),
  status: inventoryCategoryStatusSchema.optional(),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
})

export const updateInventoryCategorySchema = createInventoryCategorySchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required.",
  })

export type CreateInventoryCategoryInput = z.infer<
  typeof createInventoryCategorySchema
>
export type UpdateInventoryCategoryInput = z.infer<
  typeof updateInventoryCategorySchema
>

const supplierSchemaBase = z.object({
  name: z.string().trim().min(2).max(140),
  contactPerson: z.string().trim().max(120).optional().or(z.literal("")),
  email: z.string().trim().email().optional().or(z.literal("")),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
  isTaxRegistered: z.boolean().optional().default(false),
  taxRegistrationType: taxRegistrationTypeSchema.optional(),
  taxRegistrationNumber: z.string().trim().max(60).optional().or(z.literal("")),
  leadTimeDays: z.coerce.number().int().min(0).max(365).optional(),
  addressLine1: z.string().trim().max(200).optional().or(z.literal("")),
  addressLine2: z.string().trim().max(200).optional().or(z.literal("")),
  city: z.string().trim().max(100).optional().or(z.literal("")),
  state: z.string().trim().max(100).optional().or(z.literal("")),
  postalCode: z.string().trim().max(20).optional().or(z.literal("")),
  country: z.string().trim().max(100).optional().or(z.literal("")),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
  status: supplierStatusSchema.optional(),
})

const validateSupplierTaxRegistration = (
  values: {
    isTaxRegistered?: boolean
    taxRegistrationType?: unknown
    taxRegistrationNumber?: string
  },
  ctx: z.RefinementCtx
) => {
  const hasNumber = Boolean(values.taxRegistrationNumber && values.taxRegistrationNumber.trim())
  if (values.isTaxRegistered) {
    if (!values.taxRegistrationType) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Tax registration type is required when tax registered.",
        path: ["taxRegistrationType"],
      })
    }
    if (!hasNumber) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Tax registration number is required when tax registered.",
        path: ["taxRegistrationNumber"],
      })
    }
  }
}

export const createSupplierSchema = addCountryStateValidation(supplierSchemaBase)
  .superRefine(validateSupplierTaxRegistration)

export const updateSupplierSchema = addCountryStateValidation(supplierSchemaBase.partial())
  .superRefine(validateSupplierTaxRegistration)
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required.",
  })

export type CreateSupplierInput = z.infer<typeof createSupplierSchema>
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>

const supplierLinkSchema = z.object({
  supplierId: z.string().trim().min(1),
  supplierSku: z.string().trim().max(120).optional().or(z.literal("")),
  supplierCostCents: z.coerce.number().int().min(0).max(100000000).optional(),
  minOrderQty: z.coerce.number().int().min(1).max(1000000).optional(),
  leadTimeDays: z.coerce.number().int().min(0).max(365).optional(),
  isPreferred: z.boolean().optional(),
})

export const createInventoryProductSchema = z.object({
  sku: z.string().trim().min(2).max(80),
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(1000).optional().or(z.literal("")),
  unit: z.enum(INVENTORY_UNIT_OPTIONS).optional().default("unit"),
  categoryId: z.string().trim().min(1),
  status: inventoryProductStatusSchema.optional(),
  costPriceCents: z.coerce.number().int().min(0).max(100000000),
  mrpCents: z.coerce.number().int().min(0).max(100000000),
  reorderPoint: z.coerce.number().int().min(0).max(1000000).optional(),
  reorderQty: z.coerce.number().int().min(0).max(1000000).optional(),
  onHandQty: z.coerce.number().int().min(0).max(1000000).optional(),
  isPhysical: z.boolean().optional(),
  taxIds: z.array(z.string().trim().min(1)).optional().default([]),
  supplierLinks: z.array(supplierLinkSchema).optional().default([]),
})

export const updateInventoryProductSchema = createInventoryProductSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required.",
  })

export type CreateInventoryProductInput = z.infer<
  typeof createInventoryProductSchema
>
export type UpdateInventoryProductInput = z.infer<
  typeof updateInventoryProductSchema
>

export const purchaseOrderItemInputSchema = z.object({
  productId: z.string().trim().min(1),
  quantity: z.coerce.number().int().min(1).max(1000000),
  unitCostCents: z.coerce.number().int().min(0).max(100000000),
})

export const createPurchaseOrderSchema = z.object({
  supplierId: z.string().trim().min(1),
  orderDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  expectedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  status: purchaseOrderStatusSchema.optional(),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
  items: z.array(purchaseOrderItemInputSchema).min(1),
})

export const updatePurchaseOrderSchema = z
  .object({
    status: purchaseOrderStatusSchema.optional(),
    expectedDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .or(z.literal("")),
    notes: z.string().trim().max(1000).optional().or(z.literal("")),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required.",
  })

export type CreatePurchaseOrderInput = z.infer<typeof createPurchaseOrderSchema>
export type UpdatePurchaseOrderInput = z.infer<typeof updatePurchaseOrderSchema>

export const shiftTemplateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(240).optional().or(z.literal("")),
    color: z.string().trim().max(40).optional().or(z.literal("")),
    isActive: z.boolean().optional(),
    startTime: z.string().regex(/^\d{2}:\d{2}$/),
    endTime: z.string().regex(/^\d{2}:\d{2}$/),
    breaks: z.array(
      z.object({
        id: z.string().optional(),
        startTime: z.string().regex(/^\d{2}:\d{2}$/),
        endTime: z.string().regex(/^\d{2}:\d{2}$/),
        sortOrder: z.coerce.number().int().min(0).optional(),
      })
    ),
  })
  .superRefine((values, ctx) => {
    if (toMinutes(values.startTime) >= toMinutes(values.endTime)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Shift start time must be before end time.",
        path: ["startTime"],
      })
    }
    const shiftStart = toMinutes(values.startTime)
    const shiftEnd = toMinutes(values.endTime)
    values.breaks.forEach((period, index) => {
      const breakStart = toMinutes(period.startTime)
      const breakEnd = toMinutes(period.endTime)
      if (breakStart >= breakEnd) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Break start time must be before end time.",
          path: ["breaks", index, "startTime"],
        })
        return
      }
      if (breakStart < shiftStart || breakEnd > shiftEnd) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Breaks must be within the shift range.",
          path: ["breaks", index, "startTime"],
        })
      }
    })
    if (hasOverlaps(values.breaks)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Breaks cannot overlap.",
        path: ["breaks"],
      })
    }
  })

export type ShiftTemplateInput = z.infer<typeof shiftTemplateSchema>

export const shiftScheduleSchema = z
  .object({
    name: z.string().trim().max(120).optional().or(z.literal("")),
    staffIds: z.array(z.string().trim().min(1)),
    isDefault: z.boolean().optional(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    assignmentStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
    assignmentEndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
    weekOffDay1: weekdaySchema,
    weekOffDay2: weekdaySchema.optional().or(z.literal("")),
    weekOff2Weeks: z
      .array(z.coerce.number().int().min(1).max(5))
      .optional()
      .default([]),
    blocks: z.array(
      z.object({
        id: z.string().optional(),
        templateId: z.string().trim().min(1),
        repeatDays: z.coerce.number().int().min(1).max(366),
        sortOrder: z.coerce.number().int().min(0).optional(),
      })
    ),
  })
  .superRefine((values, ctx) => {
    const today = new Date().toISOString().slice(0, 10)
    if (values.startDate < today) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Schedule start date cannot be in the past.",
        path: ["startDate"],
      })
    }
    if (!values.isDefault && values.staffIds.length && !values.assignmentStartDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Assignment start date is required when assigning staff.",
        path: ["assignmentStartDate"],
      })
    }
    if (values.assignmentStartDate && values.assignmentStartDate < today) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Assignment start date cannot be in the past.",
        path: ["assignmentStartDate"],
      })
    }
    if (!values.isDefault && !values.staffIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select at least one staff member or mark as default.",
        path: ["staffIds"],
      })
    }
    if (values.isDefault && values.staffIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Default schedule should not target staff members.",
        path: ["staffIds"],
      })
    }
    if (values.assignmentStartDate && values.assignmentEndDate) {
      if (values.assignmentStartDate > values.assignmentEndDate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Assignment start date must be before end date.",
          path: ["assignmentStartDate"],
        })
      }
    }
    if (!values.blocks.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Add at least one shift block.",
        path: ["blocks"],
      })
    }
    if (values.weekOffDay2) {
      if (!values.weekOff2Weeks.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Select weeks for the second week off day.",
          path: ["weekOff2Weeks"],
        })
      }
      if (values.weekOffDay2 === values.weekOffDay1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Week off day 2 must be different from week off day 1.",
          path: ["weekOffDay2"],
        })
      }
    } else if (values.weekOff2Weeks.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Week off day 2 is required when selecting week off 2 weeks.",
        path: ["weekOffDay2"],
      })
    }
  })

export type ShiftScheduleInput = z.infer<typeof shiftScheduleSchema>

export const shiftOverrideSchema = z
  .object({
    staffId: z.string().trim().min(1),
    templateId: z.string().trim().min(1).optional().or(z.literal("")),
    isUnavailable: z.boolean().optional().default(false),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    skipWeekOff: z.boolean().optional().default(true),
    skipHolidays: z.boolean().optional().default(true),
  })
  .superRefine((values, ctx) => {
    if (!values.isUnavailable && !values.templateId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select a shift template or mark as unavailable.",
        path: ["templateId"],
      })
    }
  })

export type ShiftOverrideInput = z.infer<typeof shiftOverrideSchema>

export const flexibleSlotSchema = z
  .object({
    staffId: z.string().trim().min(1),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    slots: z
      .array(
        z.object({
          startTime: z.string().regex(/^\d{2}:\d{2}$/),
          endTime: z.string().regex(/^\d{2}:\d{2}$/),
          sortOrder: z.coerce.number().int().min(0).optional(),
        })
      )
      .min(1),
  })
  .superRefine((values, ctx) => {
    const withMinutes = values.slots
      .map((slot, index) => ({
        index,
        start: toMinutes(slot.startTime),
        end: toMinutes(slot.endTime),
      }))
      .sort((a, b) => a.start - b.start)

    withMinutes.forEach((slot) => {
      if (slot.start >= slot.end) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Slot start time must be before end time.",
          path: ["slots", slot.index, "startTime"],
        })
      }
    })

    for (let index = 0; index < withMinutes.length - 1; index += 1) {
      if (withMinutes[index].end > withMinutes[index + 1].start) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Slots cannot overlap.",
          path: ["slots"],
        })
        break
      }
    }
  })

export type FlexibleSlotInput = z.infer<typeof flexibleSlotSchema>

const flexibleWeekPlanBreakSchema = z.object({
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  sortOrder: z.coerce.number().int().min(0).optional(),
})

const flexibleWeekPlanSlotSchema = z.object({
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  sortOrder: z.coerce.number().int().min(0).optional(),
  breaks: z.array(flexibleWeekPlanBreakSchema).optional().default([]),
})

const flexibleWeekPlanDaySchema = z.object({
  day: weekdaySchema,
  isOff: z.boolean().optional().default(false),
  sortOrder: z.coerce.number().int().min(0).optional(),
  slots: z.array(flexibleWeekPlanSlotSchema).optional().default([]),
})

export const flexibleWeekPlanSchema = z
  .object({
    staffId: z.string().trim().min(1),
    weekStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    days: z.array(flexibleWeekPlanDaySchema).length(7),
  })
  .superRefine((values, ctx) => {
    const daySet = new Set(values.days.map((day) => day.day))
    if (daySet.size !== 7) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide all seven weekdays exactly once.",
        path: ["days"],
      })
      return
    }

    values.days.forEach((day, dayIndex) => {
      if (day.isOff) {
        if (day.slots.length > 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Off day cannot contain slots.",
            path: ["days", dayIndex, "slots"],
          })
        }
        return
      }

      const slotRanges = day.slots
        .map((slot, slotIndex) => ({
          slot,
          slotIndex,
          start: toMinutes(slot.startTime),
          end: toMinutes(slot.endTime),
        }))
        .sort((a, b) => a.start - b.start)

      slotRanges.forEach(({ start, end, slotIndex }) => {
        if (start >= end) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Slot start time must be before end time.",
            path: ["days", dayIndex, "slots", slotIndex, "startTime"],
          })
        }
      })

      for (let slotIndex = 0; slotIndex < slotRanges.length - 1; slotIndex += 1) {
        if (slotRanges[slotIndex].end > slotRanges[slotIndex + 1].start) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Slots cannot overlap within a day.",
            path: ["days", dayIndex, "slots"],
          })
          break
        }
      }

      slotRanges.forEach(({ slot, slotIndex, start, end }) => {
        const breakRanges = slot.breaks
          .map((breakItem, breakIndex) => ({
            breakItem,
            breakIndex,
            start: toMinutes(breakItem.startTime),
            end: toMinutes(breakItem.endTime),
          }))
          .sort((a, b) => a.start - b.start)

        breakRanges.forEach(({ breakIndex, start: breakStart, end: breakEnd }) => {
          if (breakStart >= breakEnd) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Break start time must be before end time.",
              path: ["days", dayIndex, "slots", slotIndex, "breaks", breakIndex, "startTime"],
            })
          }
          if (breakStart < start || breakEnd > end) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Break must be within slot time range.",
              path: ["days", dayIndex, "slots", slotIndex, "breaks", breakIndex],
            })
          }
        })

        for (let breakIndex = 0; breakIndex < breakRanges.length - 1; breakIndex += 1) {
          if (breakRanges[breakIndex].end > breakRanges[breakIndex + 1].start) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Breaks cannot overlap within a slot.",
              path: ["days", dayIndex, "slots", slotIndex, "breaks"],
            })
            break
          }
        }
      })
    })
  })

export type FlexibleWeekPlanInput = z.infer<typeof flexibleWeekPlanSchema>

const flexiblePatternBreakSchema = z.object({
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  sortOrder: z.coerce.number().int().min(0).optional(),
})

const flexiblePatternSlotSchema = z.object({
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  sortOrder: z.coerce.number().int().min(0).optional(),
  breaks: z.array(flexiblePatternBreakSchema).optional().default([]),
})

const flexiblePatternDaySchema = z.object({
  day: weekdaySchema,
  isOff: z.boolean().optional().default(false),
  sortOrder: z.coerce.number().int().min(0).optional(),
  slots: z.array(flexiblePatternSlotSchema).optional().default([]),
})

const flexiblePatternWeekSchema = z.object({
  weekIndex: z.coerce.number().int().min(1),
  days: z.array(flexiblePatternDaySchema).length(7),
})

export const flexiblePatternSchema = z
  .object({
    patternId: z.string().trim().min(1).optional(),
    staffId: z.string().trim().min(1),
    name: z.string().trim().max(120).optional().or(z.literal("")),
    cycleLengthWeeks: z.coerce.number().int().min(1).max(12),
    validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    validTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
    isActive: z.boolean().optional().default(true),
    weeks: z.array(flexiblePatternWeekSchema),
  })
  .superRefine((values, ctx) => {
    if (values.validTo && values.validFrom > values.validTo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "validFrom must be on or before validTo.",
        path: ["validFrom"],
      })
    }
    if (values.weeks.length !== values.cycleLengthWeeks) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "weeks length must match cycleLengthWeeks.",
        path: ["weeks"],
      })
    }
    const weekIndexSet = new Set(values.weeks.map((week) => week.weekIndex))
    if (weekIndexSet.size !== values.weeks.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Duplicate weekIndex values are not allowed.",
        path: ["weeks"],
      })
    }
    for (let index = 1; index <= values.cycleLengthWeeks; index += 1) {
      if (!weekIndexSet.has(index)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `weekIndex ${index} is missing.`,
          path: ["weeks"],
        })
      }
    }

    values.weeks.forEach((week, weekArrayIndex) => {
      const daySet = new Set(week.days.map((day) => day.day))
      if (daySet.size !== 7) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Each week must provide all weekdays exactly once.",
          path: ["weeks", weekArrayIndex, "days"],
        })
        return
      }

      week.days.forEach((day, dayIndex) => {
        if (day.isOff) {
          if (day.slots.length > 0) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Off day cannot contain slots.",
              path: ["weeks", weekArrayIndex, "days", dayIndex, "slots"],
            })
          }
          return
        }

        const slotRanges = day.slots
          .map((slot, slotIndex) => ({
            slot,
            slotIndex,
            start: toMinutes(slot.startTime),
            end: toMinutes(slot.endTime),
          }))
          .sort((a, b) => a.start - b.start)

        slotRanges.forEach(({ start, end, slotIndex }) => {
          if (start >= end) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Slot start time must be before end time.",
              path: ["weeks", weekArrayIndex, "days", dayIndex, "slots", slotIndex, "startTime"],
            })
          }
        })

        for (let slotIndex = 0; slotIndex < slotRanges.length - 1; slotIndex += 1) {
          if (slotRanges[slotIndex].end > slotRanges[slotIndex + 1].start) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Slots cannot overlap within a day.",
              path: ["weeks", weekArrayIndex, "days", dayIndex, "slots"],
            })
            break
          }
        }

        slotRanges.forEach(({ slot, slotIndex, start, end }) => {
          const breakRanges = slot.breaks
            .map((breakItem, breakIndex) => ({
              breakIndex,
              start: toMinutes(breakItem.startTime),
              end: toMinutes(breakItem.endTime),
            }))
            .sort((a, b) => a.start - b.start)

          breakRanges.forEach(({ breakIndex, start: breakStart, end: breakEnd }) => {
            if (breakStart >= breakEnd) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Break start time must be before end time.",
                path: ["weeks", weekArrayIndex, "days", dayIndex, "slots", slotIndex, "breaks", breakIndex, "startTime"],
              })
            }
            if (breakStart < start || breakEnd > end) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Break must be within slot time range.",
                path: ["weeks", weekArrayIndex, "days", dayIndex, "slots", slotIndex, "breaks", breakIndex],
              })
            }
          })

          for (let breakIndex = 0; breakIndex < breakRanges.length - 1; breakIndex += 1) {
            if (breakRanges[breakIndex].end > breakRanges[breakIndex + 1].start) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Breaks cannot overlap within a slot.",
                path: ["weeks", weekArrayIndex, "days", dayIndex, "slots", slotIndex, "breaks"],
              })
              break
            }
          }
        })
      })
    })
  })

export type FlexiblePatternInput = z.infer<typeof flexiblePatternSchema>

export const appointmentCreateSchema = z.object({
  customerId: z.string().trim().min(1),
  serviceId: z.string().trim().min(1),
  staffId: z.string().trim().min(1),
  startAt: z.string().datetime({ offset: true }),
  status: appointmentStatusSchema.optional(),
})

export const appointmentUpdateSchema = z
  .object({
    customerId: z.string().trim().min(1).optional(),
    serviceId: z.string().trim().min(1).optional(),
    staffId: z.string().trim().min(1).optional(),
    startAt: z.string().datetime({ offset: true }).optional(),
    status: appointmentStatusSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required.",
  })

export const appointmentOrderLineInputSchema = z.object({
  id: z.string().optional(),
  serviceId: z.string().trim().min(1),
  staffId: z.string().trim().min(1),
  quantity: z.coerce.number().int().min(1).max(20),
  durationMinutes: z.coerce.number().int().min(5).max(600),
  unitPriceCents: z.coerce.number().int().min(0).max(100000000),
  discountType: z.enum(["NONE", "PERCENT", "AMOUNT"]),
  discountValue: z.coerce.number().min(0).max(1000000),
  taxIds: z.array(z.string().trim().min(1)).optional().default([]),
  taxMode: taxModeSchema.default("EXCLUSIVE"),
  note: z.string().trim().max(500).optional().or(z.literal("")),
})

export const appointmentOrderProductLineInputSchema = z.object({
  id: z.string().optional(),
  productId: z.string().trim().min(1),
  quantity: z.coerce.number().int().min(1).max(1000),
  unitPriceCents: z.coerce.number().int().min(0).max(100000000),
  discountType: z.enum(["NONE", "PERCENT", "AMOUNT"]),
  discountValue: z.coerce.number().min(0).max(1000000),
  taxIds: z.array(z.string().trim().min(1)).optional().default([]),
  taxMode: taxModeSchema.default("EXCLUSIVE"),
  note: z.string().trim().max(500).optional().or(z.literal("")),
})

export const appointmentOrderCreateSchema = z.object({
  customerId: z.string().trim().min(1),
  appointmentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  appointmentStartTime: z.string().regex(/^\d{2}:\d{2}$/),
  appointmentStartAt: z.string().datetime({ offset: true }),
  status: z.enum(["DRAFT", "CONFIRMED", "COMPLETED", "CANCELED"]).optional(),
  customerNote: z.string().trim().max(500).optional().or(z.literal("")),
  internalNote: z.string().trim().max(2000).optional().or(z.literal("")),
  coupons: z.array(z.string().trim().min(2).max(40)).optional().default([]),
  lines: z.array(appointmentOrderLineInputSchema).min(1),
  productLines: z.array(appointmentOrderProductLineInputSchema).optional().default([]),
})

export const appointmentOrderUpdateSchema = appointmentOrderCreateSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: "At least one field is required." }
)

export type AppointmentCreateInput = z.infer<typeof appointmentCreateSchema>
export type AppointmentUpdateInput = z.infer<typeof appointmentUpdateSchema>
export type AppointmentOrderCreateInput = z.infer<typeof appointmentOrderCreateSchema>
export type AppointmentOrderUpdateInput = z.infer<typeof appointmentOrderUpdateSchema>

export const couponCreateSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[A-Za-z0-9_-]+$/),
  name: z.string().trim().max(120).optional().or(z.literal("")),
  discountType: z.enum(["NONE", "PERCENT", "AMOUNT"]),
  discountValue: z.coerce.number().min(0).max(1000000),
  isActive: z.boolean().optional().default(true),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  validTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  maxUses: z.coerce.number().int().min(1).max(1000000).optional(),
  maxUsesPerCustomer: z.coerce.number().int().min(1).max(1000000).optional(),
  appliesTo: couponAppliesToSchema.optional().default("ORDER"),
  allowedServiceIds: z.array(z.string().trim().min(1)).optional().default([]),
  allowedCategoryIds: z.array(z.string().trim().min(1)).optional().default([]),
  allowedProductIds: z.array(z.string().trim().min(1)).optional().default([]),
  minSubtotalCents: z.coerce.number().int().min(0).max(100000000).optional().default(0),
  stackingMode: couponStackingModeSchema.optional().default("STACKABLE"),
})

export const couponUpdateSchema = couponCreateSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: "At least one field is required." }
)

export type CouponCreateInput = z.infer<typeof couponCreateSchema>
export type CouponUpdateInput = z.infer<typeof couponUpdateSchema>

export const appointmentResolveSchema = z
  .object({
    appointmentIds: z.array(z.string().trim().min(1)).min(1),
    action: z.enum(["cancel", "reassign", "reschedule"]),
    targetStaffId: z.string().trim().min(1).optional(),
    rescheduleDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    rescheduleTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  })
  .superRefine((values, ctx) => {
    if (values.action === "reassign" && !values.targetStaffId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Target staff is required.",
        path: ["targetStaffId"],
      })
    }
    if (values.action === "reschedule") {
      if (!values.rescheduleDate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Reschedule date is required.",
          path: ["rescheduleDate"],
        })
      }
      if (!values.rescheduleTime) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Reschedule time is required.",
          path: ["rescheduleTime"],
        })
      }
    }
  })

export type AppointmentResolveInput = z.infer<typeof appointmentResolveSchema>

const leaveDefinitionBaseSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .regex(/^[A-Za-z0-9_-]+$/),
  name: z.string().trim().min(2).max(120),
  leaveType: leaveDefinitionTypeSchema,
  allowedUsers: leaveDefinitionAllowedUsersSchema.default("ALL"),
  minDaysPerRequest: z.coerce.number().int().min(0).max(365),
  maxDaysPerRequest: z.coerce.number().int().min(1).max(365),
  allowWithOtherLeaves: z.boolean().default(true),
  priorEntryAllowed: z.boolean().default(false),
  noticeDays: z.coerce.number().int().min(0).max(365).default(0),
  allowCarryForward: z.boolean().default(false),
  weekOffSingleSideAllowed: z.boolean().default(true),
  weekOffBothSideAllowed: z.boolean().default(true),
  holidaySingleSideAllowed: z.boolean().default(true),
  holidayBothSideAllowed: z.boolean().default(true),
  maxPendingRequests: z.coerce.number().int().min(1).max(50),
  status: leaveDefinitionStatusSchema.default("ACTIVE"),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
  nonClubbableWithIds: z.array(z.string().trim().min(1)).optional().default([]),
})

export const createLeaveDefinitionSchema = leaveDefinitionBaseSchema.superRefine(
  (value, ctx) => {
    if (value.minDaysPerRequest > value.maxDaysPerRequest) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Minimum days must be less than or equal to maximum days.",
        path: ["minDaysPerRequest"],
      })
    }
    if (
      value.nonClubbableWithIds.length !==
      new Set(value.nonClubbableWithIds).size
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Duplicate non-clubbable leave ids are not allowed.",
        path: ["nonClubbableWithIds"],
      })
    }
  }
)

export const updateLeaveDefinitionSchema = leaveDefinitionBaseSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required.",
  })
  .superRefine((value, ctx) => {
    if (
      typeof value.minDaysPerRequest === "number" &&
      typeof value.maxDaysPerRequest === "number" &&
      value.minDaysPerRequest > value.maxDaysPerRequest
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Minimum days must be less than or equal to maximum days.",
        path: ["minDaysPerRequest"],
      })
    }
    if (
      Array.isArray(value.nonClubbableWithIds) &&
      value.nonClubbableWithIds.length !==
        new Set(value.nonClubbableWithIds).size
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Duplicate non-clubbable leave ids are not allowed.",
        path: ["nonClubbableWithIds"],
      })
    }
  })

export type CreateLeaveDefinitionInput = z.infer<typeof createLeaveDefinitionSchema>
export type UpdateLeaveDefinitionInput = z.infer<typeof updateLeaveDefinitionSchema>

const leaveGroupBaseSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .regex(/^[A-Za-z0-9_-]+$/),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional().or(z.literal("")),
  assignmentMode: leaveGroupAssignmentModeSchema.default("ALL_STAFF"),
  status: leaveGroupStatusSchema.default("ACTIVE"),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
  leaveDefinitionIds: z.array(z.string().trim().min(1)).min(1),
  staffIds: z.array(z.string().trim().min(1)).optional().default([]),
})

export const createLeaveGroupSchema = leaveGroupBaseSchema.superRefine((value, ctx) => {
  if (value.assignmentMode === "SELECTED_STAFF" && value.staffIds.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Select at least one employee for selective assignment.",
      path: ["staffIds"],
    })
  }
  if (value.leaveDefinitionIds.length !== new Set(value.leaveDefinitionIds).size) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Duplicate leave definitions are not allowed.",
      path: ["leaveDefinitionIds"],
    })
  }
})

export const updateLeaveGroupSchema = leaveGroupBaseSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required.",
  })
  .superRefine((value, ctx) => {
    if (
      value.assignmentMode === "SELECTED_STAFF" &&
      Array.isArray(value.staffIds) &&
      value.staffIds.length === 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select at least one employee for selective assignment.",
        path: ["staffIds"],
      })
    }
    if (
      Array.isArray(value.leaveDefinitionIds) &&
      value.leaveDefinitionIds.length !== new Set(value.leaveDefinitionIds).size
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Duplicate leave definitions are not allowed.",
        path: ["leaveDefinitionIds"],
      })
    }
  })

export type CreateLeaveGroupInput = z.infer<typeof createLeaveGroupSchema>
export type UpdateLeaveGroupInput = z.infer<typeof updateLeaveGroupSchema>

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const createLeaveRequestSchema = z
  .object({
    leaveDefinitionId: z.string().trim().min(1),
    startDate: isoDateSchema,
    endDate: isoDateSchema,
    reason: z.string().trim().max(500).optional().or(z.literal("")),
  })
  .superRefine((value, ctx) => {
    if (value.startDate > value.endDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Start date cannot be after end date.",
        path: ["startDate"],
      })
    }
  })

export const reviewLeaveRequestSchema = z
  .object({
    status: z.enum(["APPROVED", "REJECTED"]),
    reviewerComment: z.string().trim().max(500).optional().or(z.literal("")),
  })
  .superRefine((value, ctx) => {
    if (value.status === "REJECTED" && !value.reviewerComment?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Comment is required when rejecting a leave request.",
        path: ["reviewerComment"],
      })
    }
  })

export const bulkReviewLeaveRequestsSchema = z
  .object({
    requestIds: z.array(z.string().trim().min(1)).min(1).max(100),
    status: z.enum(["APPROVED", "REJECTED"]),
    reviewerComment: z.string().trim().max(500).optional().or(z.literal("")),
  })
  .superRefine((value, ctx) => {
    if (value.requestIds.length !== new Set(value.requestIds).size) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Duplicate leave request ids are not allowed.",
        path: ["requestIds"],
      })
    }
    if (value.status === "REJECTED" && !value.reviewerComment?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Comment is required when rejecting leave requests.",
        path: ["reviewerComment"],
      })
    }
  })

export const cancelLeaveRequestSchema = z.object({
  cancelReason: z.string().trim().max(500).optional().or(z.literal("")),
})

export const revokeLeaveRequestSchema = z.object({
  revokeReason: z
    .string()
    .trim()
    .min(1, "Reason is required when revoking an approved leave request.")
    .max(500),
})

export type CreateLeaveRequestInput = z.infer<typeof createLeaveRequestSchema>
export type ReviewLeaveRequestInput = z.infer<typeof reviewLeaveRequestSchema>
export type BulkReviewLeaveRequestsInput = z.infer<typeof bulkReviewLeaveRequestsSchema>
export type CancelLeaveRequestInput = z.infer<typeof cancelLeaveRequestSchema>
export type RevokeLeaveRequestInput = z.infer<typeof revokeLeaveRequestSchema>

const tenantHostnameSchema = z
  .string()
  .trim()
  .min(4)
  .max(253)
  .regex(
    /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i,
    "Enter a valid domain like cheron.com."
  )

const optionalTenantHostnameSchema = tenantHostnameSchema.optional().or(z.literal(""))
const optionalOrganizationIdSchema = z.string().trim().min(1).optional().or(z.literal(""))

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(63)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
})

export const createOrganizationMemberSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().email(),
  phone: z.string().trim().min(7).max(20).optional().or(z.literal("")),
  role: organizationMembershipRoleSchema.default("ADMIN"),
  password: z.string().trim().min(8).max(100).optional().or(z.literal("")),
})

export const updateOrganizationMemberSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional().or(z.literal("")),
    email: z.string().trim().email().optional().or(z.literal("")),
    phone: z.string().trim().min(7).max(20).optional().or(z.literal("")),
    role: organizationMembershipRoleSchema.optional(),
    status: z.enum(["ACTIVE", "SUSPENDED", "INVITED", "ARCHIVED"]).optional(),
    password: z.string().trim().min(8).max(100).optional().or(z.literal("")),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required.",
  })

export const createTenantSchema = z.object({
  modules: tenantModuleSelection,
  name: z.string().trim().min(2).max(120),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(63)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  adminName: z.string().trim().min(1).max(100),
  adminEmail: z.string().trim().email(),
  adminPassword: z.string().trim().min(8).max(100),
  organizationId: optionalOrganizationIdSchema,
  customDomain: optionalTenantHostnameSchema,
})

export const updateTenantStatusSchema = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED", "ARCHIVED"]).optional(),
  organizationId: optionalOrganizationIdSchema,
  customDomain: optionalTenantHostnameSchema,
}).refine((value) => Boolean(
  value.status ||
  value.customDomain !== undefined ||
  value.organizationId !== undefined
), {
  message: "At least one field is required.",
})

export const resetAllTenantsSchema = z.object({
  confirmation: z.literal("RESET"),
  keepPlatformTenant: z.boolean().optional().default(true),
})

export const updateTenantAdminSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional().or(z.literal("")),
    email: z.string().trim().email().optional().or(z.literal("")),
    phone: z.string().trim().min(7).max(20).optional().or(z.literal("")),
    status: z.enum(["ACTIVE", "SUSPENDED", "ARCHIVED"]).optional(),
    password: z.string().trim().min(8).max(100).optional().or(z.literal("")),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required.",
  })

export type CreateTenantInput = z.infer<typeof createTenantSchema>
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>
export type CreateOrganizationMemberInput = z.infer<typeof createOrganizationMemberSchema>
export type UpdateOrganizationMemberInput = z.infer<typeof updateOrganizationMemberSchema>
export type UpdateTenantStatusInput = z.infer<typeof updateTenantStatusSchema>
export type ResetAllTenantsInput = z.infer<typeof resetAllTenantsSchema>
export type UpdateTenantAdminInput = z.infer<typeof updateTenantAdminSchema>
