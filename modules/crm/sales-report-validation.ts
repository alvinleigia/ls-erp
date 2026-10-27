import { z } from "zod"
import { activityReportSchema } from "./report-validation"

export const salesReportSchema = activityReportSchema.safeExtend({
  type: z.never().optional(),
  lostReasonId: z.string().trim().min(1).max(100).optional(),
  salesTeamId: z.string().trim().min(1).max(100).optional(),
  sourceId: z.string().trim().min(1).max(100).optional(),
  dimension: z.string().trim().min(1).max(100).default("source"),
  view: z.enum(["leads", "converted", "pipeline", "won", "lost", "overdue", "gaps"]).default("leads"),
  bucket: z.string().min(1).max(100).optional(),
  stageId: z.string().min(1).max(100).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})
export const attributionChoiceSchema = z.object({
  choice: z.enum(["partner", "supervisor"]), q: z.string().trim().max(160).default(""), selectedId: z.string().trim().min(1).max(100).optional(),
}).strict()
export type SalesReportQuery = z.infer<typeof salesReportSchema>
