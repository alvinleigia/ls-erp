"use client"
import { useTerminology } from "@/platform/terminology/provider"
import type { TermResolver } from "@/platform/terminology/resolver"
import { withRecordView, useRecordView, AccessRecordForm, AccessSummarySection } from "@/platform/access/record-view"
import * as React from "react"
import Link from "@/platform/access/link"
import { useRouter } from "next/navigation"
import { getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table"
import { DataTable } from "@/components/data-table"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/form-field"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Checkbox, Select } from "@/components/erp/controls"
import { AccessPageHeader, AccessFormActions } from "@/platform/access/record-page"
import { Surface, ActionBar, pageClass } from "@/components/erp/page"
import { Section } from "@/components/erp/section"
import { TablePagination } from "@/components/erp/pagination"
import { RecordSelect } from "@/components/erp/record-select"

type Team = { id: string; name: string; workflow: string; archived: boolean; version: number; canReadMembers?: boolean; canManage?: boolean; canAssign?: boolean; canManageTeamAccess?: boolean; _count?: { members: number } }
const workflowName = (value: string, term: TermResolver) => value === "BOTH"
  ? `${term("crm.enquiry.plural", "Enquiries")} and direct ${term("crm.opportunity.plural", "opportunities")}`
  : value === "DIRECT" ? term("crm.opportunity.plural", "Direct opportunities only", "Direct {label} only") : term("crm.enquiry.plural", "Qualify enquiries first", "Qualify {label} first")
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init }), data = await response.json()
  if (!response.ok) throw new Error(data.error || "Unable to load sales teams.")
  return data
}

export function SalesTeamSelect({ value, selected, onChange, disabled, id = "salesTeamId", all = false, fieldScope = false }: { value: string; selected?: { id: string; name: string } | null; onChange: (id: string) => void; disabled?: boolean; id?: string; all?: boolean; fieldScope?: boolean }) {
  const term = useTerminology()
  const [loaded, setLoaded] = React.useState<Team | null>(null)
  React.useEffect(() => {
    const controller = new AbortController()
    if (!value || all) return
    request<Team>(`/api/crm/sales-teams/${value}`, { signal: controller.signal }).then(team => { if (!controller.signal.aborted) setLoaded(team) }).catch(() => { if (!controller.signal.aborted) setLoaded(null) })
    return () => controller.abort()
  }, [value, all])
  return <FormField id={id} label="Sales team"><RecordSelect id={id} endpoint={all ? "/api/crm/sales-teams?includeArchived=true" : "/api/crm/sales-teams"} value={value} selected={selected?.id === value ? { value: selected.id, label: selected.name } : loaded?.id === value ? { value: loaded.id, label: loaded.name } : undefined} onChange={onChange} disabled={disabled} placeholder={all || fieldScope ? "All sales teams" : "No team (existing workflow)"} />{value && !disabled && <Button variant="link" size="sm" type="button" onClick={() => onChange("")}>{all || fieldScope ? "All teams" : "Clear team"}</Button>}{value && !all && !fieldScope && loaded?.id === value && <p className="text-xs text-muted-foreground">{workflowName(loaded.workflow, term)}. The salesperson must be a team member.</p>}</FormField>
}

