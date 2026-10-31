import { z } from "zod"
import { salesReportSchema } from "./sales-report-validation"
import { teamMetricKeys, type TeamMetric } from "./team-performance-contract"

const metric = z.enum(teamMetricKeys as [TeamMetric, ...TeamMetric[]])
export const teamPerformanceSchema = salesReportSchema.safeExtend({
  scope: z.literal("team").default("team"),
  metric: metric.default("enquiries"),
  sort: z.enum(["name", "conversionPercent", ...teamMetricKeys]).default("name"),
  order: z.enum(["asc", "desc"]).default("asc"),
  q: z.string().trim().max(100).default(""),
})
export type TeamPerformanceQuery = z.infer<typeof teamPerformanceSchema>
