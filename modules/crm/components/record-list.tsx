"use client"
import * as React from "react"
import Link from "next/link"
import { type ColumnDef, type PaginationState, getCoreRowModel, useReactTable } from "@tanstack/react-table"
import { toast } from "sonner"
import { DataTable, DataTablePagination, DataTableToolbar } from "@/components/data-table"
import { Button } from "@/components/ui/button"
import { useDateFormatter } from "@/hooks/use-date-formatter"
import { enquiryStatuses } from "@/modules/crm/validation"
import type { ListResponse } from "@/types/api"
import type { CrmContactRow, CrmEnquiryRow, CrmTaskRow } from "@/types/crm"

type Row = Partial<CrmContactRow & CrmEnquiryRow & CrmTaskRow> & { id: string }
export const selectClass = "h-9 rounded-md border bg-background px-3 text-sm"

export function RecordList({ kind, enquiryId, refresh = 0, onChanged }: {
  kind: "contacts" | "enquiries" | "tasks"; enquiryId?: string; refresh?: number; onChanged?: () => void;
}) {
  const { formatDate } = useDateFormatter()
  const [items, setItems] = React.useState<Row[]>([])
  const [total, setTotal] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState("")
  const [search, setSearch] = React.useState("")
  const [filter, setFilter] = React.useState("")
  const [pagination, setPagination] = React.useState<PaginationState>({ pageIndex: 0, pageSize: 20 })
  const [revision, setRevision] = React.useState(0)
  const [completing, setCompleting] = React.useState<string | null>(null)
  const endpoint = enquiryId ? `/api/crm/enquiries/${enquiryId}/tasks` : `/api/crm/${kind}`
  React.useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams({ page: String(pagination.pageIndex + 1), pageSize: String(pagination.pageSize), q: search })
    if (filter) params.set(kind === "contacts" ? "archived" : kind === "tasks" ? "due" : "status", filter)
    const timer = setTimeout(async () => {
      setLoading(true); setError("")
      try {
        const response = await fetch(`${endpoint}?${params}`, { signal: controller.signal, cache: "no-store" })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || "Unable to load records.")
        const result = data as ListResponse<Row>
        setItems(result.items); setTotal(result.total)
      } catch (error) {
        if (!controller.signal.aborted) { setError((error as Error).message); setItems([]); setTotal(0) }
      } finally { if (!controller.signal.aborted) setLoading(false) }
    }, 150)
    return () => { clearTimeout(timer); controller.abort() }
  }, [endpoint, kind, pagination, search, filter, revision, refresh])
  const complete = React.useCallback(async (id: string) => {
    setCompleting(id)
    try {
      const response = await fetch(`/api/crm/tasks/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ completed: true }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Unable to complete follow-up.")
      toast.success("Follow-up completed."); setRevision(value => value + 1); onChanged?.()
    } catch (error) { toast.error((error as Error).message) } finally { setCompleting(null) }
  }, [onChanged])
  const columns = React.useMemo<ColumnDef<Row>[]>(() => {
    if (kind === "contacts") return [
      { accessorKey: "name", header: "Contact", cell: ({ row }) => <Link className="font-medium underline" href={`/crm/contacts/${row.original.id}`}>{row.original.name}</Link> },
      { accessorKey: "email", header: "Email", cell: ({ row }) => row.original.email || "—" },
      { accessorKey: "phone", header: "Phone", cell: ({ row }) => row.original.phone || "—" },
    ]
    if (kind === "enquiries") return [
      { accessorKey: "title", header: "Enquiry", cell: ({ row }) => <Link className="font-medium underline" href={`/crm/enquiries/${row.original.id}`}>{row.original.title}</Link> },
      { id: "contact", header: "Contact", cell: ({ row }) => row.original.contact?.name },
      { accessorKey: "status", header: "Status" },
      { id: "assignee", header: "Salesperson", cell: ({ row }) => row.original.assignee?.name || "Unnamed user" },
    ]
    return [
      { accessorKey: "title", header: "Follow-up" },
      { id: "enquiry", header: "Enquiry", cell: ({ row }) => <Link className="underline" href={`/crm/enquiries/${row.original.enquiry?.id}`}>{row.original.enquiry?.title}</Link> },
      { accessorKey: "dueOn", header: "Due date", cell: ({ row }) => formatDate(row.original.dueOn?.slice(0, 10)) },
      { id: "actions", header: "Action", cell: ({ row }) => row.original.completedAt ? "Completed" : <Button size="sm" variant="outline" disabled={!!completing} loading={completing === row.original.id} onClick={() => void complete(row.original.id)}>Complete</Button> },
    ]
  }, [kind, formatDate, completing, complete])
  const table = useReactTable({
    data: items, columns, getCoreRowModel: getCoreRowModel(), manualPagination: true, manualFiltering: true,
    rowCount: total, state: { pagination, globalFilter: search },
    onPaginationChange: updater => setPagination(previous => {
      const next = typeof updater === "function" ? updater(previous) : updater
      return next.pageSize !== previous.pageSize ? { ...next, pageIndex: 0 } : next
    }),
    onGlobalFilterChange: value => { setSearch(String(value)); setPagination(previous => ({ ...previous, pageIndex: 0 })) },
  })
  const title = kind === "contacts" ? "Contacts" : kind === "enquiries" ? "Enquiries" : "Follow-ups"
  return <section className="space-y-4">
    <div className="flex items-center justify-between gap-3"><h1 className={enquiryId ? "text-lg font-semibold" : "text-2xl font-semibold"}>{title}</h1>
      {kind !== "tasks" && <Button asChild><Link href={`/crm/${kind}/new`}>New {kind === "contacts" ? "contact" : "enquiry"}</Link></Button>}
    </div>
    <DataTableToolbar table={table} searchPlaceholder={`Search ${title.toLowerCase()}…`} showColumnToggle={false}>
      <select aria-label={`${title} filter`} className={selectClass} value={filter} onChange={event => { setFilter(event.target.value); setPagination(previous => ({ ...previous, pageIndex: 0 })) }}>
        {kind === "contacts" ? <><option value="">Active contacts</option><option value="true">Archived contacts</option></> : kind === "tasks" ? <><option value="">Open follow-ups</option><option value="overdue">Overdue</option><option value="completed">Completed</option></> : <><option value="">All statuses</option>{enquiryStatuses.map(status => <option key={status}>{status}</option>)}</>}
      </select>
    </DataTableToolbar>
    {error && <p className="text-destructive" role="alert">{error} <Button variant="link" onClick={() => setRevision(value => value + 1)}>Retry</Button></p>}
    <DataTable table={table} loading={loading} emptyMessage={`No ${title.toLowerCase()} found.`} />
    <DataTablePagination table={table} totalRows={total} />
  </section>
}
