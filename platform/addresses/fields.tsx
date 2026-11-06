"use client"
import { FormField } from "@/components/form-field"
import { Input } from "@/components/ui/input"
import { SearchableSelect } from "@/components/searchable-select"
import { COUNTRY_OPTIONS } from "@/lib/constants/countries"
import { informationFields, informationLabels, type Correspondence } from "@/platform/participants/information"

export function AddressFields({ id, values, onChange, suffix = "", labels = informationLabels, required = [], errors = {} }: {
  id: string; values: Correspondence; onChange: (field: keyof Correspondence, value: string) => void;
  suffix?: string; labels?: Record<keyof Correspondence, string>; required?: readonly string[]; errors?: Record<string, string>;
}) {
  return <div className="grid min-w-0 gap-4 sm:grid-cols-2">{informationFields.map(field => <FormField key={field} id={`${id}-${field}`} label={`${labels[field]}${suffix}`} error={errors[field]}>
    {field === "country" ? <SearchableSelect id={`${id}-${field}`} value={values[field]} options={[{ value: "", label: "Not specified" }, ...COUNTRY_OPTIONS.map(value => ({ value, label: value }))]} onChange={value => onChange(field, value)} placeholder="Choose a country" /> : <Input id={`${id}-${field}`} value={values[field]} maxLength={field === "email" ? 254 : field === "phone" ? 40 : field.startsWith("address") ? 200 : field === "postalCode" ? 30 : 100} inputMode={field === "email" ? "email" : field === "phone" ? "tel" : "text"} onChange={event => onChange(field, event.target.value)} />}
    {required.includes(field) && <p className="text-xs text-muted-foreground">Needed at confirmation</p>}
  </FormField>)}</div>
}
