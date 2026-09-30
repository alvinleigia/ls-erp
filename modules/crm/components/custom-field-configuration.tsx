"use client"
import { withCrmRecordView, useCrmRecordView, CrmRecordForm, CrmSummarySection } from "./crm-record-view"
import { SalesTeamSelect } from "./sales-teams"
import * as React from "react"
import Link from "@/platform/access/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table"
import { DataTable } from "@/components/data-table"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/form-field"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { CrmCheckbox, CrmSelect, CrmTextarea } from "./crm-controls"
import { CrmPageHeader, CrmSurface, CrmFormActions, crmPageClass } from "./crm-page"
import { CrmSection } from "./crm-section"
import { CrmPagination, CrmTablePagination } from "./crm-pagination"
import { FieldControl } from "./custom-fields"
import { fieldScopes, fieldTypes, type FieldScope, type FieldValue } from "@/platform/custom-fields/validation"

const base = "/crm/configuration/custom-fields"
const scopeNames = { ENQUIRY: "Enquiries", OPPORTUNITY: "Opportunities", SALES: "Enquiries and opportunities", PROJECT: "Projects" }
const typeNames = { TEXT: "Text", NUMBER: "Number", DATE: "Date", BOOLEAN: "Yes / No", SELECT: "Single select" }
type Config = { salesTeamId: string | null; id?: string; scope: FieldScope; code: string; name: string; type: typeof fieldTypes[number]; helpText: string; position: number; required: boolean; visibility: "ALL" | "MANAGERS"; editability: "ALL" | "MANAGERS"; filterable: boolean; maxLength: number; minimum: string | null; maximum: string | null; defaultValue: FieldValue; archived: boolean; version?: number; options: { id?: string; name: string; archived: boolean }[] }
const empty: Config = { salesTeamId: null, scope: "SALES", code: "", name: "", type: "TEXT", helpText: "", position: 0, required: false, visibility: "ALL", editability: "ALL", filterable: false, maxLength: 2000, minimum: null, maximum: null, defaultValue: null, archived: false, options: [] }

export function CustomFieldList() {
  const [query, setQuery] = React.useState({ q: "", archived: "false", scope: "", page: 1, pageSize: 20 })
  const [data, setData] = React.useState<{ items: Config[]; total: number; canManage: boolean; scopes: FieldScope[] }>({ items: [], total: 0, canManage: false, scopes: [] })
  const [error, setError] = React.useState(""), [loading, setLoading] = React.useState(true)
  React.useEffect(() => {
    const controller = new AbortController(), timer = setTimeout(async () => {
      setLoading(true); setError("")
      try {
        const params = new URLSearchParams({ q: query.q, archived: query.archived, page: String(query.page), pageSize: String(query.pageSize), ...(query.scope ? { scope: query.scope } : {}) })
        const response = await fetch(`/api/crm/custom-fields?${params}`, { signal: controller.signal, cache: "no-store" }), result = await response.json()
        if (!response.ok) throw new Error(result.error || "Unable to load custom fields.")
        setData(result)
      } catch (error) { if (!controller.signal.aborted) { setError((error as Error).message); setData(previous => ({ ...previous, items: [], total: 0 })) } } finally { if (!controller.signal.aborted) setLoading(false) }
    }, 150)
    return () => { clearTimeout(timer); controller.abort() }
  }, [query])
  const columns = React.useMemo<ColumnDef<Config>[]>(() => [
    { accessorKey: "name", header: "Field", cell: ({ row }) => <Link className="font-medium underline underline-offset-4" href={`${base}/${row.original.id}`}>{row.original.name}</Link> },
    { accessorKey: "scope", header: "Applies to", cell: ({ row }) => scopeNames[row.original.scope] },
    { accessorKey: "type", header: "Type", cell: ({ row }) => typeNames[row.original.type] },
    { accessorKey: "required", header: "Required", cell: ({ row }) => row.original.required ? "New records" : "Optional" },
    { accessorKey: "visibility", header: "Visible to", cell: ({ row }) => row.original.visibility === "ALL" ? "All staff" : "Managers" },
  ], [])
  const table = useReactTable({ data: data.items, columns, getCoreRowModel: getCoreRowModel(), manualPagination: true, rowCount: data.total,
    state: { pagination: { pageIndex: query.page - 1, pageSize: query.pageSize } }, onPaginationChange: updater => setQuery(previous => { const next = typeof updater === "function" ? updater({ pageIndex: previous.page - 1, pageSize: previous.pageSize }) : updater; return { ...previous, page: next.pageSize !== previous.pageSize ? 1 : next.pageIndex + 1, pageSize: next.pageSize } }),
  })
  return <div className={crmPageClass}><CrmPageHeader title="Custom fields" description="Collect additional information using the same fields across your sales workflow." backHref="/crm/configuration" actions={data.canManage && <Button asChild><Link href={`${base}/new`}>New field</Link></Button>} />
    <CrmSurface><div className="flex flex-wrap gap-2"><Input className="min-w-0 flex-1 basis-48" aria-label="Search custom fields" placeholder="Search custom fields..." value={query.q} onChange={event => setQuery({ ...query, q: event.target.value, page: 1 })} />
      <CrmSelect aria-label="Record type" value={query.scope} onValueChange={scope => setQuery({ ...query, scope, page: 1 })}><option value="">All record types</option>{data.scopes.map(scope => <option key={scope} value={scope}>{scopeNames[scope]}</option>)}</CrmSelect>
      <CrmSelect aria-label="Field status" value={query.archived} onValueChange={archived => setQuery({ ...query, archived, page: 1 })}><option value="false">Active</option><option value="true">Archived</option></CrmSelect></div>
      {error && <p role="alert" className="text-destructive">{error}</p>}<DataTable table={table} loading={loading} emptyMessage="No custom fields in this selection." /><CrmTablePagination table={table} totalRows={data.total} loading={loading} />
    </CrmSurface></div>
}

