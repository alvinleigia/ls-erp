"use client"
import * as React from "react"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/form-field"
import { useDateFormatter } from "@/hooks/use-date-formatter"
import type { ListResponse } from "@/types/api"
import type { CrmActivityRow } from "@/types/crm"

export function WorkHistory({ id, revision, canEdit }: { id: string; revision: number; canEdit: boolean }) {
  const [data, setData] = React.useState<ListResponse<CrmActivityRow> | null>(null)
  const [page, setPage] = React.useState(1)
  const [refresh, setRefresh] = React.useState(0)
  const [message, setMessage] = React.useState("")
  const [error, setError] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  const { formatDate } = useDateFormatter()
  React.useEffect(() => {
    const controller = new AbortController()
    void fetch(`/api/crm/work/${id}/history?page=${page}&pageSize=10`, { signal: controller.signal, cache: "no-store" }).then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error || "Unable to load activity history."); setData(result); setError("") }).catch(error => { if (!controller.signal.aborted) { setError(error.message); setData(null) } })
    return () => controller.abort()
  }, [id, page, revision, refresh])
  async function add(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError("")
    try { const response = await fetch(`/api/crm/work/${id}/history`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || "Unable to save note."); setMessage(""); setPage(1); setRefresh(value => value + 1) }
    catch (error) { setError((error as Error).message) } finally { setSaving(false) }
  }
  return <section className="space-y-4"><h2 className="text-lg font-semibold">Activity history and internal notes</h2>{canEdit && <form onSubmit={add} className="space-y-3"><FormField id="work-note" label="Internal note or correction"><textarea id="work-note" required maxLength={5000} className="min-h-24 w-full rounded border p-3" value={message} onChange={event => setMessage(event.target.value)} /></FormField><Button loading={saving} type="submit">Add note</Button></form>}{error && <p role="alert" className="text-destructive">{error}</p>}
    {data?.items.map(item => <article key={item.id} className="rounded border p-4"><p className="whitespace-pre-wrap break-words text-sm">{item.message}</p><p className="mt-2 text-xs text-muted-foreground">{formatDate(item.createdAt)} · {item.actor.name || "Staff member"}</p></article>)}
    {data && <div className="flex items-center gap-3"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Previous</Button><span className="text-sm">{page} / {data.totalPages}</span><Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => setPage(value => value + 1)}>Next</Button></div>}
  </section>
}
