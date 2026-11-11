"use client"
import * as React from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Section } from "@/components/erp/section"
import { RecordSelect } from "@/components/erp/record-select"
import { FormField } from "@/components/form-field"
import { Textarea } from "@/components/erp/controls"
import { useDateFormatter } from "@/hooks/use-date-formatter"
import type { PartnerIntroductionEvidence } from "./contracts"

type Evidence = PartnerIntroductionEvidence["partnerAttribution"]
type State = PartnerIntroductionEvidence & { version: number; canChange: boolean; canChoose: boolean; history: { id: string; before: Evidence; after: Evidence; reason: string; createdAt: string; actor: { name: string | null } | null }[] }
const label = (value: Evidence) => value ? `${value.name} (${value.code})` : "No partner recorded"

export function PartnerLinkPanel({ endpoint, revision, onSaved }: { endpoint: string; revision: number; onSaved: () => Promise<void> | void }) {
  const { formatDateTime } = useDateFormatter()
  const [data, setData] = React.useState<State | null>(null)
  const [error, setError] = React.useState("")
  const [open, setOpen] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [partnerId, setPartner] = React.useState("")
  const [reason, setReason] = React.useState("")
  const [reload, setReload] = React.useState(0)
  React.useEffect(() => {
    const controller = new AbortController()
    setData(null); setError("")
    fetch(endpoint, { cache: "no-store", signal: controller.signal }).then(async response => {
      const next = await response.json()
      if (!response.ok) throw new Error(next.error || "Unable to load partner details.")
      if (!controller.signal.aborted) setData(next)
    }).catch(e => { if (!controller.signal.aborted) setError(e.message) })
    return () => controller.abort()
  }, [endpoint, revision, reload])
  async function save() {
    if (!data) return
    setSaving(true); setError("")
    try {
      const response = await fetch(endpoint, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ partnerId: partnerId || null, reason, version: data.version }) })
      const next = await response.json()
      if (!response.ok) throw new Error(next.error || "Unable to save partner change.")
      setOpen(false); setReload(n => n + 1); toast.success("Introducing partner updated."); await onSaved()
    } catch (e) { setError((e as Error).message) } finally { setSaving(false) }
  }
  return <Section title="Introducing collaborator / CP" description="Partner attribution does not change the salesperson, share records or grant partner access." actions={data?.canChange && <Button type="button" variant="outline" onClick={() => { setPartner(data.introducedByCollaboratorId || ""); setReason(""); setError(""); setOpen(true) }}>{data.introducedByCollaboratorId ? "Change partner" : "Add partner"}</Button>}>
    {error && !open && <p role="alert" className="text-destructive">{error}</p>}
    {!data && !error && <p>Loading partner details…</p>}
    {data && <div className="space-y-4"><p className="break-words font-medium">{label(data.partnerAttribution)}</p><details><summary className="cursor-pointer">Partner history</summary><div className="mt-3 space-y-3">{data.history.length ? data.history.map(event => <div key={event.id} className="break-words rounded-md border p-3 text-sm"><p>{label(event.before)} → {label(event.after)}</p><p>{event.reason}</p><p className="text-muted-foreground">{event.actor?.name || "System"} · {formatDateTime(event.createdAt)}</p></div>) : <p>No recorded changes.</p>}{data.history.length === 50 && <p className="text-sm text-muted-foreground">Showing the 50 most recent changes.</p>}</div></details></div>}
    <Dialog open={open} onOpenChange={next => { if (!saving) setOpen(next) }}><DialogContent><DialogHeader><DialogTitle>{data?.introducedByCollaboratorId ? "Correct introducing partner" : "Add introducing partner"}</DialogTitle><DialogDescription>This change is recorded in history. Existing issued documents keep their saved information.</DialogDescription></DialogHeader><div className="space-y-4">
      {data?.canChoose && <FormField id="partner-choice" label="Introducing collaborator / CP"><RecordSelect id="partner-choice" endpoint="/api/crm/partner-choices" value={partnerId} selected={data.partnerAttribution && data.introducedByCollaboratorId ? { value: data.introducedByCollaboratorId, label: label(data.partnerAttribution) } : undefined} onChange={setPartner} disabled={saving} showCode /></FormField>}
      {data?.introducedByCollaboratorId && <Button type="button" variant="outline" disabled={saving} onClick={() => setPartner("")}>Remove partner</Button>}
      <FormField id="partner-reason" label="Reason"><Textarea id="partner-reason" value={reason} onChange={event => setReason(event.target.value)} maxLength={1000} disabled={saving} /></FormField>
      {error && <p role="alert" className="text-destructive">{error}</p>}<div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={saving} onClick={() => setOpen(false)}>Cancel</Button><Button type="button" disabled={saving || !reason.trim() || partnerId === (data?.introducedByCollaboratorId || "")} onClick={save}>{saving ? "Saving…" : "Save partner change"}</Button></div>
    </div></DialogContent></Dialog>
  </Section>
}
