"use client"
import * as React from "react"
import { useRouter } from "next/navigation"
import { useBusinessModules } from "@/platform/module-provider"
import { AccessPageHeader, AccessFormActions } from "@/platform/access/record-page"
import { AccessRecordForm, AccessSummarySection, withRecordView, useRecordView } from "@/platform/access/record-view"
import { pageClass } from "@/components/erp/page"
import { Section } from "@/components/erp/section"
import { Select, Textarea, Checkbox } from "@/components/erp/controls"
import { FormField } from "@/components/form-field"
import { Input } from "@/components/ui/input"
import { SearchableSelect } from "@/components/searchable-select"
import { catalogItemSchema, type CatalogInput } from "../validation"
import { catalogKindLabels, catalogAvailabilityLabels } from "../labels"
import { formatDecimalCurrency } from "@/lib/formatting"
import type { AppSettingsPayload } from "@/types/scheduling"
export type CatalogFieldsProps = { value: unknown; onChange: (value: unknown) => void; disabled: boolean }
export type CatalogEditorExtension = { key: string; label: string; canEdit: boolean; serialize: (value: unknown) => unknown; Fields: React.ComponentType<CatalogFieldsProps> }
const initial: CatalogInput = { name: "", code: "", description: "", kind: "PRODUCT", unit: "unit", price: "0", currency: "", availability: "AVAILABLE", archived: false, extensionKey: null }
export const CatalogEditor = withRecordView(function CatalogEditor({ id, extension, defaults }: { id?: string; extension?: CatalogEditorExtension; defaults?: Pick<CatalogInput, "extensionKey" | "extension"> }) {
  const [value, setValue] = React.useState({ ...initial, ...(defaults ? { ...defaults, kind: "UNIT" as const } : {}) }), [loading, setLoading] = React.useState(true), [error, setError] = React.useState(""), [failed, setFailed] = React.useState(false), [saving, setSaving] = React.useState(false), [canManage, setCanManage] = React.useState(false)
  const router = useRouter(), view = useRecordView()!, modules = useBusinessModules()
  const [display, setDisplay] = React.useState<AppSettingsPayload>()
  const set = <K extends keyof CatalogInput>(key: K, next: CatalogInput[K]) => setValue(v => ({ ...v, [key]: next }))
  React.useEffect(() => {
    const controller = new AbortController()
    async function load() {
      const response = await fetch(id ? `/api/catalog/items/${id}` : "/api/catalog/items?pageSize=1", { signal: controller.signal, cache: "no-store" })
      const row = await response.json(); if (!response.ok) throw Error(row.error || "Unable to load item.")
      if (controller.signal.aborted) return
      if (id) setValue({ ...initial, ...row, price: String(row.price) })
      const displayResponse = await fetch("/api/settings/display", { signal: controller.signal, cache: "no-store" })
      if (displayResponse.ok) {
        const settings = await displayResponse.json()
        if (!controller.signal.aborted) { setDisplay(settings.settings); if (!id) setValue(v => ({ ...v, currency: settings.settings?.currency || "" })) }
      }
      setCanManage(id ? row.canManage : row.canCreate)
    }
    load().catch(e => { if (!controller.signal.aborted) { setError(e.message); setFailed(true) } }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [id])
  const editable = !failed && canManage && modules.enabled("catalog") && (!value.extensionKey || (extension?.key === value.extensionKey && extension.canEdit))
  async function save(event: React.FormEvent) {
    event.preventDefault(); setError("")
    // Only editable contract fields are sent; response metadata is never submitted.
    const payload = Object.fromEntries(Object.keys(initial).concat(["version", "extension"]).map(k => [k, value[k as keyof CatalogInput]]))
    if (value.extensionKey && extension) payload.extension = extension.serialize(value.extension)
    const parsed = catalogItemSchema.safeParse(payload)
    if (!parsed.success) { setError(parsed.error.issues[0].message); return }
    setSaving(true)
    try {
      const response = await fetch(`/api/catalog/items${id ? `/${id}` : ""}`, { method: id ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) })
      const row = await response.json()
      if (!response.ok) {
        const detail = Object.entries(row.details?.fieldErrors || {}).find(([, errors]) => Array.isArray(errors) && errors.length)
        throw Error(detail ? `${detail[0]}: ${(detail[1] as string[])[0]}` : row.error || "Unable to save item.")
      }
      if (!id) router.push(`/catalog/${row.id}`)
      else {
        setValue(v => ({ ...v, version: row.version }))
        const refresh = await fetch(`/api/catalog/items/${id}`, { cache: "no-store" })
        if (refresh.ok) { const current = await refresh.json(); setValue({ ...initial, ...current, price: String(current.price) }) }
        view.done()
      }
    } catch (e) { setError((e as Error).message) } finally { setSaving(false) }
  }
  if (loading) return <p>Loading item...</p>
  return <div className={pageClass}><AccessPageHeader title={id ? value.name : "New catalog item"} backHref="/catalog" actions={<AccessFormActions form="catalog-form" cancelHref="/catalog" saving={saving} disabled={!editable} canSave={canManage} saveLabel="Save item" />} />
    <AccessRecordForm id="catalog-form" onSubmit={save} initialSection="Item details" saving={saving} disabled={!editable} error={error} fingerprint={value} saveLabel="Save item" overview={<><AccessSummarySection title="Item details" canEdit={editable} fields={[{ label: "Code", value: value.code }, { label: "Name", value: value.name }, { label: "Kind", value: catalogKindLabels[value.kind] }, { label: "Price", value: value.currency ? formatDecimalCurrency(value.price, value.currency, display) : value.price }, { label: "Unit", value: value.unit }, { label: "Availability", value: catalogAvailabilityLabels[value.availability] }, { label: "Status", value: value.archived ? "Archived" : "Active" }, { label: "Description", value: value.description }]} />{value.extensionKey && extension && <AccessSummarySection title={extension.label} canEdit={editable} fields={[]}><extension.Fields value={value.extension} onChange={() => {}} disabled /></AccessSummarySection>}</>}>
      <Section title="Item details"><fieldset disabled={!editable || saving} className="grid gap-5 sm:grid-cols-2">
        <FormField id="item-code" label="Unique code"><Input id="item-code" value={value.code} required maxLength={60} onChange={e => set("code", e.target.value)} /></FormField>
        <FormField id="item-name" label="Name"><Input id="item-name" value={value.name} required maxLength={200} onChange={e => set("name", e.target.value)} /></FormField>
        <FormField id="item-kind" label="Kind"><Select id="item-kind" value={value.kind} disabled={!!id || !!value.extensionKey} onValueChange={v => set("kind", v as CatalogInput["kind"])}><option value="PRODUCT">Product (repeatable)</option><option value="UNIT">Unit (unique item)</option></Select></FormField>
        {!id && extension?.canEdit && <FormField id="item-extension" label="Additional details"><Select id="item-extension" value={value.extensionKey || ""} onValueChange={key => setValue(v => ({ ...v, extensionKey: key || null, extension: undefined, kind: key ? "UNIT" : v.kind }))}><option value="">Standard item</option><option value={extension.key}>{extension.label}</option></Select></FormField>}
        <FormField id="item-price" label="Price"><Input id="item-price" value={value.price} inputMode="decimal" required onChange={e => set("price", e.target.value)} /></FormField>
        <FormField id="item-currency" label="Currency"><SearchableSelect id="item-currency" placeholder="Choose currency" disabled={!editable || saving} value={value.currency} options={Intl.supportedValuesOf("currency").map(value => ({ value, label: value }))} onChange={v => set("currency", v)} /></FormField>
        <FormField id="item-unit" label="Price unit"><Input id="item-unit" value={value.unit} required maxLength={40} onChange={e => set("unit", e.target.value)} /></FormField>
        <FormField id="item-availability" label="Availability"><Select id="item-availability" value={value.availability} onValueChange={v => set("availability", v as CatalogInput["availability"])}><option value="AVAILABLE">Available</option><option value="UNAVAILABLE">Unavailable</option>{value.kind === "UNIT" && <option value="SOLD">Sold</option>}</Select></FormField>
        <FormField id="item-description" label="Description"><Textarea id="item-description" value={value.description} maxLength={5000} onChange={e => set("description", e.target.value)} /></FormField>
        <label className="flex items-center gap-2"><Checkbox checked={value.archived} disabled={!modules.can("catalogItems.archive")} onChange={e => set("archived", e.target.checked)} />Archived</label>
      </fieldset></Section>
      {extension && value.extensionKey === extension.key && <Section title={extension.label}><extension.Fields value={value.extension} onChange={v => set("extension", v)} disabled={!editable || saving} /></Section>}
    </AccessRecordForm></div>
})
