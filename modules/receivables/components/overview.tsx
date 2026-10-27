"use client"
import { AttributionFilters, emptyAttributionFilters } from "@/platform/collaborators/report-controls"
import { attributionQuery, type AttributionFilter } from "@/platform/collaborators/report-validation"
import { useEffect, useMemo, useState } from "react"
import { getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table"
import { DataTable } from "@/components/data-table"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/erp/controls"
import { Section } from "@/components/erp/section"
import { Surface, Filters, pageClass } from "@/components/erp/page"
import { TablePagination } from "@/components/erp/pagination"
import { AccessPageHeader } from "@/platform/access/record-page"
import Link from "@/platform/access/link"
import { useDateFormatter } from "@/hooks/use-date-formatter"
import { formatDecimalCurrency } from "@/lib/formatting"
import type { ReceivableOverview, ReceivableOverviewRow } from "@/types/receivables"
const empty: ReceivableOverview = { items: [], summaries: [], currencies: [], today: "", total: 0, page: 1, pageSize: 20, totalPages: 1 }
export function ReceivableOverviewPage() {
  const [attribution, setAttribution] = useState<AttributionFilter>(emptyAttributionFilters)
  const { formatDateOnly } = useDateFormatter()
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 }), [q, setQ] = useState(""), [status, setStatus] = useState("OPEN"), [currency, setCurrency] = useState(""), [sort, setSort] = useState("overdue:desc")
  const [data, setData] = useState(empty), [error, setError] = useState(""), [loading, setLoading] = useState(true), [refresh, setRefresh] = useState(0)
  const attributionParams = new URLSearchParams(attributionQuery(attribution)).toString()
  const choiceParams = new URLSearchParams({ ...attributionQuery(attribution), recordQuery: q, status, ...(currency ? { currency } : {}) }).toString()
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(""); setData(empty)
    const timer = setTimeout(async () => {
      try {
        const [field, order] = sort.split(":"), query = new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(attributionParams)), q, status, sort: field, order, page: String(pagination.pageIndex + 1), pageSize: String(pagination.pageSize), ...(currency ? { currency } : {}) })
        const response = await fetch(`/api/receivables?${query}`, { cache: "no-store", signal: controller.signal }), body = await response.json()
        if (!response.ok) throw Error(body.error || "Unable to load receivables.")
        if (!controller.signal.aborted) setData(body)
      } catch (e) { if (!controller.signal.aborted) setError((e as Error).message) } finally { if (!controller.signal.aborted) setLoading(false) }
    }, 150)
    return () => { clearTimeout(timer); controller.abort() }
  }, [pagination, q, status, currency, sort, refresh, attributionParams])
  const resetPage = () => setPagination(p => ({ ...p, pageIndex: 0 }))
  const columns = useMemo<ColumnDef<ReceivableOverviewRow>[]>(() => [
    { id: "title", header: "Order", cell: ({ row }) => <Link className="font-medium underline" href={`/sales-orders/${row.original.orderId}`}>{row.original.title}</Link> },
    { accessorKey: "customerName", header: "Customer" },
    { id: "total", header: "Order total", cell: ({ row }) => formatDecimalCurrency(row.original.total, row.original.currency) },
    { id: "paid", header: "Net received", cell: ({ row }) => formatDecimalCurrency(row.original.paid, row.original.currency) },
    { id: "outstanding", header: "Outstanding", cell: ({ row }) => formatDecimalCurrency(row.original.outstanding, row.original.currency) },
    { id: "overdue", header: "Overdue", cell: ({ row }) => formatDecimalCurrency(row.original.overdue, row.original.currency) },
    { id: "nextDue", header: "Earliest unpaid due date", cell: ({ row }) => row.original.nextDue ? formatDateOnly(row.original.nextDue) : row.original.outstanding === "0" ? "Settled" : "Unscheduled" },
  ], [formatDateOnly])
  const table = useReactTable({ data: data.items, columns, state: { pagination }, onPaginationChange: setPagination, manualPagination: true, pageCount: Math.max(1, Math.ceil(data.total / pagination.pageSize)), getCoreRowModel: getCoreRowModel() })
  return <div className={pageClass}>
    <AccessPageHeader title="Receivables" description="Balances from opened schedules on confirmed orders you can access. Open an order to record a payment or review its history." backHref="/sales-orders" />
    <Surface><div className="flex flex-wrap gap-3">
      <Input className="max-w-sm" aria-label="Search receivables" placeholder="Search orders or customers..." value={q} onChange={e => { setQ(e.target.value); resetPage() }} />
      <Select aria-label="Balance status" value={status} onValueChange={v => { setStatus(v); resetPage() }}><option value="OPEN">Outstanding</option><option value="OVERDUE">Overdue</option><option value="SETTLED">Settled</option><option value="ALL">All opened schedules</option></Select>
      <Select aria-label="Currency" value={currency} onValueChange={v => { setCurrency(v); resetPage() }}><option value="">All currencies</option>{[...new Set([...data.currencies, ...(currency ? [currency] : [])])].map(c => <option key={c} value={c}>{c}</option>)}</Select>
      <Select aria-label="Sort receivables" value={sort} onValueChange={v => { setSort(v); resetPage() }}><option value="overdue:desc">Highest overdue</option><option value="outstanding:desc">Highest outstanding</option><option value="nextDue:asc">Earliest unpaid due date</option><option value="title:asc">Order name</option></Select>
      <Filters activeCount={Object.keys(attributionQuery(attribution)).length} onReset={() => { setAttribution(emptyAttributionFilters); resetPage() }}><AttributionFilters value={attribution} onChange={value => { setAttribution(value); resetPage() }} choicesEndpoint={`/api/receivables/attribution-choices?${choiceParams}`} canFilterOrigin={data.canFilterOrigin ?? false} responsibleLabel="Salesperson type" /></Filters>
      <Button variant="outline" disabled={loading} onClick={() => setRefresh(n => n + 1)}>Refresh</Button>
      <Button variant="ghost" onClick={() => { setAttribution(emptyAttributionFilters); setQ(""); setStatus("OPEN"); setCurrency(""); setSort("overdue:desc"); resetPage() }}>Reset filters</Button>
    </div><p className="text-sm text-muted-foreground">{data.today ? `As of ${formatDateOnly(data.today)} in your business time zone. ` : ""}Totals follow these filters across all pages. Currencies are kept separate; no exchange conversion is applied. Cancelled orders and unopened schedules are excluded. Salesperson type describes the current owner of the linked opportunity, not the payment operator. Partner and saved-supervisor filters use its original introduction.</p></Surface>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {data.summaries.map(s => <Section key={s.currency} title={`${s.currency} balances`} description={`${s.orders} matching ${s.orders === 1 ? "order" : "orders"}`}><dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">{[["Order total", s.total], ["Net received", s.paid], ["Outstanding", s.outstanding], ["Overdue", s.overdue]].map(([label, value]) => <div key={label}><dt className="text-sm text-muted-foreground">{label}</dt><dd className="break-words text-lg font-semibold">{formatDecimalCurrency(value, s.currency)}</dd></div>)}</dl><div className="border-t pt-4"><h3 className="mb-3 text-sm font-medium">Outstanding by age</h3><dl className="grid grid-cols-2 gap-4 lg:grid-cols-3">{[["Not yet overdue", s.current], ["1–30 days overdue", s.days1to30], ["31–60 days overdue", s.days31to60], ["61–90 days overdue", s.days61to90], ["91+ days overdue", s.days91plus], ["Unscheduled", s.unscheduled]].map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="break-words font-medium">{formatDecimalCurrency(value, s.currency)}</dd></div>)}</dl></div></Section>)}
    <Surface><DataTable table={table} emptyMessage={loading ? "Loading receivables..." : "No matching receivables. Open a schedule on a confirmed order, or change the filters."} /><TablePagination table={table} totalRows={data.total} loading={loading} /></Surface>
  </div>
}
