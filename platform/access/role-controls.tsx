"use client"
import * as React from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { DropdownSelect } from "@/components/ui/dropdown-select"
import { PageHeader, Surface, pageClass } from "@/components/erp/page"
import { DraftPanel } from "@/components/erp/record-detail"
import { Pagination } from "@/components/erp/pagination"
import { RecordSelect } from "@/components/erp/record-select"
import { crmRecordScopes, type CrmRecordScope } from "./record-scope"
import { accessResources, resourceKeys, permissionActions, roleTemplates, type Permission, type Resource } from "./catalog"

type AccessRole = { id?: string; name: string; permissions: Permission[]; archived: boolean; crmRecordScope?: CrmRecordScope; version?: number }
type RoleRow = AccessRole & { id: string; _count: { assignments: number } }
async function request<T>(url: string, body?: unknown, method = "PATCH"): Promise<T> {
  const response = await fetch(url, body === undefined ? { cache: "no-store" } : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || "Unable to save access settings.")
  return data
}

export function AccessRoles() {
  const [rows, setRows] = React.useState<RoleRow[]>([]), [total, setTotal] = React.useState(0)
  const [page, setPage] = React.useState(1), [pageSize, setPageSize] = React.useState(20), [q, setQ] = React.useState(""), [archived, setArchived] = React.useState("false")
  const [revision, refresh] = React.useReducer(n => n + 1, 0)
  const [loading, setLoading] = React.useState(true), [error, setError] = React.useState("")
  const [draft, setDraft] = React.useState<AccessRole | null>(null), [assign, setAssign] = React.useState(false)
  React.useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setLoading(true); setError("")
      try {
        const response = await fetch(`/api/access/roles?page=${page}&pageSize=${pageSize}&archived=${archived}&q=${encodeURIComponent(q)}`, { signal: controller.signal, cache: "no-store" })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error)
        if (!controller.signal.aborted) { setRows(data.items); setTotal(data.total) }
      } catch (e) { if (!controller.signal.aborted) { setError((e as Error).message); setRows([]) } }
      finally { if (!controller.signal.aborted) setLoading(false) }
    }, 200)
    return () => { clearTimeout(timer); controller.abort() }
  }, [q, page, pageSize, archived, revision])
  async function edit(id: string) { try { setDraft(await request<AccessRole>(`/api/access/roles/${id}`)) } catch (e) { setError((e as Error).message) } }
  return <div className={pageClass}>
    <PageHeader title="Access roles" description="Control access to business modules and administration views. Account roles still determine which records a user can manage." actions={<><Button variant="outline" disabled={loading || !!error} onClick={() => setAssign(true)}>Assign role</Button><Button disabled={loading || !!error} onClick={() => setDraft({ name: "", permissions: [], archived: false })}>New role</Button></>} />
    <Surface><p className="text-sm text-muted-foreground">Tenant administrators retain full access. Users without a custom role keep their existing permissions. These roles restrict the user&apos;s Staff or Manager account role. Modules also require platform allowance and tenant activation. User creation, invitations and role assignments remain administrator-only.</p></Surface>
    <Surface>
      <div className="flex flex-wrap gap-2"><Input className="min-w-0 flex-1" aria-label="Search access roles" placeholder="Search roles..." value={q} onChange={e => { setQ(e.target.value); setPage(1) }} /><DropdownSelect label="Role status" value={archived} options={[{ value: "false", label: "Active roles" }, { value: "true", label: "Archived roles" }]} onValueChange={value => { setArchived(value); setPage(1) }} /><Button variant="outline" onClick={refresh}>Refresh</Button></div>
      {error ? <p role="alert" className="text-destructive">{error}</p> : loading ? <p>Loading roles...</p> : rows.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="p-3">Role</th><th className="p-3">Assigned users</th></tr></thead><tbody>{rows.map(row => <tr key={row.id} className="border-b"><td className="p-3"><button className="font-medium underline" onClick={() => edit(row.id)}>{row.name}</button></td><td className="p-3">{row._count.assignments}</td></tr>)}</tbody></table></div> : <p className="py-6 text-center text-muted-foreground">No access roles found. Create a role from a template to start.</p>}
      <Pagination page={page} pageSize={pageSize} total={total} loading={loading} onPageChange={setPage} onPageSizeChange={size => { setPageSize(size); setPage(1) }} />
    </Surface>
    {draft && <RoleEditor initial={draft} onClose={() => setDraft(null)} onSaved={() => { setDraft(null); refresh() }} />}
    {assign && <AssignmentEditor onClose={() => setAssign(false)} onSaved={() => { setAssign(false); refresh() }} />}
  </div>
}

