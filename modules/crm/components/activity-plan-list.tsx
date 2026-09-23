"use client"
import * as React from "react"
import Link from "next/link"
import { getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table"
import { Button } from "@/components/ui/button"
import { DataTable, DataTablePagination, DataTableToolbar } from "@/components/data-table"
import { selectClass } from "./record-list"
import type { ActivityPlanRow } from "@/types/crm-plans"
export function ActivityPlanList() {
  const [items, setItems] = React.useState<ActivityPlanRow[]>([]), [total, setTotal] = React.useState(0)
  const [q, setQ] = React.useState(""), [archived, setArchived] = React.useState("false")
  const [canManage, setCanManage] = React.useState(false), [loading, setLoading] = React.useState(true), [error, setError] = React.useState("")
  const [pagination, setPagination] = React.useState({ pageIndex: 0, pageSize: 20 })
  React.useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setLoading(true); setError("")
      try { const response = await fetch(`/api/crm/activity-plans?${new URLSearchParams({ q, archived, page: String(pagination.pageIndex + 1), pageSize: String(pagination.pageSize) })}`, { signal: controller.signal, cache: "no-store" }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Unable to load plans."); setItems(data.items); setTotal(data.total); setCanManage(data.canManage) }
      catch (error) { if (!controller.signal.aborted) { setError((error as Error).message); setItems([]) } }
      finally { if (!controller.signal.aborted) setLoading(false) }
    }, 150)
    return () => { clearTimeout(timer); controller.abort() }
  }, [q, archived, pagination])
  const columns = React.useMemo<ColumnDef<ActivityPlanRow>[]>(() => [
    { accessorKey: "name", header: "Plan", cell: ({ row }) => <Link className="underline" href={`/crm/activity-plans/${row.original.id}`}>{row.original.name}</Link> },
    { id: "steps", header: "Activities", cell: ({ row }) => row.original.steps.length },
    { accessorKey: "version", header: "Version" },
    { id: "apply", header: "Action", cell: ({ row }) => !row.original.archived && <Link className="underline" href={`/crm/activity-plans/apply?planId=${row.original.id}`}>Apply plan</Link> },
  ], [])
  const table = useReactTable({ data: items, columns, getCoreRowModel: getCoreRowModel(), manualPagination: true, manualFiltering: true, rowCount: total, state: { pagination, globalFilter: q }, onPaginationChange: updater => setPagination(previous => { const next = typeof updater === "function" ? updater(previous) : updater; return next.pageSize !== previous.pageSize ? { ...next, pageIndex: 0 } : next }), onGlobalFilterChange: value => { setQ(String(value)); setPagination(previous => ({ ...previous, pageIndex: 0 })) } })
  return <section className="space-y-4"><div className="flex justify-between gap-3"><h1 className="text-2xl font-semibold">Activity plans</h1>{canManage && <Button asChild><Link href="/crm/activity-plans/new">New plan</Link></Button>}</div><p className="text-sm text-muted-foreground">Reusable follow-up steps, scheduled from a chosen start date. Applying a plan creates all activities for the selected staff member.</p><DataTableToolbar table={table} searchPlaceholder="Search plans…" showColumnToggle={false}><select aria-label="Plan status" className={selectClass} value={archived} onChange={event => { setArchived(event.target.value); setPagination(previous => ({ ...previous, pageIndex: 0 })) }}><option value="false">Active</option><option value="true">Archived</option></select></DataTableToolbar>{error && <p role="alert" className="text-destructive">{error}</p>}<DataTable table={table} loading={loading} emptyMessage="No activity plans. A manager can create one." /><DataTablePagination table={table} totalRows={total} /></section>
}
