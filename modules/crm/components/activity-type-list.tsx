"use client"
import * as React from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { CrmTextarea } from "./crm-controls"
import { workTypes } from "../work-validation"
import type { WorkType } from "@/types/crm-work"
import { DropdownSelect } from "@/components/ui/dropdown-select"
import { CrmDraftPanel } from "./crm-record-detail"
import { FormField } from "@/components/form-field"
import { CrmPageHeader, CrmSurface, crmPageClass } from "./crm-page"
import { CrmPagination } from "./crm-pagination"

type ActivityType = { baseType: WorkType; defaultInstructions: string; id: string; name: string; archived: boolean; version: number }
export function ActivityTypeList() {
  const [rows, setRows] = React.useState<ActivityType[]>([])
  const [query, setQuery] = React.useState({ q: "", archived: "false", page: 1, pageSize: 20 })
  const [total, setTotal] = React.useState(0)
  const [canManage, setCanManage] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState("")
  const [revision, setRevision] = React.useState(0)
  const [editing, setEditing] = React.useState<ActivityType | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [saveError, setSaveError] = React.useState("")
  React.useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setLoading(true); setError("")
      try {
        const response = await fetch(`/api/crm/activity-types?${new URLSearchParams({ ...query, page: String(query.page), pageSize: String(query.pageSize) })}`, { signal: controller.signal, cache: "no-store" })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || "Unable to load activity types.")
        setRows(data.items); setTotal(data.total); setCanManage(data.canManage)
      } catch (error) { if (!controller.signal.aborted) { setError((error as Error).message); setRows([]); setTotal(0) } }
      finally { if (!controller.signal.aborted) setLoading(false) }
    }, 150)
    return () => { clearTimeout(timer); controller.abort() }
  }, [query, revision])
  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!editing) return
    setSaving(true); setSaveError("")
    try {
      const response = await fetch(`/api/crm/activity-types${editing.id ? `/${editing.id}` : ""}`, { method: editing.id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editing.id ? { name: editing.name, baseType: editing.baseType, defaultInstructions: editing.defaultInstructions, archived: editing.archived, version: editing.version } : { name: editing.name, baseType: editing.baseType, defaultInstructions: editing.defaultInstructions }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Unable to save activity type.")
      setEditing(null); setRevision(value => value + 1); toast.success("Activity type saved.")
    } catch (error) { setSaveError((error as Error).message) } finally { setSaving(false) }
  }
  return <div className={crmPageClass}>
    <CrmPageHeader title="Activity types" description="Configure activities such as Site Visit or Demo. Built-in Task, Call, Meeting and Email remain available." backHref="/crm/enquiries" backLabel="Back to enquiries" actions={canManage && <Button onClick={() => { setSaveError(""); setEditing({ id: "", name: "", baseType: "MEETING", defaultInstructions: "", archived: false, version: 1 }) }}>New activity type</Button>} />
    <CrmSurface>
      <div className="flex flex-wrap gap-3"><Input aria-label="Search activity types" placeholder="Search activity types…" className="min-w-0 flex-1 basis-48" value={query.q} onChange={event => setQuery({ ...query, q: event.target.value, page: 1 })} /><DropdownSelect label="Activity type status" value={query.archived} options={[{ value: "false", label: "Active activity types" }, { value: "true", label: "Archived activity types" }]} onValueChange={archived => setQuery({ ...query, archived, page: 1 })} /><Button variant="outline" onClick={() => setRevision(value => value + 1)}>Refresh</Button></div>
      {error && <p role="alert" className="text-destructive">{error}</p>}
      <div className="overflow-x-auto rounded-lg border"><table className="w-full text-sm"><thead className="bg-muted/50"><tr><th className="p-3 text-left">Activity type</th><th className="p-3 text-left">Behaviour</th><th className="p-3 text-left">Status</th>{canManage && <th className="p-3 text-right">Action</th>}</tr></thead><tbody>{rows.map(row => <tr key={row.id} className="border-t"><td className="p-3">{row.name}</td><td className="p-3">{row.baseType}</td><td className="p-3">{row.archived ? "Archived" : "Active"}</td>{canManage && <td className="p-3 text-right"><Button variant="outline" size="sm" onClick={() => { setSaveError(""); setEditing(row) }}>Edit<span className="sr-only"> {row.name}</span></Button></td>}</tr>)}{!rows.length && <tr><td className="p-6 text-center text-muted-foreground" colSpan={canManage ? 4 : 3}>{loading ? "Loading activity types…" : "No activity types found."}</td></tr>}</tbody></table></div>
      <CrmPagination {...query} total={total} loading={loading} onPageChange={page => setQuery({ ...query, page })} onPageSizeChange={pageSize => setQuery({ ...query, pageSize, page: 1 })} />
    </CrmSurface>
    {editing && <CrmDraftPanel title={editing.id ? "Edit activity type" : "New activity type"} description="Archive an activity type to stop new selections while keeping historical records." onClose={() => setEditing(null)} onSubmit={save} saving={saving} fingerprint={editing} error={saveError} saveLabel="Save activity type"><fieldset disabled={saving} className="min-h-0 space-y-4 overflow-y-auto pr-1"><FormField id="activity-type-name" label="Activity type name"><Input id="activity-type-name" required maxLength={100} value={editing.name} onChange={event => setEditing({ ...editing, name: event.target.value })} /></FormField><FormField id="activity-type-behaviour" label="Behaviour"><DropdownSelect id="activity-type-behaviour" className="w-full" disabled={!!editing.id} value={editing.baseType} options={workTypes.map(value => ({ value, label: value.charAt(0) + value.slice(1).toLowerCase() }))} onValueChange={value => setEditing({ ...editing, baseType: value as WorkType })} /><p className="text-xs text-muted-foreground">Determines available outcomes. Behaviour stays fixed after creation.</p></FormField><FormField id="activity-type-instructions" label="Default instructions"><CrmTextarea id="activity-type-instructions" maxLength={5000} value={editing.defaultInstructions} onChange={event => setEditing({ ...editing, defaultInstructions: event.target.value })} /></FormField>{editing.id && <FormField id="activity-type-status" label="Status"><DropdownSelect id="activity-type-status" className="w-full" value={editing.archived ? "archived" : "active"} options={[{ value: "active", label: "Active" }, { value: "archived", label: "Archived" }]} onValueChange={value => setEditing({ ...editing, archived: value === "archived" })} /></FormField>}</fieldset></CrmDraftPanel>}
  </div>
}
