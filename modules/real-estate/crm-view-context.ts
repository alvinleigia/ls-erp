import type { CrmCreateQuery, CrmViewReferences } from "@/modules/crm/view-context"

export function realEstateViewReferences(query: CrmCreateQuery): CrmViewReferences {
  return { primaryId: typeof query.projectId === "string" ? query.projectId : "", secondaryId: typeof query.subprojectId === "string" ? query.subprojectId : "" }
}

export function realEstateFilterQuery(projectId: string, subprojectId: string): Record<string, string> {
  return { ...(projectId ? { projectId } : {}), ...(subprojectId ? { subprojectId } : {}) }
}
