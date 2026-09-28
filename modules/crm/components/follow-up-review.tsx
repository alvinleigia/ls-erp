"use client"
import { CrmSelect } from "./crm-controls"
import * as React from "react"
import { Input } from "@/components/ui/input"
import { FormField } from "@/components/form-field"
import { selectClass } from "./record-list"
import { wallTime } from "../work-time"
import type { FollowUpPreview } from "@/types/crm-follow-ups"

export function useFollowUpReview(id: string | undefined, version: number | undefined, outcome: string, revision: number) {
  const key = JSON.stringify([id, version, outcome, revision])
  const [result, setResult] = React.useState<{ key: string; data: FollowUpPreview | null; error: string } | null>(null)
  const [action, setAction] = React.useState<"APPLY" | "SKIP">("APPLY")
  const [reason, setReason] = React.useState("")
  React.useEffect(() => {
    if (!id || !version || !outcome) return
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/crm/work/${id}/follow-up?${new URLSearchParams({ version: String(version), outcome })}`, { signal: controller.signal, cache: "no-store" })
        const data = await response.json(); if (!response.ok) throw new Error(data.error || "Unable to review the follow-up rule.")
        if (!controller.signal.aborted) { setResult({ key, data, error: "" }); setAction(data.schedule ? "APPLY" : "SKIP"); setReason("") }
      } catch (error) { if (!controller.signal.aborted) setResult({ key, data: null, error: (error as Error).message }) }
    }, 100)
    return () => { clearTimeout(timer); controller.abort() }
  }, [id, version, outcome, revision, key])
  const current = result?.key === key ? result : null
  const data = current?.data || null
  const applying = !!data?.rule && action === "APPLY" && !!data.schedule
  const ready = !!data && (!data.rule || applying || (action === "SKIP" && !!reason.trim()))
  const decision = data?.rule ? { id: data.rule.id, version: data.rule.version, action, reason, ...(applying ? { dueOn: data.schedule!.dueOn, reminderAt: data.schedule!.reminderAt } : {}) } : undefined
  return { data, error: current?.error || "", loading: !!id && !!outcome && !current, action, setAction, reason, setReason, applying, ready, decision }
}
export function FollowUpReview({ review }: { review: ReturnType<typeof useFollowUpReview> }) {
  const { data } = review
  return <div className="space-y-3">
    {review.loading && <p role="status" className="text-sm">Checking follow-up rules…</p>}
    {review.error && <p role="alert" className="text-sm text-destructive">{review.error} Use Refresh to review again.</p>}
    {data?.rule && <section className="space-y-3 rounded-lg border p-4"><h3 className="font-medium">Suggested next step: {data.rule.name}</h3>
      {data.schedule && <><p className="text-sm">{data.schedule.activityTypeName || data.schedule.type}: {data.schedule.title} · Due {data.schedule.dueOn} ({data.timeZone}). Assigned to the same staff member.</p>{data.schedule.description && <p className="whitespace-pre-wrap text-sm">{data.schedule.description}</p>}{data.schedule.reminderAt && <p className="text-sm">Reminder: {wallTime(data.schedule.reminderAt, data.timeZone || "UTC").replace("T", " ")}</p>}<p className="text-xs text-muted-foreground">This rule permits up to {data.rule.maxDepth} consecutive generated follow-ups. Dates are based on when you complete this activity.</p></>}
      {data.blockedReason && <p className="text-sm">{data.blockedReason}</p>}
      <FormField id="follow-up-decision" label="Next step"><CrmSelect id="follow-up-decision" className={`${selectClass} w-full`} value={review.action} onValueChange={event => review.setAction(event as "APPLY" | "SKIP")}><option value="APPLY" disabled={!data.schedule}>Create the suggested follow-up</option><option value="SKIP">Skip this suggestion / choose a manual follow-up</option></CrmSelect></FormField>
      {review.action === "SKIP" && <FormField id="follow-up-skip-reason" label="Reason for skipping the suggestion"><Input id="follow-up-skip-reason" required maxLength={2000} value={review.reason} onChange={event => review.setReason(event.target.value)} /></FormField>}
    </section>}
    {!data?.rule && data?.blockedReason && <p className="text-sm text-muted-foreground">{data.blockedReason}</p>}
  </div>
}
