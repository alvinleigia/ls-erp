"use client"
import * as React from "react"
import { useSession } from "next-auth/react"
import { toast } from "sonner"
import { RecordAccessContext } from "./record-context"
import { sharingResource } from "./sharing-registry"
import { EditPanel } from "@/components/erp/record-detail"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/erp/controls"
import { RecordSelect } from "@/components/erp/record-select"
import { FormField } from "@/components/form-field"

type Grant = { kind: "USER" | "TEAM"; id: string; level: "READ" | "EDIT"; name: string; inactive?: boolean }
type Settings = { resource: string; recordId: string; title: string; restricted: boolean; version: number; inherited: boolean; grants: Grant[] }
export function RecordSharingControl() {
  const record = React.useContext(RecordAccessContext), { data: session } = useSession()
  const [open, setOpen] = React.useState(false)
  if (session?.user?.role !== "ADMIN" || !record?.id || !sharingResource(record.resource)) return null
  return <><Button type="button" variant="outline" onClick={() => setOpen(true)}>Sharing</Button>{open && <SharingDialog resource={record.resource} id={record.id} onClose={() => setOpen(false)} />}</>
}
function SharingDialog({ resource, id, onClose }: { resource: string; id: string; onClose: () => void }) {
  const [settings, setSettings] = React.useState<Settings>(), [error, setError] = React.useState(""), [saving, setSaving] = React.useState(false)
  const [kind, setKind] = React.useState<Grant["kind"]>("USER"), [target, setTarget] = React.useState(""), [name, setName] = React.useState(""), [level, setLevel] = React.useState<Grant["level"]>("READ")
  const endpoint = `/api/access/records/${resource}/${id}`
  const baseline = React.useRef("")
  const load = React.useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(endpoint, { signal, cache: "no-store" }), data = await response.json()
    if (!response.ok) throw new Error(data.error || "Unable to load sharing.")
    baseline.current = JSON.stringify(data); setSettings(data); setError("")
  }, [endpoint])
  React.useEffect(() => { const controller = new AbortController(); void load(controller.signal).catch(error => { if (!controller.signal.aborted) setError(error.message) }); return () => controller.abort() }, [load])
  async function save() {
    if (!settings) return
    setSaving(true); setError("")
    try {
      const response = await fetch(endpoint, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ restricted: settings.restricted, version: settings.version, grants: settings.grants.map(({ kind, id, level }) => ({ kind, id, level })) }) }), data = await response.json()
      if (!response.ok) throw new Error(data.error || "Unable to save sharing.")
      toast.success("Record sharing saved."); onClose()
    } catch (error) { setError((error as Error).message) } finally { setSaving(false) }
  }
  return <EditPanel open title="Record sharing" description={settings?.title || "Manage visibility and shared access."} onClose={onClose} onSubmit={() => void save()} saving={saving} disabled={!settings} error={error} saveLabel="Save sharing" dirty={!!settings && JSON.stringify(settings) !== baseline.current}>
    {error && <Button type="button" variant="link" size="sm" onClick={() => void load().catch(error => setError(error.message))}>Reload sharing settings</Button>}
    {!settings && !error && <p>Loading sharing...</p>}
    {settings && <fieldset disabled={saving} className="min-w-0 space-y-5">
      {settings.inherited && <p className="text-sm">Sharing is inherited from the parent project. Changes apply to that project and its subprojects.</p>}
      <FormField id="record-visibility" label="Visibility"><Select id="record-visibility" value={settings.restricted ? "RESTRICTED" : "NORMAL"} onValueChange={value => setSettings({ ...settings, restricted: value === "RESTRICTED" })}><option value="NORMAL">Normal access</option><option value="RESTRICTED">Restricted access</option></Select></FormField>
      <p className="text-sm text-muted-foreground">Normal keeps existing access and adds the recipients below. Restricted allows responsible staff, selected users or teams, and tenant administrators. Tenant-wide manager access does not bypass Restricted visibility.</p>
      <p className="text-sm text-muted-foreground">Profiles still control which actions are permitted. Access from user and team shares is combined. Restrictions on linked source records still apply. Sales order sharing also governs its receivables, payments and reservations.</p>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2"><FormField id="sharing-kind" label="Share with"><Select id="sharing-kind" value={kind} onValueChange={value => { setKind(value as Grant["kind"]); setTarget(""); setName("") }}><option value="USER">User</option><option value="TEAM">Team</option></Select></FormField>
      <FormField id="sharing-recipient" label={kind === "USER" ? "User" : "Team"}><RecordSelect key={kind} id="sharing-recipient" endpoint={kind === "USER" ? "/api/users" : "/api/teams"} value={target} selected={target ? { value: target, label: name } : undefined} onChange={(value, option) => { setTarget(value); setName(option?.label || value) }} /></FormField>
      <FormField id="sharing-level" label="Access"><Select id="sharing-level" value={level} onValueChange={value => setLevel(value as Grant["level"])}><option value="READ">Read only</option><option value="EDIT">Read and edit</option></Select></FormField>
      <Button type="button" variant="outline" className="self-end" disabled={!target || settings.grants.length >= 200 || settings.grants.some(g => g.kind === kind && g.id === target)} onClick={() => { setSettings({ ...settings, grants: [...settings.grants, { kind, id: target, level, name }] }); setTarget(""); setName("") }}>Add recipient</Button></div>
      <ul aria-label="Sharing recipients" className="space-y-3">{settings.grants.map((g,index) => <li key={`${g.kind}:${g.id}`} className="flex min-w-0 flex-wrap items-center gap-2 rounded-md border p-3"><span className="min-w-0 flex-1 break-words text-sm">{g.name} <span className="text-muted-foreground">({g.kind === "USER" ? "User" : "Team"}{g.inactive ? ", inactive" : ""})</span></span><Select aria-label={`Access for ${g.name}`} value={g.level} onValueChange={value => setSettings({ ...settings, grants: settings.grants.map((item,i) => i === index ? { ...item, level: value as Grant["level"] } : item) })}><option value="READ">Read only</option><option value="EDIT">Read and edit</option></Select><Button type="button" size="sm" variant="ghost" aria-label={`Remove ${g.name}`} onClick={() => setSettings({ ...settings, grants: settings.grants.filter((_,i) => i !== index) })}>Remove</Button></li>)}</ul>
    </fieldset>}
  </EditPanel>
}
