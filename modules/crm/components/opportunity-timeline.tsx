"use client"
import * as React from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/form-field"
import { useDateFormatter } from "@/hooks/use-date-formatter"
import type { CrmActivityRow } from "@/types/crm"
import type { ListResponse } from "@/types/api"

export function OpportunityTimeline({ id, revision }: { id: string; revision: number }) {
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
  return <section className="space-y-4"><h2 className="text-lg font-semibold">Activity and history</h2><form onSubmit={add} className="space-y-3"><FormField id="opportunity-note" label="Add a note"><textarea id="opportunity-note" required maxLength={5000} className="min-h-24 w-full rounded border p-3" value={message} onChange={event => setMessage(event.target.value)} /></FormField><Button type="submit" loading={saving}>Add note</Button></form>
    {error && <p role="alert" className="text-destructive">{error}</p>}{loading ? <p>Loading history…</p> : data?.items.map(item => <article key={item.id} className="rounded-lg border p-4"><p className="whitespace-pre-wrap break-words text-sm">{item.message}</p><p className="mt-2 text-xs text-muted-foreground">{item.actor.name || "Team member"} · {formatDate(item.createdAt)}</p></article>)}
    <div className="flex items-center gap-3"><Button variant="outline" disabled={loading || page <= 1} onClick={() => setPage(value => value - 1)}>Previous</Button><span className="text-sm">Page {page} of {data?.totalPages || 1}</span><Button variant="outline" disabled={loading || !data || page >= data.totalPages} onClick={() => setPage(value => value + 1)}>Next</Button></div>
  </section>
}
