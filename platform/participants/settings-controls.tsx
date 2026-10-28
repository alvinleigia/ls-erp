"use client"
import * as React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/erp/controls"
import { Section } from "@/components/erp/section"
import { ReloadDraft } from "@/components/erp/reload-draft"
import { pageClass } from "@/components/erp/page"
import { AccessPageHeader } from "@/platform/access/record-page"
import { informationFields, informationLabels, type InformationField } from "./information"
import { participantRoles, participantFormDefinitionSchema, type ParticipantFormConfiguration, type ParticipantFormDefinition } from "./requirements"
import type { ParticipantImpact } from "./configuration"

type Settings = ParticipantFormConfiguration & { canPublish: boolean }
type Preview = { impact: ParticipantImpact; previewHash: string }
export function ParticipantSettingsControls() {
  const [saved, setSaved] = React.useState<Settings>(), [draft, setDraft] = React.useState<ParticipantFormDefinition>(), [preview, setPreview] = React.useState<Preview>()
  const [busy, setBusy] = React.useState(false), [error, setError] = React.useState(""), [reload, setReload] = React.useState(0)
  React.useEffect(() => {
    const c = new AbortController()
    void fetch("/api/participant-settings", { signal: c.signal, cache: "no-store" }).then(async response => {
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Unable to load customer detail settings.")
      if (!c.signal.aborted) { setSaved(data); setDraft(structuredClone(data.definition)); setPreview(undefined); setError("") }
    }).catch(e => { if (!c.signal.aborted) setError(e.message) })
    return () => c.abort()
  }, [reload])
  function change(next: ParticipantFormDefinition) { setDraft(next); setPreview(undefined) }
  function toggle(role: typeof participantRoles[number], field: InformationField, checked: boolean) {
    if (draft) change({ ...draft, required: { ...draft.required, [role]: informationFields.filter(key => key === field ? checked : draft.required[role].includes(key)) } })
  }
  async function submit(publish: boolean) {
    if (!saved || !draft || busy) return
    const checked = participantFormDefinitionSchema.safeParse(draft)
    if (!checked.success) {
      const path = checked.error.issues[0].path
      setError(path[0] === "labels" ? `Enter a label for ${informationLabels[path[1] as InformationField]}.` : "Enter a form title and valid requirement choices.")
      return
    }
    setBusy(true); setError("")
    try {
      const response = await fetch(publish ? "/api/participant-settings" : "/api/participant-settings/preview", { method: publish ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: saved.version, definition: draft, ...(publish ? { previewHash: preview?.previewHash } : {}) }) })
      const data = await response.json(); if (!response.ok) { setPreview(undefined); throw new Error(data.error || "Unable to save customer detail settings.") }
      if (publish) { setSaved(data); setDraft(structuredClone(data.definition)); setPreview(undefined) } else setPreview(data)
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  const dirty = !!saved && !!draft && JSON.stringify(saved.definition) !== JSON.stringify(draft)
  return <div className={pageClass}><AccessPageHeader title="Customer detail requirements" description="Choose field labels and the details required when an order is confirmed. Names, identities, money and access rules stay fixed." actions={<ReloadDraft disabled={busy} label="Reload settings" onReload={() => setReload(v => v + 1)} />} />
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {!draft && !error && <p>Loading settings...</p>}
    {draft && saved && <><Section title="Form labels and required details" description="Drafts can be saved with missing details. Published requirements apply to future confirmations, including existing draft orders. Confirmed orders keep their accepted rules.">
      <fieldset disabled={busy || !saved.canPublish} className="space-y-5"><div className="space-y-2"><label htmlFor="participant-form-title" className="text-sm font-medium">Form title</label><Input id="participant-form-title" value={draft.title} maxLength={60} onChange={event => change({ ...draft, title: event.target.value })} /></div>
        <div className="max-w-full overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Field label</th>{participantRoles.map(role => <th key={role} className="p-2">{saved.preset.roleLabels[role]}</th>)}</tr></thead><tbody>{informationFields.map(field => <tr key={field} className="border-t"><td className="min-w-44 p-2"><Input aria-label={`Label for ${field}`} value={draft.labels[field]} maxLength={60} onChange={event => change({ ...draft, labels: { ...draft.labels, [field]: event.target.value } })} /></td>{participantRoles.map(role => <td key={role} className="p-2"><Checkbox aria-label={`Require ${field} for ${saved.preset.roleLabels[role]}`} checked={draft.required[role].includes(field)} onChange={event => toggle(role, field, event.target.checked)} /></td>)}</tr>)}</tbody></table></div>
      </fieldset>
      <p className="text-sm text-muted-foreground">Checked fields are needed for every participant in that role. Other descriptive custom fields retain their existing validation. Identity documents, signatures and ownership shares are not collected here.</p>
      {saved.canPublish && <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy || !dirty} onClick={() => void submit(false)}>Preview impact</Button><Button disabled={busy || !dirty || !preview} loading={busy} onClick={() => void submit(true)}>Publish requirements</Button></div>}
    </Section>
    {preview && <Section title="Impact preview">{preview.impact.accessibleDrafts === null ? <p>The order module or its Read permission is unavailable. Existing draft orders could not be checked; published rules will still apply when confirmation is available.</p> : <p>{preview.impact.accessibleDrafts} accessible draft orders checked; {preview.impact.incompleteDrafts} would need additional details. This preview covers orders you can read, including their office boundaries. Confirmed orders are excluded.</p>}<p className="text-sm text-muted-foreground">Frozen drafts are not rewritten. If an existing draft is incomplete, correct the opportunity details, save a new quotation revision, then cancel and replace that draft.</p></Section>}
    </>}
  </div>
}
