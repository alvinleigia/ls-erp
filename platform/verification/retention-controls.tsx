"use client"
import * as React from "react"
import { Button } from "@/components/ui/button"
import { VerificationDisposalControls, type DisposalRow } from "./disposal-controls"
import { InfoHelp } from "@/components/erp/info-help"
import { useDateFormatter } from "@/hooks/use-date-formatter"
import type { VerificationSubject } from "./contracts"
import { retentionDecisionLabels, type RetentionDecision } from "./retention-contracts"
type View = { canDispose: boolean; disposals: DisposalRow[]; case: { id: string } | null; version: number; active: boolean; canPlace: boolean; canRelease: boolean; canReview: boolean; history: { id: string; number: number; action: string; reason: string; createdAt: string }[]; decisions: (RetentionDecision & { id: string; filename: string })[] }
export function VerificationRetentionControls({ kind, id }: VerificationSubject) {
  const [view, setView] = React.useState<View>(), [reason, setReason] = React.useState(""), [reload, setReload] = React.useState(0), [busy, setBusy] = React.useState(false), [error, setError] = React.useState(""), [message, setMessage] = React.useState(""), [confirmRelease, setConfirmRelease] = React.useState(false), { formatDateTime } = useDateFormatter()
  React.useEffect(() => { setView(undefined); setReason(""); setMessage(""); setConfirmRelease(false) }, [kind, id])
  React.useEffect(() => {
    const c = new AbortController(); setError("")
    void fetch(`/api/verification/holds?${new URLSearchParams({ kind, id })}`, { cache: "no-store", signal: c.signal }).then(async r => { const d = await r.json(); if (!r.ok) throw Error(d.error || "Unable to load retention review."); if (!c.signal.aborted) setView(d) }).catch(e => { if (!c.signal.aborted) setError(e.message) })
    return () => c.abort()
  }, [kind, id, reload])
  async function hold(action: "PLACE" | "RELEASE") {
    if (!view?.case || busy) return
    setBusy(true); setError(""); setMessage("")
    try {
      const r = await fetch("/api/verification/holds", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ caseId: view.case.id, version: view.version, action, reason }) }), d = await r.json()
      if (!r.ok) throw Error(d.error || "Unable to change preservation hold.")
      setReason(""); setConfirmRelease(false); setMessage(action === "PLACE" ? "Preservation hold placed." : "Preservation hold released. Retention and saved references still apply."); setReload(n => n + 1)
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to change preservation hold.") } finally { setBusy(false) }
  }
  return <div className="space-y-4">{error && <p role="alert" className="text-sm text-destructive">{error}</p>}{message && <p role="status" className="text-sm">{message}</p>}
    <Button type="button" variant="outline" disabled={busy} onClick={() => { setError(""); setReload(n => n + 1) }}>Refresh retention review</Button>
    {!view && !error && <p className="text-sm">Loading retention review...</p>}
    {view && <><div className="space-y-3 rounded-lg border p-4"><div className="flex min-w-0 items-center gap-2"><h3 className="min-w-0 font-medium">{view.active ? "Preservation hold active" : "No active preservation hold"}</h3><InfoHelp title="Preservation holds">Holds preserve accepted verification records across all transactions for this customer. They do not approve identity or block payments. Unaccepted abandoned uploads follow their separate cleanup policy. No accepted evidence is deleted by this review.</InfoHelp></div>
      {view.case && (view.active ? view.canRelease : view.canPlace) && <><label htmlFor="verification-hold-reason" className="block text-sm font-medium">{view.active ? "Release reason" : "Hold reason"}</label><textarea id="verification-hold-reason" maxLength={1000} value={reason} disabled={busy} onChange={e => { setReason(e.target.value); setConfirmRelease(false) }} className="min-h-24 w-full rounded-md border bg-background p-3" />
        {view.active ? <>{confirmRelease ? <div className="space-y-2"><p className="text-sm">Release this preservation instruction? Saved references and retention periods will still protect records.</p><div className="flex flex-wrap gap-2"><Button type="button" disabled={busy || reason.trim().length < 5} onClick={() => void hold("RELEASE")}>Confirm hold release</Button><Button type="button" variant="outline" disabled={busy} onClick={() => setConfirmRelease(false)}>Keep hold</Button></div></div> : <Button type="button" variant="outline" disabled={busy || reason.trim().length < 5} onClick={() => setConfirmRelease(true)}>Release preservation hold</Button>}</> : <Button type="button" disabled={busy || reason.trim().length < 5} onClick={() => void hold("PLACE")}>Place preservation hold</Button>}
    </>}
    </div>
    {!!view.history.length && <details className="rounded-lg border p-3"><summary className="cursor-pointer font-medium">Preservation hold history</summary><ol className="mt-3 space-y-3">{view.history.map(h => <li key={h.id} className="space-y-1 border-t pt-2 text-sm"><p className="font-medium">{h.action === "PLACE" ? "Hold placed" : "Hold released"} · {formatDateTime(h.createdAt)}</p><p className="whitespace-pre-wrap break-words">{h.reason}</p></li>)}</ol><p className="mt-3 text-xs text-muted-foreground">Latest 10 events. Earlier events remain retained.</p></details>}
    {view.canReview && <div className="space-y-3"><h3 className="font-medium">Accepted evidence retention review</h3>{!view.decisions.length && <p className="text-sm">No accepted evidence in this case.</p>}{view.decisions.map(d => <div key={d.id} className="min-w-0 space-y-1 rounded-lg border p-3 text-sm"><p className="break-all font-medium">{d.filename}</p><p>{retentionDecisionLabels[d.decision]}</p>{d.retainUntil && <p className="text-muted-foreground">Period ends {formatDateTime(d.retainUntil)}</p>}<p className="text-xs text-muted-foreground">Reviewed {formatDateTime(d.evaluatedAt)} · policy version {d.policyVersion}</p></div>)}</div>}
    {view.canDispose && <VerificationDisposalControls candidates={view.decisions.filter(d => d.decision === "REVIEW" && !view.disposals.some(r => r.evidenceId === d.id && r.state !== "CANCELLED"))} rows={view.disposals} changed={() => setReload(n => n + 1)} />}
    </>}
  </div>
}
