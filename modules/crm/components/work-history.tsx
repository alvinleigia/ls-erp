"use client"
import * as React from "react"
import { CalendarPlus, CheckCircle2, CircleX, Pencil, Bell, MessageSquare, History, GitBranch, UserRound, type LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/form-field"
import { formatWorkHistoryMessage, formatWorkHistoryTime, type WorkHistoryFormat } from "../work-history-format"
import type { ListResponse } from "@/types/api"
import type { CrmActivityRow } from "@/types/crm"
import { CrmEmptyState, CrmSection } from "./crm-section"
import { CrmTimeline, TimelinePagination } from "./crm-timeline"

const historyAppearance: Record<string, { icon: LucideIcon; action: string }> = {
  "crm.work.created": { icon: CalendarPlus, action: "scheduled an activity" },
  "crm.work.completed": { icon: CheckCircle2, action: "completed the activity" },
  "crm.work.cancelled": { icon: CircleX, action: "cancelled the activity" },
  "crm.work.updated": { icon: Pencil, action: "updated the activity" },
  "crm.work.reminder.updated": { icon: Bell, action: "updated the reminder" },
  "crm.work.note.added": { icon: MessageSquare, action: "added an internal note" },
  "crm.work.rule.applied": { icon: GitBranch, action: "applied a follow-up rule" },
  "crm.work.rule.skipped": { icon: GitBranch, action: "skipped a follow-up rule" },
  "crm.work.assignment.inherited": { icon: UserRound, action: "reassigned the activity with its enquiry" },
}

export function WorkHistory({ id, revision, canEdit, settings }: { id: string; revision: number; canEdit: boolean; settings: WorkHistoryFormat }) {
  const [data, setData] = React.useState<ListResponse<CrmActivityRow> | null>(null)
  const [page, setPage] = React.useState(1)
  const [refresh, setRefresh] = React.useState(0)
  const [message, setMessage] = React.useState("")
  const [error, setError] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  React.useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    void fetch(`/api/crm/work/${id}/history?page=${page}&pageSize=10`, { signal: controller.signal, cache: "no-store" }).then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error || "Unable to load activity history."); setData(result); setError("") }).catch(error => { if (!controller.signal.aborted) { setError(error.message); setData(null) } }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [id, page, revision, refresh])
  async function add(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError("")
    try { const response = await fetch(`/api/crm/work/${id}/history`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || "Unable to save note."); setMessage(""); setPage(1); setRefresh(value => value + 1) }
    catch (error) { setError((error as Error).message) } finally { setSaving(false) }
  }
  return <CrmSection title="Activity history and internal notes" description="Changes to this activity and notes for your team." icon={History}>
    {canEdit && <form onSubmit={add} className="space-y-3 rounded-lg border bg-muted/20 p-4"><FormField id="work-note" label="Internal note or correction"><textarea id="work-note" required maxLength={5000} disabled={saving} placeholder="Add context for your team…" className="min-h-24 w-full rounded-md border bg-background p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" value={message} onChange={event => setMessage(event.target.value)} /></FormField><div className="flex justify-end"><Button loading={saving} type="submit">Add note</Button></div></form>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {loading ? <p className="text-sm text-muted-foreground">Loading activity history…</p> : data && <CrmTimeline entries={data.items.map(item => ({
      id: item.id, ...(historyAppearance[item.event] || { icon: History, action: "recorded an activity update" }),
      actor: item.actor.name || "Staff member", dateTime: item.createdAt, timeLabel: formatWorkHistoryTime(item.createdAt, settings),
      detail: <p className="whitespace-pre-wrap break-words">{formatWorkHistoryMessage(item, settings)}</p>,
    }))} />}
    {!loading && data?.total === 0 && <CrmEmptyState title="No activity history yet" description="Activity updates and internal notes will appear here." />}
    {data && <TimelinePagination label="Activity history pages" page={page} totalPages={data.totalPages} loading={loading} onPageChange={setPage} />}
  </CrmSection>
}
