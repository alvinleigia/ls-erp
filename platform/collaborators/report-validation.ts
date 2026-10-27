import { z } from "zod"

export const attributionFilterShape = {
  responsibleType: z.enum(["all", "internal", "external"]).default("all"),
  introduction: z.enum(["all", "partner", "unattributed"]).default("all"),
  introducedByCollaboratorId: z.string().trim().min(1).max(100).optional(),
  introductionSupervisorId: z.string().trim().min(1).max(100).optional(),
}
export function validateAttributionFilters(value: AttributionFilter, ctx: z.RefinementCtx) {
  if (value.introduction === "unattributed" && (value.introducedByCollaboratorId || value.introductionSupervisorId)) ctx.addIssue({ code: "custom", path: ["introduction"], message: "Clear the partner and supervisor filters before choosing no recorded partner." })
}
export const attributionFilterSchema = z.object(attributionFilterShape).strict().superRefine(validateAttributionFilters)
export type AttributionFilter = { responsibleType?: "all" | "internal" | "external"; introduction?: "all" | "partner" | "unattributed"; introducedByCollaboratorId?: string; introductionSupervisorId?: string }
export const hasIntroductionFilter = (q: AttributionFilter) => (q.introduction && q.introduction !== "all") || !!q.introducedByCollaboratorId || !!q.introductionSupervisorId
export const attributionQuery = (q: AttributionFilter): Record<string, string> => Object.fromEntries(Object.entries(q).filter(([key, value]) => key in attributionFilterShape && value && value !== "all"))
