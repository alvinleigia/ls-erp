"use client"
import * as React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox, Select } from "@/components/erp/controls"
import { Section } from "@/components/erp/section"
import { pageClass } from "@/components/erp/page"
import { AccessPageHeader } from "@/platform/access/record-page"
import { ReloadDraft } from "@/components/erp/reload-draft"
import { verificationPolicySchema, verificationRoles, type VerificationConfiguration, type VerificationPolicy } from "./contracts"

type Settings = VerificationConfiguration & { canPublish: boolean }
type Preview = { previewHash: string; facts: number; documents: number }
const roleNames = { CUSTOMER: "Customer", ADDITIONAL_CUSTOMER: "Additional customer", REPRESENTATIVE: "Representative" }
export function VerificationSettingsControls() {
  const [saved, setSaved] = React.useState<Settings>(), [draft, setDraft] = React.useState<VerificationPolicy>()
  const [preview, setPreview] = React.useState<Preview>(), [tab, setTab] = React.useState<"facts" | "documents">("facts")
  const [error, setError] = React.useState(""), [message, setMessage] = React.useState(""), [busy, setBusy] = React.useState(false), [reload, setReload] = React.useState(0)
  React.useEffect(() => {
    const controller = new AbortController()
    void fetch("/api/verification/policy", { cache: "no-store", signal: controller.signal }).then(async response => {
      const body = await response.json(); if (!response.ok) throw new Error(body.error || "Unable to load verification requirements.")
      if (!controller.signal.aborted) { setSaved(body); setDraft(structuredClone(body.definition)); setPreview(undefined); setError("") }
    }).catch(e => { if (!controller.signal.aborted) setError(e.message) })
    return () => controller.abort()
  }, [reload])
  function change(next: VerificationPolicy) { setDraft(next); setPreview(undefined); setMessage("") }
  const dirty = !!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(saved.definition)
  async function submit(publish: boolean) {
    if (!saved || !draft || busy) return
    const parsed = verificationPolicySchema.safeParse(draft)
    if (!parsed.success) { setError(parsed.error.issues[0].message); return }
    setBusy(true); setError(""); setMessage("")
    try {
      const response = await fetch(publish ? "/api/verification/policy" : "/api/verification/policy/preview", {
        method: publish ? "PUT" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: saved.version, definition: parsed.data, ...(publish ? { previewHash: preview?.previewHash } : {}) }),
      })
      const body = await response.json(); if (!response.ok) throw new Error(body.error || "Unable to save verification requirements.")
      if (publish) { setSaved(body); setDraft(structuredClone(body.definition)); setPreview(undefined); setMessage(`Published verification requirements version ${body.version}.`) }
      else setPreview(body)
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save verification requirements.") }
    finally { setBusy(false) }
  }
  function updateRow(index: number, patch: object) {
    if (!draft) return
    change({ ...draft, [tab]: draft[tab].map((row, i) => i === index ? { ...row, ...patch } : row) })
  }
  function add() {
    if (!draft) return
    let n = 1; while (draft[tab].some(row => row.code === `${tab === "facts" ? "fact" : "document"}_${n}`)) n++
    const row = { code: `${tab === "facts" ? "fact" : "document"}_${n}`, label: "", subjects: ["PERSON", "BUSINESS"] as ("PERSON" | "BUSINESS")[], roles: [...verificationRoles] }
    change(tab === "facts" ? { ...draft, facts: [...draft.facts, { ...row, type: "TEXT" }] } : { ...draft, documents: [...draft.documents, row] })
  }
  return <div className={pageClass}>
    <AccessPageHeader title="Customer verification requirements" />
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {message && <p role="status">{message}</p>}
    {!saved && !error && <p>Loading requirements…</p>}
    {saved && draft && <>
      <Section title={`Requirements · ${saved.version ? `published version ${saved.version}` : "not published"}`} help="Each selected fact or document type will be required for the chosen subject and participant roles. These settings define internal human review; they do not claim government identity validation. Transaction checkpoints are configured separately. Recording payments already received is never gated here.">
        <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">{dirty ? "Unpublished changes" : "Saved requirements"}</p><ReloadDraft disabled={busy} onReload={() => setReload(n => n + 1)} /></div>
        <div role="tablist" aria-label="Verification requirements" className="flex flex-wrap gap-2">{(["facts", "documents"] as const).map(key => <Button key={key} type="button" role="tab" aria-selected={tab === key} disabled={busy} variant={tab === key ? "secondary" : "ghost"} onClick={() => setTab(key)}>{key === "facts" ? "Required facts" : "Required documents"} ({draft[key].length})</Button>)}</div>
        <fieldset disabled={busy || !saved.canPublish} className="mt-4 space-y-4">
          <div className="max-w-sm space-y-2"><label htmlFor="verification-validity" className="text-sm font-medium">Approval validity (days; blank means no automatic expiry)</label><Input id="verification-validity" type="number" min={1} max={3650} value={draft.validityDays ?? ""} onChange={e => change({ ...draft, validityDays: e.target.value === "" ? null : Number(e.target.value) })} /></div>
          <p className="text-sm">A separate authorised reviewer must approve submissions. Collectors cannot approve their own work.</p>
          <div role="tabpanel" aria-label={tab === "facts" ? "Required facts" : "Required documents"} className="space-y-4">
            {!draft[tab].length && <p className="text-sm text-muted-foreground">No {tab === "facts" ? "facts" : "document types"} required yet. Add only what your business needs to review.</p>}
            {draft[tab].map((row, index) => <div key={`${tab}-${index}`} className="space-y-3 rounded-lg border p-4">
              <div className="grid gap-3 sm:grid-cols-2"><div><label className="text-sm" htmlFor={`v-code-${index}`}>Code</label><Input id={`v-code-${index}`} maxLength={40} value={row.code} onChange={e => updateRow(index, { code: e.target.value })} /></div><div><label className="text-sm" htmlFor={`v-label-${index}`}>Label</label><Input id={`v-label-${index}`} maxLength={100} value={row.label} onChange={e => updateRow(index, { label: e.target.value })} /></div></div>
              {"type" in row && <div className="space-y-1"><label className="block text-sm" htmlFor={`v-type-${index}`}>Fact type</label><Select id={`v-type-${index}`} value={row.type} onValueChange={value => updateRow(index, { type: value })}><option value="TEXT">Text</option><option value="DATE">Date</option><option value="EMAIL">Email</option><option value="COUNTRY">Country</option></Select></div>}
              <div className="flex flex-wrap gap-4" aria-label="Subject types">{(["PERSON", "BUSINESS"] as const).map(kind => <label key={kind} className="flex items-center gap-2 text-sm"><Checkbox checked={row.subjects.includes(kind)} onChange={e => updateRow(index, { subjects: e.target.checked ? [...row.subjects, kind] : row.subjects.filter(v => v !== kind) })} />{kind === "PERSON" ? "Person" : "Business"}</label>)}</div>
              <div className="flex flex-wrap gap-4" aria-label="Participant roles">{verificationRoles.map(role => <label key={role} className="flex items-center gap-2 text-sm"><Checkbox checked={row.roles.includes(role)} onChange={e => updateRow(index, { roles: e.target.checked ? [...row.roles, role] : row.roles.filter(v => v !== role) })} />{roleNames[role]}</label>)}</div>
              <Button type="button" variant="ghost" onClick={() => change({ ...draft, [tab]: draft[tab].filter((_, i) => i !== index) })}>Remove {tab === "facts" ? "fact" : "document type"}</Button>
            </div>)}
            <Button type="button" variant="outline" disabled={draft[tab].length >= (tab === "facts" ? 30 : 20)} onClick={add}>Add {tab === "facts" ? "fact" : "document type"}</Button>
          </div>
        </fieldset>
      </Section>
      {saved.canPublish && <Section title="Review and publish" help="Publishing keeps prior requirement versions. It does not change customer facts, approve cases, rewrite accepted documents, or change checkpoint modes.">
        {preview && <p role="status" className="mb-4">Preview: {preview.facts} fact requirements and {preview.documents} document types. Transaction checkpoints are configured separately.</p>}
        <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy || !dirty && saved.version > 0} onClick={() => void submit(false)}>Preview requirements</Button><Button disabled={busy || !preview} loading={busy} onClick={() => void submit(true)}>Publish requirements</Button></div>
      </Section>}
    </>}
  </div>
}
