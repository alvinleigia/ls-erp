import { z } from "zod"
import { attributionFilterShape, validateAttributionFilters } from "@/platform/collaborators/report-validation"

import { dashboardKinds } from "@/types/dashboard"

export const dashboardSelectionSchema = z.object({
  ...attributionFilterShape,
  range: z.enum(["today", "week", "month", "custom"]).default("week"),
  startDate: z.iso.date().optional(), endDate: z.iso.date().optional(),
}).strict().superRefine((value,ctx) => {
  validateAttributionFilters(value,ctx)
  if (value.range === "custom" && (!value.startDate || !value.endDate || value.endDate < value.startDate || Date.parse(value.endDate)-Date.parse(value.startDate)>365*86400000)) ctx.addIssue({code:"custom",path:["endDate"],message:"Choose both dates, covering at most 366 days."})
})
export const dashboardPageSchema = dashboardSelectionSchema.safeExtend({ page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(20) })
export const dashboardRecordSchema = dashboardPageSchema.safeExtend({kind:z.enum(dashboardKinds)})
export type DashboardSelection = z.infer<typeof dashboardSelectionSchema>
