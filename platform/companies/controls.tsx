"use client"
import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table"
import { DataTable } from "@/components/data-table"
import { FormField } from "@/components/form-field"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox, Select } from "@/components/erp/controls"
import { PageHeader, FormActions, Surface, pageClass } from "@/components/erp/page"
import { TablePagination } from "@/components/erp/pagination"
import { RecordSelect } from "@/components/erp/record-select"
import type { ListResponse } from "@/types/api"
import type { Company, Office } from "./contracts"

type Kind = "company" | "office"
const paths = { company: { api: "/api/companies", page: "/settings/companies", singular: "Company", plural: "Companies" }, office: { api: "/api/offices", page: "/settings/offices", singular: "Office", plural: "Offices" } }
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init }), data = await response.json()
  if (!response.ok) throw new Error(data.error || "Unable to load company structure.")
  return data
}
export function CompanyStructureList({ kind }: { kind: Kind }) {
  const path = paths[kind]
  const [query, setQuery] = React.useState({ q: "", status: "active", page: 1, pageSize: 20 })
  const [data, setData] = React.useState<ListResponse<Company | Office>>({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 1 })
  const [loading, setLoading] = React.useState(true), [error, setError] = React.useState("")
  React.useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      setLoading(true); setError("")
      request<typeof data>(`${path.api}?${new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]))}`, { signal: controller.signal })
        .then(setData).catch(error => { if (!controller.signal.aborted) { setError(error.message); setData(previous => ({ ...previous, items: [], total: 0 })) } })
        .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    }, 150)
    return () => { clearTimeout(timer); controller.abort() }
  }, [query, path.api])
  const columns = React.useMemo<ColumnDef<Company | Office>[]>(() => [
    { accessorKey: "name", header: path.singular, meta: { label: path.singular }, cell: ({ row }) => <Link href={`${path.page}/${row.original.id}`} className="underline">{row.original.name}</Link> },
    { accessorKey: "code", header: "Code", meta: { label: "Code" } },
    { id: "parent", header: kind === "company" ? "Parent company" : "Company", meta: { label: kind === "company" ? "Parent company" : "Company" }, cell: ({ row }) => ("company" in row.original ? row.original.company.name : row.original.parent?.name) || "Independent company" },
    { id: "status", header: "Status", meta: { label: "Status" }, cell: ({ row }) => row.original.archived ? "Archived" : row.original.isInitial ? "Active · Initial" : "Active" },
  ], [kind, path])
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({ data: data.items, columns, getCoreRowModel: getCoreRowModel(), manualPagination: true, rowCount: data.total, state: { pagination: { pageIndex: query.page - 1, pageSize: query.pageSize } }, onPaginationChange: updater => setQuery(previous => { const next = typeof updater === "function" ? updater({ pageIndex: previous.page - 1, pageSize: previous.pageSize }) : updater; return { ...previous, page: next.pageSize !== previous.pageSize ? 1 : next.pageIndex + 1, pageSize: next.pageSize } }) })
  return <div className={pageClass}>
    <PageHeader title="Companies and offices" description="Define your operating companies, subsidiaries and their offices." backHref="/settings" actions={<Button asChild><Link href={`${path.page}/new`}>New {kind}</Link></Button>} />
    <nav aria-label="Company structure" className="flex gap-2"><Button asChild variant={kind === "company" ? "default" : "outline"}><Link href="/settings/companies">Companies</Link></Button><Button asChild variant={kind === "office" ? "default" : "outline"}><Link href="/settings/offices">Offices</Link></Button></nav>
    <p className="text-sm text-muted-foreground">This directory defines your business structure. Office membership, record permissions and employee workplace assignments are configured separately.</p>
    <Surface><div className="flex flex-wrap gap-3"><Input aria-label={`Search ${path.plural.toLowerCase()}`} placeholder={`Search ${path.plural.toLowerCase()}...`} value={query.q} onChange={event => setQuery({ ...query, q: event.target.value, page: 1 })} className="min-w-0 flex-1 basis-48" /><Select aria-label="Structure status" value={query.status} onValueChange={status => setQuery({ ...query, status, page: 1 })}><option value="active">Active</option><option value="archived">Archived</option><option value="all">All statuses</option></Select></div>
      {error && <p role="alert" className="text-destructive">{error}</p>}<DataTable table={table} loading={loading} emptyMessage={`No ${path.plural.toLowerCase()} in this selection.`} /><TablePagination table={table} totalRows={data.total} loading={loading} />
    </Surface>
  </div>
}

