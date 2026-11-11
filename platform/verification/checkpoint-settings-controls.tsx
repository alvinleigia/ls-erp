"use client"
import * as React from "react"
import { AccessPageHeader } from "@/platform/access/record-page"
import { pageClass } from "@/components/erp/page"
import { Section } from "@/components/erp/section"
import { Button } from "@/components/ui/button"
import { Checkbox, Select } from "@/components/erp/controls"
import { participantRoleLabels } from "@/platform/participants/validation"
import { verificationRoles } from "./contracts"
import { checkpointNames, checkpointModes, verificationCheckpoints, type CheckpointDefinition } from "./checkpoint-contracts"
type Settings = { version: number; definition: CheckpointDefinition; canPublish: boolean }
export function VerificationCheckpointSettingsControls() {
  const [saved, setSaved] = React.useState<Settings>(), [draft, setDraft] = React.useState<CheckpointDefinition>(), [previewHash, setPreviewHash] = React.useState(""), [busy, setBusy] = React.useState(false), [error, setError] = React.useState(""), [message, setMessage] = React.useState("")
  React.useEffect(() => {
    const controller = new AbortController()
    void fetch("/api/verification/checkpoints", { cache: "no-store", signal: controller.signal }).then(async r => { const data = await r.json(); if (!r.ok) throw Error(data.error || "Unable to load checkpoints."); if (!controller.signal.aborted) { setSaved(data); setDraft(data.definition) } }).catch(e => { if (!controller.signal.aborted) setError(e.message) })
    return () => controller.abort()
  }, [])
  const change = (d: CheckpointDefinition) => { setDraft(d); setPreviewHash(""); setMessage("") }
  async function save(publish: boolean) {
    if (!draft || !saved || busy) return
    setBusy(true); setError("")
    try {
      const response = await fetch(`/api/verification/checkpoints${publish ? "" : "/preview"}`, { method: publish ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: saved.version, definition: draft, ...(publish ? { previewHash } : {}) }) }), data = await response.json()
      if (!response.ok) throw Error(data.error || "Unable to save checkpoints.")
      if (publish) { setSaved(data); setDraft(data.definition); setPreviewHash(""); setMessage(`Published checkpoint settings version ${data.version}.`) } else { setPreviewHash(data.previewHash); setMessage("Review the selected modes and participant roles before publishing. New actions will use these rules; historical actions remain unchanged.") }
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save checkpoints.") } finally { setBusy(false) }
  }
  return <div className={pageClass}><AccessPageHeader title="Verification checkpoints" />{error && <p role="alert" className="text-destructive">{error}</p>}{message && <p role="status">{message}</p>}
    {saved && draft && <Section title={`Checkpoint settings · ${saved.version ? `version ${saved.version}` : "not published"}`} help="Off applies no gate. Warn lets the action continue and freezes any missing-verification warning. Required blocks the action unless every applicable saved participant has current approval. Begin with Warn during onboarding. Recording payments, existing documents and historical orders are not retrospectively blocked. If required checkpoints exist, disabling the verification module cannot bypass them.">
      <fieldset disabled={busy || !saved.canPublish} className="space-y-5"><div className="grid gap-4 sm:grid-cols-3">{verificationCheckpoints.map(k => <label key={k} className="block text-sm font-medium">{checkpointNames[k]}<Select aria-label={checkpointNames[k]} className="mt-2 w-full" value={draft.checkpoints[k]} onValueChange={v => change({ ...draft, checkpoints: { ...draft.checkpoints, [k]: v as typeof checkpointModes[number] } })}>{checkpointModes.map(mode => <option key={mode} value={mode}>{mode === "OFF" ? "Off" : mode === "WARN" ? "Warn" : "Required"}</option>)}</Select></label>)}</div>
        <div className="space-y-2"><p className="text-sm font-medium">Participant roles requiring verification</p><div className="flex flex-wrap gap-4">{verificationRoles.map(role => <label key={role} className="flex items-center gap-2 text-sm"><Checkbox disabled={role === "CUSTOMER"} checked={draft.roles.includes(role)} onChange={e => change({ ...draft, roles: e.target.checked ? [...draft.roles, role] : draft.roles.filter(r => r !== role) })} />{participantRoleLabels[role]}</label>)}</div></div>
      </fieldset>{saved.canPublish && <div className="mt-5 flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={busy || saved.version > 0 && JSON.stringify(saved.definition) === JSON.stringify(draft)} onClick={() => void save(false)}>Preview checkpoint rules</Button><Button type="button" disabled={busy || !previewHash} onClick={() => void save(true)}>Publish checkpoint rules</Button></div>}
    </Section>}
  </div>
}
