"use client"
import * as React from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/form-field"
import { SearchableSelect } from "@/components/searchable-select"
import { CrmSelect } from "./crm-controls"
import { CrmSection } from "./crm-section"
import { RecordSelect } from "./record-select"
import type { FieldValue, FieldView } from "@/platform/custom-fields/validation"

export function FieldControl({ field, value, onChange, disabled, id }: { field: Pick<FieldView, "type" | "maxLength" | "minimum" | "maximum" | "options" | "optionName">; value: FieldValue; onChange: (value: FieldValue) => void; disabled?: boolean; id: string }) {
  if (field.type === "BOOLEAN") return <CrmSelect id={id} className="w-full" value={value === null ? "" : String(value)} disabled={disabled} onValueChange={next => onChange(next === "" ? null : next === "true")}><option value="">Not set</option><option value="true">Yes</option><option value="false">No</option></CrmSelect>
  if (field.type === "SELECT") return <SearchableSelect id={id} value={String(value ?? "")} disabled={disabled} options={field.options.filter(option => !option.archived).map(option => ({ value: option.id, label: option.name }))} selectedOption={value ? { value: String(value), label: field.optionName || field.options.find(option => option.id === value)?.name || "Saved option" } : undefined} preferSelectedOption onChange={onChange} placeholder="Choose an option" />
  return <Input id={id} disabled={disabled} type={field.type === "DATE" ? "date" : field.type === "NUMBER" ? "number" : "text"} step={field.type === "NUMBER" ? "0.000001" : undefined} min={field.minimum ?? undefined} max={field.maximum ?? undefined} maxLength={field.maxLength} value={String(value ?? "")} onChange={event => onChange(event.target.value || null)} />
}

export function useCustomFields(resource: string, id?: string, sourceEnquiryId?: string) {
  const [fields, setFields] = React.useState<FieldView[]>([]), [patch, setPatch] = React.useState<Record<string, FieldValue>>({})
  const teamRequest = React.useRef(0)
  const [loading, setLoading] = React.useState(true), [error, setError] = React.useState("")
  const load = React.useCallback(async (record: { customFields?: FieldView[]; salesTeamId?: string | null }, converting = false) => {
    ++teamRequest.current
    setError(""); setPatch({})
    try {
      if (converting) {
        const response = await fetch(`/api/crm/custom-fields/form/${resource}${record.salesTeamId ? `?salesTeamId=${encodeURIComponent(record.salesTeamId)}` : ""}`, { cache: "no-store" })
        if (!response.ok) throw new Error("Unable to load custom fields. Refresh before saving.")
        const own: FieldView[] = await response.json()
        const shared = (record.customFields ?? []).filter(field => field.scope === "SALES").map(field => ({ ...field, editable: false }))
        setFields([...own.filter(field => field.scope !== "SALES"), ...shared])
      } else setFields(record.customFields ?? [])
    } catch (error) { setError((error as Error).message) } finally { setLoading(false) }
  }, [resource])
  React.useEffect(() => {
    if (id || sourceEnquiryId) return
    const controller = new AbortController(), currentRequest = ++teamRequest.current
    fetch(`/api/crm/custom-fields/form/${resource}`, { signal: controller.signal, cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error("Unable to load custom fields. Refresh before saving.")
      const data = await response.json()
      if (currentRequest === teamRequest.current) { setFields(data); setLoading(false) }
    }).catch(error => { if (!controller.signal.aborted && currentRequest === teamRequest.current) { setError(error.message); setLoading(false) } })
    return () => controller.abort()
  }, [resource, id, sourceEnquiryId])
  async function changeTeam(salesTeamId: string) {
    const request = ++teamRequest.current
    setLoading(true); setError("")
    try {
      const response = await fetch(`/api/crm/custom-fields/form/${resource}${salesTeamId ? `?salesTeamId=${encodeURIComponent(salesTeamId)}` : ""}`, { cache: "no-store" })
      if (!response.ok) throw new Error("Unable to load team fields. Select the team again to retry.")
      const next: FieldView[] = await response.json()
      if (request !== teamRequest.current) return
      setFields(previous => next.map(field => previous.find(old => old.id === field.id) ?? field))
      setPatch(previous => Object.fromEntries(Object.entries(previous).filter(([id]) => next.some(field => field.id === id))))
    } catch (error) { if (request === teamRequest.current) setError((error as Error).message) } finally { if (request === teamRequest.current) setLoading(false) }
  }
  function section(disabled = false) {
    if (loading) return <p className="text-sm text-muted-foreground">Loading custom fields...</p>
    if (error) return <p role="alert" className="text-destructive">{error}</p>
    if (!fields.length && !sourceEnquiryId) return null
    return <CrmSection title="Additional information" description={sourceEnquiryId ? "Shared enquiry fields are copied when you convert. Enquiry-only fields remain on the original enquiry." : "Additional fields configured for this business."}>
      <div className="grid gap-4 sm:grid-cols-2">{fields.map(field => {
        const value = Object.hasOwn(patch, field.id) ? patch[field.id] : field.value
        const locked = disabled || !field.editable
        return <FormField key={field.id} id={`custom-${field.id}`} label={`${field.savedName || field.name}${field.required ? " *" : ""}${field.archived ? " (archived)" : ""}`}>
          <FieldControl field={{ ...field, optionName: Object.hasOwn(patch, field.id) ? undefined : field.optionName }} id={`custom-${field.id}`} value={value} disabled={locked} onChange={value => setPatch(previous => ({ ...previous, [field.id]: value }))} />
          {field.helpText && <p className="text-xs text-muted-foreground">{field.helpText}</p>}
          {!locked && !field.required && value !== null && <Button type="button" variant="link" size="sm" onClick={() => setPatch(previous => ({ ...previous, [field.id]: null }))}>Clear {field.name}</Button>}
        </FormField>
      })}</div>
    </CrmSection>
  }
  return { load, changeTeam, payload: { customFields: patch }, section, blocked: loading || !!error }
}

