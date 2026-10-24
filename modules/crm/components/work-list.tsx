"use client"
import { useTerminology, useTerminologyReader } from "@/platform/terminology/provider"
import { AccessPageHeader } from "@/platform/access/record-page"
import { Surface, Filters, pageClass } from "@/components/erp/page"
import { TablePagination } from "@/components/erp/pagination"
import * as React from "react"
import Link from "@/platform/access/link"
import { CalendarClock, ChevronDown, Plus, RefreshCw, Search } from "lucide-react"
import { getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/data-table"
import { RecordSelect } from "@/components/erp/record-select"
import { useDateFormatter } from "@/hooks/use-date-formatter"
import { ActivityTypeSelect, activityTypeFilter } from "./activity-type-select"
import { wallTime } from "../work-time"
import type { CrmWorkRow, WorkListResponse } from "@/types/crm-work"
import { Input } from "@/components/ui/input"
import { FormField } from "@/components/form-field"
import { DropdownSelect } from "@/components/ui/dropdown-select"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { EmptyState, Section } from "@/components/erp/section"

export function WorkList({ extensionQuery = "", guidance, allowCreate = true, contactId, enquiryId, opportunityId, planLaunchId, initialDue = "", initialScope, initialState, assignedUserId, salesTeamId, initialType, activityTypeId, completedFrom, completedThrough }: { extensionQuery?: string; guidance?: React.ReactNode; allowCreate?: boolean; contactId?: string; enquiryId?: string; opportunityId?: string; planLaunchId?: string; initialDue?: string; initialScope?: string; initialState?: string; assignedUserId?: string; salesTeamId?: string; initialType?: string; activityTypeId?: string; completedFrom?: string; completedThrough?: string }) {
  const readTerm = useTerminologyReader()
  const term = useTerminology()
  const embedded = !!(extensionQuery || contactId || enquiryId || opportunityId)
  const [data, setData] = React.useState<WorkListResponse | null>(null)
  const [q, setQ] = React.useState("")
  const [scope, setScope] = React.useState(initialScope === "visible" || embedded ? "visible" : "mine")
  const [due, setDue] = React.useState(["overdue", "today", "upcoming", "reminders"].includes(initialDue) ? initialDue : "")
  const [state, setState] = React.useState(initialState && ["open", "completed", "cancelled", "all"].includes(initialState) ? initialState : "open")
  const [type, setType] = React.useState(activityTypeId || initialType || "")
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
      const params = new URLSearchParams(extensionQuery)
      for (const [key, value] of Object.entries({ q, scope, state, sort, order: sort === "dueOn" ? "asc" : "desc", page: String(pagination.pageIndex + 1), pageSize: String(pagination.pageSize) })) params.set(key, value)
      if (completionPeriod) { params.set("completedFrom", completionPeriod.completedFrom); params.set("completedThrough", completionPeriod.completedThrough) }
      for (const [key, value] of Object.entries({ due, ...activityTypeFilter(type), assignedUserId: owner, salesTeamId, contactId, enquiryId, opportunityId, planLaunchId })) if (value) params.set(key, value)
      try { const response = await fetch(`/api/crm/work?${params}`, { signal: controller.signal, cache: "no-store" }); const result = await response.json(); if (!response.ok) throw new Error(result.error || readTerm("crm.activity.plural", "Unable to load activities.", "Unable to load {label}.")); setData(result) }
      catch (error) { if (!controller.signal.aborted) { setError((error as Error).message); setData(null) } }
      finally { if (!controller.signal.aborted) setLoading(false) }
    }, 150)
    return () => { clearTimeout(timer); controller.abort() }
  }, [readTerm, salesTeamId, q, scope, state, sort, pagination, due, type, owner, extensionQuery, contactId, enquiryId, opportunityId, planLaunchId, revision, completionPeriod])
  const columns = React.useMemo<ColumnDef<CrmWorkRow>[]>(() => [
    { accessorKey: "title", header: term("crm.activity.singular", "Activity"), cell: ({ row }) => <div><Link className="font-medium underline" href={`/crm/activities/${row.original.id}`}>{row.original.title}</Link>{row.original.planLaunch && <p className="text-xs text-muted-foreground">{row.original.planLaunch.planName} · Step {(row.original.planPosition ?? 0) + 1}</p>}</div> },
    { accessorKey: "type", header: "Type", cell: ({ row }) => row.original.activityTypeName || row.original.type },
    { id: "contact", header: term("crm.contact.singular", "Customer"), cell: ({ row }) => row.original.contact.name },
    { id: "owner", header: "Assigned to", cell: ({ row }) => row.original.assignee.name || "Staff member" },
    { accessorKey: "priority", header: "Priority", cell: ({ row }) => ["", "Low", "Normal", "High"][row.original.priority] },
    { accessorKey: "dueOn", header: "Scheduled", cell: ({ row }) => row.original.startsAt ? `${formatDate(row.original.dueOn.slice(0, 10))} ${wallTime(row.original.startsAt, data?.timeZone || "UTC").slice(11)}` : `${formatDate(row.original.dueOn.slice(0, 10))} · All day` },
    { accessorKey: "status", header: "Status", cell: ({ row }) => row.original.status.replaceAll("_", " ") },
  ], [formatDate, data?.timeZone, term])
  const table = useReactTable({ data: data?.items ?? [], columns, getCoreRowModel: getCoreRowModel(), manualPagination: true, manualFiltering: true, rowCount: data?.total ?? 0, state: { pagination, globalFilter: q, columnVisibility: { contact: !contactId } },
    onPaginationChange: updater => setPagination(previous => { const next = typeof updater === "function" ? updater(previous) : updater; return previous.pageSize !== next.pageSize ? { ...next, pageIndex: 0 } : next }),
    onGlobalFilterChange: value => { setQ(String(value)); setPagination(previous => ({ ...previous, pageIndex: 0 })) },
  })
  const context = new URLSearchParams(Object.fromEntries(Object.entries({ contactId, enquiryId, opportunityId }).filter((entry): entry is [string, string] => !!entry[1])))
  const filterCount = [scope !== (embedded ? "visible" : "mine"), !!due, !!type, !!owner, sort !== "dueOn"].filter(Boolean).length
  const actions = <>
    <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline">More actions<ChevronDown className="size-4" aria-hidden="true" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end">
      <DropdownMenuItem asChild><Link href={`/crm/activity-plans/apply?${context}`}>Apply plan</Link></DropdownMenuItem>
      <DropdownMenuItem asChild><Link href={`/crm/activities/new?${context}&log=true`}>Log interaction</Link></DropdownMenuItem>
    </DropdownMenuContent></DropdownMenu>
    <Button asChild><Link href={`/crm/activities/new?${context}`}><Plus className="size-4" aria-hidden="true" />{term("crm.activity.singular", "Schedule activity", "Schedule {label}")}</Link></Button>
  </>
  const content = <>

    {planLaunchId && <p className="text-sm">{term("crm.activity.plural", "Showing accessible activities from this plan application.", "Showing accessible {label} from this plan application.")} <Link className="underline" href="/crm/activities">Show all my work</Link></p>}
    {!embedded && <p className="text-sm text-muted-foreground">Work through reminders and follow-ups, review customer history, then record an outcome and the next step. Times use {data?.timeZone || "the business time zone"}.</p>}
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-0 basis-full sm:basis-56 sm:flex-1"><Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" aria-hidden="true" /><Input aria-label={term("crm.activity.singular", "Search activity titles", "Search {label} titles")} placeholder={term("crm.activity.plural", "Search activities…", "Search {label}…")} className="pl-9" value={q} onChange={event => table.setGlobalFilter(event.target.value)} /></div>
      <DropdownSelect label={term("crm.activity.singular", "Activity status", "{label} status")} value={state} options={[{ value: "open", label: "Open" }, { value: "completed", label: "Completed" }, { value: "cancelled", label: "Cancelled" }, { value: "all", label: "All statuses" }]} onValueChange={value => { setState(value); setDue(""); setCompletionPeriod(null); reset() }} className="min-w-32" />
      <Filters label={term("crm.activity.singular", "Activity filters", "{label} filters")} activeCount={filterCount} onReset={() => { setScope(embedded ? "visible" : "mine"); setDue(""); setType(""); setOwner(""); setSort("dueOn"); reset() }}>
            <FormField id="activity-scope" label={term("crm.activity.plural", "Show activities", "Show {label}")}><DropdownSelect id="activity-scope" label={term("crm.activity.singular", "Activity scope", "{label} scope")} className="w-full" value={scope} options={[{ value: "mine", label: "Assigned to me" }, { value: "visible", label: "All I can access" }]} onValueChange={value => { setScope(value); setOwner(""); reset() }} /></FormField>
            <FormField id="activity-due" label="Due date"><DropdownSelect id="activity-due" label={term("crm.activity.singular", "Activity due filter", "{label} due filter")} className="w-full" value={due} options={[{ value: "", label: "Any due date" }, { value: "today", label: "Today" }, { value: "overdue", label: "Overdue" }, { value: "upcoming", label: "Upcoming" }, { value: "reminders", label: "My due reminders" }]} onValueChange={value => { setDue(value); setCompletionPeriod(null); if (value === "reminders" || value === "overdue") setState("open"); reset() }} /></FormField>
            <FormField id="activity-type" label={term("crm.activity.singular", "Activity type", "{label} type")}><ActivityTypeSelect id="activity-type" filter value={type} onChange={value => { setType(value); reset() }} /></FormField>
            <FormField id="activity-sort" label="Sort by"><DropdownSelect id="activity-sort" label={term("crm.activity.singular", "Activity sorting", "{label} sorting")} className="w-full" value={sort} options={[{ value: "dueOn", label: "Earliest due" }, { value: "priority", label: "Highest priority" }, { value: "updatedAt", label: "Recently updated" }]} onValueChange={value => { setSort(value); reset() }} /></FormField>
            {data?.canManage && scope === "visible" && <FormField id="work-owner" label="Assigned staff" className="min-[440px]:col-span-2"><div className="flex min-w-0 gap-2"><div className="min-w-0 flex-1"><RecordSelect id="work-owner" endpoint="/api/crm/assignees" value={owner} onChange={value => { setOwner(value); reset() }} /></div>{owner && <Button variant="ghost" onClick={() => { setOwner(""); reset() }}>Clear</Button>}</div></FormField>}
      </Filters>
      <Button variant="ghost" size="icon" aria-label={term("crm.activity.plural", "Refresh activities", "Refresh {label}")} title={term("crm.activity.plural", "Refresh activities", "Refresh {label}")} disabled={loading} onClick={() => setRevision(value => value + 1)}><RefreshCw className="size-4" aria-hidden="true" /></Button>
    </div>
    {completionPeriod && <div className="flex items-center gap-3 text-sm">Completed/logged from {formatDate(completionPeriod.completedFrom)} through {formatDate(completionPeriod.completedThrough)}<Button size="sm" variant="outline" onClick={() => { setCompletionPeriod(null); reset() }}>Clear period</Button></div>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {!loading && !error && data?.items.length === 0 ? <EmptyState title={term("crm.activity.plural", "No activities match these filters", "No {label} match these filters")} description={term("crm.activity.singular", "Try another status or filter, or schedule an activity", "Try another status or filter, or schedule a {label}") + " " + term("crm.contact.singular", "for this customer.", "for this {label}.")} /> : <>
      <div className="hidden md:block"><DataTable table={table} loading={loading} emptyMessage={term("crm.activity.plural", "No activities match these filters.", "No {label} match these filters.")} /></div>
      <div className="space-y-3 md:hidden">{loading ? <p className="py-4 text-sm text-muted-foreground">{term("crm.activity.plural", "Loading activities…", "Loading {label}…")}</p> : data?.items.map(item => <article key={item.id} className="space-y-2 rounded-lg border p-3">
        <div className="flex items-start justify-between gap-2"><Link className="min-w-0 break-words font-medium underline underline-offset-4" href={`/crm/activities/${item.id}`}>{item.title}</Link><span className="rounded bg-muted px-2 py-0.5 text-xs">{item.status.replaceAll("_", " ")}</span></div>
        {item.planLaunch && <p className="text-xs text-muted-foreground">{item.planLaunch.planName} · Step {(item.planPosition ?? 0) + 1}</p>}
        {!contactId && <p className="break-words text-sm">{item.contact.name}</p>}
        <p className="text-sm">{formatDate(item.dueOn.slice(0, 10))} · {item.startsAt ? wallTime(item.startsAt, data?.timeZone || "UTC").slice(11) : "All day"}</p>
        <p className="break-words text-xs text-muted-foreground">{item.activityTypeName || item.type} · {item.assignee.name || "Staff member"} · {["", "Low", "Normal", "High"][item.priority]} priority</p>
      </article>)}</div>
    </>}
    <TablePagination table={table} totalRows={data?.total ?? 0} loading={loading} />
  </>
  return embedded ? <Section title={term("crm.activity.plural", "Activities and follow-ups", "{label} and follow-ups")} description={`${term("crm.activity.plural", "Upcoming work and completed activities.", "Upcoming work and completed {label}.")} Times use ${data?.timeZone || "the business time zone"}.`} icon={CalendarClock} actions={allowCreate ? actions : undefined}>{guidance}{content}</Section> : <section className={pageClass}><AccessPageHeader title="My Work" actions={<><Button variant="outline" asChild><Link href="/crm/calendar">Calendar</Link></Button>{allowCreate && actions}</>} /><Surface>{content}</Surface></section>
}
