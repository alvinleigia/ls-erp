import { z } from "zod"
import { flexiblePatternSchema } from "@/lib/validation"

const date = z.iso.date()
const optionalDate = date.optional().or(z.literal(""))
const staffQuery = { staffId: z.string().trim().optional(), staffIds: z.string().optional() }
export const splitStaffIds = (value?: string) => (value ?? "").split(",").map(id => id.trim()).filter(Boolean)
export const mondayDate = date.refine(value => new Date(value).getUTCDay() === 1, "weekStartDate must be a Monday (YYYY-MM-DD).")
export const weekPlanQuerySchema = z.object({ ...staffQuery, weekStartDate: mondayDate })
  .refine(value => !!value.staffId || splitStaffIds(value.staffIds).length > 0, "staffId/staffIds is required.")
export const deleteWeekPlanSchema = z.object({ staffId: z.string().trim().min(1), weekStartDate: mondayDate })
export const patternQuerySchema = z.object({ ...staffQuery, startDate: optionalDate, endDate: optionalDate })
  .refine(value => !!value.staffId || splitStaffIds(value.staffIds).length > 0, "staffId/staffIds is required.")
  .refine(value => !value.startDate || !value.endDate || value.startDate <= value.endDate, "Start date cannot be after end date.")
export const patternListSchema = z.object({
  q: z.string().trim().optional(), staffId: z.string().trim().optional(),
  isActive: z.enum(["true", "false", ""]).optional(), effectiveOn: optionalDate,
  sort: z.string().default("updatedAt"), order: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(10),
})
export const deletePatternSchema = z.object({ patternId: z.string().trim().min(1) })
export const clonePatternSchema = z.object({
  name: z.string().trim().max(120).optional().or(z.literal("")), validFrom: date, validTo: optionalDate,
  activate: z.boolean().default(true), targetStaffId: z.string().trim().min(1).optional(),
}).refine(value => !value.validTo || value.validFrom <= value.validTo, "validFrom must be on or before validTo.")

export const impactPreviewSchema = z.object({
  mode: z.enum(["DEACTIVATE", "CLONE", "UPDATE"]), patternId: z.string().trim().min(1),
  targetStaffId: z.string().trim().min(1).optional(), validFrom: date.optional(), validTo: optionalDate,
  activate: z.boolean().default(true), cycleLengthWeeks: z.coerce.number().int().min(1).max(12).optional(),
  weeks: z.array(flexiblePatternSchema.shape.weeks.element).optional(),
}).superRefine((value, ctx) => {
  if (value.mode !== "DEACTIVATE" && !value.validFrom) ctx.addIssue({ code: "custom", message: "validFrom is required.", path: ["validFrom"] })
  if (value.validFrom && value.validTo && value.validFrom > value.validTo) ctx.addIssue({ code: "custom", message: "validFrom must be on or before validTo.", path: ["validTo"] })
  // Use the save validator for the draft cycle: preview must not accept invalid slots,
  // overlapping breaks, duplicate weekdays or missing weeks that save would reject.
  if (value.weeks) {
    const checked = flexiblePatternSchema.safeParse({ ...value, staffId: "preview", validFrom: value.validFrom ?? "2000-01-03" })
    if (!checked.success) for (const issue of checked.error.issues) ctx.addIssue({ code: "custom", message: issue.message, path: issue.path })
  }
})
