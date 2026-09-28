"use client"
import { ExportButton } from "./export-button"
import { PropertyCaption } from "@/modules/real-estate/components/property-caption"
import { ProjectFilter } from "@/modules/real-estate/components/project-filter"
import { CrmTableToolbar, CrmPageHeader, CrmSurface, CrmFilters, crmPageClass } from "./crm-page"
import { RecordSelect } from "./record-select"
import { FormField } from "@/components/form-field"
import { CrmTablePagination } from "./crm-pagination"
import { CrmSection } from "./crm-section"
import { CrmSelect } from "./crm-controls"
import * as React from "react"
import Link from "next/link"
import { type ColumnDef, type PaginationState, getCoreRowModel, useReactTable } from "@tanstack/react-table"
import { toast } from "sonner"
import { DataTable } from "@/components/data-table"
import { Button } from "@/components/ui/button"
import { useDateFormatter } from "@/hooks/use-date-formatter"
import { enquiryStatuses } from "@/modules/crm/validation"
import type { ListResponse } from "@/types/api"
import type { CrmContactRow, CrmEnquiryRow, CrmTaskRow } from "@/types/crm"

type Row = Partial<CrmContactRow & CrmEnquiryRow & CrmTaskRow> & { id: string }
export const selectClass = "h-9 rounded-md border bg-background px-3 text-sm"

