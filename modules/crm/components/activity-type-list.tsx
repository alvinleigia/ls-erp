"use client"
import { useTerminology, useTerminologyReader } from "@/platform/terminology/provider"
import * as React from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/erp/controls"
import { workTypes } from "../work-validation"
import type { WorkType } from "@/types/crm-work"
import { DropdownSelect } from "@/components/ui/dropdown-select"
import { DraftPanel } from "@/components/erp/record-detail"
import { FormField } from "@/components/form-field"
import { AccessPageHeader } from "@/platform/access/record-page"
import { Surface, pageClass } from "@/components/erp/page"
import { Pagination } from "@/components/erp/pagination"

type ActivityType = { baseType: WorkType; defaultInstructions: string; id: string; name: string; archived: boolean; version: number }
export function ActivityTypeList() {
  const readTerm = useTerminologyReader()
  const term = useTerminology()
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
        if (!response.ok) throw new Error(data.error || readTerm("crm.activity.singular", "Unable to load activity types.", "Unable to load {label} types."))
        setRows(data.items); setTotal(data.total); setCanManage(data.canManage)
      } catch (error) { if (!controller.signal.aborted) { setError((error as Error).message); setRows([]); setTotal(0) } }
      finally { if (!controller.signal.aborted) setLoading(false) }
    }, 150)
    return () => { clearTimeout(timer); controller.abort() }
  }, [readTerm, query, revision])
  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!editing) return
    setSaving(true); setSaveError("")
    try {
      const response = await fetch(`/api/crm/activity-types${editing.id ? `/${editing.id}` : ""}`, { method: editing.id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editing.id ? { name: editing.name, baseType: editing.baseType, defaultInstructions: editing.defaultInstructions, archived: editing.archived, version: editing.version } : { name: editing.name, baseType: editing.baseType, defaultInstructions: editing.defaultInstructions }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || readTerm("crm.activity.singular", "Unable to save activity type.", "Unable to save {label} type."))
      setEditing(null); setRevision(value => value + 1); toast.success(term("crm.activity.singular", "Activity type saved.", "{label} type saved."))
    } catch (error) { setSaveError((error as Error).message) } finally { setSaving(false) }
  }
  return <div className={pageClass}>
    <AccessPageHeader title={term("crm.activity.singular", "Activity types", "{label} types")} description={term("crm.activity.plural", "Configure activities such as Site Visit or Demo. Built-in Task, Call, Meeting and Email remain available.", "Configure {label} such as Site Visit or Demo. Built-in Task, Call, Meeting and Email remain available.")} backHref="/crm/enquiries" backLabel={term("crm.enquiry.plural", "Back to enquiries", "Back to {label}")} actions={canManage && <Button onClick={() => { setSaveError(""); setEditing({ id: "", name: "", baseType: "MEETING", defaultInstructions: "", archived: false, version: 1 }) }}>{term("crm.activity.singular", "New activity type", "New {label} type")}</Button>} />
    <Surface>
      <div className="flex flex-wrap gap-3"><Input aria-label={term("crm.activity.singular", "Search activity types", "Search {label} types")} placeholder={term("crm.activity.singular", "Search activity types…", "Search {label} types…")} className="min-w-0 flex-1 basis-48" value={query.q} onChange={event => setQuery({ ...query, q: event.target.value, page: 1 })} /><DropdownSelect label={term("crm.activity.singular", "Activity type status", "{label} type status")} value={query.archived} options={[{ value: "false", label: term("crm.activity.singular", "Active activity types", "Active {label} types") }, { value: "true", label: term("crm.activity.singular", "Archived activity types", "Archived {label} types") }]} onValueChange={archived => setQuery({ ...query, archived, page: 1 })} /><Button variant="outline" onClick={() => setRevision(value => value + 1)}>Refresh</Button></div>
      {error && <p role="alert" className="text-destructive">{error}</p>}
      <div className="overflow-x-auto rounded-lg border"><table className="w-full text-sm"><thead className="bg-muted/50"><tr><th className="p-3 text-left">{term("crm.activity.singular", "Activity type", "{label} type")}</th><th className="p-3 text-left">Behaviour</th><th className="p-3 text-left">Status</th>{canManage && <th className="p-3 text-right">Action</th>}</tr></thead><tbody>{rows.map(row => <tr key={row.id} className="border-t"><td className="p-3">{row.name}</td><td className="p-3">{row.baseType}</td><td className="p-3">{row.archived ? "Archived" : "Active"}</td>{canManage && <td className="p-3 text-right"><Button variant="outline" size="sm" onClick={() => { setSaveError(""); setEditing(row) }}>Edit<span className="sr-only"> {row.name}</span></Button></td>}</tr>)}{!rows.length && <tr><td className="p-6 text-center text-muted-foreground" colSpan={canManage ? 4 : 3}>{loading ? term("crm.activity.singular", "Loading activity types…", "Loading {label} types…") : term("crm.activity.singular", "No activity types found.", "No {label} types found.")}</td></tr>}</tbody></table></div>
      <Pagination {...query} total={total} loading={loading} onPageChange={page => setQuery({ ...query, page })} onPageSizeChange={pageSize => setQuery({ ...query, pageSize, page: 1 })} />
    </Surface>
    {editing && <DraftPanel title={editing.id ? term("crm.activity.singular", "Edit activity type", "Edit {label} type") : term("crm.activity.singular", "New activity type", "New {label} type")} description={term("crm.activity.singular", "Archive an activity type to stop new selections while keeping historical records.", "Archive {label} types to stop new selections while keeping historical records.")} onClose={() => setEditing(null)} onSubmit={save} saving={saving} fingerprint={editing} error={saveError} saveLabel={term("crm.activity.singular", "Save activity type", "Save {label} type")}><fieldset disabled={saving} className="min-h-0 space-y-4 overflow-y-auto pr-1"><FormField id="activity-type-name" label={term("crm.activity.singular", "Activity type name", "{label} type name")}><Input id="activity-type-name" required maxLength={100} value={editing.name} onChange={event => setEditing({ ...editing, name: event.target.value })} /></FormField><FormField id="activity-type-behaviour" label="Behaviour"><DropdownSelect id="activity-type-behaviour" className="w-full" disabled={!!editing.id} value={editing.baseType} options={workTypes.map(value => ({ value, label: value.charAt(0) + value.slice(1).toLowerCase() }))} onValueChange={value => setEditing({ ...editing, baseType: value as WorkType })} /><p className="text-xs text-muted-foreground">Determines available outcomes. Behaviour stays fixed after creation.</p></FormField><FormField id="activity-type-instructions" label="Default instructions"><Textarea id="activity-type-instructions" maxLength={5000} value={editing.defaultInstructions} onChange={event => setEditing({ ...editing, defaultInstructions: event.target.value })} /></FormField>{editing.id && <FormField id="activity-type-status" label="Status"><DropdownSelect id="activity-type-status" className="w-full" value={editing.archived ? "archived" : "active"} options={[{ value: "active", label: "Active" }, { value: "archived", label: "Archived" }]} onValueChange={value => setEditing({ ...editing, archived: value === "archived" })} /></FormField>}</fieldset></DraftPanel>}
  </div>
}
