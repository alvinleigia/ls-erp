"use client"
import { useBusinessModules } from "@/platform/module-provider"
import { History, MessageSquare } from "lucide-react"
import { CrmSection, CrmEmptyState } from "./crm-section"
import { CrmTimeline, TimelinePagination } from "./crm-timeline"
import { CrmActionBar } from "./crm-page"
import { CrmTextarea } from "./crm-controls"
import * as React from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/form-field"
import { useDateFormatter } from "@/hooks/use-date-formatter"
import type { CrmActivityRow } from "@/types/crm"
import type { ListResponse } from "@/types/api"

export function OpportunityTimeline({ id, revision }: { id: string; revision: number }) {
  const { can } = useBusinessModules()
  const [data, setData] = React.useState<ListResponse<CrmActivityRow> | null>(null)
  const [page, setPage] = React.useState(1)
  const [refresh, setRefresh] = React.useState(0)
  const [message, setMessage] = React.useState("")
  const [error, setError] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const { formatDate } = useDateFormatter()
  React.useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      setLoading(true); setError("")
      try { const response = await fetch(`/api/crm/opportunities/${id}/activity?page=${page}`, { signal: controller.signal, cache: "no-store" }); const result = await response.json(); if (!response.ok) throw new Error(result.error || "Unable to load history."); setData(result) }
      catch (error) { if (!controller.signal.aborted) { setError((error as Error).message); setData(null) } }
      finally { if (!controller.signal.aborted) setLoading(false) }
    })()
    return () => controller.abort()
  }, [id, page, revision, refresh])
  async function add(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError("")
    try { const response = await fetch(`/api/crm/opportunities/${id}/activity`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || "Unable to save note."); setMessage(""); setPage(1); setRefresh(value => value + 1); toast.success("Note added.") }
    catch (error) { setError((error as Error).message) } finally { setSaving(false) }
  }
  return <CrmSection title="Activity history and internal notes" description="Updates and notes for your team." icon={History}>
    {can("opportunities.edit") && <form onSubmit={add} className="space-y-3 rounded-lg border bg-muted/20 p-4"><FormField id="opportunity-note" label="Add a note"><CrmTextarea id="opportunity-note" required maxLength={5000} value={message} onChange={event => setMessage(event.target.value)} /></FormField><CrmActionBar><Button type="submit" loading={saving}>Add note</Button></CrmActionBar></form>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {loading ? <p className="text-sm text-muted-foreground">Loading history…</p> : !error && data && <CrmTimeline entries={data.items.map(item => ({ id: item.id, icon: item.event.includes("note") ? MessageSquare : History, actor: item.actor.name || "Staff member", action: item.event.includes("note") ? "added an internal note" : "recorded an update", dateTime: item.createdAt, timeLabel: formatDate(item.createdAt), detail: <p className="whitespace-pre-wrap break-words">{item.message}</p> }))} />}
    {!loading && !error && data?.total === 0 && <CrmEmptyState title="No activity history yet" description="Updates and internal notes will appear here." />}
    {data && <TimelinePagination label="Activity history pages" page={page} pageSize={data.pageSize} total={data.total} totalPages={data.totalPages} loading={loading} onPageChange={setPage} />}
  </CrmSection>
}
