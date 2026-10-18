"use client"
import { Input } from "@/components/ui/input"
import { SearchableSelect } from "@/components/searchable-select"
import { Select } from "@/components/erp/controls"
import type { FieldValue, FieldView } from "@/platform/custom-fields/validation"

export function FieldControl({ field, value, onChange, disabled, id }: { field: Pick<FieldView, "type" | "maxLength" | "minimum" | "maximum" | "options" | "optionName">; value: FieldValue; onChange: (value: FieldValue) => void; disabled?: boolean; id: string }) {
  if (field.type === "BOOLEAN") return <Select id={id} className="w-full" value={value === null ? "" : String(value)} disabled={disabled} onValueChange={next => onChange(next === "" ? null : next === "true")}><option value="">Not set</option><option value="true">Yes</option><option value="false">No</option></Select>
  if (field.type === "SELECT") return <SearchableSelect id={id} value={String(value ?? "")} disabled={disabled} options={field.options.filter(option => !option.archived).map(option => ({ value: option.id, label: option.name }))} selectedOption={value ? { value: String(value), label: field.optionName || field.options.find(option => option.id === value)?.name || "Saved option" } : undefined} preferSelectedOption onChange={onChange} placeholder="Choose an option" />
  return <Input id={id} disabled={disabled} type={field.type === "DATE" ? "date" : field.type === "NUMBER" ? "number" : "text"} step={field.type === "NUMBER" ? "0.000001" : undefined} min={field.minimum ?? undefined} max={field.maximum ?? undefined} maxLength={field.maxLength} value={String(value ?? "")} onChange={event => onChange(event.target.value || null)} />
}
