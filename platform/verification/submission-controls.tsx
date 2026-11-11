"use client"
import * as React from "react"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/erp/controls"
import { COUNTRY_OPTIONS } from "@/lib/constants/countries"
import { applicableRequirements, verificationRoles, type VerificationPolicy, type VerificationSubject } from "./contracts"

type Review = { number: number; decision: string; reason: string | null; validUntil: string | null }
type View = {
  case: { id: string } | null; status: string; policy: { version: number; definition: VerificationPolicy }; revisionPolicy: { version: number; definition: VerificationPolicy }
  submission: { id: string; number: number; policyVersion: number; role: typeof verificationRoles[number]; facts: { code: string; value: string }[]; evidenceIds: string[] } | null
  history: { id: string; number: number; policyVersion: number; role: string; submittedAt: string; reason: string | null; reviews: Review[] }[]
  evidence: { id: string; documentCode: string; filename: string }[]; canSubmit: boolean; canReview: boolean; canRevoke: boolean; canReadEvidence: boolean; selfReview: boolean
}
const readable = (s: string) => s.toLowerCase().replaceAll("_", " ").replace(/^./, c => c.toUpperCase())
async function post(path: string, data: unknown) {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) })
  const result = await response.json(); if (!response.ok) throw Error(result.error || "Unable to complete verification action."); return result
}
export function VerificationSubmissions({ kind, id, changed, onChanged }: VerificationSubject & { changed: number; onChanged: () => void }) {
  const [view, setView] = React.useState<View>(), [error, setError] = React.useState(""), [busy, setBusy] = React.useState(false), [message, setMessage] = React.useState("")
  const [role, setRole] = React.useState<typeof verificationRoles[number]>("CUSTOMER"), [values, setValues] = React.useState<Record<string, string>>({}), [files, setFiles] = React.useState<string[]>([]), [reason, setReason] = React.useState("")
  const [reviewReason, setReviewReason] = React.useState(""), [reviewed, setReviewed] = React.useState(false), initialized = React.useRef("")
  React.useEffect(() => {
    const controller = new AbortController()
    void fetch(`/api/verification/submissions?${new URLSearchParams({ kind, id })}`, { cache: "no-store", signal: controller.signal }).then(async r => {
      const data: View & { error?: string } = await r.json(); if (!r.ok) throw Error(data.error || "Unable to load private submissions.")
      if (controller.signal.aborted) return
      setView(data); setError("")
      const key = `${kind}:${id}:${data.policy.version}:${data.submission?.number ?? 0}:${data.history[0]?.reviews[0]?.number ?? 0}`
      if (initialized.current !== key) {
        initialized.current = key; setRole(data.submission?.role ?? "CUSTOMER"); setValues(Object.fromEntries(data.submission?.facts.map(f => [f.code, f.value]) ?? [])); setFiles(data.submission?.evidenceIds ?? []); setReason(""); setReviewReason(""); setReviewed(false)
      }
    }).catch(e => { if (!controller.signal.aborted) setError(e.message) })
    return () => controller.abort()
  }, [kind, id, changed])
  async function act(work: () => Promise<unknown>, success: string) {
    if (busy) return
    setBusy(true); setError(""); setMessage("")
    try { await work(); setMessage(success); onChanged() } catch (e) { setError(e instanceof Error ? e.message : "Unable to complete this action.") } finally { setBusy(false) }
  }
  const requirements = view && applicableRequirements(view.policy.definition, kind, role), submittedRequirements = view?.submission && applicableRequirements(view.revisionPolicy.definition, kind, view.submission.role)
  const currentReview = view?.history[0]?.reviews[0], awaiting = !!view?.submission && !currentReview
  const review = (decision: "APPROVED" | "CHANGES_REQUIRED" | "REVOKED") => view?.submission && post("/api/verification/reviews", { submissionId: view.submission.id, version: view.submission.number, reviewVersion: currentReview?.number ?? 0, decision, reviewed, ...(reviewReason.trim() ? { reason: reviewReason.trim() } : {}) })
  return <div className="space-y-4">
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}{message && <p role="status" className="text-sm">{message}</p>}
    {!view && !error && <p>Loading private submissions…</p>}
    {view && <>
      <p className="font-medium">Review status: {readable(view.status)}</p>
      {view.submission && <div className="space-y-3 rounded-lg border p-4"><h3 className="font-medium">Submitted revision {view.submission.number}</h3><p className="text-sm text-muted-foreground">Policy {view.submission.policyVersion} · {readable(view.submission.role)}</p>
        <dl className="grid gap-3 sm:grid-cols-2">{view.submission.facts.map(f => <div key={f.code} className="min-w-0"><dt className="text-sm text-muted-foreground">{submittedRequirements?.facts.find(d => d.code === f.code)?.label ?? f.code}</dt><dd className="break-words text-sm font-medium">{f.value}</dd></div>)}</dl>
        <h4 className="text-sm font-medium">Evidence in this revision</h4>{!view.submission.evidenceIds.length ? <p className="text-sm">No evidence required by this revision.</p> : view.submission.evidenceIds.map(fileId => <div key={fileId} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2"><span className="min-w-0 break-all text-sm">{view.evidence.find(e => e.id === fileId)?.filename ?? "Private selected file"}</span>{view.canReadEvidence && <Button asChild variant="outline"><a href={`/api/verification/evidence/${fileId}/download`} target="_blank" rel="noopener noreferrer">Download selected evidence</a></Button>}</div>)}
        {view.submission.policyVersion !== view.policy.version && <p className="text-sm">Requirements have changed. Submit a new revision before approval.</p>}
        {view.canReview && awaiting && <div className="space-y-3 border-t pt-3">
          {view.selfReview && <p className="text-sm">A different reviewer must approve your submission or evidence.</p>}
          <label className="flex gap-2 text-sm"><input type="checkbox" checked={reviewed} disabled={busy} onChange={e => setReviewed(e.target.checked)} />I have reviewed the submitted facts and selected evidence.</label>
          <label className="block text-sm">Review reason<textarea value={reviewReason} maxLength={1000} disabled={busy} onChange={e => setReviewReason(e.target.value)} className="mt-1 block w-full rounded-md border bg-background p-2" /></label>
          <div className="flex flex-wrap gap-2"><Button type="button" disabled={busy || !reviewed || view.selfReview || view.submission.policyVersion !== view.policy.version} onClick={() => void act(async () => review("APPROVED"), "Independent approval recorded.")}>Approve verification</Button><Button type="button" variant="outline" disabled={busy || !reviewReason.trim()} onClick={() => void act(async () => review("CHANGES_REQUIRED"), "Corrections requested. The submitted revision was retained.")}>Request corrections</Button></div>
        </div>}
        {view.canRevoke && currentReview?.decision === "APPROVED" && <div className="space-y-2 border-t pt-3"><label className="block text-sm">Revocation reason<textarea value={reviewReason} maxLength={1000} disabled={busy} onChange={e => setReviewReason(e.target.value)} className="mt-1 block w-full rounded-md border bg-background p-2" /></label><Button type="button" variant="outline" disabled={busy || !reviewReason.trim()} onClick={() => void act(async () => review("REVOKED"), "Approval revoked. The earlier decision was retained.")}>Revoke approval</Button></div>}
      </div>}
      {view.canSubmit && view.case && requirements && <details className="rounded-lg border p-4" open={!view.submission}><summary className="cursor-pointer font-medium">{view.submission ? "Prepare a corrected submission" : "Prepare verification submission"}</summary><div className="mt-4 space-y-4">
        <p className="text-sm text-muted-foreground">Submitting freezes these facts and selected files. A new revision requires fresh review and supersedes the previous verification status.</p>
        <div><label htmlFor="verification-role" className="block text-sm font-medium">Participant role</label><Select id="verification-role" value={role} disabled={busy} onValueChange={v => { setRole(v as typeof role); setFiles([]) }}>{verificationRoles.map(r => <option key={r} value={r}>{readable(r)}</option>)}</Select></div>
        <div className="grid gap-3 sm:grid-cols-2">{requirements.facts.map(f => <label key={f.code} className="min-w-0 text-sm font-medium">{f.label}{f.type === "COUNTRY" ? <Select aria-label={f.label} className="mt-1 w-full" value={values[f.code] ?? ""} disabled={busy} onValueChange={v => setValues(s => ({ ...s, [f.code]: v }))}><option value="">Choose a country</option>{COUNTRY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}</Select> : <input type={f.type === "DATE" ? "date" : f.type === "EMAIL" ? "email" : "text"} value={values[f.code] ?? ""} maxLength={f.type === "EMAIL" ? 254 : 500} disabled={busy} onChange={e => setValues(s => ({ ...s, [f.code]: e.target.value }))} className="mt-1 block w-full rounded-md border bg-background px-3 py-2 font-normal" />}</label>)}</div>
        {requirements.documents.map(d => <fieldset key={d.code} className="space-y-2 rounded border p-3"><legend className="text-sm font-medium">{d.label} (required)</legend>{view.evidence.filter(e => e.documentCode === d.code).map(e => <label key={e.id} className="flex min-w-0 gap-2 text-sm"><input type="checkbox" checked={files.includes(e.id)} disabled={busy} onChange={event => setFiles(list => event.target.checked ? [...list, e.id] : list.filter(id => id !== e.id))} /><span className="break-all">{e.filename}</span></label>)}{!view.evidence.some(e => e.documentCode === d.code) && <p className="text-sm text-muted-foreground">Upload accepted evidence in the Evidence tab first.</p>}</fieldset>)}
        {!!view.submission && <label className="block text-sm font-medium">Reason for new revision<textarea maxLength={1000} value={reason} disabled={busy} onChange={e => setReason(e.target.value)} className="mt-1 block w-full rounded-md border bg-background p-2 font-normal" /></label>}
        <Button type="button" disabled={busy || !!view.submission && !reason.trim()} onClick={() => void act(() => post("/api/verification/submissions", { caseId: view.case!.id, version: view.submission?.number ?? 0, policyVersion: view.policy.version, role, facts: requirements.facts.map(f => ({ code: f.code, value: values[f.code] ?? "" })), evidenceIds: files.filter(id => view.evidence.some(e => e.id === id && requirements.documents.some(d => d.code === e.documentCode))), ...(reason.trim() ? { reason: reason.trim() } : {}) }), "Revision submitted for independent review.")}>Submit for review</Button>
      </div></details>}
      {!!view.history.length && <details className="rounded-lg border p-4"><summary className="cursor-pointer font-medium">Recent revision history</summary><div className="mt-3 space-y-3">{view.history.map(s => <div key={s.id} className="space-y-1 border-t pt-2 text-sm"><p className="font-medium">Revision {s.number} · policy {s.policyVersion} · {s.reviews[0] ? readable(s.reviews[0].decision) : "Under review"}</p>{s.reason && <p className="break-words">Revision reason: {s.reason}</p>}{s.reviews.map(r => <p key={r.number} className="break-words">{readable(r.decision)}{r.reason ? `: ${r.reason}` : ""}{r.validUntil ? ` · Valid until ${r.validUntil.slice(0, 10)}` : ""}</p>)}</div>)}<p className="text-xs text-muted-foreground">Latest 10 revisions. Earlier revisions remain retained.</p></div></details>}
    </>}
  </div>
}
