"use client"
import { useEffect, useMemo, useState } from "react"
import { getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table"
import { DataTable } from "@/components/data-table"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/erp/controls"
import { Surface, pageClass } from "@/components/erp/page"
import { TablePagination } from "@/components/erp/pagination"
import { AccessPageHeader } from "@/platform/access/record-page"
import Link from "@/platform/access/link"
import { useTerminology } from "@/platform/terminology/provider"
import { useDateFormatter } from "@/hooks/use-date-formatter"
import { formatDecimalCurrency } from "@/lib/formatting"
import { orderRequest } from "./request"
export type OrderRow = { id: string; title: string; customerName: string; currency: string; consideration: string; quotationId: string; revision: number; status: string; version: number; createdAt: string }
export const orderStatus = (status: string) => ({ DRAFT: "Draft", CONFIRMED: "Confirmed", CANCELLED: "Cancelled" })[status] || status
export function SalesOrderList() {
  const term = useTerminology(), { formatDateTime } = useDateFormatter()
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 }), [q, setQ] = useState(""), [status, setStatus] = useState("")
  const [data, setData] = useState<{ items: OrderRow[]; total: number }>({ items: [], total: 0 }), [error, setError] = useState(""), [loading, setLoading] = useState(true), [refresh, setRefresh] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError("")
    const timer = setTimeout(() => {
      const query = new URLSearchParams({ page: String(pagination.pageIndex + 1), pageSize: String(pagination.pageSize), q, ...(status ? { status } : {}) })
      orderRequest<typeof data>(`/api/sales-orders?${query}`, { signal: controller.signal }).then(setData).catch(e => { if (!controller.signal.aborted) { setError(e.message); setData({ items: [], total: 0 }) } }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    }, 150)
    return () => { clearTimeout(timer); controller.abort() }
  }, [pagination, q, status, refresh])
  const columns = useMemo<ColumnDef<OrderRow>[]>(() => [
    { id: "title", header: term("salesOrders.order.singular", "Sales order"), cell: ({ row }) => <Link className="font-medium underline" href={`/sales-orders/${row.original.id}`}>{row.original.title}</Link> },
    { accessorKey: "customerName", header: "Customer" },
    { id: "status", header: "Status", cell: ({ row }) => orderStatus(row.original.status) },
    { id: "amount", header: "Consideration", cell: ({ row }) => formatDecimalCurrency(row.original.consideration, row.original.currency) },
    { accessorKey: "revision", header: "Source revision" },
    { id: "createdAt", header: "Created", cell: ({ row }) => formatDateTime(row.original.createdAt) },
  ], [term, formatDateTime])
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({ data: data.items, columns, state: { pagination }, onPaginationChange: setPagination, manualPagination: true, pageCount: Math.max(1, Math.ceil(data.total / pagination.pageSize)), getCoreRowModel: getCoreRowModel() })
  return <div className={pageClass}><AccessPageHeader title={term("salesOrders.order.plural", "Sales Orders")} description="Create a draft from a saved quotation, review its terms, then confirm the agreement." actions={<Button asChild variant="outline"><Link href="/crm/quotations">Open quotations</Link></Button>} /><Surface>
    <div className="flex flex-wrap gap-3"><Input aria-label="Search orders" placeholder="Search orders or customers..." className="max-w-sm" value={q} onChange={e => { setQ(e.target.value); setPagination(p => ({ ...p, pageIndex: 0 })) }} /><Select aria-label="Order status" value={status} onValueChange={value => { setStatus(value); setPagination(p => ({ ...p, pageIndex: 0 })) }}><option value="">All statuses</option>{["DRAFT", "CONFIRMED", "CANCELLED"].map(s => <option key={s} value={s}>{orderStatus(s)}</option>)}</Select><Button variant="outline" onClick={() => setRefresh(n => n + 1)}>Refresh</Button></div>
    {error && <p role="alert" className="text-destructive">{error}</p>}<DataTable table={table} emptyMessage={loading ? "Loading..." : "No orders found. Open a saved quotation to create one."} /><TablePagination table={table} totalRows={data.total} loading={loading} />
  </Surface></div>
}
