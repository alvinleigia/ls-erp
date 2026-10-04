"use client"

import * as React from "react"
import {
  ColumnDef,
  PaginationState,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table"
import { RecordPanel, ReadOnlyFields } from "@/components/erp/record-detail"
import { Section } from "@/components/erp/section"

import { DataTable } from "@/components/data-table"
import { PageHeader, pageClass, Surface, TableToolbar, Filters } from "@/components/erp/page"
import { TablePagination } from "@/components/erp/pagination"
import { FormField } from "@/components/form-field"
import { Button } from "@/components/ui/button"
import { DropdownSelect } from "@/components/ui/dropdown-select"
import { Input } from "@/components/ui/input"
import type { ListResponse } from "@/types/api"
import type { AuditLogReportRow, AuditLogDetail } from "@/types/reports"

const formatDateTime = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return date.toLocaleString()
}

const prettyJson = (value: unknown) => {
  if (value === null || value === undefined) return "-"
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export default function AuditLogsReportPage() {
  const [items, setItems] = React.useState<AuditLogReportRow[]>([])
  const [error, setError] = React.useState("")
  const [refresh, setRefresh] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [search, setSearch] = React.useState("")
  const [event, setEvent] = React.useState("")
  const [entityType, setEntityType] = React.useState("")
  const [requestId, setRequestId] = React.useState("")
  const [dateFrom, setDateFrom] = React.useState("")
  const [dateTo, setDateTo] = React.useState("")
  const [totalRows, setTotalRows] = React.useState(0)
  const [pagination, setPagination] = React.useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  })
  const [detailId, setDetailId] = React.useState<string | null>(null)
  const [category, setCategory] = React.useState("all")
  const [actorUserId, setActorUserId] = React.useState("")
  const [entityId, setEntityId] = React.useState("")
  const [canReviewSecurity, setCanReviewSecurity] = React.useState(false)

  const loadReport = React.useCallback(async (signal: AbortSignal) => {
    setLoading(true)
    const params = new URLSearchParams()
    params.set("page", String(pagination.pageIndex + 1))
    params.set("pageSize", String(pagination.pageSize))
    if (search.trim()) params.set("q", search.trim())
    if (event.trim()) params.set("event", event.trim())
    if (entityType.trim()) params.set("entityType", entityType.trim())
    if (requestId.trim()) params.set("requestId", requestId.trim())
    params.set("category", category)
    if (actorUserId.trim()) params.set("actorUserId", actorUserId.trim())
    if (entityId.trim()) params.set("entityId", entityId.trim())
    if (dateFrom) params.set("dateFrom", dateFrom)
    if (dateTo) params.set("dateTo", dateTo)

    setError("")
    try {
      const response = await fetch(`/api/reports/audit-logs?${params.toString()}`, { cache: "no-store", signal })
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error || "Unable to load report.")
      }
      const data = await response.json() as ListResponse<AuditLogReportRow> & { canReviewSecurity: boolean }
      if (signal.aborted) return
      setItems(data.items)
      setTotalRows(data.total)
      setCanReviewSecurity(data.canReviewSecurity)

    } catch (error) {
      if (signal.aborted) return
      setError(error instanceof Error ? error.message : "Unable to load report.")
      setCanReviewSecurity(false)
      setDetailId(null)
      setItems([])
      setTotalRows(0)

    } finally {
      if (!signal.aborted) setLoading(false)
    }
  }, [category, actorUserId, entityId, dateFrom, dateTo, entityType, event, pagination.pageIndex, pagination.pageSize, requestId, search])

  React.useEffect(() => {
    const controller = new AbortController()
    void loadReport(controller.signal)
    return () => controller.abort()
  }, [loadReport, refresh])

  React.useEffect(() => {
    const refreshOnFocus = () => setRefresh(value => value + 1)
    window.addEventListener("focus", refreshOnFocus)
    return () => window.removeEventListener("focus", refreshOnFocus)
  }, [])

  const columns = React.useMemo<ColumnDef<AuditLogReportRow>[]>(
    () => [
      {
        id: "createdAt",
        header: "When",
        accessorFn: (row) => formatDateTime(row.createdAt),
      },
      {
        accessorKey: "event",
        header: "Event",
      },
      {
        id: "entity",
        header: "Entity",
        cell: ({ row }) => (
          <div className="space-y-1">
            <div>{row.original.entityType}</div>
            <div className="text-xs text-muted-foreground">{row.original.entityId ?? "-"}</div>
          </div>
        ),
      },
      {
        id: "actor",
        header: "Actor",
        cell: ({ row }) => (
          <div className="space-y-1">
            <div>{row.original.actorName || "-"}</div>
            <div className="text-xs text-muted-foreground">
              {row.original.actorEmail || row.original.actorUserId || "-"}
            </div>
          </div>
        ),
      },
      {
        id: "requestId",
        header: "Request ID",
        accessorFn: (row) => row.requestId ?? "-",
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <Button variant="outline" size="sm" onClick={() => setDetailId(row.original.id)}>
            View
          </Button>
        ),
      },
    ],
    []
  )

  const table = useReactTable({
    data: items,
    columns,
    state: { pagination, globalFilter: search },
    onPaginationChange: updater => setPagination(previous => {
      const next = typeof updater === "function" ? updater(previous) : updater
      return next.pageSize !== previous.pageSize ? { ...next, pageIndex: 0 } : next
    }),
    onGlobalFilterChange: (value) => {
      setSearch(String(value))
      setPagination((prev) => ({ ...prev, pageIndex: 0 }))
    },
    getCoreRowModel: getCoreRowModel(),
    manualFiltering: true,
    manualPagination: true,
    pageCount: Math.max(1, Math.ceil(totalRows / pagination.pageSize)),
  })

  return (
    <div className={pageClass}>
      <PageHeader title="Audit logs" description="Review who changed a record and what changed. Security events are administrator-only. CRM managers use the history on accessible records." actions={<Button variant="outline" disabled={loading} onClick={() => setRefresh(value => value + 1)}>Refresh</Button>} />

      <Surface>
      <TableToolbar table={table} searchPlaceholder="Search event, entity, actor, or request ID"><DropdownSelect label="Event category" value={category} options={[{ value: "all", label: "All permitted events" }, { value: "business", label: "Business events" }, { value: "security", label: "Security events", disabled: !canReviewSecurity }]} onValueChange={value => { setCategory(value); setPagination(prev => ({ ...prev, pageIndex: 0 })) }} /><Filters activeCount={[event, entityType, entityId, actorUserId, requestId, dateFrom, dateTo].filter(Boolean).length} onReset={() => {
              setCategory("all")
              setEntityId("")
              setActorUserId("")
              setEvent("")
              setEntityType("")
              setRequestId("")
              setDateFrom("")
              setDateTo("")
              setSearch("")
              setPagination({ pageIndex: 0, pageSize: 10 })
            }}><FormField id="audit-event" label="Event">
            <Input
              id="audit-event"
              value={event}
              onChange={(eventValue) => {
                setEvent(eventValue.target.value)
                setPagination((prev) => ({ ...prev, pageIndex: 0 }))
              }}
              placeholder="leave.request.reviewed"
              className="w-full"
            />
          </FormField>
<FormField id="audit-entity" label="Entity type">
            <Input
              id="audit-entity"
              value={entityType}
              onChange={(eventValue) => {
                setEntityType(eventValue.target.value)
                setPagination((prev) => ({ ...prev, pageIndex: 0 }))
              }}
              placeholder="LeaveRequest"
              className="w-full"
            />
          </FormField>
<FormField id="audit-entity-id" label="Record ID"><Input id="audit-entity-id" value={entityId} onChange={e => { setEntityId(e.target.value); setPagination(prev => ({ ...prev, pageIndex: 0 })) }} /></FormField>
<FormField id="audit-actor-id" label="Actor ID"><Input id="audit-actor-id" value={actorUserId} onChange={e => { setActorUserId(e.target.value); setPagination(prev => ({ ...prev, pageIndex: 0 })) }} /></FormField>
<FormField id="audit-request-id" label="Request ID">
            <Input
              id="audit-request-id"
              value={requestId}
              onChange={(eventValue) => {
                setRequestId(eventValue.target.value)
                setPagination((prev) => ({ ...prev, pageIndex: 0 }))
              }}
              placeholder="request-id"
              className="w-full"
            />
          </FormField>
<FormField id="audit-date-from" label="Date from (UTC)">
            <Input
              id="audit-date-from"
              type="date"
              value={dateFrom}
              onChange={(eventValue) => {
                setDateFrom(eventValue.target.value)
                setPagination((prev) => ({ ...prev, pageIndex: 0 }))
              }}
            />
          </FormField>
<FormField id="audit-date-to" label="Date to (UTC)">
            <Input
              id="audit-date-to"
              type="date"
              value={dateTo}
              onChange={(eventValue) => {
                setDateTo(eventValue.target.value)
                setPagination((prev) => ({ ...prev, pageIndex: 0 }))
              }}
            />
          </FormField></Filters></TableToolbar>

      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : <DataTable table={table} loading={loading} emptyMessage="No audit logs found." />}
      <TablePagination table={table} totalRows={totalRows} loading={loading} />
      </Surface>

      {detailId && <AuditEntry id={detailId} onClose={() => setDetailId(null)} />}

    </div>
  )
}

