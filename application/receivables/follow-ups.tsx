"use client"
import { useCallback, useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import Link from "@/platform/access/link"
import { Button } from "@/components/ui/button"
import { Pagination } from "@/components/erp/pagination"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { WorkScheduleFields, emptyWork, workPayload } from "@/modules/crm/components/work-schedule-fields"
import { wallTime } from "@/modules/crm/work-time"
import { useDateFormatter } from "@/hooks/use-date-formatter"
import { useFormErrors } from "@/hooks/use-form-errors"
import type { WorkListResponse } from "@/types/crm-work"

type Context = { contactId: string; opportunityId: string; title: string; canCreate: boolean; canAssign: boolean; currentUserId: string; timeZone: string }
async function read<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { cache: "no-store", signal }), data = await response.json()
  if (!response.ok) throw Error(data.error || "Unable to load collection follow-ups.")
  return data
}
export function CollectionFollowUps({ orderId }: { orderId: string }) {
  const { data: session } = useSession(), { formatDateOnly } = useDateFormatter()
  const [context, setContext] = useState<Context>(), [list, setList] = useState<WorkListResponse>()
  const [page, setPage] = useState(1), [all, setAll] = useState(false), [error, setError] = useState("")
  const [open, setOpen] = useState(false), [saving, setSaving] = useState(false), [values, setValues] = useState(emptyWork)
  const { errors, setErrorsFromResponse, clearErrors } = useFormErrors()
  const load = useCallback(async (signal?: AbortSignal) => {
    const [ctx, rows] = await Promise.all([
      read<Context>(`/api/sales-orders/${orderId}/receivables/follow-ups`, signal),
      read<WorkListResponse>(`/api/crm/work?collectionOrderId=${encodeURIComponent(orderId)}&scope=visible&state=${all ? "all" : "open"}&page=${page}&pageSize=5`, signal),
    ])
    setContext(ctx); setList(rows); setError("")
  }, [orderId, all, page])
  useEffect(() => { const c = new AbortController(); load(c.signal).catch(e => { if (!c.signal.aborted) { setContext(undefined); setList(undefined); setError(e.message) } }); return () => c.abort() }, [load])
  function begin() {
    if (!context) return
    clearErrors(); setError(""); setValues({ ...emptyWork, title: "Collection follow-up", type: "CALL", callDirection: "OUTBOUND", assignedUserId: context.currentUserId, dueOn: wallTime(new Date(), context.timeZone).slice(0, 10) }); setOpen(true)
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!context) return
    setSaving(true); setError(""); clearErrors()
    try {
      const response = await fetch("/api/crm/work", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...workPayload(values, context.timeZone), collectionOrderId: orderId, contactId: context.contactId, opportunityId: context.opportunityId, enquiryId: "" }) })
      const data = await response.json()
      if (!response.ok) { setErrorsFromResponse(data); throw Error(data.error || "Unable to schedule follow-up.") }
      setOpen(false); await load()
    } catch (e) { setError((e as Error).message) } finally { setSaving(false) }
  }
  return <section aria-label="Collection follow-ups" className="space-y-3 border-t pt-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-medium">Collection follow-ups</h3><div className="flex flex-wrap gap-2">
      <Button variant="outline" onClick={() => { setAll(!all); setPage(1) }}>{all ? "Show pending" : "Show all follow-ups"}</Button>
      <Button variant="outline" onClick={() => load().catch(e => { setContext(undefined); setList(undefined); setError(e.message) })}>Refresh follow-ups</Button>
      {context?.canCreate && <Button onClick={begin}>Schedule collection follow-up</Button>}
    </div></div>
    <p className="text-sm text-muted-foreground">{all ? "Activity history" : "Pending activities"} for this receivable. Open an activity to record calls, outcomes and notes. Recording an outcome does not record a payment.</p>
    {error && !open && <p role="alert" className="text-destructive">{error}</p>}
    {list && <>{!list.items.length && <p>No {all ? "collection" : "pending collection"} follow-ups.</p>}{list.items.map(row => <article key={row.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3">
      <div className="min-w-0 break-words"><Link className="font-medium underline" href={`/crm/activities/${row.id}`}>{row.title}</Link><p className="text-sm">{row.assignee.name || "Staff"} · {formatDateOnly(row.dueOn.slice(0, 10))} · {row.status.replaceAll("_", " ")}</p>{row.outcome && <p className="text-sm">{row.outcome.replaceAll("_", " ")}</p>}</div>
    </article>)}<Pagination {...list} onPageChange={setPage} label="Collection follow-up pagination" /></>}
    <Dialog open={open} onOpenChange={value => { if (!saving) setOpen(value) }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>Schedule collection follow-up</DialogTitle><DialogDescription>Choose an owner and due date. The activity stays linked to this receivable and appears in Activities.</DialogDescription></DialogHeader>
      {context && <form onSubmit={save} className="space-y-4"><fieldset disabled={saving}><WorkScheduleFields prefix="collection" values={values} onChange={setValues} canAssign={context.canAssign} assignee={{ id: context.currentUserId, name: session?.user?.name || "Me" }} timeZone={context.timeZone} errors={errors} /></fieldset>
        {error && <p role="alert" className="text-destructive">{error}</p>}<div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={saving} onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" loading={saving}>Save follow-up</Button></div>
      </form>}
    </DialogContent></Dialog>
  </section>
}
