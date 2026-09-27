"use client"
import * as React from "react"
import { History, Phone, Mail, Users, CheckSquare } from "lucide-react"
import { useDateFormatter } from "@/hooks/use-date-formatter"
import type { ListResponse } from "@/types/api"
import type { InteractionRow } from "@/types/crm-work"
import { CrmEmptyState, CrmSection } from "./crm-section"
import { CrmTimeline, TimelinePagination } from "./crm-timeline"

const interactionAppearance = {
  CALL: { icon: Phone, action: "recorded a call" },
  EMAIL: { icon: Mail, action: "recorded an email" },
  MEETING: { icon: Users, action: "recorded a meeting" },
  TASK: { icon: CheckSquare, action: "completed a task" },
}

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
  const content = <>{error && <p role="status" className="text-sm text-muted-foreground">{error}</p>}
    {loading ? <p className="text-sm text-muted-foreground">Loading interactions…</p> : data && <CrmTimeline entries={data.items.map(item => ({
      id: item.id, ...interactionAppearance[item.type], actor: item.completedBy?.name || "Staff member",
      dateTime: item.occurredAt, timeLabel: formatDate(item.occurredAt),
      detail: <><div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span className="rounded-md border bg-background px-2 py-0.5 font-medium text-foreground">{item.outcome.replaceAll("_", " ")}</span>{item.callDirection && <span>{item.callDirection === "INBOUND" ? "Inbound" : "Outbound"}</span>}{item.durationMinutes !== null && <span>{item.durationMinutes} min</span>}</div><p className="whitespace-pre-wrap break-words">{item.summary}</p></>,
    }))} />}
    {!loading && data?.total === 0 && <CrmEmptyState title="No interactions logged yet" description="Completed calls, meetings, emails and tasks will appear here." />}
    {data && <TimelinePagination label="Customer interaction pages" page={page} totalPages={data.totalPages} total={data.total} pageSize={data.pageSize} loading={loading} onPageChange={setPage} />}
  </>
  return <CrmSection title="Previous customer interactions" description="Shared conversation history for everyone working with this contact." icon={History}>{content}</CrmSection>
}
