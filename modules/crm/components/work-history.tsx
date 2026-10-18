"use client"
import { useTerminology, useTerminologyReader } from "@/platform/terminology/provider"
import { ActionBar } from "@/components/erp/page"
import { Textarea } from "@/components/erp/controls"
import * as React from "react"
import { CalendarPlus, CheckCircle2, CircleX, Pencil, Bell, MessageSquare, History, GitBranch, UserRound, type LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/form-field"
import { formatWorkHistoryMessage, formatWorkHistoryTime, type WorkHistoryFormat } from "../work-history-format"
import type { ListResponse } from "@/types/api"
import type { CrmActivityRow } from "@/types/crm"
import { EmptyState, Section } from "@/components/erp/section"
import { Timeline } from "@/components/erp/timeline"
import { Pagination } from "@/components/erp/pagination"

const historyAppearance: Record<string, { icon: LucideIcon; action: string; template?: string }> = {
  "crm.work.created": { icon: CalendarPlus, action: "scheduled an activity", template: "scheduled a {label}" },
  "crm.work.completed": { icon: CheckCircle2, action: "completed the activity", template: "completed the {label}" },
  "crm.work.cancelled": { icon: CircleX, action: "cancelled the activity", template: "cancelled the {label}" },
  "crm.work.updated": { icon: Pencil, action: "updated the activity", template: "updated the {label}" },
  "crm.work.reminder.updated": { icon: Bell, action: "updated the reminder" },
  "crm.work.note.added": { icon: MessageSquare, action: "added an internal note" },
  "crm.work.rule.applied": { icon: GitBranch, action: "applied a follow-up rule" },
  "crm.work.rule.skipped": { icon: GitBranch, action: "skipped a follow-up rule" },
  "crm.work.assignment.inherited": { icon: UserRound, action: "reassigned the activity with its enquiry" },
}

export function WorkHistory({ id, revision, canEdit, settings }: { id: string; revision: number; canEdit: boolean; settings: WorkHistoryFormat }) {
  const readTerm = useTerminologyReader()
  const term = useTerminology()
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
    void fetch(`/api/crm/work/${id}/history?page=${page}&pageSize=10`, { signal: controller.signal, cache: "no-store" }).then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error || readTerm("crm.activity.singular", "Unable to load activity history.", "Unable to load {label} history.")); setData(result); setError("") }).catch(error => { if (!controller.signal.aborted) { setError(error.message); setData(null) } }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [readTerm, id, page, revision, refresh])
  async function add(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError("")
    try { const response = await fetch(`/api/crm/work/${id}/history`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || "Unable to save note."); setMessage(""); setPage(1); setRefresh(value => value + 1) }
    catch (error) { setError((error as Error).message) } finally { setSaving(false) }
  }
  return <Section title={term("crm.activity.singular", "Activity history and internal notes", "{label} history and internal notes")} description={term("crm.activity.singular", "Changes to this activity and notes for your team.", "Changes to this {label} and notes for your team.")} icon={History}>
    {canEdit && <form onSubmit={add} className="space-y-3 rounded-lg border bg-muted/20 p-4"><FormField id="work-note" label="Internal note or correction"><Textarea id="work-note" required maxLength={5000} disabled={saving} placeholder="Add context for your team…" value={message} onChange={event => setMessage(event.target.value)} /></FormField><ActionBar><Button loading={saving} type="submit">Add note</Button></ActionBar></form>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {loading ? <p className="text-sm text-muted-foreground">{term("crm.activity.singular", "Loading activity history…", "Loading {label} history…")}</p> : data && <Timeline entries={data.items.map(item => ({
      id: item.id, icon: historyAppearance[item.event]?.icon || History,
      action: item.event === "crm.work.assignment.inherited"
        ? term("crm.activity.singular", "reassigned the activity", "reassigned the {label}") + " " + term("crm.enquiry.singular", "with its enquiry", "with its {label}")
        : historyAppearance[item.event]?.template
          ? term("crm.activity.singular", historyAppearance[item.event].action, historyAppearance[item.event].template)
          : historyAppearance[item.event]?.action || term("crm.activity.singular", "recorded an activity update", "recorded a {label} update"),
      actor: item.actor.name || "Staff member", dateTime: item.createdAt, timeLabel: formatWorkHistoryTime(item.createdAt, settings),
      detail: <p className="whitespace-pre-wrap break-words">{formatWorkHistoryMessage(item, settings)}</p>,
    }))} />}
    {!loading && data?.total === 0 && <EmptyState title={term("crm.activity.singular", "No activity history yet", "No {label} history yet")} description={term("crm.activity.singular", "Activity updates and internal notes will appear here.", "{label} updates and internal notes will appear here.")} />}
    {data && <Pagination label={term("crm.activity.singular", "Activity history pages", "{label} history pages")} page={page} totalPages={data.totalPages} total={data.total} pageSize={data.pageSize} loading={loading} onPageChange={setPage} />}
  </Section>
}
