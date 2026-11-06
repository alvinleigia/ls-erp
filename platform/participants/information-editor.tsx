"use client"
import * as React from "react"
import { ReloadDraft } from "@/components/erp/reload-draft"
import { Button } from "@/components/ui/button"
import { Section } from "@/components/erp/section"
import { EditPanel, ReadOnlyFields, RecordTabs } from "@/components/erp/record-detail"
import { AddressFields } from "@/platform/addresses/fields"
import { SavedAddressPicker } from "@/platform/addresses/controls"
import type { AddressRow, AddressPurpose } from "@/platform/addresses/contracts"
import { correspondenceSchema, emptyCorrespondence, informationFields, informationPartyKey, type Correspondence } from "./information"
import { defaultInformation, type ParticipantInformationView } from "./requirements"
import type { ParticipantInformation } from "./validation"

const purposes = ["correspondence", "billing", "delivery"] as const
type Purpose = typeof purposes[number]
const purposeLabels = { correspondence: "Correspondence", billing: "Billing", delivery: "Delivery / site" }
const records = (data: ParticipantInformationView, prefill = false): ParticipantInformation["records"] => [...new Map(data.participants.map(row => {
  const suggestion = prefill && !row.information ? data.defaults?.find(item => informationPartyKey(item.party) === informationPartyKey(row.party)) : undefined
  return [informationPartyKey(row.party), suggestion ?? { party: { kind: row.party.kind, id: row.party.id }, values: defaultInformation(row), ...(row.addresses ? { addresses: row.addresses } : {}), ...(row.addressReferences ? { addressReferences: row.addressReferences } : {}) }]
})).values()]