export type CustomFilter = { customFieldId: string; customFieldValue: string; customFieldOperator: "eq" | "gte" | "lte" }
export const emptyCustomFilter: CustomFilter = { customFieldId: "", customFieldValue: "", customFieldOperator: "eq" }
export function CustomFieldFilter({ resource, value, onChange }: { resource: string; value: CustomFilter; onChange: (filter: CustomFilter) => void }) {
  const [field, setField] = React.useState<FieldView | null>(null), [error, setError] = React.useState("")
  React.useEffect(() => {
    setField(null); setError("")
    if (!value.customFieldId) return
    const controller = new AbortController()
    fetch(`/api/crm/custom-fields/${value.customFieldId}`, { signal: controller.signal, cache: "no-store" }).then(async response => { if (!response.ok) throw new Error("Unable to load this filter."); setField(await response.json()) }).catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => controller.abort()
  }, [value.customFieldId])
  return <div className="space-y-3 sm:col-span-2"><FormField id={`custom-filter-${resource}`} label="Custom field"><RecordSelect id={`custom-filter-${resource}`} endpoint={`/api/crm/custom-fields?resource=${resource}&filterable=true`} value={value.customFieldId} selected={field ? { value: field.id, label: field.name } : undefined} onChange={customFieldId => onChange({ ...emptyCustomFilter, customFieldId })} placeholder="Choose a field" /></FormField>
    {error && <p role="alert" className="text-destructive">{error}</p>}{field && <>
      {["NUMBER", "DATE"].includes(field.type) && <CrmSelect aria-label="Custom field comparison" value={value.customFieldOperator} onValueChange={customFieldOperator => onChange({ ...value, customFieldOperator: customFieldOperator as CustomFilter["customFieldOperator"] })}><option value="eq">Equals</option><option value="gte">At least</option><option value="lte">At most</option></CrmSelect>}
      <FormField id={`custom-filter-value-${resource}`} label={field.name}><FieldControl field={{ ...field, minimum: null, maximum: null, options: field.options.map(option => ({ ...option, archived: false })) }} id={`custom-filter-value-${resource}`} value={field.type === "BOOLEAN" ? value.customFieldValue === "" ? null : value.customFieldValue === "true" : value.customFieldValue} onChange={next => onChange({ ...value, customFieldValue: next === null ? "" : String(next) })} /></FormField>
    </>}{value.customFieldId && <Button variant="link" size="sm" type="button" onClick={() => onChange(emptyCustomFilter)}>Clear custom field filter</Button>}</div>
  }
