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
import { ProfileAssignmentEditor } from "./profile-assignment"
import { profileModules, profileModuleName, profileResources, moduleProfileTemplates } from "./profiles"
import { resourceRecordPolicies, recordPolicyDescriptions } from "./resource-policy"
import { accessResources, permissionActions, type Permission, type Resource } from "./catalog"

type AccessRole = { id?: string; name: string; permissions: Permission[]; archived: boolean; moduleKey?: string; version?: number }
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
    <PageHeader title="Access profiles" description="Create reusable module permissions and combine several profiles for each user." actions={<><Button variant="outline" disabled={loading || !!error} onClick={() => setAssign(true)}>Assign profiles</Button><Button disabled={loading || !!error} onClick={() => setDraft({ name: "", permissions: [], archived: false })}>New profile</Button></>} />
    <Surface><p className="text-sm text-muted-foreground">Tenant administrators retain full access. Profiles combine allowed actions. Record visibility is configured per user. Users with no profiles have no business access. Modules also require platform allowance and tenant activation. User creation, invitations and role assignments remain administrator-only.</p></Surface>
    <Surface>
      <div className="flex flex-wrap gap-2"><Input className="min-w-0 flex-1" aria-label="Search access profiles" placeholder="Search profiles..." value={q} onChange={e => { setQ(e.target.value); setPage(1) }} /><DropdownSelect label="Role status" value={archived} options={[{ value: "false", label: "Active roles" }, { value: "true", label: "Archived roles" }]} onValueChange={value => { setArchived(value); setPage(1) }} /><Button variant="outline" onClick={refresh}>Refresh</Button></div>
      {error ? <p role="alert" className="text-destructive">{error}</p> : loading ? <p>Loading roles...</p> : rows.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="p-3">Role</th><th className="p-3">Module</th><th className="p-3">Assigned users</th></tr></thead><tbody>{rows.map(row => <tr key={row.id} className="border-b"><td className="p-3"><button className="font-medium underline" onClick={() => edit(row.id)}>{row.name}</button></td><td className="p-3">{profileModuleName(row.moduleKey ?? "all")}</td><td className="p-3">{row._count.assignments}</td></tr>)}</tbody></table></div> : <p className="py-6 text-center text-muted-foreground">No access profiles found. Create a profile from a module template to start.</p>}
      <Pagination page={page} pageSize={pageSize} total={total} loading={loading} onPageChange={setPage} onPageSizeChange={size => { setPageSize(size); setPage(1) }} />
    </Surface>
    {draft && <RoleEditor initial={draft} onClose={() => setDraft(null)} onSaved={() => { setDraft(null); refresh() }} />}
    {assign && <ProfileAssignmentEditor onClose={() => setAssign(false)} onSaved={() => { setAssign(false); refresh() }} />}
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
      const { id, name, permissions, archived, version, moduleKey } = value
      await request(`/api/access/roles${id ? `/${id}` : ""}`, { name, permissions, archived, version, moduleKey }, id ? "PATCH" : "POST")
      toast.success("Access profile saved."); onSaved()
    } catch (e) { setError((e as Error).message) } finally { setSaving(false) }
  }
  return <DraftPanel title={initial.id ? "Edit access profile" : "New access profile"} description="Read allows the view. Other actions require Read. Clearing Read removes all actions for that entity." fingerprint={value} saving={saving} error={error} onClose={onClose} onSubmit={save}>
    <div className="space-y-2"><Label htmlFor="role-name">Profile name</Label><Input id="role-name" required minLength={2} maxLength={80} value={value.name} onChange={e => setValue({ ...value, name: e.target.value })} /></div>
    <DropdownSelect label="Profile module" value={value.moduleKey ?? "all"} options={profileModules.map(key => ({ value: key, label: profileModuleName(key) }))} onValueChange={moduleKey => setValue({ ...value, moduleKey, permissions: value.permissions.filter(p => profileResources(moduleKey).includes(p.split(".")[0] as Resource)) })} />
    {!initial.id && <DropdownSelect label="Copy template" value="choose" options={[{ value: "choose", label: "Choose module permissions", disabled: true }, ...moduleProfileTemplates.filter(template => !value.moduleKey || value.moduleKey === "all" || template.moduleKey === value.moduleKey).map(template => ({ value: template.key, label: template.name }))]} onValueChange={key => { const template = moduleProfileTemplates.find(item => item.key === key)!; setValue({ ...value, name: value.name || template.name, moduleKey: template.moduleKey, permissions: [...template.permissions] }) }} />}
    <p className="text-sm text-muted-foreground">Changes apply to every user with this profile. Templates include dashboard access. Record visibility is set when assigning profiles to a user.</p>
    <div className="overflow-x-auto rounded-lg border"><table className="w-full text-sm"><thead><tr className="border-b"><th className="p-2 text-left">Entity</th>{permissionActions.map(action => <th className="p-2 capitalize" key={action}>{action}</th>)}</tr></thead><tbody>{profileResources(value.moduleKey ?? "all").map(resource => <tr key={resource} className="border-b"><th className="p-2 text-left font-normal">{accessResources[resource].name}<p className="mt-1 max-w-64 text-xs text-muted-foreground">{recordPolicyDescriptions[resourceRecordPolicies[resource]]}</p></th>{permissionActions.map(action => { const permission = `${resource}.${action}` as Permission; return <td key={action} className="p-2 text-center">{(accessResources[resource].actions as readonly string[]).includes(action) ? <input type="checkbox" className="size-4 accent-primary" aria-label={`${accessResources[resource].name}: ${action}`} checked={value.permissions.includes(permission)} onChange={e => toggle(resource, permission, e.target.checked)} /> : <span aria-label="Not applicable">—</span>}</td> })}</tr>)}</tbody></table></div>
    {initial.id && <label className="flex items-center gap-2"><input type="checkbox" checked={value.archived} onChange={e => setValue({ ...value, archived: e.target.checked })} />Archived (reassign users first)</label>}
  </DraftPanel>
}
