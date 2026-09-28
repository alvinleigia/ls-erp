import { z } from "zod"
import { workTypes } from "./work-validation"

export const activityReportSchema = z.object({
  activityTypeId: z.string().trim().min(1).max(100).optional(),
  from: z.iso.date().optional(), through: z.iso.date().optional(),
  assignedUserId: z.string().trim().min(1).max(100).optional(),
  scope: z.enum(["mine", "team"]).default("mine"), type: z.enum(workTypes).optional(),
}).strict().superRefine((value, ctx) => {
  if (!!value.from !== !!value.through || (value.from && value.through && (value.through < value.from || Date.parse(value.through) - Date.parse(value.from) > 365 * 86400000))) {
    ctx.addIssue({ code: "custom", path: ["through"], message: "Choose both dates, covering at most 366 days." })
  }
})
export const activityReportPageSchema = activityReportSchema.safeExtend({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})
export type ActivityReportInput = z.infer<typeof activityReportSchema>
