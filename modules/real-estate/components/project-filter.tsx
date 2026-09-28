"use client"
import { FormField } from "@/components/form-field"
import { RecordSelect } from "@/modules/crm/components/record-select"
import { useRealEstateEnabled } from "./property-fields"
export function ProjectFilter({ projectId, subprojectId, onChange }: { projectId: string; subprojectId: string; onChange: (projectId: string, subprojectId: string) => void }) {
  const enabled = useRealEstateEnabled()
  if (!enabled) return null
  return <><FormField id="project-filter" label="Project"><RecordSelect id="project-filter" endpoint="/api/crm/property-projects" value={projectId} onChange={id => onChange(id, "")} placeholder="All projects" /></FormField>{projectId && <FormField id="subproject-filter" label="Subproject"><RecordSelect key={projectId} id="subproject-filter" endpoint={`/api/crm/property-projects?parentId=${encodeURIComponent(projectId)}`} value={subprojectId} onChange={id => onChange(projectId, id)} placeholder="All subprojects" /></FormField>}</>
}
