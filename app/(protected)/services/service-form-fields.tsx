"use client"

import * as React from "react"
import { useCurrentResourceAction } from "@/platform/access/view-guard"
import { FormField } from "@/components/form-field"
import { RecordSelect } from "@/components/erp/record-select"
import { Select, Textarea, Checkbox } from "@/components/erp/controls"
import { Section } from "@/components/erp/section"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import type { ServiceFormValues, ServiceOption } from "@/types/services"
import type { TaxRow } from "@/types/scheduling"
import { serviceStatusOptions, serviceTypeOptions } from "./service-form-model"

type ServiceFormFieldsProps = {
  mode: "create" | "edit"
  values: ServiceFormValues
  errors: Record<string, string>
  selectedCategory?: ServiceOption
  selectedServices?: ServiceOption[]
  taxOptions: TaxRow[]
  onChange: (next: ServiceFormValues) => void
}

export function ServiceFormFields({ mode, values, errors, selectedCategory, selectedServices = [], taxOptions, onChange }: ServiceFormFieldsProps) {
  const [pickedServices, setPickedServices] = React.useState<ServiceOption[]>(selectedServices)
  const [pickerKey, setPickerKey] = React.useState(0)
  const update = <K extends keyof ServiceFormValues>(key: K, value: ServiceFormValues[K]) => onChange({ ...values, [key]: value })
  const canArchive = useCurrentResourceAction("archive")
  const fieldId = (name: string) => `${mode}-${name}`

  return <>
    <Section title="Service details">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id={fieldId("service-name")} label="Name" error={errors.name}><Input id={fieldId("service-name")} required minLength={2} maxLength={120} value={values.name} onChange={event => update("name", event.target.value)} /></FormField>
        <FormField id={fieldId("service-category")} label="Category" error={errors.categoryId}>
          <RecordSelect id={fieldId("service-category")} endpoint="/api/service-categories" value={values.categoryId} selected={selectedCategory ? { value: selectedCategory.id, label: selectedCategory.name } : undefined} placeholder="Select a category" onChange={value => update("categoryId", value)} />
        </FormField>
        <FormField id={fieldId("service-type")} label="Type" error={errors.type}>
          <Select id={fieldId("service-type")} className="w-full" value={values.type} onValueChange={value => { const type = value as ServiceFormValues["type"]; onChange({ ...values, type, packageItemIds: type === "PACKAGE" ? values.packageItemIds : [] }) }}>
            {serviceTypeOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </Select>
        </FormField>
        <FormField id={fieldId("service-status")} label="Status" error={errors.status}>
          <Select disabled={!canArchive} id={fieldId("service-status")} className="w-full" value={values.status} onValueChange={value => update("status", value as ServiceFormValues["status"])}>
            {serviceStatusOptions.map(status => <option key={status} value={status}>{status === "ACTIVE" ? "Active" : "Inactive"}</option>)}
          </Select>
        </FormField>
      </div>
      <FormField id={fieldId("service-description")} label="Description" error={errors.description}><Textarea id={fieldId("service-description")} maxLength={1000} value={values.description} onChange={event => update("description", event.target.value)} /></FormField>
    </Section>
    <Section title="Pricing and duration">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id={fieldId("service-duration")} label="Duration (minutes)" error={errors.durationMinutes}><Input id={fieldId("service-duration")} required type="number" min={5} max={600} value={values.durationMinutes} onChange={event => update("durationMinutes", Number(event.target.value) || 0)} /></FormField>
        <FormField id={fieldId("service-price")} label="Price" error={errors.priceCents}><Input id={fieldId("service-price")} required type="number" min={0} max={10000} step="0.01" inputMode="decimal" value={values.price} onChange={event => update("price", event.target.value)} /></FormField>
      </div>
    </Section>
    <Section title="Default taxes">
      <FormField id={fieldId("service-tax-mode")} label="Tax mode" error={errors.taxMode}>
        <Select id={fieldId("service-tax-mode")} className="w-full" value={values.taxMode} onValueChange={value => update("taxMode", value as ServiceFormValues["taxMode"])}><option value="EXCLUSIVE">Exclusive (tax added on top)</option><option value="INCLUSIVE">Inclusive (price includes tax)</option></Select>
      </FormField>
      <FormField id={fieldId("service-taxes")} label="Taxes" error={errors.taxIds}>
        <div className="max-h-48 space-y-3 overflow-y-auto rounded-lg border p-3">
          {taxOptions.map(tax => <label key={tax.id} className="flex items-center gap-2 text-sm"><Checkbox checked={values.taxIds.includes(tax.id)} onChange={event => update("taxIds", event.target.checked ? [...new Set([...values.taxIds, tax.id])] : values.taxIds.filter(id => id !== tax.id))} /><span>{tax.name} ({tax.percent}%){tax.isActive ? "" : " - inactive"}</span></label>)}
          {!taxOptions.length && <p className="text-sm text-muted-foreground">No taxes available.</p>}
        </div>
      </FormField>
    </Section>
    {values.type === "PACKAGE" && <Section title="Package items" description="Search for services to include in this package.">
      <FormField id={fieldId("service-package-items")} label="Add a service" error={errors.packageItemIds}>
        <RecordSelect key={pickerKey} id={fieldId("service-package-items")} endpoint="/api/services?status=ACTIVE&type=STANDARD" value="" placeholder="Search services..." onChange={(id, option) => {
          if (!id || !option) return
          setPickedServices(previous => [...previous.filter(item => item.id !== id), { id, name: option.label }])
          update("packageItemIds", [...new Set([...values.packageItemIds, id])])
          setPickerKey(key => key + 1)
        }} />
      </FormField>
      <ul className="space-y-2">{values.packageItemIds.map(id => {
        const name = pickedServices.find(item => item.id === id)?.name || selectedServices.find(item => item.id === id)?.name || "Selected service"
        return <li key={id} className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm"><span className="min-w-0 break-words">{name}</span><Button type="button" size="sm" variant="ghost" aria-label={`Remove ${name}`} onClick={() => update("packageItemIds", values.packageItemIds.filter(value => value !== id))}>Remove</Button></li>
      })}</ul>
      {!values.packageItemIds.length && <p className="text-sm text-muted-foreground">No services added yet.</p>}
    </Section>}
  </>
}
