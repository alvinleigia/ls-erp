import { z } from "zod"
import { activityReportSchema } from "./report-validation"

export const salesReportSchema = activityReportSchema.safeExtend({
  type: z.never().optional(),
  lostReasonId: z.string().trim().min(1).max(100).optional(),
  salesTeamId: z.string().trim().min(1).max(100).optional(),
  sourceId: z.string().trim().min(1).max(100).optional(),
  projectId: z.string().trim().min(1).max(100).optional(),
  subprojectId: z.string().trim().min(1).max(100).optional(),
  dimension: z.enum(["source", "salesperson", "project", "lostReason"]).default("source"),
  view: z.enum(["leads", "converted", "pipeline", "won", "lost", "overdue", "gaps"]).default("leads"),
  bucket: z.string().min(1).max(100).optional(),
  stageId: z.string().min(1).max(100).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})
export type SalesReportQuery = z.infer<typeof salesReportSchema>
