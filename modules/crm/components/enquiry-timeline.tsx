"use client"
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
  return <div className="space-y-8">
    <WorkList enquiryId={enquiryId} contactId={contactId} />
    <form onSubmit={event => void add(event)} className="space-y-4 rounded-xl border p-5"><FormField id="note" label="Add an enquiry note" error={noteErrors.errors.message}><textarea id="note" required maxLength={5000} className="min-h-24 w-full rounded-md border bg-background p-3 text-sm" value={note} onChange={event => setNote(event.target.value)} /></FormField><Button type="submit" loading={saving}>Add note</Button></form>
    <section className="space-y-4"><h2 className="text-lg font-semibold">Activity history</h2>
      {activityError && <p role="alert" className="text-destructive">{activityError}</p>}
      {activityLoading ? <p>Loading activity…</p> : !activityError && activity?.items.map(item => <article key={item.id} className="rounded-lg border p-4"><p className="whitespace-pre-wrap break-words text-sm">{item.message}</p><p className="mt-2 text-xs text-muted-foreground">{item.actor.name || "Team member"} · {formatDate(item.createdAt)}</p></article>)}
      <div className="flex items-center justify-between text-sm"><Button variant="outline" disabled={page <= 1 || activityLoading} onClick={() => setPage(value => value - 1)}>Previous</Button><span>Page {page} of {activity?.totalPages ?? 1}</span><Button variant="outline" disabled={page >= (activity?.totalPages ?? 1) || activityLoading} onClick={() => setPage(value => value + 1)}>Next</Button></div>
    </section>
  </div>
}
