"use client"
import * as React from "react"
import { Section } from "@/components/erp/section"
import { Button } from "@/components/ui/button"
import { useDateFormatter } from "@/hooks/use-date-formatter"
import { participantRoleLabels } from "@/platform/participants/validation"
import type { ParticipantRole } from "@/platform/participants/validation"
import { checkpointNames, type VerificationSource } from "./checkpoint-contracts"
import { verificationRoles } from "./contracts"
import { useBusinessModules } from "@/platform/module-provider"
import Link from "@/platform/access/link"
import { listStateKey } from "@/lib/list-navigation"
type View = { participants: { kind?: string; id?: string; name: string | null; role: ParticipantRole; status: string; validUntil: string | null }[]; acceptances: { id: string; checkpoint: keyof typeof checkpointNames; configurationVersion: number; evaluatedAt: string; mode: string; eligible: boolean }[] }
const label = (s: string) => s.toLowerCase().replaceAll("_", " ").replace(/^./, c => c.toUpperCase())
export function ParticipantVerificationSummary({ kind, id, version }: VerificationSource & { version?: number }) {
  const { can } = useBusinessModules()
  const [view, setView] = React.useState<View>(), [error, setError] = React.useState(""), [reload, setReload] = React.useState(0), { formatDateTime } = useDateFormatter()
  React.useEffect(() => {
    const controller = new AbortController(); setError(""); setView(undefined)
    void fetch(`/api/verification/summary?${new URLSearchParams({ kind, id })}`, { cache: "no-store", signal: controller.signal }).then(async r => { const result = await r.json(); if (!r.ok) throw Error(result.error || "Unable to load verification summary."); if (!controller.signal.aborted) setView(result) }).catch(e => { if (!controller.signal.aborted) setError(e.message) })
    return () => controller.abort()
  }, [kind, id, version, reload])
  return <Section title="Participant verification" help="Current internal verification for each selected participant role. This summary grants no access to private facts or files. Order participants come from the saved quotation, not the opportunity's current selections. Checkpoint rules select which roles need approval. Historical acceptance records describe the result at that action; they do not change when today's status changes.">
    <Button type="button" variant="outline" onClick={() => setReload(n => n + 1)}>Refresh verification summary</Button>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}{!view && !error && <p className="text-sm">Loading verification summary…</p>}
    {view && <div className="mt-4 space-y-4"><div className="grid gap-3 sm:grid-cols-2">{view.participants.map((p, i) => <div key={`${p.kind}-${p.id}-${p.role}-${i}`} className="min-w-0 space-y-1 rounded-lg border p-3"><p className="break-words font-medium">{p.name || "Saved participant unavailable"}</p><p className="text-sm text-muted-foreground">{participantRoleLabels[p.role] ?? p.role}</p><p className="text-sm font-medium">{label(p.status)}</p>{p.validUntil && <p className="text-xs text-muted-foreground">Valid until {formatDateTime(p.validUntil)}</p>}{p.id && ["PERSON", "BUSINESS"].includes(p.kind ?? "") && verificationRoles.some(r => r === p.role) && can(["customerVerification.read", "verificationSubmissions.read", p.kind === "PERSON" ? "contacts.read" : "accounts.read"]) && <Button asChild variant="outline" size="sm"><Link href={`/crm/${p.kind === "PERSON" ? "contacts" : "accounts"}/${encodeURIComponent(p.id)}?${new URLSearchParams({ [listStateKey("record-view", "tab")]: JSON.stringify("verification"), verificationRole: p.role })}`}>Open verification</Link></Button>}</div>)}</div>
      {!!view.acceptances.length && <details className="rounded-lg border p-3"><summary className="cursor-pointer font-medium">Accepted checkpoint history</summary><ol className="mt-3 space-y-3">{view.acceptances.map(r => <li key={r.id} className="space-y-1 border-t pt-2 text-sm"><p className="font-medium">{checkpointNames[r.checkpoint]} · {r.eligible ? "Passed" : "Warning recorded"}</p><p className="text-muted-foreground">{formatDateTime(r.evaluatedAt)} · {label(r.mode)} · settings version {r.configurationVersion}</p></li>)}</ol><p className="mt-2 text-xs text-muted-foreground">Latest 10 accepted actions. Earlier proofs remain retained.</p></details>}
    </div>}
  </Section>
}
