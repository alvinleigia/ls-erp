"use client"
import * as React from "react"
import Link from "next/link"
import { CalendarClock, ChevronDown, Plus, RefreshCw, Search, SlidersHorizontal } from "lucide-react"
import { getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table"
import { Button } from "@/components/ui/button"
import { DataTable, DataTablePagination, DataTableToolbar } from "@/components/data-table"
import { RecordSelect } from "./record-select"
import { selectClass } from "./record-list"
import { useDateFormatter } from "@/hooks/use-date-formatter"
import { workTypes } from "../work-validation"
import { wallTime } from "../work-time"
import type { CrmWorkRow, WorkListResponse } from "@/types/crm-work"
import { Input } from "@/components/ui/input"
import { FormField } from "@/components/form-field"
import { DropdownSelect } from "@/components/ui/dropdown-select"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { CrmEmptyState, CrmSection } from "./crm-section"

export function WorkList({ contactId, enquiryId, opportunityId, planLaunchId, initialDue = "", initialScope, initialState, assignedUserId, initialType, completedFrom, completedThrough, compact = false }: { contactId?: string; enquiryId?: string; opportunityId?: string; planLaunchId?: string; initialDue?: string; initialScope?: string; initialState?: string; assignedUserId?: string; initialType?: string; completedFrom?: string; completedThrough?: string; compact?: boolean }) {
  const embedded = !!(contactId || enquiryId || opportunityId)
  const [data, setData] = React.useState<WorkListResponse | null>(null)
  const [q, setQ] = React.useState("")
  const [scope, setScope] = React.useState(initialScope === "visible" || embedded ? "visible" : "mine")
  const [due, setDue] = React.useState(["overdue", "today", "upcoming", "reminders"].includes(initialDue) ? initialDue : "")
  const [state, setState] = React.useState(initialState && ["open", "completed", "cancelled", "all"].includes(initialState) ? initialState : "open")
  const [type, setType] = React.useState(workTypes.includes(initialType as typeof workTypes[number]) ? initialType! : "")
  const [owner, setOwner] = React.useState(assignedUserId || "")
  const [completionPeriod, setCompletionPeriod] = React.useState(completedFrom && completedThrough ? { completedFrom, completedThrough } : null)
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
      if (completionPeriod) { params.set("completedFrom", completionPeriod.completedFrom); params.set("completedThrough", completionPeriod.completedThrough) }
      for (const [key, value] of Object.entries({ due, type, assignedUserId: owner, contactId, enquiryId, opportunityId, planLaunchId })) if (value) params.set(key, value)
      try { const response = await fetch(`/api/crm/work?${params}`, { signal: controller.signal, cache: "no-store" }); const result = await response.json(); if (!response.ok) throw new Error(result.error || "Unable to load activities."); setData(result) }
      catch (error) { if (!controller.signal.aborted) { setError((error as Error).message); setData(null) } }
      finally { if (!controller.signal.aborted) setLoading(false) }
    }, 150)
    return () => { clearTimeout(timer); controller.abort() }
  }, [q, scope, state, sort, pagination, due, type, owner, contactId, enquiryId, opportunityId, planLaunchId, revision, completionPeriod])
  const columns = React.useMemo<ColumnDef<CrmWorkRow>[]>(() => [
    { accessorKey: "title", header: "Activity", cell: ({ row }) => <div><Link className="font-medium underline" href={`/crm/activities/${row.original.id}`}>{row.original.title}</Link>{row.original.planLaunch && <p className="text-xs text-muted-foreground">{row.original.planLaunch.planName} · Step {(row.original.planPosition ?? 0) + 1}</p>}</div> },
    { accessorKey: "type", header: "Type" },
    { id: "contact", header: "Customer", cell: ({ row }) => row.original.contact.name },
    { id: "owner", header: "Assigned to", cell: ({ row }) => row.original.assignee.name || "Staff member" },
    { accessorKey: "priority", header: "Priority", cell: ({ row }) => ["", "Low", "Normal", "High"][row.original.priority] },
    { accessorKey: "dueOn", header: "Scheduled", cell: ({ row }) => row.original.startsAt ? `${formatDate(row.original.dueOn.slice(0, 10))} ${wallTime(row.original.startsAt, data?.timeZone || "UTC").slice(11)}` : `${formatDate(row.original.dueOn.slice(0, 10))} · All day` },
    { accessorKey: "status", header: "Status", cell: ({ row }) => row.original.status.replaceAll("_", " ") },
  ], [formatDate, data?.timeZone])
  const table = useReactTable({ data: data?.items ?? [], columns, getCoreRowModel: getCoreRowModel(), manualPagination: true, manualFiltering: true, rowCount: data?.total ?? 0, state: { pagination, globalFilter: q, columnVisibility: { contact: !compact } },
    onPaginationChange: updater => setPagination(previous => { const next = typeof updater === "function" ? updater(previous) : updater; return previous.pageSize !== next.pageSize ? { ...next, pageIndex: 0 } : next }),
    onGlobalFilterChange: value => { setQ(String(value)); setPagination(previous => ({ ...previous, pageIndex: 0 })) },
  })
  const context = new URLSearchParams(Object.fromEntries(Object.entries({ contactId, enquiryId, opportunityId }).filter((entry): entry is [string, string] => !!entry[1])))
  const filterCount = [scope !== "visible", !!due, !!type, !!owner, sort !== "dueOn"].filter(Boolean).length
  const compactActions = <>
    <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline">More actions<ChevronDown className="size-4" aria-hidden="true" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end">
      <DropdownMenuItem asChild><Link href={`/crm/activity-plans/apply?${context}`}>Apply plan</Link></DropdownMenuItem>
      <DropdownMenuItem asChild><Link href={`/crm/activities/new?${context}&log=true`}>Log interaction</Link></DropdownMenuItem>
    </DropdownMenuContent></DropdownMenu>
    <Button asChild><Link href={`/crm/activities/new?${context}`}><Plus className="size-4" aria-hidden="true" />Schedule activity</Link></Button>
  </>
  const content = <>
    {!compact && <div className="flex flex-wrap items-center justify-between gap-3"><h1 className={embedded ? "text-lg font-semibold" : "text-2xl font-semibold"}>{embedded ? "Activities and follow-ups" : "My Work"}</h1><div className="flex flex-wrap gap-2">{!embedded && <Button variant="outline" asChild><Link href="/crm/calendar">Calendar</Link></Button>}<Button variant="outline" asChild><Link href={`/crm/activity-plans/apply?${context}`}>Apply plan</Link></Button><Button variant="outline" asChild><Link href={`/crm/activities/new?${context}&log=true`}>Log interaction</Link></Button><Button asChild><Link href={`/crm/activities/new?${context}`}>Schedule activity</Link></Button></div></div>}
    {planLaunchId && <p className="text-sm">Showing accessible activities from this plan application. <Link className="underline" href="/crm/activities">Show all my work</Link></p>}
    {!embedded && <p className="text-sm text-muted-foreground">Work through reminders and follow-ups, review customer history, then record an outcome and the next step. Times use {data?.timeZone || "the business time zone"}.</p>}
    {compact ? <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-0 basis-full sm:basis-56 sm:flex-1"><Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" aria-hidden="true" /><Input aria-label="Search activity titles" placeholder="Search activities…" className="pl-9" value={q} onChange={event => table.setGlobalFilter(event.target.value)} /></div>
      <DropdownSelect label="Activity status" value={state} options={[{ value: "open", label: "Open" }, { value: "completed", label: "Completed" }, { value: "cancelled", label: "Cancelled" }, { value: "all", label: "All statuses" }]} onValueChange={value => { setState(value); setDue(""); setCompletionPeriod(null); reset() }} className="min-w-32" />
      <Popover><PopoverTrigger asChild><Button variant="outline"><SlidersHorizontal className="size-4" aria-hidden="true" />Filters{filterCount > 0 && <span className="rounded bg-secondary px-1.5 text-xs">{filterCount}</span>}</Button></PopoverTrigger>
        <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] space-y-4 p-4" aria-label="Activity filters">
          <div className="flex items-center justify-between"><h3 className="font-semibold">Activity filters</h3><Button size="sm" variant="ghost" disabled={!filterCount} onClick={() => { setScope("visible"); setDue(""); setType(""); setOwner(""); setSort("dueOn"); reset() }}>Reset filters</Button></div>
          <div className="grid grid-cols-1 gap-4 min-[400px]:grid-cols-2">
            <FormField id="activity-scope" label="Show activities"><DropdownSelect id="activity-scope" label="Activity scope" className="w-full" value={scope} options={[{ value: "mine", label: "Assigned to me" }, { value: "visible", label: "All I can access" }]} onValueChange={value => { setScope(value); setOwner(""); reset() }} /></FormField>
            <FormField id="activity-due" label="Due date"><DropdownSelect id="activity-due" label="Activity due filter" className="w-full" value={due} options={[{ value: "", label: "Any due date" }, { value: "today", label: "Today" }, { value: "overdue", label: "Overdue" }, { value: "upcoming", label: "Upcoming" }, { value: "reminders", label: "My due reminders" }]} onValueChange={value => { setDue(value); setCompletionPeriod(null); if (value === "reminders" || value === "overdue") setState("open"); reset() }} /></FormField>
            <FormField id="activity-type" label="Activity type"><DropdownSelect id="activity-type" label="Activity type" className="w-full" value={type} options={[{ value: "", label: "All types" }, ...workTypes.map(value => ({ value, label: value.charAt(0) + value.slice(1).toLowerCase() }))]} onValueChange={value => { setType(value); reset() }} /></FormField>
            <FormField id="activity-sort" label="Sort by"><DropdownSelect id="activity-sort" label="Activity sorting" className="w-full" value={sort} options={[{ value: "dueOn", label: "Earliest due" }, { value: "priority", label: "Highest priority" }, { value: "updatedAt", label: "Recently updated" }]} onValueChange={value => { setSort(value); reset() }} /></FormField>
            {data?.canManage && scope === "visible" && <FormField id="work-owner" label="Assigned staff" className="min-[400px]:col-span-2"><div className="flex min-w-0 gap-2"><div className="min-w-0 flex-1"><RecordSelect id="work-owner" endpoint="/api/crm/assignees" value={owner} onChange={value => { setOwner(value); reset() }} /></div>{owner && <Button variant="ghost" onClick={() => { setOwner(""); reset() }}>Clear</Button>}</div></FormField>}
          </div>
        </PopoverContent>
      </Popover>
      <Button variant="ghost" size="icon" aria-label="Refresh activities" title="Refresh activities" disabled={loading} onClick={() => setRevision(value => value + 1)}><RefreshCw className="size-4" aria-hidden="true" /></Button>
    </div> : <DataTableToolbar table={table} searchPlaceholder="Search activity titles…" showColumnToggle={false}>
      <select aria-label="Activity scope" className={selectClass} value={scope} onChange={event => { setScope(event.target.value); setOwner(""); reset() }}><option value="mine">Assigned to me</option><option value="visible">All I can access</option></select>
      <select aria-label="Activity status" className={selectClass} value={state} onChange={event => { setState(event.target.value); setDue(""); setCompletionPeriod(null); reset() }}><option value="open">Open</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option><option value="all">All statuses</option></select>
      <select aria-label="Activity due filter" className={selectClass} value={due} onChange={event => { setDue(event.target.value); setCompletionPeriod(null); if (event.target.value === "reminders" || event.target.value === "overdue") setState("open"); reset() }}><option value="">Any due date</option><option value="today">Today</option><option value="overdue">Overdue</option><option value="upcoming">Upcoming</option><option value="reminders">My due reminders</option></select>
      <select aria-label="Activity type" className={selectClass} value={type} onChange={event => { setType(event.target.value); reset() }}><option value="">All types</option>{workTypes.map(type => <option key={type}>{type}</option>)}</select>
      <select aria-label="Activity sorting" className={selectClass} value={sort} onChange={event => { setSort(event.target.value); reset() }}><option value="dueOn">Earliest due</option><option value="priority">Highest priority</option><option value="updatedAt">Recently updated</option></select>
      {data?.canManage && scope === "visible" && <div className="w-52"><RecordSelect id="work-owner" endpoint="/api/crm/assignees" value={owner} onChange={value => { setOwner(value); reset() }} /></div>}
      <Button variant="outline" size="sm" onClick={() => setRevision(value => value + 1)}>Refresh</Button>
    </DataTableToolbar>}
    {completionPeriod && <div className="flex items-center gap-3 text-sm">Completed/logged from {formatDate(completionPeriod.completedFrom)} through {formatDate(completionPeriod.completedThrough)}<Button size="sm" variant="outline" onClick={() => { setCompletionPeriod(null); reset() }}>Clear period</Button></div>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {compact && !loading && !error && data?.items.length === 0 ? <CrmEmptyState title="No activities match these filters" description="Try another status or filter, or schedule an activity for this contact." /> : <>
      <div className={compact ? "hidden md:block" : undefined}><DataTable table={table} loading={loading} emptyMessage="No activities match these filters." /></div>
      {compact && <div className="space-y-3 md:hidden">{loading ? <p className="py-4 text-sm text-muted-foreground">Loading activities…</p> : data?.items.map(item => <article key={item.id} className="space-y-2 rounded-lg border p-3">
        <div className="flex items-start justify-between gap-2"><Link className="min-w-0 break-words font-medium underline underline-offset-4" href={`/crm/activities/${item.id}`}>{item.title}</Link><span className="rounded bg-muted px-2 py-0.5 text-xs">{item.status.replaceAll("_", " ")}</span></div>
        {item.planLaunch && <p className="text-xs text-muted-foreground">{item.planLaunch.planName} · Step {(item.planPosition ?? 0) + 1}</p>}
        <p className="text-sm">{formatDate(item.dueOn.slice(0, 10))} · {item.startsAt ? wallTime(item.startsAt, data?.timeZone || "UTC").slice(11) : "All day"}</p>
        <p className="break-words text-xs text-muted-foreground">{item.type} · {item.assignee.name || "Staff member"} · {["", "Low", "Normal", "High"][item.priority]} priority</p>
      </article>)}</div>}
    </>}
    <DataTablePagination table={table} totalRows={data?.total ?? 0} compact={compact} />
  </>
  return compact ? <CrmSection title="Activities and follow-ups" description={`Upcoming work and completed activities. Times use ${data?.timeZone || "the business time zone"}.`} icon={CalendarClock} actions={compactActions}>{content}</CrmSection> : <section className="space-y-4">{content}</section>
}
