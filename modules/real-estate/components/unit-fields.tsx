"use client"
import * as React from "react"
import type { CatalogFieldsProps } from "@/modules/catalog/components/item-editor"
import { FormField } from "@/components/form-field"
import { RecordSelect } from "@/components/erp/record-select"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/erp/controls"
import { Button } from "@/components/ui/button"
import { ReadOnlyFields } from "@/components/erp/record-detail"
type Unit = { projectId: string; categoryId: string; launchPhaseId?: string | null; launchPhase?: { id: string; name: string }; bedrooms: number | null; area: string; areaUnit: string; project?: { id: string; name: string; parentId: string | null; rootId?: string; pathName?: string; rootProject?: { id: string; name: string }; parent?: { id: string; name: string } }; category?: { id: string; name: string } }
export function unitFieldsPayload(value: unknown) {
  const row = (value || {}) as Partial<Unit>
  return { projectId: row.projectId || "", categoryId: row.categoryId || "", launchPhaseId: row.launchPhaseId || null, bedrooms: row.bedrooms ?? null, area: row.area == null ? "" : String(row.area), areaUnit: row.areaUnit || "SQ_FT" }
}
export function UnitFields({ value, onChange, disabled }: CatalogFieldsProps) {
  const row = (value || { projectId: "", categoryId: "", bedrooms: null, area: "", areaUnit: "SQ_FT" }) as Unit
  const [parentId, setParentId] = React.useState(row.project?.rootId || row.projectId)
  const change = (patch: Partial<Unit>) => onChange({ ...row, ...patch })
  if (disabled) return <ReadOnlyFields fields={[{ label: "Project / subproject", value: row.project?.pathName || row.project?.name || row.projectId }, { label: "Launch phase", value: row.launchPhase?.name || "No phase" }, { label: "Property category", value: row.category?.name || row.categoryId }, { label: "Bedrooms", value: row.bedrooms ?? "Not specified" }, { label: "Area", value: row.area ? `${row.area} ${row.areaUnit === "SQ_M" ? "m²" : "ft²"}` : "Not specified" }]} />
  return <div className="grid gap-5 sm:grid-cols-2">
    <FormField id="unit-project" label="Project"><RecordSelect id="unit-project" endpoint="/api/real-estate/projects" value={parentId} selected={row.project ? { value: parentId, label: row.project.rootProject?.name || row.project.name } : undefined} onChange={id => { setParentId(id); change({ projectId: id, project: undefined, launchPhaseId: null, launchPhase: undefined }) }} /></FormField>
    {parentId && <FormField id="unit-subproject" label="Subproject (optional)"><RecordSelect key={parentId} id="unit-subproject" labelField="pathName" endpoint={`/api/real-estate/projects?descendantOf=${encodeURIComponent(parentId)}&selectable=true`} value={row.projectId !== parentId ? row.projectId : ""} selected={row.project?.parentId ? { value: row.project.id, label: row.project.pathName || row.project.name } : undefined} onChange={id => change({ projectId: id || parentId })} />{row.projectId !== parentId && <Button type="button" variant="ghost" size="sm" onClick={() => change({ projectId: parentId, project: undefined })}>Clear subproject</Button>}</FormField>}
    <FormField id="unit-category" label="Property category"><RecordSelect id="unit-category" endpoint="/api/real-estate/choices/property-categories" value={row.categoryId} selected={row.category ? { value: row.category.id, label: row.category.name } : undefined} onChange={categoryId => change({ categoryId })} /></FormField>
    {parentId && <FormField id="unit-launch-phase" label="Launch phase (optional)" help="Units without a phase keep their existing availability. A phase controls new reservations only."><RecordSelect key={`phase-${parentId}`} id="unit-launch-phase" endpoint={`/api/real-estate/projects/${encodeURIComponent(parentId)}/launch-phases`} value={row.launchPhaseId || ""} selected={row.launchPhase ? { value: row.launchPhase.id, label: row.launchPhase.name } : undefined} onChange={launchPhaseId => change({ launchPhaseId: launchPhaseId || null })} />{row.launchPhaseId && <Button type="button" variant="ghost" size="sm" onClick={() => change({ launchPhaseId: null, launchPhase: undefined })}>Clear launch phase</Button>}</FormField>}
    <FormField id="unit-bedrooms" label="Bedrooms (0 for studio)"><Input id="unit-bedrooms" type="number" min={0} max={100} value={row.bedrooms ?? ""} onChange={e => change({ bedrooms: e.target.value === "" ? null : Number(e.target.value) })} /></FormField>
    <FormField id="unit-area" label="Area (optional)"><Input id="unit-area" inputMode="decimal" value={row.area ?? ""} onChange={e => change({ area: e.target.value })} /></FormField>
    <FormField id="unit-area-unit" label="Area unit"><Select id="unit-area-unit" value={row.areaUnit} onValueChange={areaUnit => change({ areaUnit })}><option value="SQ_FT">Square feet</option><option value="SQ_M">Square metres</option></Select></FormField>
  </div>
}
