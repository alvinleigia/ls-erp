import { z } from "zod"

export const workforceDateRangeSchema = z.object({
  startDate: z.iso.date(),
  endDate: z.iso.date(),
  staffIds: z.string().optional(),
}).refine(value => value.startDate <= value.endDate, {
  message: "Start date cannot be after end date.", path: ["endDate"],
})
export type WorkforceDateRangeQuery = z.infer<typeof workforceDateRangeSchema>

export const updateAssignmentSchema = z.object({ endDate: z.iso.date() })

export const shiftScheduleListSchema = z.object({
  q: z.string().trim().optional(),
  staffId: z.string().trim().optional(),
  isDefault: z.enum(["true", "false"]).optional().transform(value => value === "true"),
  startDate: z.iso.date().optional().or(z.literal("")),
  // Keep the table's existing fallback for columns without a dedicated sort.
  sort: z.string().default("startDate"),
  order: z.enum(["asc", "desc"]).default("asc"),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
}).refine(value => (value.page === undefined) === (value.pageSize === undefined), {
  message: "Supply both page and pageSize for pagination.", path: ["pageSize"],
})

export const deleteOverrideSchema = z.object({
  staffId: z.string().trim().min(1), startDate: z.iso.date(), endDate: z.iso.date(),
}).refine(value => value.startDate <= value.endDate, {
  message: "Start date cannot be after end date.", path: ["endDate"],
})
export const deleteFlexibleSlotSchema = z.object({ staffId: z.string().trim().min(1), date: z.iso.date() })
