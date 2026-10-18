"use client"
import { useTerminology } from "@/platform/terminology/provider"
import * as React from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DropdownSelect } from "@/components/ui/dropdown-select"
import { DraftPanel } from "@/components/erp/record-detail"
import { FormField } from "@/components/form-field"
import { AccessPageHeader } from "@/platform/access/record-page"
import { Surface, pageClass } from "@/components/erp/page"
import { Pagination } from "@/components/erp/pagination"

type Reason = { id: string; name: string; archived: boolean; version: number }
export function LostReasonList() {
  const term = useTerminology()
  const [rows, setRows] = React.useState<Reason[]>([])
  const [query, setQuery] = React.useState({ q: "", archived: "false", page: 1, pageSize: 20 })
  const [total, setTotal] = React.useState(0)
  const [canManage, setCanManage] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState("")
  const [revision, setRevision] = React.useState(0)
  const [editing, setEditing] = React.useState<Reason | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [saveError, setSaveError] = React.useState("")
  React.useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setLoading(true); setError("")
      try {
        const response = await fetch(`/api/crm/lost-reasons?${new URLSearchParams({ ...query, page: String(query.page), pageSize: String(query.pageSize) })}`, { signal: controller.signal, cache: "no-store" })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || "Unable to load reasons.")
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
      const response = await fetch(`/api/crm/lost-reasons${editing.id ? `/${editing.id}` : ""}`, { method: editing.id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editing.id ? { name: editing.name, archived: editing.archived, version: editing.version } : { name: editing.name }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Unable to save reason.")
      setEditing(null); setRevision(value => value + 1); toast.success("Lost reason saved.")
    } catch (error) { setSaveError((error as Error).message) } finally { setSaving(false) }
  }
  return <div className={pageClass}>
    <AccessPageHeader title="Lost reasons" description={`Configure reasons shared by ${term("crm.enquiry.plural", "enquiries")} and ${term("crm.opportunity.plural", "opportunities")}, such as Spam, Duplicate or Budget mismatch. Managers can add, rename or archive reasons.`} backHref="/crm/enquiries" backLabel={term("crm.enquiry.plural", "Back to enquiries", "Back to {label}")} actions={canManage && <Button onClick={() => { setSaveError(""); setEditing({ id: "", name: "", archived: false, version: 1 }) }}>New reason</Button>} />
    <Surface>
      <div className="flex flex-wrap gap-3"><Input aria-label="Search lost reasons" placeholder="Search reasons…" className="min-w-0 flex-1 basis-48" value={query.q} onChange={event => setQuery({ ...query, q: event.target.value, page: 1 })} /><DropdownSelect label="Reason status" value={query.archived} options={[{ value: "false", label: "Active reasons" }, { value: "true", label: "Archived reasons" }]} onValueChange={archived => setQuery({ ...query, archived, page: 1 })} /><Button variant="outline" onClick={() => setRevision(value => value + 1)}>Refresh</Button></div>
      {error && <p role="alert" className="text-destructive">{error}</p>}
      <div className="overflow-x-auto rounded-lg border"><table className="w-full text-sm"><thead className="bg-muted/50"><tr><th className="p-3 text-left">Reason</th><th className="p-3 text-left">Status</th>{canManage && <th className="p-3 text-right">Action</th>}</tr></thead><tbody>{rows.map(row => <tr key={row.id} className="border-t"><td className="p-3">{row.name}</td><td className="p-3">{row.archived ? "Archived" : "Active"}</td>{canManage && <td className="p-3 text-right"><Button variant="outline" size="sm" onClick={() => { setSaveError(""); setEditing(row) }}>Edit<span className="sr-only"> {row.name}</span></Button></td>}</tr>)}{!rows.length && <tr><td className="p-6 text-center text-muted-foreground" colSpan={canManage ? 3 : 2}>{loading ? "Loading reasons…" : "No reasons found."}</td></tr>}</tbody></table></div>
      <Pagination {...query} total={total} loading={loading} onPageChange={page => setQuery({ ...query, page })} onPageSizeChange={pageSize => setQuery({ ...query, pageSize, page: 1 })} />
    </Surface>
    {editing && <DraftPanel title={editing.id ? "Edit lost reason" : "New lost reason"} description="Archive a reason to stop new selections while keeping historical records." onClose={() => setEditing(null)} onSubmit={save} saving={saving} fingerprint={editing} error={saveError} saveLabel="Save reason"><fieldset disabled={saving} className="space-y-4"><FormField id="reason-name" label="Reason name"><Input id="reason-name" required maxLength={100} value={editing.name} onChange={event => setEditing({ ...editing, name: event.target.value })} /></FormField>{editing.id && <FormField id="reason-status" label="Status"><DropdownSelect id="reason-status" className="w-full" value={editing.archived ? "archived" : "active"} options={[{ value: "active", label: "Active" }, { value: "archived", label: "Archived" }]} onValueChange={value => setEditing({ ...editing, archived: value === "archived" })} /></FormField>}</fieldset></DraftPanel>}
  </div>
}
