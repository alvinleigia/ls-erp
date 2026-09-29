"use client"
import { withCrmRecordView, useCrmRecordView, CrmRecordForm, CrmSummarySection } from "./crm-record-view"
import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table"
import { DataTable } from "@/components/data-table"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/form-field"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { CrmCheckbox, CrmSelect } from "./crm-controls"
import { CrmPageHeader, CrmSurface, CrmFormActions, CrmActionBar, crmPageClass } from "./crm-page"
import { CrmSection } from "./crm-section"
import { CrmTablePagination } from "./crm-pagination"
import { RecordSelect } from "./record-select"

type Team = { id: string; name: string; workflow: string; archived: boolean; version: number; canManage?: boolean; _count?: { members: number } }
const base = "/crm/configuration/sales-teams"
const workflowName = (value: string) => value === "DIRECT" ? "Direct opportunities" : "Qualify enquiries first"
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init }), data = await response.json()
  if (!response.ok) throw new Error(data.error || "Unable to load sales teams.")
  return data
}

export function SalesTeamSelect({ value, selected, onChange, disabled, id = "salesTeamId", all = false, fieldScope = false }: { value: string; selected?: { id: string; name: string } | null; onChange: (id: string) => void; disabled?: boolean; id?: string; all?: boolean; fieldScope?: boolean }) {
  const [loaded, setLoaded] = React.useState<Team | null>(null)
  React.useEffect(() => {
    const controller = new AbortController()
    if (!value || all) return
    request<Team>(`/api/crm/sales-teams/${value}`, { signal: controller.signal }).then(team => { if (!controller.signal.aborted) setLoaded(team) }).catch(() => { if (!controller.signal.aborted) setLoaded(null) })
    return () => controller.abort()
  }, [value, all])
  return <FormField id={id} label="Sales team"><RecordSelect id={id} endpoint={all ? "/api/crm/sales-teams?includeArchived=true" : "/api/crm/sales-teams"} value={value} selected={selected?.id === value ? { value: selected.id, label: selected.name } : loaded?.id === value ? { value: loaded.id, label: loaded.name } : undefined} onChange={onChange} disabled={disabled} placeholder={all || fieldScope ? "All sales teams" : "No team (existing workflow)"} />{value && !disabled && <Button variant="link" size="sm" type="button" onClick={() => onChange("")}>{all || fieldScope ? "All teams" : "Clear team"}</Button>}{value && !all && !fieldScope && loaded?.id === value && <p className="text-xs text-muted-foreground">{workflowName(loaded.workflow)}. The salesperson must be a team member.</p>}</FormField>
}

