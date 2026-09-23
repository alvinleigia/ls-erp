"use client"
import * as React from "react"
import Link from "next/link"
import { getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table"
import { Button } from "@/components/ui/button"
import { DataTable, DataTablePagination, DataTableToolbar } from "@/components/data-table"
import { selectClass } from "./record-list"
import type { FollowUpRuleRow } from "@/types/crm-follow-ups"
export function FollowUpRuleList() {
  const [items, setItems] = React.useState<FollowUpRuleRow[]>([]), [total, setTotal] = React.useState(0)
  const [q, setQ] = React.useState(""), [archived, setArchived] = React.useState("false")
  const [canManage, setCanManage] = React.useState(false), [loading, setLoading] = React.useState(true), [error, setError] = React.useState("")
  const [pagination, setPagination] = React.useState({ pageIndex: 0, pageSize: 20 })
  React.useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setLoading(true); setError("")
      try { const response = await fetch(`/api/crm/follow-up-rules?${new URLSearchParams({ q, archived, page: String(pagination.pageIndex + 1), pageSize: String(pagination.pageSize) })}`, { signal: controller.signal, cache: "no-store" }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Unable to load rules."); setItems(data.items); setTotal(data.total); setCanManage(data.canManage) }
      catch (error) { if (!controller.signal.aborted) { setError((error as Error).message); setItems([]) } }
      finally { if (!controller.signal.aborted) setLoading(false) }
    }, 150)
    return () => { clearTimeout(timer); controller.abort() }
  }, [q, archived, pagination])
  const columns = React.useMemo<ColumnDef<FollowUpRuleRow>[]>(() => [
    { accessorKey: "name", header: "Rule", cell: ({ row }) => <Link className="underline" href={`/crm/follow-up-rules/${row.original.id}`}>{row.original.name}</Link> },
    { id: "trigger", header: "Trigger", cell: ({ row }) => `${row.original.sourceType} · ${row.original.outcome.replaceAll("_", " ")}` },
    { id: "next", header: "Next activity", cell: ({ row }) => row.original.nextStep.title },
    { id: "delay", header: "Days after completion", cell: ({ row }) => row.original.nextStep.dayOffset },
    { accessorKey: "maxDepth", header: "Chain limit" },
  ], [])
  const table = useReactTable({ data: items, columns, getCoreRowModel: getCoreRowModel(), manualPagination: true, manualFiltering: true, rowCount: total, state: { pagination, globalFilter: q }, onPaginationChange: updater => setPagination(previous => { const next = typeof updater === "function" ? updater(previous) : updater; return next.pageSize !== previous.pageSize ? { ...next, pageIndex: 0 } : next }), onGlobalFilterChange: value => { setQ(String(value)); setPagination(previous => ({ ...previous, pageIndex: 0 })) } })
  return <section className="space-y-4"><div className="flex justify-between gap-3"><h1 className="text-2xl font-semibold">Follow-up rules</h1>{canManage && <Button asChild><Link href="/crm/follow-up-rules/new">New rule</Link></Button>}</div><p className="text-sm text-muted-foreground">One rule per activity type and outcome. Edit or restore the existing rule to change that trigger. Rules create work after staff review; they do not send messages.</p><DataTableToolbar table={table} searchPlaceholder="Search rules…" showColumnToggle={false}><select aria-label="Rule status" className={selectClass} value={archived} onChange={event => { setArchived(event.target.value); setPagination(previous => ({ ...previous, pageIndex: 0 })) }}><option value="false">Active</option><option value="true">Archived</option></select></DataTableToolbar>{error && <p role="alert" className="text-destructive">{error}</p>}<DataTable table={table} loading={loading} emptyMessage="No follow-up rules. A manager can create one." /><DataTablePagination table={table} totalRows={total} /></section>
}
