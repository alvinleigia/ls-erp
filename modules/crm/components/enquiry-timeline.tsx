"use client"
import * as React from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FormField } from "@/components/form-field"
import { useDateFormatter } from "@/hooks/use-date-formatter"
import { useFormErrors } from "@/hooks/use-form-errors"
import type { ListResponse } from "@/types/api"
import type { CrmActivityRow } from "@/types/crm"
import { RecordList } from "./record-list"

export function EnquiryTimeline({ enquiryId, closed, revision }: { enquiryId: string; closed: boolean; revision: number }) {
  const { formatDate } = useDateFormatter()
  const [task, setTask] = React.useState({ title: "", dueOn: "" })
  const [note, setNote] = React.useState("")
  const [saving, setSaving] = React.useState<"task" | "note" | null>(null)
  const [refresh, setRefresh] = React.useState(0)
  const [page, setPage] = React.useState(1)
  const [activity, setActivity] = React.useState<ListResponse<CrmActivityRow> | null>(null)
  const [activityError, setActivityError] = React.useState("")
  const [activityLoading, setActivityLoading] = React.useState(true)
  const taskErrors = useFormErrors()
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
  async function add(event: React.FormEvent, kind: "task" | "note") {
    event.preventDefault(); setSaving(kind)
    const fields = kind === "task" ? taskErrors : noteErrors
    fields.clearErrors()
    try {
      const response = await fetch(`/api/crm/enquiries/${enquiryId}/${kind === "task" ? "tasks" : "activity"}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(kind === "task" ? task : { message: note }),
      })
      const data = await response.json()
      if (!response.ok) { fields.setErrorsFromResponse(data); throw new Error(data.error || "Unable to save.") }
      if (kind === "task") setTask({ title: "", dueOn: "" }); else setNote("")
      changed(); toast.success(kind === "task" ? "Follow-up added." : "Note added.")
    } catch (error) { toast.error((error as Error).message) } finally { setSaving(null) }
  }
  return <div className="space-y-8">
    {!closed && <form onSubmit={event => void add(event, "task")} className="space-y-4 rounded-xl border p-5">
      <h2 className="text-lg font-semibold">Add follow-up</h2>
      <div className="grid gap-4 sm:grid-cols-2"><FormField id="taskTitle" label="What needs to happen?" error={taskErrors.errors.title}><Input id="taskTitle" required maxLength={200} value={task.title} onChange={event => setTask({ ...task, title: event.target.value })} /></FormField><FormField id="dueOn" label="Due date" error={taskErrors.errors.dueOn}><Input id="dueOn" type="date" required value={task.dueOn} onChange={event => setTask({ ...task, dueOn: event.target.value })} /></FormField></div>
      <Button type="submit" loading={saving === "task"} disabled={!!saving}>Add follow-up</Button>
    </form>}
    <RecordList kind="tasks" enquiryId={enquiryId} refresh={refresh + revision} onChanged={changed} />
    <form onSubmit={event => void add(event, "note")} className="space-y-4 rounded-xl border p-5"><FormField id="note" label="Add a note" error={noteErrors.errors.message}><textarea id="note" required maxLength={5000} className="min-h-24 w-full rounded-md border bg-background p-3 text-sm" value={note} onChange={event => setNote(event.target.value)} /></FormField><Button type="submit" loading={saving === "note"} disabled={!!saving}>Add note</Button></form>
    <section className="space-y-4"><h2 className="text-lg font-semibold">Activity history</h2>
      {activityError && <p role="alert" className="text-destructive">{activityError}</p>}
      {activityLoading ? <p>Loading activity…</p> : !activityError && activity?.items.map(item => <article key={item.id} className="rounded-lg border p-4"><p className="whitespace-pre-wrap break-words text-sm">{item.message}</p><p className="mt-2 text-xs text-muted-foreground">{item.actor.name || "Team member"} · {formatDate(item.createdAt)}</p></article>)}
      <div className="flex items-center justify-between text-sm"><Button variant="outline" disabled={page <= 1 || activityLoading} onClick={() => setPage(value => value - 1)}>Previous</Button><span>Page {page} of {activity?.totalPages ?? 1}</span><Button variant="outline" disabled={page >= (activity?.totalPages ?? 1) || activityLoading} onClick={() => setPage(value => value + 1)}>Next</Button></div>
    </section>
  </div>
}
