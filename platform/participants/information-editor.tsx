"use client"
import * as React from "react"
import { ReloadDraft } from "@/components/erp/reload-draft"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Section } from "@/components/erp/section"
import { EditPanel, ReadOnlyFields } from "@/components/erp/record-detail"
import { FormField } from "@/components/form-field"
import { SearchableSelect } from "@/components/searchable-select"
import { COUNTRY_OPTIONS } from "@/lib/constants/countries"
import { correspondenceSchema, informationFields, informationPartyKey, type Correspondence } from "./information"
import { defaultInformation, type ParticipantInformationView } from "./requirements"
import type { ParticipantInformation } from "./validation"

const records = (data: ParticipantInformationView): ParticipantInformation["records"] => [...new Map(data.participants.map(row => [informationPartyKey(row.party), { party: { kind: row.party.kind, id: row.party.id }, values: defaultInformation(row) }])).values()]
export function ParticipantInformationEditor({ endpoint, sourceVersion, onSaved }: { endpoint: string; sourceVersion: number; onSaved: () => Promise<void> }) {
  const [data, setData] = React.useState<ParticipantInformationView>(), [draft, setDraft] = React.useState<ParticipantInformation["records"]>([])
  const [editing, setEditing] = React.useState(false), [saving, setSaving] = React.useState(false), [conflict, setConflict] = React.useState(false), [reload, setReload] = React.useState(0)
  const [error, setError] = React.useState(""), [errors, setErrors] = React.useState<Record<string, string>>({})
  React.useEffect(() => {
    if (editing) return
    const c = new AbortController(); setData(undefined); setError("")
    void fetch(endpoint, { signal: c.signal, cache: "no-store" }).then(async response => {
      const next = await response.json(); if (!response.ok) throw new Error(next.error || "Unable to load customer details.")
      if (!c.signal.aborted) { setData(next); setDraft(records(next)) }
    }).catch(e => { if (!c.signal.aborted) setError(e.message) })
    return () => c.abort()
  }, [endpoint, sourceVersion, editing, reload])
  const dirty = !!data && JSON.stringify(records(data)) !== JSON.stringify(draft)
  function change(index: number, field: keyof Correspondence, value: string) {
    setDraft(rows => rows.map((row, i) => i === index ? { ...row, values: { ...row.values, [field]: value } } : row))
    const key = `${index}:${field}`
    if (errors[key]) {
      setErrors(previous => { const next = { ...previous }; delete next[key]; return next })
      if (!conflict && Object.keys(errors).every(item => item === key)) setError("")
    }
  }
  function close() { setEditing(false); setConflict(false); setError(""); setErrors({}) }
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!data || saving || conflict) return
    const invalid: Record<string, string> = {}
    draft.forEach((row, i) => { const checked = correspondenceSchema.safeParse(row.values); if (!checked.success) for (const issue of checked.error.issues) invalid[`${i}:${String(issue.path[0])}`] = issue.message })
    setErrors(invalid); if (Object.keys(invalid).length) { setError("Check the highlighted correspondence fields."); return }
    setSaving(true); setError("")
    try {
      const response = await fetch(endpoint, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: data.version, configurationVersion: data.configuration.version, information: { format: 1, records: draft } }) })
      const next = await response.json()
      if (!response.ok) { if (response.status === 409) setConflict(true); throw new Error(next.error || "Unable to save customer details.") }
      setData(next); setDraft(records(next)); await onSaved(); setEditing(false)
    } catch (e) { setError((e as Error).message) } finally { setSaving(false) }
  }
  return <Section title={data?.configuration.definition.title || "Customer details"} description="Correspondence for this transaction. Saving here does not change the contact or business directory."
    actions={data?.canEdit && <Button variant="outline" onClick={() => { setDraft(records(data)); setEditing(true); setConflict(false); setError(""); setErrors({}) }}>Edit customer details</Button>}>
    {!editing && error && <p role="alert" className="text-sm text-destructive">{error}<Button variant="link" onClick={() => setReload(v => v + 1)}>Retry</Button></p>}
    {!data && !error && <p>Loading customer details...</p>}
    {data && <><p className="text-sm text-muted-foreground">Drafts may be incomplete. Required fields are checked against the saved quotation when an order is confirmed.</p>
      {records(data).map(row => { const participant = data.participants.find(item => informationPartyKey(item.party) === informationPartyKey(row.party))!; return <div key={informationPartyKey(row.party)} className="space-y-3 rounded-md border p-4"><p className="break-words font-medium">{participant.party.name}</p><p className="text-sm text-muted-foreground">{data.participants.filter(item => informationPartyKey(item.party) === informationPartyKey(row.party)).map(item => data.configuration.preset.roleLabels[item.role]).join(", ")}</p><ReadOnlyFields fields={informationFields.map(field => ({ label: data.configuration.definition.labels[field], value: row.values[field] }))} /></div> })}
      {data.missing.length > 0 && <div className="rounded-md border p-4 text-sm"><p className="font-medium">Needed before confirmation</p><ul className="mt-2 list-disc space-y-1 pl-5">{data.missing.map((item,i) => <li key={i}>{item.participant}: {item.label}</li>)}</ul></div>}
    </>}
    {data && editing && <EditPanel open title="Edit customer details" description="Names and participant identities stay linked to the saved selections. Enter correspondence for this transaction." onClose={close} onSubmit={save} saving={saving} dirty={dirty} error={error} disabled={!dirty || conflict} saveLabel="Save customer details"
      footerActions={conflict && <ReloadDraft disabled={saving} onReload={() => { close(); setReload(v => v + 1) }} />}>
      {draft.map((row, i) => {
        const participant = data.participants.find(item => informationPartyKey(item.party) === informationPartyKey(row.party))!
        const needed = new Set(data.participants.filter(item => informationPartyKey(item.party) === informationPartyKey(row.party)).flatMap(item => data.configuration.definition.required[item.role]))
        return <div key={informationPartyKey(row.party)} className="space-y-4 rounded-md border p-4"><p className="break-words font-medium">{participant.party.name}</p><p className="text-sm text-muted-foreground">{data.participants.filter(item => informationPartyKey(item.party) === informationPartyKey(row.party)).map(item => data.configuration.preset.roleLabels[item.role]).join(", ")}</p><div className="grid gap-4 sm:grid-cols-2">{informationFields.map(field => <FormField key={field} id={`info-${i}-${field}`} label={`${data.configuration.definition.labels[field]} for ${participant.party.name}`} error={errors[`${i}:${field}`]}>
          {field === "country" ? <SearchableSelect id={`info-${i}-${field}`} value={row.values[field]} options={[{ value: "", label: "Not specified" }, ...COUNTRY_OPTIONS.map(value => ({ value, label: value }))]} onChange={value => change(i,field,value)} placeholder="Choose a country" /> : <Input id={`info-${i}-${field}`} value={row.values[field]} maxLength={field === "email" ? 254 : field === "phone" ? 40 : field.startsWith("address") ? 200 : field === "postalCode" ? 30 : 100} inputMode={field === "email" ? "email" : field === "phone" ? "tel" : "text"} onChange={event => change(i,field,event.target.value)} />}
          {needed.has(field) && <p className="text-xs text-muted-foreground">Needed at confirmation</p>}
        </FormField>)}</div></div>
      })}
    </EditPanel>}
  </Section>
}
