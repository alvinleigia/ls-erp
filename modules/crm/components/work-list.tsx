"use client"
import * as React from "react"
import Link from "next/link"
import { getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table"
import { Button } from "@/components/ui/button"
import { DataTable, DataTablePagination, DataTableToolbar } from "@/components/data-table"
import { RecordSelect } from "./record-select"
import { selectClass } from "./record-list"
import { useDateFormatter } from "@/hooks/use-date-formatter"
import { workTypes } from "../work-validation"
import { wallTime } from "../work-time"
import type { CrmWorkRow, WorkListResponse } from "@/types/crm-work"

export function WorkList({ contactId, enquiryId, opportunityId, initialDue = "" }: { contactId?: string; enquiryId?: string; opportunityId?: string; initialDue?: string }) {
  const embedded = !!(contactId || enquiryId || opportunityId)
  const [data, setData] = React.useState<WorkListResponse | null>(null)
  const [q, setQ] = React.useState("")
  const [scope, setScope] = React.useState(embedded ? "visible" : "mine")
  const [due, setDue] = React.useState(["overdue", "today", "upcoming", "reminders"].includes(initialDue) ? initialDue : "")
  const [state, setState] = React.useState("open")
  const [type, setType] = React.useState("")
  const [owner, setOwner] = React.useState("")
  const [sort, setSort] = React.useState("dueOn")
  const [pagination, setPagination] = React.useState({ pageIndex: 0, pageSize: 20 })
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState("")
  const [revision, setRevision] = React.useState(0)
  const { formatDate } = useDateFormatter()
  const reset = () => setPagination(previous => ({ ...previous, pageIndex: 0 }))
  React.useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setLoading(true); setError("")
      const params = new URLSearchParams({ q, scope, state, sort, order: sort === "dueOn" ? "asc" : "desc", page: String(pagination.pageIndex + 1), pageSize: String(pagination.pageSize) })
      for (const [key, value] of Object.entries({ due, type, assignedUserId: owner, contactId, enquiryId, opportunityId })) if (value) params.set(key, value)
      try { const response = await fetch(`/api/crm/work?${params}`, { signal: controller.signal, cache: "no-store" }); const result = await response.json(); if (!response.ok) throw new Error(result.error || "Unable to load activities."); setData(result) }
      catch (error) { if (!controller.signal.aborted) { setError((error as Error).message); setData(null) } }
      finally { if (!controller.signal.aborted) setLoading(false) }
    }, 150)
    return () => { clearTimeout(timer); controller.abort() }
  }, [q, scope, state, sort, pagination, due, type, owner, contactId, enquiryId, opportunityId, revision])
  const columns = React.useMemo<ColumnDef<CrmWorkRow>[]>(() => [
    { accessorKey: "title", header: "Activity", cell: ({ row }) => <Link className="font-medium underline" href={`/crm/activities/${row.original.id}`}>{row.original.title}</Link> },
    { accessorKey: "type", header: "Type" },
    { id: "contact", header: "Customer", cell: ({ row }) => row.original.contact.name },
    { id: "owner", header: "Assigned to", cell: ({ row }) => row.original.assignee.name || "Staff member" },
    { accessorKey: "priority", header: "Priority", cell: ({ row }) => ["", "Low", "Normal", "High"][row.original.priority] },
    { accessorKey: "dueOn", header: "Scheduled", cell: ({ row }) => row.original.startsAt ? `${formatDate(row.original.dueOn.slice(0, 10))} ${wallTime(row.original.startsAt, data?.timeZone || "UTC").slice(11)}` : `${formatDate(row.original.dueOn.slice(0, 10))} · All day` },
    { accessorKey: "status", header: "Status", cell: ({ row }) => row.original.status.replaceAll("_", " ") },
  ], [formatDate, data?.timeZone])
  const table = useReactTable({ data: data?.items ?? [], columns, getCoreRowModel: getCoreRowModel(), manualPagination: true, manualFiltering: true, rowCount: data?.total ?? 0, state: { pagination, globalFilter: q },
    onPaginationChange: updater => setPagination(previous => { const next = typeof updater === "function" ? updater(previous) : updater; return previous.pageSize !== next.pageSize ? { ...next, pageIndex: 0 } : next }),
    onGlobalFilterChange: value => { setQ(String(value)); setPagination(previous => ({ ...previous, pageIndex: 0 })) },
  })
  const context = new URLSearchParams(Object.fromEntries(Object.entries({ contactId, enquiryId, opportunityId }).filter((entry): entry is [string, string] => !!entry[1])))
  return <section className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><h1 className={embedded ? "text-lg font-semibold" : "text-2xl font-semibold"}>{embedded ? "Activities and follow-ups" : "My Work"}</h1><div className="flex gap-2">{!embedded && <Button variant="outline" asChild><Link href="/crm/calendar">Calendar</Link></Button>}<Button variant="outline" asChild><Link href={`/crm/activities/new?${context}&log=true`}>Log interaction</Link></Button><Button asChild><Link href={`/crm/activities/new?${context}`}>Schedule activity</Link></Button></div></div>
    {!embedded && <p className="text-sm text-muted-foreground">Work through reminders and follow-ups, review customer history, then record an outcome and the next step. Times use {data?.timeZone || "the business time zone"}.</p>}
    <DataTableToolbar table={table} searchPlaceholder="Search activity titles…" showColumnToggle={false}>
      <select aria-label="Activity scope" className={selectClass} value={scope} onChange={event => { setScope(event.target.value); setOwner(""); reset() }}><option value="mine">Assigned to me</option><option value="visible">All I can access</option></select>
      <select aria-label="Activity status" className={selectClass} value={state} onChange={event => { setState(event.target.value); setDue(""); reset() }}><option value="open">Open</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option><option value="all">All statuses</option></select>
      <select aria-label="Activity due filter" className={selectClass} value={due} onChange={event => { setDue(event.target.value); if (event.target.value === "reminders" || event.target.value === "overdue") setState("open"); reset() }}><option value="">Any due date</option><option value="today">Today</option><option value="overdue">Overdue</option><option value="upcoming">Upcoming</option><option value="reminders">My due reminders</option></select>
      <select aria-label="Activity type" className={selectClass} value={type} onChange={event => { setType(event.target.value); reset() }}><option value="">All types</option>{workTypes.map(type => <option key={type}>{type}</option>)}</select>
      <select aria-label="Activity sorting" className={selectClass} value={sort} onChange={event => { setSort(event.target.value); reset() }}><option value="dueOn">Earliest due</option><option value="priority">Highest priority</option><option value="updatedAt">Recently updated</option></select>
      {data?.canManage && scope === "visible" && <div className="w-52"><RecordSelect id="work-owner" endpoint="/api/crm/assignees" value={owner} onChange={value => { setOwner(value); reset() }} /></div>}
      <Button variant="outline" size="sm" onClick={() => setRevision(value => value + 1)}>Refresh</Button>
    </DataTableToolbar>
    {error && <p role="alert" className="text-destructive">{error}</p>}<DataTable table={table} loading={loading} emptyMessage="No activities match these filters." /><DataTablePagination table={table} totalRows={data?.total ?? 0} />
  </section>
}