function AddressTabs({ children, errors }: { children: (purpose: Purpose) => React.ReactNode; errors?: unknown }) {
  const [purpose, setPurpose] = React.useState<string>("correspondence")
  return <RecordTabs value={purpose} onChange={setPurpose} keepMounted={!!errors} validationErrors={errors} tabs={purposes.map(value => ({ value, label: purposeLabels[value], content: children(value) }))} />
}
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
  function change(index: number, purpose: Purpose, field: keyof Correspondence, value: string) {
    setDraft(rows => rows.map((row, i) => {
      if (i !== index) return row
      const next = structuredClone(row)
      if (purpose === "correspondence") next.values[field] = value
      else next.addresses = { ...next.addresses, [purpose]: { ...emptyCorrespondence, ...next.addresses?.[purpose], [field]: value } }
      if (next.addressReferences) delete next.addressReferences[purpose]
      return next
    }))
    const key = `${index}:${purpose}:${field}`
    if (errors[key]) {
      setErrors(previous => { const next = { ...previous }; delete next[key]; return next })
      if (!conflict && Object.keys(errors).every(item => item === key)) setError("")
    }
  }
  function select(index: number, purpose: Purpose, selected: AddressRow) {
    setDraft(rows => rows.map((row, i) => i !== index ? row : { ...row, ...(purpose === "correspondence" ? { values: selected.values } : { addresses: { ...row.addresses, [purpose]: selected.values } }), addressReferences: { ...row.addressReferences, [purpose]: { id: selected.id, version: selected.version } } }))
    setErrors({}); if (!conflict) setError("")
  }
  function clear(index: number, purpose: "billing" | "delivery") {
    setDraft(rows => rows.map((row, i) => { if (i !== index) return row; const next = structuredClone(row); if (next.addresses) delete next.addresses[purpose]; if (next.addressReferences) delete next.addressReferences[purpose]; return next }))
  }
  function close() { setEditing(false); setConflict(false); setError(""); setErrors({}) }
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!data || saving || conflict) return
    const invalid: Record<string, string> = {}
    draft.forEach((row, i) => { for (const purpose of purposes) { const values = purpose === "correspondence" ? row.values : row.addresses?.[purpose]; if (!values) continue; const checked = correspondenceSchema.safeParse(values); if (!checked.success) for (const issue of checked.error.issues) invalid[`${i}:${purpose}:${String(issue.path[0])}`] = issue.message } })
    setErrors(invalid); if (Object.keys(invalid).length) { setError("Check the highlighted correspondence fields."); return }
    setSaving(true); setError("")
    try {
      const response = await fetch(endpoint, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: data.version, configurationVersion: data.configuration.version, information: { format: 1, records: draft } }) })
      const next = await response.json()
      if (!response.ok) { if (response.status === 409 && next.error?.includes("Reload before saving")) setConflict(true); throw new Error(next.error || "Unable to save customer details.") }
      setData(next); setDraft(records(next)); await onSaved(); setEditing(false)
    } catch (e) { setError((e as Error).message) } finally { setSaving(false) }
  }
  return <Section title={data?.configuration.definition.title || "Customer details"} description="Correspondence for this transaction. Saving here does not change the contact or business directory."
    actions={data?.canEdit && <Button variant="outline" onClick={() => { setDraft(records(data, true)); setEditing(true); setConflict(false); setError(""); setErrors({}) }}>Edit customer details</Button>} help={(data) && <div><p className="font-medium">Participant details</p>Drafts may be incomplete. Required fields are checked against the saved quotation when an order is confirmed.</div>}>
    {!editing && error && <p role="alert" className="text-sm text-destructive">{error}<Button variant="link" onClick={() => setReload(v => v + 1)}>Retry</Button></p>}
    {!data && !error && <p>Loading customer details...</p>}
    {data && <>
      {records(data).map(row => { const participant = data.participants.find(item => informationPartyKey(item.party) === informationPartyKey(row.party))!; return <div key={informationPartyKey(row.party)} className="space-y-3 rounded-md border p-4"><p className="break-words font-medium">{participant.party.name}</p><p className="text-sm text-muted-foreground">{data.participants.filter(item => informationPartyKey(item.party) === informationPartyKey(row.party)).map(item => data.configuration.preset.roleLabels[item.role]).join(", ")}</p><AddressTabs>{purpose => { const values = purpose === "correspondence" ? row.values : row.addresses?.[purpose]; return values ? <ReadOnlyFields fields={informationFields.map(field => ({ label: data.configuration.definition.labels[field], value: values[field] }))} /> : <p className="text-sm text-muted-foreground">No separate {purposeLabels[purpose].toLowerCase()} address saved for this transaction.</p> }}</AddressTabs></div> })}
      {data.missing.length > 0 && <div className="rounded-md border p-4 text-sm"><p className="font-medium">Needed before confirmation</p><ul className="mt-2 list-disc space-y-1 pl-5">{data.missing.map((item,i) => <li key={i}>{item.participant}: {item.label}</li>)}</ul></div>}
    </>}
    {data && editing && <EditPanel open title="Edit customer details" description="Names and participant identities stay linked to the saved selections. Enter correspondence for this transaction." onClose={close} onSubmit={save} saving={saving} dirty={dirty} error={error} disabled={!dirty || conflict} saveLabel="Save customer details"
      footerActions={conflict && <ReloadDraft disabled={saving} onReload={() => { close(); setReload(v => v + 1) }} />}>
      {data.defaults?.length ? <p role="status" className="rounded-md border bg-muted/30 p-3 text-sm">Directory details have been prefilled for participants without saved correspondence. Review and save to keep an independent copy for this transaction.</p> : null}
      {draft.map((row, i) => {
        const participant = data.participants.find(item => informationPartyKey(item.party) === informationPartyKey(row.party))!
        const needed = new Set(data.participants.filter(item => informationPartyKey(item.party) === informationPartyKey(row.party)).flatMap(item => data.configuration.definition.required[item.role]))
        const book = data.addressBooks?.find(item => informationPartyKey(item.party) === informationPartyKey(row.party))
        return <div key={informationPartyKey(row.party)} className="space-y-4 rounded-md border p-4"><p className="break-words font-medium">{participant.party.name}</p><p className="text-sm text-muted-foreground">{data.participants.filter(item => informationPartyKey(item.party) === informationPartyKey(row.party)).map(item => data.configuration.preset.roleLabels[item.role]).join(", ")}</p><AddressTabs errors={errors}>{purpose => <>
          <div className="flex flex-wrap items-center gap-3">{book && <SavedAddressPicker endpoint={book.endpoint} purpose={purpose.toUpperCase() as AddressPurpose} onSelect={value => select(i, purpose, value)} />}{purpose !== "correspondence" && row.addresses?.[purpose] && <Button type="button" variant="outline" onClick={() => clear(i, purpose)}>Clear separate address</Button>}</div>
          {row.addressReferences?.[purpose] && <p className="text-xs text-muted-foreground">Saved address copy · version {row.addressReferences[purpose]!.version}. Editing makes this a transaction-specific address.</p>}
          <AddressFields id={`info-${i}-${purpose}`} values={purpose === "correspondence" ? row.values : row.addresses?.[purpose] ?? emptyCorrespondence} labels={data.configuration.definition.labels} suffix={`${purpose === "correspondence" ? "" : ` (${purposeLabels[purpose].toLowerCase()})`} for ${participant.party.name}`} required={purpose === "correspondence" ? [...needed] : []} errors={Object.fromEntries(informationFields.map(field => [field, errors[`${i}:${purpose}:${field}`]]))} onChange={(field, value) => change(i, purpose, field, value)} />
        </>}</AddressTabs></div>
      })}
    </EditPanel>}
  </Section>
}