export const CustomFieldEditor = withCrmRecordView(CustomFieldEditorBody)
function CustomFieldEditorBody({ id }: { id?: string }) {
  const view = useCrmRecordView()!
  const router = useRouter()
  const [value, setValue] = React.useState<Config>(empty), [scopes, setScopes] = React.useState<FieldScope[]>([])
  const [canManage, setCanManage] = React.useState(false), [loading, setLoading] = React.useState(true), [saving, setSaving] = React.useState(false), [failed, setFailed] = React.useState(false)
  const [error, setError] = React.useState(""), [confirm, setConfirm] = React.useState(false), [original, setOriginal] = React.useState<Config | null>(null), [optionPage, setOptionPage] = React.useState(1)
  const [revision, setRevision] = React.useState(0)
  React.useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError(""); setFailed(false)
    async function get(url: string) { const response = await fetch(url, { signal: controller.signal, cache: "no-store" }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Unable to load custom field."); return data }
    Promise.all([get("/api/crm/custom-fields?pageSize=1"), id ? get(`/api/crm/custom-fields/${id}`) : null]).then(([config, record]) => {
      setScopes(config.scopes); setCanManage(config.canManage)
      if (record) { setValue(record); setOriginal(record) }
    }).catch(error => { if (!controller.signal.aborted) { setError(error.message); setFailed(true) } }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [id, revision])
  const change = <K extends keyof Config>(key: K, next: Config[K]) => setValue(previous => ({ ...previous, [key]: next }))
  async function save() {
    setSaving(true); setError("")
    try {
      const payload = Object.fromEntries(Object.keys(empty).map(key => [key, value[key as keyof Config]]))
      payload.options = value.options.map(({ id, name, archived }) => ({ ...(id ? { id } : {}), name, archived }))
      if (id) payload.version = value.version
      const response = await fetch(`/api/crm/custom-fields${id ? `/${id}` : ""}`, { method: id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }), data = await response.json()
      if (!response.ok) throw new Error(data.error || "Check the field settings.")
      view.done(); toast.success("Custom field saved."); router.push(base)
    } catch (error) { setError((error as Error).message); setConfirm(false) } finally { setSaving(false) }
  }
  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (original && (value.archived !== original.archived || value.options.some(option => option.archived && original.options.some(old => old.id === option.id && !old.archived)))) setConfirm(true)
    else void save()
  }
  return <div className={crmPageClass}><CrmPageHeader title={id ? original?.name || "Custom field" : "New custom field"} backHref={base} description="Up to 50 fields per record type, including archived fields. Shared sales fields copy from enquiries to opportunities." actions={<CrmFormActions form="custom-field-form" cancelHref={base} canSave={canManage} disabled={loading || failed} saving={saving} saveLabel="Save field"><Button variant="outline" disabled={saving} onClick={() => setRevision(value => value + 1)}>Refresh</Button></CrmFormActions>} />
    {loading ? <p>Loading custom field...</p> : <CrmRecordForm id="custom-field-form" saving={saving} error={error} disabled={!canManage || failed} fingerprint={value} initialSection="Field details"
      overview={original && <>
        <CrmSummarySection title="Field details" canEdit={canManage} fields={[{ label: "Name", value: original.name }, { label: "Code", value: original.code }, { label: "Record type", value: original.scope }, { label: "Field type", value: original.type }, { label: "Help text", value: original.helpText }]} />
        <CrmSummarySection title="Rules and access" canEdit={canManage} fields={[{ label: "Visible to", value: original.visibility === "ALL" ? "All staff with record access" : "Managers only" }, { label: "Editable by", value: original.editability === "ALL" ? "All staff with record access" : "Managers only" }, { label: "Display order", value: original.position }, { label: "Default value", value: original.defaultValue === null ? "None" : String(original.defaultValue) }, ...(original.type === "TEXT" ? [{ label: "Maximum characters", value: original.maxLength }] : original.type === "NUMBER" ? [{ label: "Minimum", value: original.minimum }, { label: "Maximum", value: original.maximum }] : []), { label: "Required", value: original.required ? "Yes" : "No" }, { label: "Available in filters", value: original.filterable ? "Yes" : "No" }, { label: "Status", value: original.archived ? "Archived" : "Active" }]} />
        {original.type === "SELECT" && <CrmSummarySection title="Options" canEdit={canManage} fields={original.options.map((option, index) => ({ label: `Option ${index + 1}`, value: `${option.name}${option.archived ? " (archived)" : ""}` }))} />}
      </>} className="space-y-5" onSubmit={submit}><fieldset disabled={!canManage || failed || saving} className="space-y-5">
      <CrmSection title="Field details" description="Record type, code and field type are fixed after creation."><div className="grid gap-4 sm:grid-cols-2">
        <FormField id="field-name" label="Name"><Input id="field-name" required maxLength={100} value={value.name} onChange={event => change("name", event.target.value)} /></FormField>
        {value.scope !== "PROJECT" && <SalesTeamSelect fieldScope value={value.salesTeamId || ""} disabled={!!id} onChange={salesTeamId => change("salesTeamId", salesTeamId || null)} />}
        <FormField id="field-code" label="Field code"><Input id="field-code" required disabled={!!id} pattern="[a-z][a-z0-9_]{0,49}" placeholder="e.g. preferred_location" value={value.code} onChange={event => change("code", event.target.value)} /></FormField>
        <FormField id="field-scope" label="Applies to"><CrmSelect id="field-scope" className="w-full" disabled={!!id} value={value.scope} onValueChange={scope => setValue({ ...value, scope: scope as FieldScope, ...(scope === "PROJECT" ? { salesTeamId: null } : {}) })}>{fieldScopes.filter(scope => scopes.includes(scope)).map(scope => <option key={scope} value={scope}>{scopeNames[scope]}</option>)}</CrmSelect></FormField>
        <FormField id="field-type" label="Type"><CrmSelect id="field-type" className="w-full" disabled={!!id} value={value.type} onValueChange={type => setValue({ ...value, type: type as Config["type"], options: [], defaultValue: type === "BOOLEAN" ? false : null })}>{fieldTypes.map(type => <option key={type} value={type}>{typeNames[type]}</option>)}</CrmSelect></FormField>
        <FormField id="field-order" label="Display order"><Input id="field-order" type="number" required min={0} max={1000000} value={value.position} onChange={event => change("position", Number(event.target.value))} /></FormField>
        <FormField id="field-status" label="Status"><CrmSelect id="field-status" className="w-full" value={value.archived ? "archived" : "active"} onValueChange={next => change("archived", next === "archived")}><option value="active">Active</option><option value="archived">Archived</option></CrmSelect></FormField>
        <FormField id="field-help" label="Help text" className="sm:col-span-2"><CrmTextarea id="field-help" maxLength={500} value={value.helpText} onChange={event => change("helpText", event.target.value)} /></FormField>
      </div></CrmSection>
      <CrmSection title="Rules and access" description="Required applies to records created after it is enabled. Existing values keep their saved labels and remain editable after limits change."><div className="grid gap-4 sm:grid-cols-2">
        <FormField id="field-visibility" label="Visible to"><CrmSelect id="field-visibility" className="w-full" value={value.visibility} onValueChange={next => change("visibility", next as Config["visibility"])}><option value="ALL">All staff with record access</option><option value="MANAGERS">Managers only</option></CrmSelect></FormField>
        <FormField id="field-editability" label="Editable by"><CrmSelect id="field-editability" className="w-full" value={value.editability} onValueChange={next => change("editability", next as Config["editability"])}><option value="ALL">All staff with edit access</option><option value="MANAGERS">Managers only</option></CrmSelect></FormField>
        <label className="flex items-center gap-2 text-sm"><CrmCheckbox checked={value.required} onChange={event => change("required", event.target.checked)} />Required for new records</label>
        <label className="flex items-center gap-2 text-sm"><CrmCheckbox checked={value.filterable} onChange={event => change("filterable", event.target.checked)} />Allow filtering</label>
        {value.type === "TEXT" && <FormField id="field-length" label="Maximum characters"><Input id="field-length" type="number" min={1} max={2000} required value={value.maxLength} onChange={event => change("maxLength", Number(event.target.value))} /></FormField>}
        {value.type === "NUMBER" && <>{(["minimum", "maximum"] as const).map(key => <FormField key={key} id={`field-${key}`} label={key === "minimum" ? "Minimum" : "Maximum"}><Input id={`field-${key}`} type="number" step="0.000001" value={value[key] ?? ""} onChange={event => change(key, event.target.value || null)} /></FormField>)}</>}
        <FormField id="field-default" label="Default value"><FieldControl id="field-default" field={{ ...value, options: value.options.filter(option => option.id).map(option => ({ ...option, id: option.id! })) }} value={value.defaultValue} onChange={next => change("defaultValue", next)} />{value.defaultValue !== null && <Button type="button" variant="link" size="sm" onClick={() => change("defaultValue", null)}>Clear default</Button>}{value.type === "SELECT" && <p className="text-xs text-muted-foreground">Save new options first, then reopen this field to choose a default.</p>}</FormField>
      </div></CrmSection>
      {value.type === "SELECT" && <CrmSection title="Options" description="Up to 50 options. Archive used options to keep existing selections readable." actions={<Button type="button" variant="outline" disabled={value.options.length >= 50} onClick={() => { change("options", [...value.options, { name: "", archived: false }]); setOptionPage(Math.floor(value.options.length / 10) + 1) }}>Add option</Button>}>
        <div className="space-y-3">{value.options.slice((optionPage - 1) * 10, optionPage * 10).map((option, offset) => { const index = (optionPage - 1) * 10 + offset; return <div key={option.id || index} className="flex flex-wrap items-end gap-3 rounded-lg border p-3"><FormField className="min-w-0 flex-1 basis-48" id={`option-${index}`} label={`Option ${index + 1}`}><Input id={`option-${index}`} required maxLength={100} value={option.name} onChange={event => change("options", value.options.map((row, i) => i === index ? { ...row, name: event.target.value } : row))} /></FormField><label className="flex items-center gap-2 pb-2 text-sm"><CrmCheckbox checked={option.archived} onChange={event => change("options", value.options.map((row, i) => i === index ? { ...row, archived: event.target.checked } : row))} />Archived</label>{!option.id && <Button type="button" variant="ghost" onClick={() => { change("options", value.options.filter((_, i) => i !== index)); setOptionPage(1) }}>Remove</Button>}</div> })}</div>
        <CrmPagination page={optionPage} pageSize={10} total={value.options.length} onPageChange={setOptionPage} />
      </CrmSection>}
    </fieldset></CrmRecordForm>}
    <Dialog open={confirm} onOpenChange={open => { if (!saving) setConfirm(open) }}><DialogContent><DialogHeader><DialogTitle>Save archive changes?</DialogTitle><DialogDescription>Archived fields and options remain on existing records and are unavailable for new selections.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" disabled={saving} onClick={() => setConfirm(false)}>Cancel</Button><Button loading={saving} onClick={() => void save()}>Confirm and save</Button></DialogFooter></DialogContent></Dialog>
  </div>
}
