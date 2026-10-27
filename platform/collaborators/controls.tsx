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
import type { Collaborator } from "./contracts"

const base = "/users/collaborators", api = "/api/collaborators"
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init }), data = await response.json()
  if (!response.ok) throw new Error(data.error || "Unable to load collaborators.")
  return data
}
export function CollaboratorList() {
  const [query, setQuery] = React.useState({ q: "", status: "active", page: 1, pageSize: 20 })
  const [data, setData] = React.useState<ListResponse<Collaborator>>({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 1 })
  const [loading, setLoading] = React.useState(true), [error, setError] = React.useState("")
  React.useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      setLoading(true); setError("")
      request<ListResponse<Collaborator>>(`${api}?${new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]))}`, { signal: controller.signal })
        .then(result => { if (!controller.signal.aborted) setData(result) })
        .catch(error => { if (!controller.signal.aborted) { setError(error.message); setData(previous => ({ ...previous, items: [], total: 0, totalPages: 1 })) } })
        .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    }, 150)
    return () => { clearTimeout(timer); controller.abort() }
  }, [query])
  const columns = React.useMemo<ColumnDef<Collaborator>[]>(() => [
    { accessorKey: "name", header: "Collaborator", cell: ({ row }) => <Link className="underline" href={`${base}/${row.original.id}`}>{row.original.name}</Link> },
    { accessorKey: "code", header: "Code" }, { accessorKey: "classification", header: "Classification" },
    { accessorKey: "organizationName", header: "Organization" },
    { id: "supervisor", header: "Supervisor", cell: ({ row }) => <span>{row.original.supervisor.name || row.original.supervisor.email}{row.original.supervisor.status !== "ACTIVE" || !["ADMIN", "MANAGER"].includes(row.original.supervisor.role) ? " (unavailable)" : ""}</span> },
    { id: "status", header: "Status", cell: ({ row }) => row.original.archived ? "Archived" : "Active" },
  ], [])
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({ data: data.items, columns, getCoreRowModel: getCoreRowModel(), manualPagination: true, rowCount: data.total, state: { pagination: { pageIndex: query.page - 1, pageSize: query.pageSize } }, onPaginationChange: updater => setQuery(previous => { const next = typeof updater === "function" ? updater({ pageIndex: previous.page - 1, pageSize: previous.pageSize }) : updater; return { ...previous, page: next.pageSize !== previous.pageSize ? 1 : next.pageIndex + 1, pageSize: next.pageSize } }) })
  return <div className={pageClass}>
    <PageHeader title="External collaborators" description="Keep partners and their internal supervisors separate from employee profiles." actions={<Button asChild><Link href={`${base}/new`}>New collaborator</Link></Button>} />
    <p className="text-sm text-muted-foreground">Directory entries do not create a login or grant record access. Supervisor assignment does not share the supervisor&apos;s permissions.</p>
    <Surface><div className="flex flex-wrap gap-3"><Input aria-label="Search collaborators" placeholder="Search collaborators..." value={query.q} onChange={event => setQuery({ ...query, q: event.target.value, page: 1 })} className="min-w-0 flex-1 basis-48" /><Select aria-label="Collaborator status" value={query.status} onValueChange={status => setQuery({ ...query, status, page: 1 })}><option value="active">Active</option><option value="archived">Archived</option><option value="all">All statuses</option></Select></div>
      {error && <p role="alert" className="text-destructive">{error}</p>}<DataTable table={table} loading={loading} emptyMessage="No collaborators in this selection." /><TablePagination table={table} totalRows={data.total} loading={loading} />
    </Surface>
  </div>
}
const blank = { name: "", code: "", classification: "Partner", organizationName: "", email: "", phone: "", supervisorUserId: "", archived: false }
export function CollaboratorEditor({ id }: { id: string }) {
  const router = useRouter(), creating = id === "new"
  const [record, setRecord] = React.useState<Collaborator | null>(null), [form, setForm] = React.useState(blank)
  const [loading, setLoading] = React.useState(!creating), [saving, setSaving] = React.useState(false), [error, setError] = React.useState(""), [reload, setReload] = React.useState(0)
  React.useEffect(() => {
    if (creating) return
    const controller = new AbortController(); setLoading(true); setError("")
    request<Collaborator>(`${api}/${id}`, { signal: controller.signal }).then(row => {
      if (!controller.signal.aborted) { setRecord(row); setForm({ ...row, organizationName: row.organizationName || "", email: row.email || "", phone: row.phone || "" }) }
    }).catch(error => { if (!controller.signal.aborted) setError(error.message) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [creating, id, reload])
  async function save(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError("")
    try {
      const fields = { name: form.name, classification: form.classification, organizationName: form.organizationName.trim() || null, email: form.email.trim() || null, phone: form.phone.trim() || null, supervisorUserId: form.supervisorUserId }
      await request(creating ? api : `${api}/${id}`, { method: creating ? "POST" : "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(creating ? { ...fields, code: form.code } : { ...fields, archived: form.archived, version: record!.version }) })
      router.push(base)
    } catch (error) { setError((error as Error).message) } finally { setSaving(false) }
  }
  return <div className={pageClass}>
    <PageHeader title={creating ? "New collaborator" : "Edit collaborator"} description="An external partner is a separate identity. Contact email is not a login." backHref={base} actions={<FormActions form="collaborator" cancelHref={base} saving={saving} disabled={loading || (!creating && !record) || !form.supervisorUserId} saveLabel={creating ? "Create collaborator" : "Save changes"} />} />
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {!creating && <Button type="button" variant="outline" disabled={saving || loading} onClick={() => setReload(value => value + 1)}>Reload saved details</Button>}
    {loading ? <p>Loading collaborator...</p> : (creating || record) && <Surface><form id="collaborator" onSubmit={save}><fieldset disabled={saving} className="grid min-w-0 gap-5 sm:grid-cols-2">
      <FormField id="collaborator-name" label="Collaborator name"><Input id="collaborator-name" required maxLength={160} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></FormField>
      <FormField id="collaborator-code" label="Code"><Input id="collaborator-code" required maxLength={32} pattern="[A-Za-z0-9][A-Za-z0-9_-]{0,31}" disabled={!creating} value={form.code} onChange={event => setForm({ ...form, code: event.target.value.toUpperCase() })} /><p className="text-xs text-muted-foreground">A stable identifier that cannot be changed after creation.</p></FormField>
      <FormField id="collaborator-classification" label="Classification"><Input id="collaborator-classification" required maxLength={80} value={form.classification} onChange={event => setForm({ ...form, classification: event.target.value })} /><p className="text-xs text-muted-foreground">For example, Channel partner, Agent or Consultant.</p></FormField>
      <FormField id="collaborator-organization" label="Organization name"><Input id="collaborator-organization" maxLength={160} value={form.organizationName} onChange={event => setForm({ ...form, organizationName: event.target.value })} /><p className="text-xs text-muted-foreground">Optional agency or business name; this does not create a company or account.</p></FormField>
      <FormField id="collaborator-email" label="Contact email"><Input id="collaborator-email" type="email" maxLength={254} value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} /></FormField>
      <FormField id="collaborator-phone" label="Phone"><Input id="collaborator-phone" maxLength={40} value={form.phone} onChange={event => setForm({ ...form, phone: event.target.value })} /></FormField>
      <FormField id="collaborator-supervisor" label="Internal supervisor"><RecordSelect id="collaborator-supervisor" endpoint={`${api}/supervisors`} value={form.supervisorUserId} selected={record ? { value: record.supervisor.id, label: record.supervisor.name || record.supervisor.email } : undefined} onChange={supervisorUserId => setForm({ ...form, supervisorUserId })} placeholder="Choose an active manager or administrator" /><p className="text-xs text-muted-foreground">Responsibility only. Permissions, teams and office access are managed separately.</p>{record && (record.supervisor.status !== "ACTIVE" || !["ADMIN", "MANAGER"].includes(record.supervisor.role)) && <p className="text-sm text-muted-foreground">The saved supervisor is unavailable. Choose an active replacement before restoring this collaborator.</p>}</FormField>
      {!creating && <FormField id="collaborator-archived" label="Archived"><Checkbox id="collaborator-archived" checked={form.archived} onChange={event => setForm({ ...form, archived: event.target.checked })} /></FormField>}
    </fieldset></form></Surface>}
  </div>
}