function AuditEntry({ id, onClose }: { id: string; onClose: () => void }) {
 const [row, setRow] = React.useState<AuditLogDetail | null>(null)
 const [error, setError] = React.useState("")
 const [revision, refresh] = React.useReducer(value => value + 1, 0)
 React.useEffect(() => {
  const controller = new AbortController()
  setRow(null); setError("")
  fetch(`/api/reports/audit-logs/${encodeURIComponent(id)}`, { cache: "no-store", signal: controller.signal }).then(async response => {
   const body = await response.json()
   if (!response.ok) throw new Error(body.error || "Unable to load audit entry.")
   if (!controller.signal.aborted) setRow(body)
  }).catch(error => { if (!controller.signal.aborted) setError(error.message) })
  return () => controller.abort()
 }, [id, revision])
 React.useEffect(() => {
  const onFocus = () => { setRow(null); refresh() }
  window.addEventListener("focus", onFocus)
  return () => window.removeEventListener("focus", onFocus)
 }, [])
 return <RecordPanel title={row?.event || "Audit entry"} description={row ? formatDateTime(row.createdAt) : "Read-only event history"} onClose={onClose} actions={<Button variant="outline" onClick={() => { setRow(null); refresh() }}>Reload entry</Button>}>
  {error ? <p role="alert" className="text-destructive">{error}</p> : !row ? <p>Loading audit entry...</p> : <>
   <Section title="Event details"><ReadOnlyFields fields={[
    { label: "Actor", value: row.actorName || row.actorEmail || row.actorUserId }, { label: "Actor role", value: row.actorRole },
    { label: "Actor ID", value: row.actorUserId }, { label: "Request ID", value: row.requestId },
    { label: "Entity type", value: row.entityType }, { label: "Entity ID", value: row.entityId },
   ]} /></Section>
   <Section title="Changed fields"><p className="mb-3 text-sm text-muted-foreground">Only recorded changes are shown. Credentials are redacted.</p>
    {row.changes.length ? <div className="overflow-x-auto rounded-md border"><table className="w-full text-sm"><thead><tr><th className="p-3 text-left">Field</th><th className="p-3 text-left">Before</th><th className="p-3 text-left">After</th></tr></thead><tbody>{row.changes.map(change => <tr key={change.field} className="border-t"><th className="max-w-40 break-words p-3 text-left font-medium">{change.field}</th><td className="p-3 align-top"><pre className="max-h-48 max-w-64 overflow-auto whitespace-pre-wrap break-words text-xs">{prettyJson(change.before)}</pre></td><td className="p-3 align-top"><pre className="max-h-48 max-w-64 overflow-auto whitespace-pre-wrap break-words text-xs">{prettyJson(change.after)}</pre></td></tr>)}</tbody></table></div> : <p className="text-sm text-muted-foreground">No field changes were recorded for this event.</p>}
   </Section>
   <details className="rounded-lg border p-4"><summary className="cursor-pointer font-medium">Recorded snapshots</summary><div className="mt-4 space-y-4">
    <Section title="Metadata"><pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">{prettyJson(row.metadata)}</pre></Section>
    <Section title="Before"><pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs">{prettyJson(row.before)}</pre></Section>
    <Section title="After"><pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs">{prettyJson(row.after)}</pre></Section>
   </div></details>
  </>}
 </RecordPanel>
}
