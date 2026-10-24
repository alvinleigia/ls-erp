"use client"
import { useTerminology } from "@/platform/terminology/provider"
import { SalesTeamSelect } from "@/platform/teams/controls"
import { CustomFieldFilter, emptyCustomFilter } from "./custom-fields"
import { LostReasonFilter } from "./lost-reason-fields"
import { ExportButton } from "@/components/erp/export-button"
import { CrmExtensionCaption, CrmExtensionFilter, useCrmExtensionFilterQuery } from "./extension-provider"
import { TableToolbar, Surface, Filters, pageClass } from "@/components/erp/page"
import { AccessPageHeader } from "@/platform/access/record-page"
import { RecordSelect } from "@/components/erp/record-select"
import { FormField } from "@/components/form-field"
import { TablePagination } from "@/components/erp/pagination"
import { Section } from "@/components/erp/section"
import { Select } from "@/components/erp/controls"
import * as React from "react"
import Link from "@/platform/access/link"
import { type ColumnDef, type PaginationState, getCoreRowModel, useReactTable } from "@tanstack/react-table"
import { toast } from "sonner"
import { DataTable } from "@/components/data-table"
import { Button } from "@/components/ui/button"
import { useDateFormatter } from "@/hooks/use-date-formatter"
import { enquiryStatuses } from "@/modules/crm/validation"
import type { ListResponse } from "@/types/api"
import type { CrmContactRow, CrmEnquiryRow, CrmTaskRow } from "@/types/crm"

import type { CrmViewReferences } from "../view-context"

type Row = Partial<CrmContactRow & CrmEnquiryRow & CrmTaskRow> & { id: string }
export const selectClass = "h-9 rounded-md border bg-background px-3 text-sm"

