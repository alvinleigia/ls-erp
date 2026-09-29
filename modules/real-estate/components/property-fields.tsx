"use client"
import * as React from "react"
import { useBusinessModules } from "@/platform/module-provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FormField } from "@/components/form-field"
import { CrmSection } from "@/modules/crm/components/crm-section"
import { RecordSelect } from "@/modules/crm/components/record-select"
import { ChoiceSelect } from "./choice-select"
import type { PropertyDefaults } from "../choices"
import type { PropertyContextInput } from "../sales-validation"
import type { PropertyContext } from "@/types/real-estate"

export const emptyProperty: PropertyContextInput = { projectId: "", subprojectId: "", budgetMin: "", budgetMax: "", budgetCurrency: "", propertyCategory: "", bedrooms: null, buyingTimeframe: "" }
export function propertyFields(context?: PropertyContext | null): PropertyContextInput {
  return { projectId: context?.projectId || "", subprojectId: context?.subprojectId || "", budgetMin: context?.budgetMin || "", budgetMax: context?.budgetMax || "", budgetCurrency: context?.budgetCurrency || "", propertyCategory: (context?.propertyCategory || "") as PropertyContextInput["propertyCategory"], bedrooms: context?.bedrooms ?? null, buyingTimeframe: (context?.buyingTimeframe || "") as PropertyContextInput["buyingTimeframe"] }
}
export function useRealEstateEnabled() {
  return useBusinessModules().enabled("realEstate")
}
export function PropertyFields({ value, onChange, selected, disabled, readOnly, error, isNew = false }: { isNew?: boolean; error?: string; value: PropertyContextInput; onChange: (value: PropertyContextInput) => void; selected?: PropertyContext | null; disabled?: boolean; readOnly?: boolean }) {
  const [defaultsLoading, setDefaultsLoading] = React.useState(isNew)
  const [defaultsError, setDefaultsError] = React.useState("")
  const latest = React.useRef({ value, onChange })
  React.useEffect(() => { latest.current = { value, onChange } }, [value, onChange])
  React.useEffect(() => {
    if (!isNew || readOnly) { setDefaultsLoading(false); return }
    const controller = new AbortController()
    fetch("/api/real-estate/choices/defaults", { signal: controller.signal, cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error("Unable to load defaults. Select the property choices manually.")
      const defaults: PropertyDefaults = await response.json()
      if (!controller.signal.aborted) {
        const current = latest.current
        current.onChange({ ...current.value, propertyCategory: current.value.propertyCategory || defaults["property-categories"]?.id || "", buyingTimeframe: current.value.buyingTimeframe || defaults["buying-timeframes"]?.id || "" })
      }
    }).catch(error => { if (!controller.signal.aborted) setDefaultsError(error.message) }).finally(() => { if (!controller.signal.aborted) setDefaultsLoading(false) })
    return () => controller.abort()
  }, [isNew, readOnly])
  const locked = disabled || readOnly || defaultsLoading
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
    {(error || defaultsError) && <p role="alert" className="text-sm text-destructive">{error || defaultsError}</p>}
    <fieldset disabled={locked} className="grid gap-4 sm:grid-cols-2">
      <FormField id="property-project" label="Project (optional)"><RecordSelect id="property-project" endpoint="/api/real-estate/projects" value={value.projectId} disabled={locked} selected={project ? { value: project.id, label: `${project.name}${project.archived ? " (archived)" : ""}` } : undefined} onChange={projectId => onChange({ ...value, projectId, subprojectId: "" })} />{value.projectId && !readOnly && <Button type="button" variant="link" size="sm" onClick={() => onChange({ ...value, projectId: "", subprojectId: "" })}>Clear project</Button>}</FormField>
      <FormField id="property-subproject" label="Subproject (optional)"><RecordSelect key={value.projectId} id="property-subproject" endpoint={`/api/real-estate/projects?parentId=${encodeURIComponent(value.projectId)}`} value={value.subprojectId} disabled={locked || !value.projectId} selected={subproject ? { value: subproject.id, label: `${subproject.name}${subproject.archived ? " (archived)" : ""}` } : undefined} onChange={subprojectId => onChange({ ...value, subprojectId })} />{value.subprojectId && !readOnly && <Button type="button" variant="link" size="sm" onClick={() => onChange({ ...value, subprojectId: "" })}>Clear subproject</Button>}</FormField>
      {([['budgetMin', 'Minimum budget'], ['budgetMax', 'Maximum budget'], ['budgetCurrency', 'Budget currency (e.g. INR)']] as const).map(([key, label]) => <FormField key={key} id={`property-${key}`} label={label}><Input id={`property-${key}`} maxLength={key === "budgetCurrency" ? 3 : 19} value={value[key]} onChange={event => onChange({ ...value, [key]: event.target.value })} /></FormField>)}
      <FormField id="property-category" label="Preferred property category"><ChoiceSelect kind="property-categories" id="property-category" value={value.propertyCategory || ""} name={selected && selected.propertyCategory === value.propertyCategory ? selected.propertyCategoryName : undefined} disabled={locked} clearable={!readOnly} placeholder="Not specified" onChange={propertyCategory => onChange({ ...value, propertyCategory })} /></FormField>
      <FormField id="property-bedrooms" label="Bedrooms (0 for studio)"><Input id="property-bedrooms" type="number" min={0} max={50} value={value.bedrooms ?? ""} onChange={event => onChange({ ...value, bedrooms: event.target.value === "" ? null : Number(event.target.value) })} /></FormField>
      <FormField id="property-timeframe" label="Buying timeframe"><ChoiceSelect kind="buying-timeframes" id="property-timeframe" value={value.buyingTimeframe || ""} name={selected && selected.buyingTimeframe === value.buyingTimeframe ? selected.buyingTimeframeName : undefined} disabled={locked} clearable={!readOnly} placeholder="Not specified" onChange={buyingTimeframe => onChange({ ...value, buyingTimeframe })} /></FormField>
    </fieldset>
  </CrmSection>
}
