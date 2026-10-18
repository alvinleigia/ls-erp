"use client"
import * as React from "react"
import { CatalogEditor } from "@/modules/catalog/components/item-editor"
import { UnitFields, unitFieldsPayload } from "@/modules/real-estate/components/unit-fields"
import { useBusinessModules } from "@/platform/module-provider"
export function ApplicationCatalogEditor({ id, projectId }: { id?: string; projectId?: string }) {
  const modules = useBusinessModules()
  const [project, setProject] = React.useState<unknown>(), [error, setError] = React.useState("")
  React.useEffect(() => {
    if (!projectId) return
    const controller = new AbortController()
    fetch(`/api/real-estate/projects/${encodeURIComponent(projectId)}`, { signal: controller.signal, cache: "no-store" }).then(async response => {
      const row = await response.json(); if (!response.ok) throw Error(row.error || "Unable to load project.")
      if (!controller.signal.aborted) setProject(row)
    }).catch(e => { if (!controller.signal.aborted) setError(e.message) })
    return () => controller.abort()
  }, [projectId])
  const property = modules.enabled("realEstate") && modules.can("projects.read")
  if (projectId && (!project || error)) return <p role={error ? "alert" : undefined}>{error || "Loading project..."}</p>
  if (projectId && !property) return <p role="alert">Property units are not available to your account.</p>
  return <CatalogEditor id={id} defaults={projectId ? { extensionKey: "realEstate", extension: { projectId, project, categoryId: "", bedrooms: null, area: "", areaUnit: "SQ_FT" } } : undefined} extension={property ? { key: "realEstate", label: "Property unit", canEdit: modules.can("projects.edit"), serialize: unitFieldsPayload, Fields: UnitFields } : undefined} />
}
