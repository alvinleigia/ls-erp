"use client"
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
import { useFormErrors } from "@/hooks/use-form-errors"
import type { ListResponse } from "@/types/api"
import type { CrmActivityRow } from "@/types/crm"
import { WorkList } from "./work-list"

export function EnquiryTimeline({ enquiryId, contactId, revision }: { enquiryId: string; contactId: string; revision: number }) {
  const { formatDate } = useDateFormatter()
  const [note, setNote] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  const [refresh, setRefresh] = React.useState(0)
  const [page, setPage] = React.useState(1)
  const [activity, setActivity] = React.useState<ListResponse<CrmActivityRow> | null>(null)
  const [activityError, setActivityError] = React.useState("")
  const [activityLoading, setActivityLoading] = React.useState(true)
  const noteErrors = useFormErrors()
  const changed = React.useCallback(() => { setRefresh(value => value + 1); setPage(1) }, [])
  React.useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      setActivityLoading(true); setActivityError("")
      try {
        const response = await fetch(`/api/crm/enquiries/${enquiryId}/activity?page=${page}`, { signal: controller.signal, cache: "no-store" })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || "Unable to load activity.")
        setActivity(data)
      } catch (error) { if (!controller.signal.aborted) setActivityError((error as Error).message) }
      finally { if (!controller.signal.aborted) setActivityLoading(false) }
    })()
    return () => controller.abort()
  }, [enquiryId, page, refresh, revision])
  async function add(event: React.FormEvent) {
    event.preventDefault(); setSaving(true)
    noteErrors.clearErrors()
    try {
      const response = await fetch(`/api/crm/enquiries/${enquiryId}/activity`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: note }),
      })
      const data = await response.json()
      if (!response.ok) { noteErrors.setErrorsFromResponse(data); throw new Error(data.error || "Unable to save.") }
      setNote(""); changed(); toast.success("Note added.")
    } catch (error) { toast.error((error as Error).message) } finally { setSaving(false) }
  }
  return <div className="space-y-6"><WorkList enquiryId={enquiryId} contactId={contactId} /><CrmSection title="Activity history and internal notes" description="Updates and notes for your team." icon={History}>
    <form onSubmit={event => void add(event)} className="space-y-3 rounded-lg border bg-muted/20 p-4"><FormField id="note" label="Add an enquiry note" error={noteErrors.errors.message}><CrmTextarea id="note" required maxLength={5000} value={note} onChange={event => setNote(event.target.value)} /></FormField><CrmActionBar><Button type="submit" loading={saving}>Add note</Button></CrmActionBar></form>
    {activityError && <p role="alert" className="text-destructive">{activityError}</p>}
    {activityLoading ? <p className="text-sm text-muted-foreground">Loading history…</p> : !activityError && activity && <CrmTimeline entries={activity.items.map(item => ({ id: item.id, icon: item.event.includes("note") ? MessageSquare : History, actor: item.actor.name || "Staff member", action: item.event.includes("note") ? "added an internal note" : "recorded an update", dateTime: item.createdAt, timeLabel: formatDate(item.createdAt), detail: <p className="whitespace-pre-wrap break-words">{item.message}</p> }))} />}
    {!activityLoading && !activityError && activity?.total === 0 && <CrmEmptyState title="No activity history yet" description="Updates and internal notes will appear here." />}
    {activity && <TimelinePagination label="Activity history pages" page={page} pageSize={activity.pageSize} total={activity.total} totalPages={activity.totalPages} loading={activityLoading} onPageChange={setPage} />}
  </CrmSection></div>
}
