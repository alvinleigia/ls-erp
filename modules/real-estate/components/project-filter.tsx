"use client"
import { useTerminology } from "@/platform/terminology/provider"
import { FormField } from "@/components/form-field"
import { RecordSelect } from "@/components/erp/record-select"
import { useRealEstateEnabled } from "./property-fields"
export function ProjectFilter({ projectId, subprojectId, onChange }: { projectId: string; subprojectId: string; onChange: (projectId: string, subprojectId: string) => void }) {
  const term = useTerminology()
  const enabled = useRealEstateEnabled()
  if (!enabled) return null
  return <><FormField id="project-filter" label={term("realEstate.project.singular", "Project")}><RecordSelect id="project-filter" endpoint="/api/crm/property-projects" value={projectId} onChange={id => onChange(id, "")} placeholder={term("realEstate.project.plural", "All projects", "All {label}")} /></FormField>{projectId && <FormField id="subproject-filter" label={term("realEstate.subproject.singular", "Subproject")}><RecordSelect key={projectId} id="subproject-filter" endpoint={`/api/crm/property-projects?parentId=${encodeURIComponent(projectId)}`} value={subprojectId} onChange={id => onChange(projectId, id)} placeholder={term("realEstate.subproject.plural", "All subprojects", "All {label}")} /></FormField>}</>
}
