"use client"
import { useTerminology } from "@/platform/terminology/provider"
import { AccessPageHeader } from "@/platform/access/record-page"
import { Surface, pageClass } from "@/components/erp/page"
import { TableToolbar } from "@/components/erp/page"
import { TablePagination } from "@/components/erp/pagination"
import { Select } from "@/components/erp/controls"
import * as React from "react"
import Link from "@/platform/access/link"
import { getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/data-table"
import type { CrmPipelineRow } from "@/types/crm"
import { selectClass } from "./record-list"

export function PipelineList() {
  const term = useTerminology()
  const [items, setItems] = React.useState<CrmPipelineRow[]>([])
  const [total, setTotal] = React.useState(0)
  const [canManage, setCanManage] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState("")
  const [q, setQ] = React.useState("")
  const [archived, setArchived] = React.useState("false")
  const [pagination, setPagination] = React.useState({ pageIndex: 0, pageSize: 20 })
  React.useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setLoading(true); setError("")
      try {
        const response = await fetch(`/api/crm/pipelines?${new URLSearchParams({ q, archived, page: String(pagination.pageIndex + 1), pageSize: String(pagination.pageSize) })}`, { signal: controller.signal, cache: "no-store" })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || "Unable to load pipelines.")
        setItems(data.items); setTotal(data.total); setCanManage(data.canManage)
      } catch (error) { if (!controller.signal.aborted) { setError((error as Error).message); setItems([]); setTotal(0) } }
      finally { if (!controller.signal.aborted) setLoading(false) }
    }, 150)
    return () => { clearTimeout(timer); controller.abort() }
  }, [q, archived, pagination])
  const columns = React.useMemo<ColumnDef<CrmPipelineRow>[]>(() => [
    { accessorKey: "name", header: "Pipeline", cell: ({ row }) => <Link className="underline" href={`/crm/pipelines/${row.original.id}`}>{row.original.name}</Link> },
    { accessorKey: "archived", header: "Status", cell: ({ row }) => row.original.archived ? "Archived" : "Active" },
  ], [])
  const table = useReactTable({ data: items, columns, getCoreRowModel: getCoreRowModel(), manualPagination: true, manualFiltering: true, rowCount: total, state: { pagination, globalFilter: q },
    onPaginationChange: updater => setPagination(previous => { const next = typeof updater === "function" ? updater(previous) : updater; return next.pageSize !== previous.pageSize ? { ...next, pageIndex: 0 } : next }),
    onGlobalFilterChange: value => { setQ(String(value)); setPagination(previous => ({ ...previous, pageIndex: 0 })) },
  })
  return <section className={pageClass}><AccessPageHeader title="Sales pipelines" description={term("crm.opportunity.plural", "Manage the stages your team uses to track opportunities.", "Manage the stages your team uses to track {label}.")} actions={canManage && <Button asChild><Link href="/crm/pipelines/new">New pipeline</Link></Button>} />
    <Surface><TableToolbar table={table} searchPlaceholder="Search pipelines…" showColumnToggle={false}><Select aria-label="Pipeline status" className={selectClass} value={archived} onValueChange={event => { setArchived(event); setPagination(previous => ({ ...previous, pageIndex: 0 })) }}><option value="false">Active</option><option value="true">Archived</option></Select></TableToolbar>
    {error && <p role="alert" className="text-destructive">{error}</p>}<DataTable table={table} loading={loading} emptyMessage="No pipelines. A manager can create one to get started." /><TablePagination table={table} totalRows={total} loading={loading} /></Surface>
  </section>
}