export function TeamList({ sales = true }: { sales?: boolean }) {
  const base = sales ? "/crm/configuration/sales-teams" : "/users/teams"
  const endpoint = sales ? "/api/crm/sales-teams" : "/api/teams"
  const term = useTerminology()
  const [q, setQ] = React.useState({ q: "", archived: "false", page: 1, pageSize: 20 })
  const [data, setData] = React.useState<{ items: Team[]; total: number; canManage: boolean }>({ items: [], total: 0, canManage: false })
  const [loading, setLoading] = React.useState(true), [error, setError] = React.useState("")
  React.useEffect(() => {
    const controller = new AbortController(), timer = setTimeout(() => {
      setLoading(true); setError("")
      request<typeof data>(`${endpoint}?${new URLSearchParams(Object.entries(q).map(([key, value]) => [key, String(value)]))}`, { signal: controller.signal }).then(setData).catch(error => { if (!controller.signal.aborted) { setError(error.message); setData({ items: [], total: 0, canManage: false }) } }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    }, 150)
    return () => { clearTimeout(timer); controller.abort() }
  }, [q, endpoint])
  const columns = React.useMemo<ColumnDef<Team>[]>(() => [
    { accessorKey: "name", header: "Team", cell: ({ row }) => <Link className="underline" href={`${base}/${row.original.id}`}>{row.original.name}</Link> },
    ...(sales ? [{ accessorKey: "workflow", header: "Sales workflow", cell: ({ row }: { row: { original: Team } }) => workflowName(row.original.workflow, term) }] : []),
    { id: "members", header: "Members", cell: ({ row }) => row.original._count?.members ?? 0 },
  ], [term, sales, base])
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({ data: data.items, columns, getCoreRowModel: getCoreRowModel(), manualPagination: true, rowCount: data.total, state: { pagination: { pageIndex: q.page - 1, pageSize: q.pageSize } }, onPaginationChange: updater => setQ(previous => { const next = typeof updater === "function" ? updater({ pageIndex: previous.page - 1, pageSize: previous.pageSize }) : updater; return { ...previous, page: next.pageSize !== previous.pageSize ? 1 : next.pageIndex + 1, pageSize: next.pageSize } }) })
  return <div className={pageClass}><AccessPageHeader title={sales ? "Sales teams" : "Business teams"} backHref={sales ? "/crm/configuration" : "/users"} description={sales ? "Organize salespeople and choose how each team starts its sales process." : "Manage shared teams, members and team managers across your business."} actions={data.canManage && <Button asChild><Link href={`${base}/new`}>{sales ? "New sales team" : "New team"}</Link></Button>} /><Surface>
    <div className="flex flex-wrap gap-3"><Input aria-label="Search sales teams" placeholder="Search teams..." value={q.q} onChange={event => setQ({ ...q, q: event.target.value, page: 1 })} className="min-w-0 flex-1 basis-48" /><Select aria-label="Team status" value={q.archived} onValueChange={archived => setQ({ ...q, archived, page: 1 })}><option value="false">Active</option><option value="true">Archived</option></Select></div>
    {error && <p role="alert" className="text-destructive">{error}</p>}<DataTable table={table} loading={loading} emptyMessage="No sales teams in this selection." /><TablePagination table={table} totalRows={data.total} loading={loading} />
  </Surface></div>
}

export const TeamEditor = withRecordView(TeamEditorBody)
function TeamEditorBody({ id, sales = true }: { id?: string; sales?: boolean }) {
  const base = sales ? "/crm/configuration/sales-teams" : "/users/teams"
  const endpoint = sales ? "/api/crm/sales-teams" : "/api/teams"
  const term = useTerminology()
  const view = useRecordView()!
  const router = useRouter()
  const [team, setTeam] = React.useState<Team>({ id: "", name: "", workflow: "BOTH", archived: false, version: 1 })
  const [original, setOriginal] = React.useState<Team | null>(null), [canManage, setCanManage] = React.useState(false)
  const [loading, setLoading] = React.useState(true), [saving, setSaving] = React.useState(false), [error, setError] = React.useState(""), [failed, setFailed] = React.useState(false), [confirm, setConfirm] = React.useState(false)
  React.useEffect(() => {
    const controller = new AbortController()
    Promise.all([request<{ canManage: boolean }>(`${endpoint}?pageSize=1`, { signal: controller.signal }), id ? request<Team>(`${endpoint}/${id}`, { signal: controller.signal }) : null]).then(([config, row]) => { setCanManage(row?.canManage ?? config.canManage); if (row) { setTeam(row); setOriginal(row) } }).catch(error => { if (!controller.signal.aborted) { setError(error.message); setFailed(true) } }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [id, endpoint])
  async function save() {
    setSaving(true); setError("")
    try {
      const row = await request<Team>(`${endpoint}${id ? `/${id}` : ""}`, { method: id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: team.name, ...(sales ? { workflow: team.workflow } : {}), archived: team.archived, ...(id ? { version: team.version } : {}) }) })
      view.done(); setConfirm(false); setTeam(row); setOriginal(row)
      if (!id) router.push(`${base}/${row.id}`)
    } catch (error) { setError((error as Error).message) } finally { setSaving(false) }
  }
  if (loading) return <p>Loading sales team...</p>
  const dirty = !!original && (original.name !== team.name || original.workflow !== team.workflow || original.archived !== team.archived)
  return <div className={pageClass}><AccessPageHeader title={id ? team.name || "Team" : sales ? "New sales team" : "New team"} backHref={base} actions={<AccessFormActions form="team-form" cancelHref={base} canSave={canManage} saving={saving} disabled={failed} saveLabel={sales ? "Save sales team" : "Save team"} />} />

    <AccessRecordForm id="team-form" saving={saving} error={error} disabled={!canManage || failed} fingerprint={team} initialSection="Team details"
      overview={original && <AccessSummarySection title="Team details" canEdit={canManage} fields={[{ label: "Name", value: original.name }, ...(sales ? [{ label: "Workflow", value: workflowName(original.workflow, term) }] : []), { label: "Status", value: original.archived ? "Archived" : "Active" }]}><p className="text-sm text-muted-foreground">Membership controls assignment. Record visibility follows the assigned access role; membership alone does not grant team-manager authority.</p></AccessSummarySection>}
      tabs={id && team.canReadMembers && !failed ? [{ value: "members", label: "Members", content: <TeamMembers endpoint={endpoint} id={id} team={team} disabled={saving || dirty || team.archived || !team.canAssign} onChange={row => { setTeam(row); setOriginal(row) }} /> }] : []} onSubmit={event => { event.preventDefault(); if (original && !original.archived && team.archived) setConfirm(true); else void save() }} className="space-y-5"><Section title="Team details"><fieldset disabled={!canManage || saving || failed} className="grid gap-4 sm:grid-cols-2">
      <FormField id="team-name" label="Team name"><Input id="team-name" required maxLength={100} value={team.name} onChange={event => setTeam({ ...team, name: event.target.value })} /></FormField>
      {sales && <FormField id="team-workflow" label="Sales workflow"><Select id="team-workflow" className="w-full" value={team.workflow} onValueChange={workflow => setTeam({ ...team, workflow })}><option value="BOTH">{workflowName("BOTH", term)}</option><option value="ENQUIRY_FIRST">{workflowName("ENQUIRY_FIRST", term)}</option><option value="DIRECT">{workflowName("DIRECT", term)}</option></Select><p className="text-sm text-muted-foreground">{team.workflow === "BOTH" ? `Create ${term("crm.enquiry.plural", "enquiries")} for new prospects or ${term("crm.opportunity.plural", "opportunities")} directly for ready deals. Qualification is optional before conversion.` : team.workflow === "DIRECT" ? `Create ${term("crm.opportunity.plural", "opportunities")} directly. New ${term("crm.enquiry.plural", "enquiries")} cannot be assigned to this team; existing ones remain available for conversion.` : `Create ${term("crm.enquiry.singular", "an enquiry")}, mark it Qualified, then convert it to ${term("crm.opportunity.singular", "an opportunity")}. Direct creation is blocked.`}</p></FormField>}
      <label className="flex items-center gap-2"><Checkbox checked={team.archived} onChange={event => setTeam({ ...team, archived: event.target.checked })} />Archived</label>
    </fieldset></Section><Section title="Access and assignment"><p className="text-sm text-muted-foreground">Each resource and action follows its configured record limits. Team membership can grant project access when a project is assigned to that team. Only a tenant administrator can designate team managers. Module and action permissions are always required. Leave approval follows the reporting manager.</p></Section></AccessRecordForm>

    <Dialog open={confirm} onOpenChange={open => { if (!saving) setConfirm(open) }}><DialogContent><DialogHeader><DialogTitle>Archive this team?</DialogTitle><DialogDescription>Archiving removes active-team access across modules. Explicit project assignments and sales record ownership remain in force. New records cannot be assigned until the team is restored.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" disabled={saving} onClick={() => setConfirm(false)}>Cancel</Button><Button loading={saving} onClick={() => void save()}>Archive team</Button></DialogFooter></DialogContent></Dialog>
  </div>
}

type Member = { isManager?: boolean; id: string; name: string | null; role: string; status: string }
function TeamMembers({ endpoint, id, team, disabled, onChange }: { endpoint: string; id: string; team: Team; disabled: boolean; onChange: (row: Team) => void }) {
  const [data, setData] = React.useState<{ items: Member[]; total: number }>({ items: [], total: 0 }), [q, setQ] = React.useState({ page: 1, pageSize: 10 })
  const [userId, setUserId] = React.useState(""), [remove, setRemove] = React.useState<Member | null>(null), [error, setError] = React.useState(""), [saving, setSaving] = React.useState(false), [loading, setLoading] = React.useState(true)
  React.useEffect(() => {
    const controller = new AbortController(); setLoading(true)
    request<typeof data>(`${endpoint}/${id}/members?page=${q.page}&pageSize=${q.pageSize}`, { signal: controller.signal }).then(setData).catch(error => { if (!controller.signal.aborted) setError(error.message) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [id, q, team.version, endpoint])
  const change = React.useCallback(async (memberId: string, removing: boolean, isManager?: boolean) => {
    setSaving(true); setError("")
    try {
      onChange(await request<Team>(`${endpoint}/${id}/members`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: memberId, version: team.version, remove: removing, ...(isManager === undefined ? {} : { isManager }) }) })); setUserId(""); setRemove(null); setQ(previous => ({ ...previous, page: 1 }))
    } catch (error) { setError((error as Error).message) } finally { setSaving(false) }
  }, [id, team.version, onChange, endpoint])
  const columns = React.useMemo<ColumnDef<Member>[]>(() => [
    { accessorKey: "name", header: "Member" }, { accessorKey: "role", header: "Role" }, { accessorKey: "status", header: "Status" },
    { id: "teamAccess", header: "Team access", cell: ({ row }) => team.canManageTeamAccess ? <Select aria-label={`${row.original.name || "Member"} team access`} value={row.original.isManager ? "manager" : "member"} disabled={disabled || saving} onValueChange={value => void change(row.original.id, false, value === "manager")}><option value="member">Member</option><option value="manager">Team manager</option></Select> : row.original.isManager ? "Team manager" : "Member" },
    { id: "action", header: "Action", cell: ({ row }) => <Button variant="outline" disabled={disabled || saving || (!!row.original.isManager && !team.canManageTeamAccess)} onClick={() => setRemove(row.original)}>Remove</Button> },
  ], [disabled, saving, team.canManageTeamAccess, change])
  const table = useReactTable({ data: data.items, columns, getCoreRowModel: getCoreRowModel(), manualPagination: true, rowCount: data.total, state: { pagination: { pageIndex: q.page - 1, pageSize: q.pageSize } }, onPaginationChange: updater => setQ(previous => { const next = typeof updater === "function" ? updater({ pageIndex: previous.page - 1, pageSize: previous.pageSize }) : updater; return { page: next.pageSize !== previous.pageSize ? 1 : next.pageIndex + 1, pageSize: next.pageSize } }) })
  return <Section title="Team members" description="Save team changes before editing members. Reassign open sales records before removing a member.">
    {error && <p role="alert" className="text-destructive">{error}</p>}<div className="grid items-end gap-3 sm:grid-cols-[1fr_auto]"><FormField id="team-member" label="Add staff member"><RecordSelect id="team-member" endpoint="/api/teams/assignees" value={userId} onChange={setUserId} disabled={disabled || saving} /></FormField><ActionBar><Button disabled={!userId || disabled} loading={saving} onClick={() => void change(userId, false)}>Add member</Button></ActionBar></div>
    <DataTable table={table} loading={loading} emptyMessage="Add members before assigning sales records to this team." /><TablePagination table={table} totalRows={data.total} loading={loading} />
    <Dialog open={!!remove} onOpenChange={open => { if (!open && !saving) setRemove(null) }}><DialogContent><DialogHeader><DialogTitle>Remove {remove?.name}?</DialogTitle><DialogDescription>Open sales records must be reassigned first. Historical assignments remain unchanged.</DialogDescription></DialogHeader>{error && <p role="alert" className="text-destructive">{error}</p>}<DialogFooter><Button variant="outline" disabled={saving} onClick={() => setRemove(null)}>Cancel</Button><Button loading={saving} onClick={() => remove && void change(remove.id, true)}>Remove member</Button></DialogFooter></DialogContent></Dialog>
  </Section>
}
