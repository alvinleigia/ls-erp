"use client"
import * as React from "react"
import Link from "@/platform/access/link"
import { getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table"
import { DataTable } from "@/components/data-table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/erp/controls"
import { AccessPageHeader } from "@/platform/access/record-page"
import { Surface, pageClass } from "@/components/erp/page"
import { TablePagination } from "@/components/erp/pagination"
import { formatDecimalCurrency } from "@/lib/formatting"
import type { AppSettingsPayload } from "@/types/scheduling"
import { catalogKindLabels, catalogAvailabilityLabels } from "../labels"
export type CatalogRow = { id: string; code: string; name: string; kind: string; price: string; currency: string; availability: string; reservationState?: string | null; archived: boolean; version: number }
export function CatalogList({ extensionKey, contextId, newHref = "/catalog/new", embedded = false }: { extensionKey?: string; contextId?: string; newHref?: string; embedded?: boolean }) {
  const [query, setQuery] = React.useState({ q: "", archived: "false", availability: "", page: 1, pageSize: 20 })
  const [data, setData] = React.useState<{ items: CatalogRow[]; total: number; canCreate: boolean }>({ items: [], total: 0, canCreate: false })
  const [loading, setLoading] = React.useState(true), [error, setError] = React.useState(""), [revision, setRevision] = React.useState(0)
  const [display, setDisplay] = React.useState<AppSettingsPayload>()
  React.useEffect(() => {
    const controller = new AbortController()
    fetch("/api/settings/display", { signal: controller.signal, cache: "no-store" }).then(async response => {
      if (response.ok) { const data = await response.json(); if (!controller.signal.aborted) setDisplay(data.settings) }
    }).catch(() => {})
    return () => controller.abort()
  }, [])
  const columns = React.useMemo<ColumnDef<CatalogRow>[]>(() => [
    { accessorKey: "code", header: "Code", cell: ({ row }) => <Link className="underline" href={`/catalog/${row.original.id}`}>{row.original.code}</Link> },
    { accessorKey: "name", header: "Name" }, { accessorKey: "kind", header: "Kind", cell: ({ row }) => catalogKindLabels[row.original.kind] || row.original.kind },
    { accessorKey: "price", header: "Price", cell: ({ row }) => formatDecimalCurrency(row.original.price, row.original.currency, display) },
    { accessorKey: "availability", header: "Availability", cell: ({ row }) => catalogAvailabilityLabels[row.original.reservationState || row.original.availability] || row.original.availability },
  ], [display])
  const table = useReactTable({ data: data.items, columns, getCoreRowModel: getCoreRowModel(), manualPagination: true, rowCount: data.total,
    state: { pagination: { pageIndex: query.page - 1, pageSize: query.pageSize } },
    onPaginationChange: updater => setQuery(previous => { const next = typeof updater === "function" ? updater({ pageIndex: previous.page - 1, pageSize: previous.pageSize }) : updater; return { ...previous, page: next.pageSize !== previous.pageSize ? 1 : next.pageIndex + 1, pageSize: next.pageSize } }),
  })
  React.useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setLoading(true); setError("")
      try {
        const response = await fetch(`/api/catalog/items?${new URLSearchParams({ ...query, page: String(query.page), pageSize: String(query.pageSize), ...(extensionKey ? { extensionKey } : {}), ...(contextId ? { contextId } : {}) })}`, { signal: controller.signal, cache: "no-store" })
        const result = await response.json(); if (!response.ok) throw Error(result.error || "Unable to load catalog.")
        if (!controller.signal.aborted) setData(result)
      } catch (e) { if (!controller.signal.aborted) { setError((e as Error).message); setData({ items: [], total: 0, canCreate: false }) } }
      finally { if (!controller.signal.aborted) setLoading(false) }
    }, 150)
    return () => { clearTimeout(timer); controller.abort() }
  }, [query, revision, extensionKey, contextId])
  return <div className={embedded ? "space-y-5" : pageClass}><AccessPageHeader title={embedded ? "Units" : "Sales catalog"} description="Priced products and uniquely identified units. Availability is managed explicitly." actions={data.canCreate && <Button asChild><Link href={newHref}>New item</Link></Button>} />
    <Surface><div className="flex flex-wrap gap-3"><Input className="min-w-0 flex-1 basis-48" aria-label="Search catalog" placeholder="Search code or name..." value={query.q} onChange={e => setQuery({ ...query, q: e.target.value, page: 1 })} /><Select aria-label="Catalog status" value={query.archived} onValueChange={archived => setQuery({ ...query, archived, page: 1 })}><option value="false">Active</option><option value="true">Archived</option></Select><Select aria-label="Availability" value={query.availability} onValueChange={availability => setQuery({ ...query, availability, page: 1 })}><option value="">All availability</option><option value="AVAILABLE">Available</option><option value="UNAVAILABLE">Unavailable</option><option value="SOLD">Sold</option><option value="RESERVED">Reserved</option><option value="ALLOCATED">Allocated</option></Select><Button variant="outline" onClick={() => setRevision(v => v + 1)}>Refresh</Button></div>
      {error && <p role="alert" className="text-destructive">{error}</p>}<DataTable table={table} loading={loading} emptyMessage="No catalog items found." /><TablePagination table={table} totalRows={data.total} loading={loading} />
    </Surface></div>
}