function RoleEditor({ initial, onClose, onSaved }: { initial: AccessRole; onClose: () => void; onSaved: () => void }) {
  const [value, setValue] = React.useState(initial), [saving, setSaving] = React.useState(false), [error, setError] = React.useState("")
  function toggle(resource: Resource, permission: Permission, checked: boolean) {
    let permissions = value.permissions.filter(item => item !== permission)
    if (checked) permissions = [...new Set([...permissions, `${resource}.read` as Permission, permission])]
    else if (permission.endsWith(".read")) permissions = permissions.filter(item => !item.startsWith(`${resource}.`))
    setValue({ ...value, permissions })
  }
  async function save() {
    setSaving(true); setError("")
    try {
      const { id, name, permissions, archived, version, crmRecordScope } = value
      await request(`/api/access/roles${id ? `/${id}` : ""}`, { name, permissions, archived, version, crmRecordScope }, id ? "PATCH" : "POST")
      toast.success("Access role saved."); onSaved()
    } catch (e) { setError((e as Error).message) } finally { setSaving(false) }
  }
  return <DraftPanel title={initial.id ? "Edit access role" : "New access role"} description="Read allows the view. Other actions require Read. Clearing Read removes all actions for that entity." fingerprint={value} saving={saving} error={error} onClose={onClose} onSubmit={save}>
    <div className="space-y-2"><Label htmlFor="role-name">Role name</Label><Input id="role-name" required minLength={2} maxLength={80} value={value.name} onChange={e => setValue({ ...value, name: e.target.value })} /></div>
    {!initial.id && <DropdownSelect label="Copy template" value="choose" options={[{ value: "choose", label: "Copy permissions from a template", disabled: true }, ...roleTemplates.map(template => ({ value: template.key, label: template.name }))]} onValueChange={key => { const template = roleTemplates.find(item => item.key === key)!; setValue({ ...value, name: value.name || template.name, permissions: [...template.permissions] }) }} />}
    <div className="space-y-2"><Label htmlFor="crm-record-scope">CRM sales record scope</Label><DropdownSelect id="crm-record-scope" label="CRM sales record scope" value={value.crmRecordScope ?? "ACCOUNT_ROLE"} options={crmRecordScopes.map(scope => ({ value: scope, label: { ACCOUNT_ROLE: "Existing account access", OWN: "Own / assigned records", MANAGED_TEAMS: "Own and managed sales teams", ALL: "All tenant records" }[scope] }))} onValueChange={scope => setValue({ ...value, crmRecordScope: scope as CrmRecordScope })} /><p className="text-sm text-muted-foreground">Applies to enquiries, opportunities, related contacts/accounts, activities and quotations. Manager accounts can use team or tenant scope; Staff retain assigned-record access. Team managers are designated by a tenant administrator in Sales teams. Projects and other modules keep their existing access rules.</p></div>
    <div className="overflow-x-auto rounded-lg border"><table className="w-full text-sm"><thead><tr className="border-b"><th className="p-2 text-left">Entity</th>{permissionActions.map(action => <th className="p-2 capitalize" key={action}>{action}</th>)}</tr></thead><tbody>{resourceKeys.map(resource => <tr key={resource} className="border-b"><th className="p-2 text-left font-normal">{accessResources[resource].name}</th>{permissionActions.map(action => { const permission = `${resource}.${action}` as Permission; return <td key={action} className="p-2 text-center">{(accessResources[resource].actions as readonly string[]).includes(action) ? <input type="checkbox" className="size-4 accent-primary" aria-label={`${accessResources[resource].name}: ${action}`} checked={value.permissions.includes(permission)} onChange={e => toggle(resource, permission, e.target.checked)} /> : <span aria-label="Not applicable">—</span>}</td> })}</tr>)}</tbody></table></div>
    {initial.id && <label className="flex items-center gap-2"><input type="checkbox" checked={value.archived} onChange={e => setValue({ ...value, archived: e.target.checked })} />Archived (reassign users first)</label>}
  </DraftPanel>
}

function AssignmentEditor({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [userId, setUserId] = React.useState(""), [roleId, setRoleId] = React.useState("")
  const [current, setCurrent] = React.useState<{ role: string; accessAssignment: { roleId: string; role: { name: string } } | null } | null>(null)
  const [saving, setSaving] = React.useState(false), [error, setError] = React.useState("")
  React.useEffect(() => {
    let cancelled = false; setCurrent(null); setRoleId(""); setError("")
    if (userId) request<NonNullable<typeof current>>(`/api/access/users/${userId}`).then(data => { if (!cancelled) { setCurrent(data); setRoleId(data.accessAssignment?.roleId || "") } }).catch(e => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [userId])
  const eligible = current && ["STAFF", "MANAGER"].includes(current.role)
  return <DraftPanel title="Assign access role" description="Choose a staff member or manager. Existing record ownership and team access remain in force." fingerprint={{ userId, roleId }} saving={saving} disabled={!eligible} error={error} onClose={onClose} onSubmit={async () => {
    setSaving(true); setError("")
    try { await request(`/api/access/users/${userId}`, { roleId: roleId || null, previousRoleId: current?.accessAssignment?.roleId ?? null }); toast.success("Access role assigned."); window.dispatchEvent(new Event("business-modules-changed")); onSaved() } catch (e) { setError((e as Error).message) } finally { setSaving(false) }
  }}>
    <div className="space-y-2"><Label htmlFor="access-user">User</Label><RecordSelect id="access-user" endpoint="/api/users" value={userId} onChange={setUserId} /></div>
    {current && !eligible && <p role="alert">Choose a Staff or Manager account. Tenant administrators retain full access.</p>}
    {eligible && <><div className="space-y-2"><Label htmlFor="assigned-role">Access role</Label><RecordSelect id="assigned-role" endpoint="/api/access/roles" value={roleId} selected={current.accessAssignment ? { value: current.accessAssignment.roleId, label: current.accessAssignment.role.name } : undefined} onChange={setRoleId} placeholder="Existing account permissions" /></div><Button type="button" variant="outline" onClick={() => setRoleId("")}>Use existing account permissions</Button><p className="text-sm text-muted-foreground">{roleId ? "The selected role will restrict this user's access." : "No custom restrictions: use this user's existing account permissions."}</p></>}
  </DraftPanel>
}
