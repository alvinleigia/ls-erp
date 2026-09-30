"use client"
import * as React from "react"
import Link from "@/platform/access/link"
import { getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table"
import { DataTable } from "@/components/data-table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { CrmSelect } from "@/modules/crm/components/crm-controls"
import { CrmPageHeader, CrmSurface, crmPageClass } from "@/modules/crm/components/crm-page"
import { CrmTablePagination } from "@/modules/crm/components/crm-pagination"
import { choiceTitles, type ChoiceKind, type PropertyChoice } from "../choices"

export function PropertyChoiceList({ kind }: { kind: ChoiceKind }) {
  const [query, setQuery] = React.useState({ q: "", archived: "false", page: 1, pageSize: 20 })
  const [data, setData] = React.useState<{ items: PropertyChoice[]; total: number; canManage: boolean }>({ items: [], total: 0, canManage: false })
  const [loading, setLoading] = React.useState(true), [error, setError] = React.useState(""), [revision, setRevision] = React.useState(0)
  const href = `/crm/configuration/real-estate/${kind}`
  const columns = React.useMemo<ColumnDef<PropertyChoice>[]>(() => [
    { accessorKey: "name", header: "Name", cell: ({ row }) => <Link className="font-medium underline underline-offset-4" href={`${href}/${row.original.id}`}>{row.original.name}</Link> },
    { accessorKey: "position", header: "Order" },
    { accessorKey: "isDefault", header: "Default", cell: ({ row }) => row.original.isDefault ? "Yes" : "—" },
    { accessorKey: "archived", header: "Status", cell: ({ row }) => row.original.archived ? "Archived" : "Active" },
  ], [href])
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
        const response = await fetch(`/api/real-estate/choices/${kind}?${new URLSearchParams({ ...query, page: String(query.page), pageSize: String(query.pageSize) })}`, { signal: controller.signal, cache: "no-store" })
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || "Unable to load choices.")
        setData(result)
      } catch (error) { if (!controller.signal.aborted) { setError((error as Error).message); setData({ items: [], total: 0, canManage: false }) } }
      finally { if (!controller.signal.aborted) setLoading(false) }
    }, 150)
    return () => { clearTimeout(timer); controller.abort() }
  }, [query, kind, revision])
  return <div className={crmPageClass}><CrmPageHeader title={choiceTitles[kind]} description="Manage names, display order and defaults. Archive choices to stop new selections while preserving saved records." backHref="/crm/configuration/real-estate" actions={data.canManage && <Button asChild><Link href={`${href}/new`}>New choice</Link></Button>} />
    <CrmSurface><div className="flex flex-wrap gap-3"><Input className="min-w-0 flex-1 basis-48" aria-label="Search choices" placeholder="Search choices…" value={query.q} onChange={event => setQuery({ ...query, q: event.target.value, page: 1 })} /><CrmSelect aria-label="Choice status" value={query.archived} onValueChange={archived => setQuery({ ...query, archived, page: 1 })}><option value="false">Active</option><option value="true">Archived</option></CrmSelect><Button variant="outline" onClick={() => setRevision(value => value + 1)}>Refresh</Button></div>
      {error && <p role="alert" className="text-destructive">{error}</p>}<DataTable table={table} loading={loading} emptyMessage="No choices found." /><CrmTablePagination table={table} totalRows={data.total} loading={loading} />
    </CrmSurface></div>
}