export function RecordList({ kind, enquiryId, accountId, projectId: fixedProjectId, subprojectId: fixedSubprojectId, refresh = 0, onChanged }: {
  kind: "contacts" | "accounts" | "enquiries" | "tasks"; projectId?: string; subprojectId?: string; enquiryId?: string; accountId?: string; refresh?: number; onChanged?: () => void;
}) {
  const { formatDate } = useDateFormatter()
  const [items, setItems] = React.useState<Row[]>([])
  const [total, setTotal] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState("")
  const [search, setSearch] = React.useState("")
  const [filter, setFilter] = React.useState("")
  const [projectId, setProjectId] = React.useState(fixedProjectId || "")
  const [subprojectId, setSubprojectId] = React.useState(fixedSubprojectId || "")
  const [sourceId, setSourceId] = React.useState("")
  const [assignedUserId, setAssignedUserId] = React.useState("")
  const [pagination, setPagination] = React.useState<PaginationState>({ pageIndex: 0, pageSize: 20 })
  const [revision, setRevision] = React.useState(0)
  const [completing, setCompleting] = React.useState<string | null>(null)
  const endpoint = accountId ? `/api/crm/accounts/${accountId}/contacts` : enquiryId ? `/api/crm/enquiries/${enquiryId}/tasks` : `/api/crm/${kind}`
  const params = new URLSearchParams({ page: String(pagination.pageIndex + 1), pageSize: String(pagination.pageSize), q: search })
  if (filter) params.set(kind === "contacts" || kind === "accounts" ? "archived" : kind === "tasks" ? "due" : "status", filter)
  if (kind === "enquiries") {
    if (projectId) params.set("projectId", projectId)
    if (subprojectId) params.set("subprojectId", subprojectId)
    if (sourceId) params.set("sourceId", sourceId)
    if (assignedUserId) params.set("assignedUserId", assignedUserId)
  }
  const queryString = params.toString()
  React.useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setLoading(true); setError("")
      try {
        const response = await fetch(`${endpoint}?${queryString}`, { signal: controller.signal, cache: "no-store" })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || "Unable to load records.")
        const result = data as ListResponse<Row>
        setItems(result.items); setTotal(result.total)
      } catch (error) {
        if (!controller.signal.aborted) { setError((error as Error).message); setItems([]); setTotal(0) }
      } finally { if (!controller.signal.aborted) setLoading(false) }
    }, 150)
    return () => { clearTimeout(timer); controller.abort() }
  }, [endpoint, queryString, revision, refresh])
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
    if (kind === "contacts" || kind === "accounts") return [
      { accessorKey: "name", header: kind === "accounts" ? "Business account" : "Contact", cell: ({ row }) => <Link className="font-medium underline" href={`/crm/${kind}/${row.original.id}`}>{row.original.name}</Link> },
      { accessorKey: "email", header: "Email", cell: ({ row }) => row.original.email || "—" },
      { accessorKey: "phone", header: "Phone", cell: ({ row }) => row.original.phone || "—" },
    ]
    if (kind === "enquiries") return [
      { accessorKey: "title", header: "Enquiry", cell: ({ row }) => <><Link className="font-medium underline" href={`/crm/enquiries/${row.original.id}`}>{row.original.title}</Link><PropertyCaption context={row.original.propertyContext} /></> },
      { id: "contact", header: "Contact", cell: ({ row }) => row.original.contact?.name },
      { id: "phone", header: "Phone", cell: ({ row }) => row.original.contact?.phone || "—" },
      { id: "company", header: "Company", cell: ({ row }) => row.original.account?.name || "—" },
      { accessorKey: "source", header: "Source", cell: ({ row }) => row.original.source || "—" },
      { accessorKey: "status", header: "Status" },
      { id: "assignee", header: "Salesperson", cell: ({ row }) => row.original.assignee?.name || "Unnamed user" },
      { id: "targetCloseOn", header: "Target close", cell: ({ row }) => formatDate(row.original.targetCloseOn?.slice(0, 10)) },
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
  const title = kind === "accounts" ? "Business accounts" : kind === "contacts" ? "Contacts" : kind === "enquiries" ? "Enquiries" : "Follow-ups"
  const content = <>
    <CrmTableToolbar table={table} searchPlaceholder={kind === "enquiries" ? "Search title, customer, phone or company…" : `Search ${title.toLowerCase()}…`} showColumnToggle={false}>
      <CrmSelect aria-label={`${title} filter`} className={selectClass} value={filter} onValueChange={event => { setFilter(event); setPagination(previous => ({ ...previous, pageIndex: 0 })) }}>
        {kind === "contacts" || kind === "accounts" ? <><option value="">Active {kind}</option><option value="true">Archived {kind}</option></> : kind === "tasks" ? <><option value="">Open follow-ups</option><option value="overdue">Overdue</option><option value="completed">Completed</option></> : <><option value="">All statuses</option>{enquiryStatuses.map(status => <option key={status}>{status}</option>)}</>}
      </CrmSelect>
      {kind === "enquiries" && <CrmFilters label="Enquiry filters" activeCount={Number(!!sourceId) + Number(!!assignedUserId) + Number(!fixedProjectId && !!projectId) + Number(!fixedProjectId && !!subprojectId)} onReset={() => { setSourceId(""); setAssignedUserId(""); setProjectId(fixedProjectId || ""); setSubprojectId(fixedSubprojectId || ""); setPagination(previous => ({ ...previous, pageIndex: 0 })) }}>
        {!fixedProjectId && <ProjectFilter projectId={projectId} subprojectId={subprojectId} onChange={(project, subproject) => { setProjectId(project); setSubprojectId(subproject); setPagination(previous => ({ ...previous, pageIndex: 0 })) }} />}
        <FormField id="lead-source-filter" label="Lead source"><RecordSelect id="lead-source-filter" endpoint="/api/crm/lead-sources?includeArchived=true" value={sourceId} onChange={value => { setSourceId(value); setPagination(previous => ({ ...previous, pageIndex: 0 })) }} placeholder="All sources" /></FormField>
        <FormField id="salesperson-filter" label="Salesperson"><RecordSelect id="salesperson-filter" endpoint="/api/crm/assignees" value={assignedUserId} onChange={value => { setAssignedUserId(value); setPagination(previous => ({ ...previous, pageIndex: 0 })) }} placeholder="All accessible salespeople" /></FormField>
      </CrmFilters>}
      {kind === "enquiries" && <ExportButton href={`/api/crm/enquiries/export?${queryString}`} filename="enquiries.csv" disabled={loading || !!error || !total} />}
    </CrmTableToolbar>
    {error && <p className="text-destructive" role="alert">{error} <Button variant="link" onClick={() => setRevision(value => value + 1)}>Retry</Button></p>}
    <DataTable table={table} loading={loading} emptyMessage={`No ${title.toLowerCase()} found.`} />
    <CrmTablePagination table={table} totalRows={total} loading={loading} />
  </>
  return enquiryId || accountId || fixedProjectId ? <CrmSection title={title}>{content}</CrmSection> : <section className={crmPageClass}><CrmPageHeader title={title} actions={kind !== "tasks" && !accountId && <Button asChild><Link href={"/crm/" + kind + "/new"}>New {kind === "accounts" ? "account" : kind === "contacts" ? "contact" : "enquiry"}</Link></Button>} /><CrmSurface>{content}</CrmSurface></section>
}