export function CompanyStructureEditor({ kind, id }: { kind: Kind; id: string }) {
  const router = useRouter(), path = paths[kind], creating = id === "new"
  const [record, setRecord] = React.useState<Company | Office | null>(null)
  const [form, setForm] = React.useState({ name: "", code: "", parentId: "", companyId: "", archived: false })
  const [loading, setLoading] = React.useState(!creating), [saving, setSaving] = React.useState(false), [error, setError] = React.useState("")
  React.useEffect(() => {
    if (creating) return
    const controller = new AbortController()
    request<Company | Office>(`${path.api}/${id}`, { signal: controller.signal }).then(row => {
      setRecord(row); setForm({ name: row.name, code: row.code, archived: row.archived, parentId: "parentId" in row ? row.parentId || "" : "", companyId: "companyId" in row ? row.companyId : "" })
    }).catch(error => { if (!controller.signal.aborted) setError(error.message) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [creating, id, path.api])
  async function save(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError("")
    try {
      const body = creating ? { name: form.name, code: form.code, ...(kind === "company" ? { parentId: form.parentId || null } : { companyId: form.companyId }) }
        : { name: form.name, archived: form.archived, version: record!.version, ...(kind === "company" ? { parentId: form.parentId || null } : {}) }
      await request(creating ? path.api : `${path.api}/${id}`, { method: creating ? "POST" : "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      router.push(path.page)
    } catch (error) { setError((error as Error).message) } finally { setSaving(false) }
  }
  return <div className={pageClass}><PageHeader title={`${creating ? "New" : "Edit"} ${kind}`} description={kind === "company" ? "A company represents a legal or operating business. A subsidiary can have a parent company." : "An office is a location or regional branch of one company."} backHref={path.page} actions={<FormActions form="company-structure" cancelHref={path.page} saving={saving} disabled={loading || (!creating && !record) || (kind === "office" && !form.companyId)} saveLabel={creating ? `Create ${kind}` : "Save changes"} />} />
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {loading ? <p>Loading {kind}...</p> : (creating || record) && <Surface><form id="company-structure" onSubmit={save} className="space-y-5"><fieldset disabled={saving} className="grid min-w-0 gap-5 sm:grid-cols-2">
      <FormField id="structure-name" label={`${path.singular} name`}><Input id="structure-name" required maxLength={160} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></FormField>
      <FormField id="structure-code" label="Code"><Input id="structure-code" required maxLength={32} pattern="[A-Za-z0-9][A-Za-z0-9_-]{0,31}" disabled={!creating} value={form.code} onChange={event => setForm({ ...form, code: event.target.value.toUpperCase() })} /><p className="text-xs text-muted-foreground">A stable identifier. It cannot be changed after creation.</p></FormField>
      {kind === "company" ? <FormField id="structure-parent" label="Parent company"><RecordSelect id="structure-parent" endpoint="/api/companies" showCode value={form.parentId} selected={record && "parent" in record && record.parent ? { value: record.parent.id, label: record.parent.name } : undefined} onChange={parentId => setForm({ ...form, parentId })} placeholder="Independent company" />{form.parentId && <Button type="button" size="sm" variant="link" onClick={() => setForm({ ...form, parentId: "" })}>Clear parent company</Button>}</FormField>
        : <FormField id="structure-company" label="Company"><RecordSelect id="structure-company" endpoint="/api/companies" showCode value={form.companyId} selected={record && "company" in record ? { value: record.company.id, label: record.company.name } : undefined} disabled={!creating} onChange={companyId => setForm({ ...form, companyId })} placeholder="Choose company" /><p className="text-xs text-muted-foreground">An office stays with the company it was created for.</p></FormField>}
      {!creating && <FormField id="structure-archived" label="Archived"><Checkbox id="structure-archived" disabled={record?.isInitial} checked={form.archived} onChange={event => setForm({ ...form, archived: event.target.checked })} />{record?.isInitial && <p className="text-xs text-muted-foreground">The initial {kind} must remain active.</p>}</FormField>}
    </fieldset></form></Surface>}
  </div>
}