export function SalesTeamList() {
  const [q, setQ] = React.useState({ q: "", archived: "false", page: 1, pageSize: 20 })
  const [data, setData] = React.useState<{ items: Team[]; total: number; canManage: boolean }>({ items: [], total: 0, canManage: false })
  const [loading, setLoading] = React.useState(true), [error, setError] = React.useState("")
  React.useEffect(() => {
    const controller = new AbortController(), timer = setTimeout(() => {
      setLoading(true); setError("")
      request<typeof data>(`/api/crm/sales-teams?${new URLSearchParams(Object.entries(q).map(([key, value]) => [key, String(value)]))}`, { signal: controller.signal }).then(setData).catch(error => { if (!controller.signal.aborted) { setError(error.message); setData({ items: [], total: 0, canManage: false }) } }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    }, 150)
    return () => { clearTimeout(timer); controller.abort() }
  }, [q])
  const columns = React.useMemo<ColumnDef<Team>[]>(() => [
    { accessorKey: "name", header: "Team", cell: ({ row }) => <Link className="underline" href={`${base}/${row.original.id}`}>{row.original.name}</Link> },
    { accessorKey: "workflow", header: "Sales workflow", cell: ({ row }) => workflowName(row.original.workflow) },
    { id: "members", header: "Members", cell: ({ row }) => row.original._count?.members ?? 0 },
  ], [])
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({ data: data.items, columns, getCoreRowModel: getCoreRowModel(), manualPagination: true, rowCount: data.total, state: { pagination: { pageIndex: q.page - 1, pageSize: q.pageSize } }, onPaginationChange: updater => setQ(previous => { const next = typeof updater === "function" ? updater({ pageIndex: previous.page - 1, pageSize: previous.pageSize }) : updater; return { ...previous, page: next.pageSize !== previous.pageSize ? 1 : next.pageIndex + 1, pageSize: next.pageSize } }) })
  return <div className={crmPageClass}><CrmPageHeader title="Sales teams" backHref="/crm/configuration" description="Organize salespeople and choose how each team starts its sales process." actions={data.canManage && <Button asChild><Link href={`${base}/new`}>New sales team</Link></Button>} /><CrmSurface>
    <div className="flex flex-wrap gap-3"><Input aria-label="Search sales teams" placeholder="Search teams..." value={q.q} onChange={event => setQ({ ...q, q: event.target.value, page: 1 })} className="min-w-0 flex-1 basis-48" /><CrmSelect aria-label="Team status" value={q.archived} onValueChange={archived => setQ({ ...q, archived, page: 1 })}><option value="false">Active</option><option value="true">Archived</option></CrmSelect></div>
    {error && <p role="alert" className="text-destructive">{error}</p>}<DataTable table={table} loading={loading} emptyMessage="No sales teams in this selection." /><CrmTablePagination table={table} totalRows={data.total} loading={loading} />
  </CrmSurface></div>
}

export const SalesTeamEditor = withCrmRecordView(SalesTeamEditorBody)
function SalesTeamEditorBody({ id }: { id?: string }) {
  const view = useCrmRecordView()!
  const router = useRouter()
  const [team, setTeam] = React.useState<Team>({ id: "", name: "", workflow: "ENQUIRY_FIRST", archived: false, version: 1 })
  const [original, setOriginal] = React.useState<Team | null>(null), [canManage, setCanManage] = React.useState(false)
  const [loading, setLoading] = React.useState(true), [saving, setSaving] = React.useState(false), [error, setError] = React.useState(""), [failed, setFailed] = React.useState(false), [confirm, setConfirm] = React.useState(false)
  React.useEffect(() => {
    const controller = new AbortController()
    Promise.all([request<{ canManage: boolean }>("/api/crm/sales-teams?pageSize=1", { signal: controller.signal }), id ? request<Team>(`/api/crm/sales-teams/${id}`, { signal: controller.signal }) : null]).then(([config, row]) => { setCanManage(config.canManage); if (row) { setTeam(row); setOriginal(row) } }).catch(error => { if (!controller.signal.aborted) { setError(error.message); setFailed(true) } }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [id])
  async function save() {
    setSaving(true); setError("")
    try {
      const row = await request<Team>(`/api/crm/sales-teams${id ? `/${id}` : ""}`, { method: id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: team.name, workflow: team.workflow, archived: team.archived, ...(id ? { version: team.version } : {}) }) })
      view.done(); setConfirm(false); setTeam(row); setOriginal(row)
      if (!id) router.push(`${base}/${row.id}`)
    } catch (error) { setError((error as Error).message) } finally { setSaving(false) }
  }
  if (loading) return <p>Loading sales team...</p>
  const dirty = !!original && (original.name !== team.name || original.workflow !== team.workflow || original.archived !== team.archived)
  return <div className={crmPageClass}><CrmPageHeader title={id ? team.name || "Sales team" : "New sales team"} backHref={base} actions={<CrmFormActions form="team-form" cancelHref={base} canSave={canManage} saving={saving} disabled={failed} saveLabel="Save sales team" />} />

    <CrmRecordForm id="team-form" saving={saving} error={error} disabled={!canManage || failed} fingerprint={team} initialSection="Team details"
      overview={original && <CrmSummarySection title="Team details" canEdit={canManage} fields={[{ label: "Name", value: original.name }, { label: "Workflow", value: workflowName(original.workflow) }, { label: "Status", value: original.archived ? "Archived" : "Active" }]}><p className="text-sm text-muted-foreground">Membership controls assignment. Staff retain access to their own sales records; managers can access records across the business.</p></CrmSummarySection>}
      tabs={id && canManage && !failed ? [{ value: "members", label: "Members", content: <TeamMembers id={id} team={team} disabled={saving || dirty || team.archived} onChange={row => { setTeam(row); setOriginal(row) }} /> }] : []} onSubmit={event => { event.preventDefault(); if (original && !original.archived && team.archived) setConfirm(true); else void save() }} className="space-y-5"><CrmSection title="Team details"><fieldset disabled={!canManage || saving || failed} className="grid gap-4 sm:grid-cols-2">
      <FormField id="team-name" label="Team name"><Input id="team-name" required maxLength={100} value={team.name} onChange={event => setTeam({ ...team, name: event.target.value })} /></FormField>
      <FormField id="team-workflow" label="Sales workflow"><CrmSelect id="team-workflow" value={team.workflow} onValueChange={workflow => setTeam({ ...team, workflow })}><option value="ENQUIRY_FIRST">Qualify enquiries first</option><option value="DIRECT">Direct opportunities</option></CrmSelect><p className="text-sm text-muted-foreground">{team.workflow === "DIRECT" ? "Create opportunities directly. Existing enquiries remain available for conversion." : "Create an enquiry, mark it Qualified, then convert it to an opportunity."}</p></FormField>
      <label className="flex items-center gap-2"><CrmCheckbox checked={team.archived} onChange={event => setTeam({ ...team, archived: event.target.checked })} />Archived</label>
    </fieldset></CrmSection><CrmSection title="Access and assignment"><p className="text-sm text-muted-foreground">Staff see their own sales records and assign work to themselves. Managers retain access across the business and can assign sales records to active team members. Membership does not share other members’ records. Existing records without a team keep their current workflow.</p></CrmSection></CrmRecordForm>

    <Dialog open={confirm} onOpenChange={open => { if (!saving) setConfirm(open) }}><DialogContent><DialogHeader><DialogTitle>Archive this sales team?</DialogTitle><DialogDescription>Existing records remain accessible. New records cannot be assigned to this team until it is restored.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" disabled={saving} onClick={() => setConfirm(false)}>Cancel</Button><Button loading={saving} onClick={() => void save()}>Archive team</Button></DialogFooter></DialogContent></Dialog>
  </div>
}

type Member = { id: string; name: string | null; role: string; status: string }
function TeamMembers({ id, team, disabled, onChange }: { id: string; team: Team; disabled: boolean; onChange: (row: Team) => void }) {
  const [data, setData] = React.useState<{ items: Member[]; total: number }>({ items: [], total: 0 }), [q, setQ] = React.useState({ page: 1, pageSize: 10 })
  const [userId, setUserId] = React.useState(""), [remove, setRemove] = React.useState<Member | null>(null), [error, setError] = React.useState(""), [saving, setSaving] = React.useState(false), [loading, setLoading] = React.useState(true)
  React.useEffect(() => {
    const controller = new AbortController(); setLoading(true)
    request<typeof data>(`/api/crm/sales-teams/${id}/members?page=${q.page}&pageSize=${q.pageSize}`, { signal: controller.signal }).then(setData).catch(error => { if (!controller.signal.aborted) setError(error.message) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [id, q, team.version])
  async function change(memberId: string, removing: boolean) {
    setSaving(true); setError("")
    try {
      onChange(await request<Team>(`/api/crm/sales-teams/${id}/members`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: memberId, version: team.version, remove: removing }) })); setUserId(""); setRemove(null); setQ(previous => ({ ...previous, page: 1 }))
    } catch (error) { setError((error as Error).message) } finally { setSaving(false) }
  }
  const columns = React.useMemo<ColumnDef<Member>[]>(() => [
    { accessorKey: "name", header: "Salesperson" }, { accessorKey: "role", header: "Role" }, { accessorKey: "status", header: "Status" },
    { id: "action", header: "Action", cell: ({ row }) => <Button variant="outline" disabled={disabled || saving} onClick={() => setRemove(row.original)}>Remove</Button> },
  ], [disabled, saving])
  const table = useReactTable({ data: data.items, columns, getCoreRowModel: getCoreRowModel(), manualPagination: true, rowCount: data.total, state: { pagination: { pageIndex: q.page - 1, pageSize: q.pageSize } }, onPaginationChange: updater => setQ(previous => { const next = typeof updater === "function" ? updater({ pageIndex: previous.page - 1, pageSize: previous.pageSize }) : updater; return { page: next.pageSize !== previous.pageSize ? 1 : next.pageIndex + 1, pageSize: next.pageSize } }) })
  return <CrmSection title="Team members" description="Save team changes before editing members. Reassign open sales records before removing a member.">
    {error && <p role="alert" className="text-destructive">{error}</p>}<div className="grid items-end gap-3 sm:grid-cols-[1fr_auto]"><FormField id="team-member" label="Add salesperson"><RecordSelect id="team-member" endpoint="/api/crm/assignees" value={userId} onChange={setUserId} disabled={disabled || saving} /></FormField><CrmActionBar><Button disabled={!userId || disabled} loading={saving} onClick={() => void change(userId, false)}>Add member</Button></CrmActionBar></div>
    <DataTable table={table} loading={loading} emptyMessage="Add members before assigning sales records to this team." /><CrmTablePagination table={table} totalRows={data.total} loading={loading} />
    <Dialog open={!!remove} onOpenChange={open => { if (!open && !saving) setRemove(null) }}><DialogContent><DialogHeader><DialogTitle>Remove {remove?.name}?</DialogTitle><DialogDescription>Open sales records must be reassigned first. Historical assignments remain unchanged.</DialogDescription></DialogHeader>{error && <p role="alert" className="text-destructive">{error}</p>}<DialogFooter><Button variant="outline" disabled={saving} onClick={() => setRemove(null)}>Cancel</Button><Button loading={saving} onClick={() => remove && void change(remove.id, true)}>Remove member</Button></DialogFooter></DialogContent></Dialog>
  </CrmSection>
}
