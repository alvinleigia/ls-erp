"use client"
import * as React from "react"
import { Button } from "@/components/ui/button"
import { useDateFormatter } from "@/hooks/use-date-formatter"
import type { ListResponse } from "@/types/api"
import type { InteractionRow } from "@/types/crm-work"

export function ContactInteractions({ contactId, revision = 0 }: { contactId: string; revision?: number }) {
  const [data, setData] = React.useState<ListResponse<InteractionRow> | null>(null)
  const [page, setPage] = React.useState(1)
  const [error, setError] = React.useState("")
  const [loading, setLoading] = React.useState(true)
  const { formatDate } = useDateFormatter()
  React.useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      setLoading(true); setError("")
      try { const response = await fetch(`/api/crm/contacts/${contactId}/interactions?page=${page}&pageSize=10`, { signal: controller.signal, cache: "no-store" }); const result = await response.json(); if (!response.ok) throw new Error(response.status === 404 ? "Customer interaction history is not available with your current access." : result.error || "Unable to load interactions."); setData(result) }
      catch (error) { if (!controller.signal.aborted) { setError((error as Error).message); setData(null) } }
      finally { if (!controller.signal.aborted) setLoading(false) }
    })()
    return () => controller.abort()
  }, [contactId, page, revision])
  return <section className="space-y-3"><h2 className="text-lg font-semibold">Previous customer interactions</h2><p className="text-sm text-muted-foreground">Shared call, meeting, email and task summaries help the next staff member continue the conversation.</p>{error && <p role="status" className="text-sm text-muted-foreground">{error}</p>}
    {loading ? <p>Loading interactions…</p> : data?.items.map(item => <article key={item.id} className="space-y-2 rounded-xl border p-4"><p className="text-sm font-medium">{item.type} · {item.outcome.replaceAll("_", " ")}{item.callDirection ? ` · ${item.callDirection}` : ""}</p><p className="whitespace-pre-wrap break-words text-sm">{item.summary}</p><p className="text-xs text-muted-foreground">{formatDate(item.occurredAt)} · {item.completedBy?.name || "Staff member"}{item.durationMinutes !== null ? ` · ${item.durationMinutes} min` : ""}</p></article>)}
    {!loading && data?.total === 0 && <p className="text-sm text-muted-foreground">No interactions logged yet.</p>}
    {data && <div className="flex items-center gap-3"><Button variant="outline" size="sm" disabled={loading || page <= 1} onClick={() => setPage(value => value - 1)}>Previous</Button><span className="text-sm">{page} / {data.totalPages}</span><Button variant="outline" size="sm" disabled={loading || page >= data.totalPages} onClick={() => setPage(value => value + 1)}>Next</Button></div>}
  </section>
}
