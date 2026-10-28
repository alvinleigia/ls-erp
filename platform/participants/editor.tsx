"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Checkbox, Select } from "@/components/erp/controls"
import { Section } from "@/components/erp/section"
import { EditPanel } from "@/components/erp/record-detail"
import { RecordSelect } from "@/components/erp/record-select"
import { FormField } from "@/components/form-field"
import { participantKey, type AdditionalParticipant, type ParticipantEditorData, type ParticipantRole } from "./validation"

export type ParticipantLabels = Record<ParticipantRole, string>
export const defaultParticipantLabels: ParticipantLabels = { CUSTOMER: "Main customer", ADDITIONAL_CUSTOMER: "Additional customer", REPRESENTATIVE: "Representative" }
type Draft = AdditionalParticipant & { name: string; saved: boolean; available: boolean }
const draftRows = (data: ParticipantEditorData): Draft[] => data.participants.map(row => ({ role: row.role as AdditionalParticipant["role"], party: { kind: row.party.kind, id: row.party.id }, name: row.party.name, saved: true, available: row.available }))

// Source adapters supply endpoints and terminology. This component knows no
// CRM/property fields and sends references only, never accepted display facts.
export function ParticipantEditor({ endpoint, sourceVersion, onSaved, labels = defaultParticipantLabels }: {
  endpoint: string; sourceVersion: number; onSaved: (version: number) => void | Promise<void>; labels?: ParticipantLabels;
}) {
  const [data, setData] = React.useState<ParticipantEditorData | null>(null)
  const [draft, setDraft] = React.useState<Draft[]>([])
  const [editing, setEditing] = React.useState(false), [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState(""), [conflict, setConflict] = React.useState(false), [reload, setReload] = React.useState(0)
  const [kind, setKind] = React.useState<"PERSON" | "BUSINESS">("PERSON")
  const [role, setRole] = React.useState<AdditionalParticipant["role"]>("ADDITIONAL_CUSTOMER")
  const [choice, setChoice] = React.useState<{ id: string; name: string } | null>(null)
  React.useEffect(() => {
    if (editing) return
    const controller = new AbortController()
    setData(null); setError("")
    void fetch(endpoint, { signal: controller.signal, cache: "no-store" }).then(async response => {
      const next = await response.json()
      if (!response.ok) throw new Error(next.error || "Unable to load participants.")
      if (!controller.signal.aborted) { setData(next); setDraft(draftRows(next)); setKind(next.canChoosePerson ? "PERSON" : "BUSINESS") }
    }).catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => controller.abort()
  }, [endpoint, sourceVersion, editing, reload])
  const dirty = !!data && JSON.stringify(draft) !== JSON.stringify(draftRows(data))
  const alreadyIncluded = !!choice && (data?.primary.some(row => row.party.kind === kind && row.party.id === choice.id && (row.role === "CUSTOMER" || row.role === role)) || draft.some(row => row.party.kind === kind && row.party.id === choice.id && row.role === role))
  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!data || saving || conflict) return
    setSaving(true); setError("")
    try {
      const response = await fetch(endpoint, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: data.version, participants: draft.map(({ role, party, refresh }) => ({ role, party, ...(refresh ? { refresh: true } : {}) })) }) })
      const next = await response.json()
      if (!response.ok) { if (response.status === 409) setConflict(true); throw new Error(next.error || "Unable to save participants.") }
      setData(next); setDraft(draftRows(next)); await onSaved(next.version); setEditing(false)
    } catch (error) { setError((error as Error).message) } finally { setSaving(false) }
  }
  function close() { setEditing(false); setConflict(false); setChoice(null); setError("") }
  return <Section title="Participants" description="Customer roles for this transaction. These roles do not grant system access or ownership shares."
    actions={data?.canEdit && <Button type="button" variant="outline" onClick={() => { setDraft(draftRows(data)); setConflict(false); setError(""); setEditing(true) }}>Edit participants</Button>}>
    {!editing && error && <p role="alert" className="text-sm text-destructive">{error} <Button variant="link" onClick={() => setReload(value => value + 1)}>Retry</Button></p>}
    {!data && !error && <p>Loading participants...</p>}
    {data && <div className="space-y-3">{[...data.primary, ...data.participants].map(row => <div key={participantKey(row)} className="min-w-0 rounded-md border p-4 text-sm">
      <p className="font-medium">{row.party.name}</p><p className="text-muted-foreground">{labels[row.role]} · {row.party.kind === "PERSON" ? "Person" : "Business"}</p>
      {(row.party.email || row.party.phone) && <p className="mt-1 break-words">{[row.party.email, row.party.phone].filter(Boolean).join(" · ")}</p>}
      {"available" in row && !row.available && <p className="mt-1 text-muted-foreground">Saved selection. Unavailable for a new selection or refresh.</p>}
    </div>)}{!data.participants.length && <p className="text-sm text-muted-foreground">No additional participants.</p>}
    <p className="text-sm text-muted-foreground">The main customer follows the source contact/business. Additional details stay as saved until explicitly refreshed. New quotation revisions copy these participants; saved orders keep their selected revision.</p></div>}
    {data && editing && <EditPanel open title="Edit participants" description="Add customers or representatives. Removing a row does not delete the contact or business." onClose={close} onSubmit={save} saving={saving} dirty={dirty} error={error} disabled={!dirty || conflict} saveLabel="Save participants"
      footerActions={conflict && <Button type="button" variant="outline" disabled={saving} onClick={() => { if (window.confirm("Discard this participant draft and reload the saved selections?")) { close(); setReload(value => value + 1) } }}>Reload saved participants</Button>}>
      {draft.map((row, index) => <div key={`${index}:${row.party.kind}:${row.party.id}`} className="space-y-3 rounded-md border p-4">
        <p className="break-words font-medium">{row.name}</p>
        <FormField id={`participant-role-${index}`} label={`Role for ${row.name}`}><Select id={`participant-role-${index}`} value={row.role} disabled={!row.available} onValueChange={role => setDraft(rows => rows.map((item, i) => i === index ? { ...item, role: role as Draft["role"] } : item))}>
          <option value="ADDITIONAL_CUSTOMER">{labels.ADDITIONAL_CUSTOMER}</option><option value="REPRESENTATIVE">{labels.REPRESENTATIVE}</option>
        </Select></FormField>
        {row.saved && row.available && <label className="flex items-center gap-2 text-sm"><Checkbox checked={!!row.refresh} onChange={event => setDraft(rows => rows.map((item, i) => i === index ? { ...item, refresh: event.target.checked } : item))} />Refresh details from the current directory</label>}
        {!row.available && <p className="text-sm text-muted-foreground">Saved selection retained. You can keep or remove it.</p>}
        <Button type="button" variant="outline" size="sm" onClick={() => setDraft(rows => rows.filter((_, i) => i !== index))}>Remove {row.name}</Button>
      </div>)}
      {(data.canChoosePerson || data.canChooseBusiness) && draft.length < 98 ? <div className="space-y-4 rounded-md border p-4">
        <FormField id="participant-kind" label="Participant type"><Select id="participant-kind" value={kind} onValueChange={value => { setKind(value as typeof kind); setChoice(null) }}><option value="PERSON" disabled={!data.canChoosePerson}>Person</option><option value="BUSINESS" disabled={!data.canChooseBusiness}>Business</option></Select></FormField>
        <FormField id="participant-new-role" label="New participant role"><Select id="participant-new-role" value={role} onValueChange={value => setRole(value as typeof role)}><option value="ADDITIONAL_CUSTOMER">{labels.ADDITIONAL_CUSTOMER}</option><option value="REPRESENTATIVE">{labels.REPRESENTATIVE}</option></Select></FormField>
        <FormField id="participant-choice" label="Choose participant"><RecordSelect key={kind} id="participant-choice" endpoint={`${endpoint}/choices?kind=${kind}`} value={choice?.id || ""} onChange={(id, option) => setChoice(option ? { id, name: option.label } : null)} /></FormField>
        {alreadyIncluded && <p className="text-sm text-muted-foreground">This participant is already included in that role or is the main customer.</p>}
        <Button type="button" variant="outline" disabled={!choice || alreadyIncluded} onClick={() => { if (choice) { setDraft(rows => [...rows, { role, party: { kind, id: choice.id }, name: choice.name, saved: false, available: true }]); setChoice(null) } }}>Add participant</Button>
      </div> : <p className="text-sm text-muted-foreground">{draft.length >= 98 ? "The limit is 98 additional participants." : "Directory Read permission is required to add participants."}</p>}
    </EditPanel>}
  </Section>
}
