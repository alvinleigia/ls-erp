"use client"
import * as React from "react"
import Link from "next/link"
import { getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table"
import { DataTable } from "@/components/data-table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { CrmSelect } from "@/modules/crm/components/crm-controls"
import { CrmPageHeader, CrmSurface, CrmFilters, crmPageClass } from "@/modules/crm/components/crm-page"
import { CrmSection } from "@/modules/crm/components/crm-section"
import { CrmTablePagination } from "@/modules/crm/components/crm-pagination"
import { lifecycleOptions } from "../validation"
import type { Project } from "@/types/real-estate"
export const choiceLabel = (value: string) => value.toLowerCase().replaceAll("_", " ").replace(/^./, first => first.toUpperCase())

export function ProjectList({ parentId, canManage: manager = false, parentArchived = false }: { parentId?: string; canManage?: boolean; parentArchived?: boolean }) {
  const [query, setQuery] = React.useState({ q: "", archived: "false", lifecycle: "", page: 1, pageSize: 20 })
  const [data, setData] = React.useState<{ items: Project[]; total: number; canManage: boolean }>({ items: [], total: 0, canManage: manager })
  const [loading, setLoading] = React.useState(true), [error, setError] = React.useState(""), [revision, setRevision] = React.useState(0)
  const columns = React.useMemo<ColumnDef<Project>[]>(() => [
    { accessorKey: "name", header: "Project", meta: { label: "Project" }, cell: ({ row }) => <Link className="font-medium underline underline-offset-4" href={`/crm/projects/${row.original.id}`}>{row.original.name}</Link> },
    { accessorKey: "code", header: "Code", meta: { label: "Code" } },
    { accessorKey: "location", header: "Location", meta: { label: "Location" }, cell: ({ row }) => row.original.location || "—" },
    { accessorKey: "lifecycle", header: "Sales lifecycle", meta: { label: "Sales lifecycle" }, cell: ({ row }) => choiceLabel(row.original.lifecycle) },
  ], [])
  const table = useReactTable({ data: data.items, columns, getCoreRowModel: getCoreRowModel(), manualPagination: true, rowCount: data.total,
    state: { pagination: { pageIndex: query.page - 1, pageSize: query.pageSize } },
    onPaginationChange: updater => setQuery(previous => {
      const next = typeof updater === "function" ? updater({ pageIndex: previous.page - 1, pageSize: previous.pageSize }) : updater
      return { ...previous, page: next.pageSize !== previous.pageSize ? 1 : next.pageIndex + 1, pageSize: next.pageSize }
    }),
  })
  React.useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setLoading(true); setError("")
      try {
        const response = await fetch(`/api/real-estate/projects?${new URLSearchParams({ ...query, page: String(query.page), pageSize: String(query.pageSize), parentId: parentId || "" })}`, { signal: controller.signal, cache: "no-store" })
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || "Unable to load projects.")
        setData(result)
      } catch (error) { if (!controller.signal.aborted) { setError((error as Error).message); setData({ items: [], total: 0, canManage: false }) } }
      finally { if (!controller.signal.aborted) setLoading(false) }
    }, 150)
    return () => { clearTimeout(timer); controller.abort() }
  }, [query, parentId, revision])
  const action = data.canManage && !parentArchived && <Button asChild><Link href={`/crm/projects/new${parentId ? `?parentId=${encodeURIComponent(parentId)}` : ""}`}>{parentId ? "New subproject" : "New project"}</Link></Button>
  const content = <>
    <div className="flex flex-wrap gap-2"><Input className="min-w-0 flex-1 basis-48" aria-label="Search projects" placeholder="Search name, code or location…" value={query.q} onChange={event => setQuery({ ...query, q: event.target.value, page: 1 })} />
      <CrmSelect aria-label="Project status" value={query.archived} onValueChange={archived => setQuery({ ...query, archived, page: 1 })}><option value="false">Active</option><option value="true">Archived</option></CrmSelect>
      <CrmFilters activeCount={query.lifecycle ? 1 : 0} onReset={() => setQuery({ ...query, lifecycle: "", page: 1 })}><label className="space-y-2 text-sm">Sales lifecycle<CrmSelect className="w-full" aria-label="Sales lifecycle filter" value={query.lifecycle} onValueChange={lifecycle => setQuery({ ...query, lifecycle, page: 1 })}><option value="">All stages</option>{lifecycleOptions.map(value => <option key={value} value={value}>{choiceLabel(value)}</option>)}</CrmSelect></label></CrmFilters>
      <Button variant="outline" onClick={() => setRevision(value => value + 1)}>Refresh</Button></div>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <DataTable table={table} loading={loading} emptyMessage="No projects match this selection." />
    <CrmTablePagination table={table} totalRows={data.total} loading={loading} />
  </>
  return parentId ? <CrmSection title="Subprojects" description="Organize sales by phase, building or group. Staff access comes from this project." actions={action}>{content}</CrmSection> : <div className={crmPageClass}><CrmPageHeader title="Projects" description="Manage property sales information and staff access." actions={action} /><CrmSurface>{content}</CrmSurface></div>
}
