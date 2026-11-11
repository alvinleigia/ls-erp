"use client"
import * as React from "react"
import { AccessPageHeader } from "@/platform/access/record-page"
import { pageClass } from "@/components/erp/page"
import { Section } from "@/components/erp/section"
import { Button } from "@/components/ui/button"
type Settings = { version: number; retainDays: number | null; canPublish: boolean }
export function VerificationRetentionSettings() {
  const [saved, setSaved] = React.useState<Settings>(), [days, setDays] = React.useState(""), [hash, setHash] = React.useState(""), [busy, setBusy] = React.useState(false), [error, setError] = React.useState(""), [message, setMessage] = React.useState("")
  React.useEffect(() => {
    const controller = new AbortController()
    void fetch("/api/verification/retention", { cache: "no-store", signal: controller.signal }).then(async r => { const d = await r.json(); if (!r.ok) throw Error(d.error || "Unable to load retention settings."); if (!controller.signal.aborted) { setSaved(d); setDays(d.retainDays === null ? "" : String(d.retainDays)) } }).catch(e => { if (!controller.signal.aborted) setError(e.message) })
    return () => controller.abort()
  }, [])
  const retainDays = days.trim() ? Number(days) : null, valid = retainDays === null || Number.isInteger(retainDays) && retainDays >= 1 && retainDays <= 36500
  async function save(publish: boolean) {
    if (!saved || busy || !valid) return
    setBusy(true); setError("")
    try {
      const r = await fetch(`/api/verification/retention${publish ? "" : "/preview"}`, { method: publish ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: saved.version, retainDays, ...(publish ? { previewHash: hash } : {}) }) }), d = await r.json()
      if (!r.ok) throw Error(d.error || "Unable to save retention settings.")
      if (publish) { setSaved(d); setHash(""); setMessage(`Published retention settings version ${d.version}. No files were deleted.`) } else { setHash(d.previewHash); setMessage(retainDays === null ? "Review: retain accepted evidence indefinitely." : `Review: unreferenced accepted evidence may enter disposal review after ${retainDays} days. Holds and saved references always take priority. No files will be deleted.`) }
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save retention settings.") } finally { setBusy(false) }
  }
  return <div className={pageClass}><AccessPageHeader title="Verification retention" />{error && <p role="alert" className="text-sm text-destructive">{error}</p>}{message && <p role="status" className="text-sm">{message}</p>}
    {saved && <Section title={`Retention settings · ${saved.version ? `version ${saved.version}` : "not published"}`} help="The period starts when an original is accepted. Blank retains indefinitely. Preservation holds, saved submissions and transaction references take priority, including superseded or revoked submissions. This release only reviews eligibility; it does not erase files, facts, history or backups, and has no automatic purge. Configure periods for your business obligations. Existing signed download links expire naturally.">
      <label htmlFor="verification-retain-days" className="block text-sm font-medium">Retain unreferenced accepted evidence (days)</label><input id="verification-retain-days" type="number" min={1} max={36500} step={1} placeholder="Indefinitely" value={days} disabled={busy || !saved.canPublish} onChange={e => { setDays(e.target.value); setHash(""); setMessage("") }} className="mt-2 h-10 w-full max-w-sm rounded-md border bg-background px-3" />
      <p className="mt-3 text-sm text-muted-foreground">Automatic deletion is disabled. Review individual cases in Customer verification → Retention and holds.</p>
      {saved.canPublish && <div className="mt-4 flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={busy || !valid || saved.version > 0 && saved.retainDays === retainDays} onClick={() => void save(false)}>Preview retention settings</Button><Button type="button" disabled={busy || !hash} onClick={() => void save(true)}>Publish retention settings</Button></div>}
    </Section>}
  </div>
}
