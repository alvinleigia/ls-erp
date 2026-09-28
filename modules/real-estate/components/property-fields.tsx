"use client"
import * as React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FormField } from "@/components/form-field"
import { CrmSection } from "@/modules/crm/components/crm-section"
import { CrmSelect } from "@/modules/crm/components/crm-controls"
import { RecordSelect } from "@/modules/crm/components/record-select"
import { categoryOptions } from "../validation"
import { buyingTimeframes } from "../sales-validation"
import type { PropertyContextInput } from "../sales-validation"
import type { PropertyContext } from "@/types/real-estate"
import { choiceLabel } from "./project-list"

export const emptyProperty: PropertyContextInput = { projectId: "", subprojectId: "", budgetMin: "", budgetMax: "", budgetCurrency: "", propertyCategory: "", bedrooms: null, buyingTimeframe: "" }
export function propertyFields(context?: PropertyContext | null): PropertyContextInput {
  return { projectId: context?.projectId || "", subprojectId: context?.subprojectId || "", budgetMin: context?.budgetMin || "", budgetMax: context?.budgetMax || "", budgetCurrency: context?.budgetCurrency || "", propertyCategory: (context?.propertyCategory || "") as PropertyContextInput["propertyCategory"], bedrooms: context?.bedrooms ?? null, buyingTimeframe: (context?.buyingTimeframe || "") as PropertyContextInput["buyingTimeframe"] }
}
export function useRealEstateEnabled() {
  const [enabled, setEnabled] = React.useState(false)
  React.useEffect(() => {
    const controller = new AbortController()
    fetch("/api/modules", { signal: controller.signal, cache: "no-store" }).then(async response => {
      if (response.ok) setEnabled(!!(await response.json()).modules?.some((item: { key: string; enabled: boolean }) => item.key === "realEstate" && item.enabled))
    }).catch(() => {})
    return () => controller.abort()
  }, [])
  return enabled
}
export function PropertyFields({ value, onChange, selected, disabled, readOnly, error }: { error?: string; value: PropertyContextInput; onChange: (value: PropertyContextInput) => void; selected?: PropertyContext | null; disabled?: boolean; readOnly?: boolean }) {
  const locked = disabled || readOnly
  const [choices, setChoices] = React.useState<Record<string, { id: string; name: string; archived: boolean }>>({})
  React.useEffect(() => {
    const controller = new AbortController()
    for (const id of [value.projectId, value.subprojectId]) {
      if (!id || id === selected?.project?.id || id === selected?.subproject?.id) continue
      fetch(`/api/real-estate/projects/${encodeURIComponent(id)}`, { signal: controller.signal, cache: "no-store" }).then(async response => {
        if (!response.ok) return
        const project = await response.json()
        if (!controller.signal.aborted) setChoices(previous => ({ ...previous, [id]: project }))
      }).catch(() => {})
    }
    return () => controller.abort()
  }, [value.projectId, value.subprojectId, selected?.project?.id, selected?.subproject?.id])
  const project = selected?.project?.id === value.projectId ? selected.project : choices[value.projectId]
  const subproject = selected?.subproject?.id === value.subprojectId ? selected.subproject : choices[value.subprojectId]
  return <CrmSection title="Property interest" description={readOnly ? "Conversion preserves the enquiry's project and requirements. Change them on the saved opportunity if needed." : "Optional project selection and buyer requirements. Budget is separate from the deal value."}>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <fieldset disabled={locked} className="grid gap-4 sm:grid-cols-2">
      <FormField id="property-project" label="Project (optional)"><RecordSelect id="property-project" endpoint="/api/real-estate/projects" value={value.projectId} disabled={locked} selected={project ? { value: project.id, label: `${project.name}${project.archived ? " (archived)" : ""}` } : undefined} onChange={projectId => onChange({ ...value, projectId, subprojectId: "" })} />{value.projectId && !readOnly && <Button type="button" variant="link" size="sm" onClick={() => onChange({ ...value, projectId: "", subprojectId: "" })}>Clear project</Button>}</FormField>
      <FormField id="property-subproject" label="Subproject (optional)"><RecordSelect key={value.projectId} id="property-subproject" endpoint={`/api/real-estate/projects?parentId=${encodeURIComponent(value.projectId)}`} value={value.subprojectId} disabled={locked || !value.projectId} selected={subproject ? { value: subproject.id, label: `${subproject.name}${subproject.archived ? " (archived)" : ""}` } : undefined} onChange={subprojectId => onChange({ ...value, subprojectId })} />{value.subprojectId && !readOnly && <Button type="button" variant="link" size="sm" onClick={() => onChange({ ...value, subprojectId: "" })}>Clear subproject</Button>}</FormField>
      {([['budgetMin', 'Minimum budget'], ['budgetMax', 'Maximum budget'], ['budgetCurrency', 'Budget currency (e.g. INR)']] as const).map(([key, label]) => <FormField key={key} id={`property-${key}`} label={label}><Input id={`property-${key}`} maxLength={key === "budgetCurrency" ? 3 : 19} value={value[key]} onChange={event => onChange({ ...value, [key]: event.target.value })} /></FormField>)}
      <FormField id="property-category" label="Preferred property category"><CrmSelect id="property-category" className="w-full" disabled={locked} value={value.propertyCategory} onValueChange={propertyCategory => onChange({ ...value, propertyCategory: propertyCategory as PropertyContextInput["propertyCategory"] })}><option value="">Not specified</option>{categoryOptions.map(item => <option key={item} value={item}>{choiceLabel(item)}</option>)}</CrmSelect></FormField>
      <FormField id="property-bedrooms" label="Bedrooms (0 for studio)"><Input id="property-bedrooms" type="number" min={0} max={50} value={value.bedrooms ?? ""} onChange={event => onChange({ ...value, bedrooms: event.target.value === "" ? null : Number(event.target.value) })} /></FormField>
      <FormField id="property-timeframe" label="Buying timeframe"><CrmSelect id="property-timeframe" className="w-full" disabled={locked} value={value.buyingTimeframe} onValueChange={buyingTimeframe => onChange({ ...value, buyingTimeframe: buyingTimeframe as PropertyContextInput["buyingTimeframe"] })}><option value="">Not specified</option>{buyingTimeframes.map(item => <option key={item} value={item}>{choiceLabel(item)}</option>)}</CrmSelect></FormField>
    </fieldset>
  </CrmSection>
}