export function RecordList({ kind, enquiryId, accountId, extensionReferences, refresh = 0, onChanged }: {
  kind: "contacts" | "accounts" | "enquiries" | "tasks"; extensionReferences?: CrmViewReferences; enquiryId?: string; accountId?: string; refresh?: number; onChanged?: () => void;
}) {
  const term = useTerminology()
  const recordKey = { contacts: "crm.contact", accounts: "crm.account", enquiries: "crm.enquiry", tasks: "crm.activity" }[kind]
  const { formatDate } = useDateFormatter()
  const [items, setItems] = React.useState<Row[]>([])
  const [total, setTotal] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState("")
  const [customFilter, setCustomFilter] = React.useState(emptyCustomFilter)
  const [search, setSearch] = React.useState("")
  const [filter, setFilter] = React.useState("")
  const [primaryId, setPrimaryId] = React.useState(extensionReferences?.primaryId || "")
  const [secondaryId, setSecondaryId] = React.useState(extensionReferences?.secondaryId || "")
  const extensionQuery = useCrmExtensionFilterQuery(primaryId, secondaryId)
  const [salesTeamId, setSalesTeamId] = React.useState("")
  const [sourceId, setSourceId] = React.useState("")
  const [lostReasonId, setLostReasonId] = React.useState("")
  const [assignedUserId, setAssignedUserId] = React.useState("")
  const [pagination, setPagination] = React.useState<PaginationState>({ pageIndex: 0, pageSize: 20 })
  const [revision, setRevision] = React.useState(0)
  const [completing, setCompleting] = React.useState<string | null>(null)
  const endpoint = accountId ? `/api/crm/accounts/${accountId}/contacts` : enquiryId ? `/api/crm/enquiries/${enquiryId}/tasks` : `/api/crm/${kind}`
  const params = new URLSearchParams({ page: String(pagination.pageIndex + 1), pageSize: String(pagination.pageSize), q: search })
  if (filter) params.set(kind === "contacts" || kind === "accounts" ? "archived" : kind === "tasks" ? "due" : "status", filter)
  if (kind === "enquiries") {
    for (const [key, value] of Object.entries(extensionQuery)) params.set(key, value)
    if (salesTeamId) params.set("salesTeamId", salesTeamId)
    if (sourceId) params.set("sourceId", sourceId)
    if (lostReasonId) params.set("lostReasonId", lostReasonId)
    if (assignedUserId) params.set("assignedUserId", assignedUserId)
  }
  if (kind === "enquiries" && customFilter.customFieldId && customFilter.customFieldValue !== "") Object.entries(customFilter).forEach(([key, value]) => params.set(key, value))
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
      { accessorKey: "name", header: kind === "accounts" ? term("crm.account.singular", "Business account") : term("crm.contact.singular", "Contact"), cell: ({ row }) => <Link className="font-medium underline" href={`/crm/${kind}/${row.original.id}`}>{row.original.name}</Link> },
      { accessorKey: "email", header: "Email", cell: ({ row }) => row.original.email || "—" },
      { accessorKey: "phone", header: "Phone", cell: ({ row }) => row.original.phone || "—" },
    ]
    if (kind === "enquiries") return [
      { accessorKey: "title", header: term("crm.enquiry.singular", "Enquiry"), cell: ({ row }) => <><Link className="font-medium underline" href={`/crm/enquiries/${row.original.id}`}>{row.original.title}</Link><CrmExtensionCaption record={row.original} /></> },
      { id: "contact", header: term("crm.contact.singular", "Contact"), cell: ({ row }) => row.original.contact?.name },
      { id: "phone", header: "Phone", cell: ({ row }) => row.original.contact?.phone || "—" },
      { id: "company", header: term("crm.account.singular", "Company"), cell: ({ row }) => row.original.account?.name || "—" },
      { accessorKey: "source", header: "Source", cell: ({ row }) => row.original.source || "—" },
      { accessorKey: "status", header: "Status", cell: ({ row }) => row.original.status === "CLOSED" ? "Lost" : row.original.status },
      { accessorKey: "lostReasonName", header: "Lost reason", cell: ({ row }) => row.original.lostReasonName || (row.original.status === "CLOSED" ? "Not recorded (legacy)" : "—") },
      { id: "assignee", header: "Salesperson", cell: ({ row }) => row.original.assignee?.name || "Unnamed user" },
      { id: "targetCloseOn", header: "Target close", cell: ({ row }) => formatDate(row.original.targetCloseOn?.slice(0, 10)) },
    ]
    return [
      { accessorKey: "title", header: "Follow-up" },
      { id: "enquiry", header: term("crm.enquiry.singular", "Enquiry"), cell: ({ row }) => <Link className="underline" href={`/crm/enquiries/${row.original.enquiry?.id}`}>{row.original.enquiry?.title}</Link> },
      { accessorKey: "dueOn", header: "Due date", cell: ({ row }) => formatDate(row.original.dueOn?.slice(0, 10)) },
      { id: "actions", header: "Action", cell: ({ row }) => row.original.completedAt ? "Completed" : <Button size="sm" variant="outline" disabled={!!completing} loading={completing === row.original.id} onClick={() => void complete(row.original.id)}>Complete</Button> },
    ]
  }, [kind, formatDate, completing, complete, term])
  const table = useReactTable({
    data: items, columns, getCoreRowModel: getCoreRowModel(), manualPagination: true, manualFiltering: true,
    rowCount: total, state: { pagination, globalFilter: search },
    onPaginationChange: updater => setPagination(previous => {
      const next = typeof updater === "function" ? updater(previous) : updater
      return next.pageSize !== previous.pageSize ? { ...next, pageIndex: 0 } : next
    }),
    onGlobalFilterChange: value => { setSearch(String(value)); setPagination(previous => ({ ...previous, pageIndex: 0 })) },
  })
  const title = kind === "tasks" ? "Follow-ups" : term(`${recordKey}.plural`, kind === "accounts" ? "Business accounts" : kind === "contacts" ? "Contacts" : "Enquiries")
  const content = <>
    <TableToolbar table={table} searchPlaceholder={kind === "enquiries" ? "Search title, customer, phone or company…" : `Search ${title.toLowerCase()}…`} showColumnToggle={false}>
      <Select aria-label={`${title} filter`} className={selectClass} value={filter} onValueChange={event => { setFilter(event); setPagination(previous => ({ ...previous, pageIndex: 0 })) }}>
        {kind === "contacts" || kind === "accounts" ? <><option value="">{term(`${recordKey}.plural`, `Active ${kind}`, "Active {label}")}</option><option value="true">{term(`${recordKey}.plural`, `Archived ${kind}`, "Archived {label}")}</option></> : kind === "tasks" ? <><option value="">Open follow-ups</option><option value="overdue">Overdue</option><option value="completed">Completed</option></> : <><option value="">All statuses</option>{enquiryStatuses.map(status => <option key={status} value={status}>{status === "CLOSED" ? "Lost" : status}</option>)}</>}
      </Select>
      {kind === "enquiries" && <Filters label={term("crm.enquiry.singular", "Enquiry filters", "{label} filters")} activeCount={Number(!!salesTeamId) + Number(!!customFilter.customFieldId) + Number(!!lostReasonId) + Number(!!sourceId) + Number(!!assignedUserId) + (extensionReferences ? 0 : Object.keys(extensionQuery).length)} onReset={() => { setCustomFilter(emptyCustomFilter); setLostReasonId(""); setSourceId(""); setSalesTeamId(""); setAssignedUserId(""); setPrimaryId(extensionReferences?.primaryId || ""); setSecondaryId(extensionReferences?.secondaryId || ""); setPagination(previous => ({ ...previous, pageIndex: 0 })) }}>
        {!extensionReferences?.primaryId && <CrmExtensionFilter primaryId={primaryId} secondaryId={secondaryId} onChange={(primary, secondary) => { setPrimaryId(primary); setSecondaryId(secondary); setPagination(previous => ({ ...previous, pageIndex: 0 })) }} />}
        <LostReasonFilter value={lostReasonId} onChange={value => { setLostReasonId(value); setPagination(previous => ({ ...previous, pageIndex: 0 })) }} />
        <SalesTeamSelect all value={salesTeamId} onChange={value => { setSalesTeamId(value); setPagination(previous => ({ ...previous, pageIndex: 0 })) }} />
        <FormField id="lead-source-filter" label="Lead source"><RecordSelect id="lead-source-filter" endpoint="/api/crm/lead-sources?includeArchived=true" value={sourceId} onChange={value => { setSourceId(value); setPagination(previous => ({ ...previous, pageIndex: 0 })) }} placeholder="All sources" /></FormField>
        <FormField id="salesperson-filter" label="Salesperson"><RecordSelect id="salesperson-filter" endpoint="/api/crm/assignees" value={assignedUserId} onChange={value => { setAssignedUserId(value); setPagination(previous => ({ ...previous, pageIndex: 0 })) }} placeholder="All accessible salespeople" /></FormField>
        <CustomFieldFilter resource="enquiry" value={customFilter} onChange={next => { setCustomFilter(next); setPagination(previous => ({ ...previous, pageIndex: 0 })) }} />
      </Filters>}
      {kind === "enquiries" && <ExportButton requirement="enquiries.export" href={`/api/crm/enquiries/export?${queryString}`} filename="enquiries.csv" disabled={loading || !!error || !total} />}
    </TableToolbar>
    {error && <p className="text-destructive" role="alert">{error} <Button variant="link" onClick={() => setRevision(value => value + 1)}>Retry</Button></p>}
    <DataTable table={table} loading={loading} emptyMessage={`No ${title.toLowerCase()} found.`} />
    <TablePagination table={table} totalRows={total} loading={loading} />
  </>
  return enquiryId || accountId || extensionReferences?.primaryId ? <Section title={title}>{content}</Section> : <section className={pageClass}><AccessPageHeader title={title} actions={kind !== "tasks" && !accountId && <>{kind === "enquiries" && <Button variant="outline" asChild><Link href="/crm/enquiries/import">{term("crm.enquiry.plural", "Import enquiries", "Import {label}")}</Link></Button>}<Button asChild><Link href={"/crm/" + kind + "/new"}>{term(`${recordKey}.singular`, `New ${kind === "accounts" ? "account" : kind === "contacts" ? "contact" : "enquiry"}`, "New {label}")}</Link></Button></>} /><Surface>{content}</Surface></section>
}
