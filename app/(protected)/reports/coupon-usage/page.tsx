"use client"
import { BusinessViewGuard } from "@/platform/access/view-guard"

import * as React from "react"
import {
  ColumnDef,
  PaginationState,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table"
import { DataTable } from "@/components/data-table"
import { PageHeader, pageClass, Surface, TableToolbar, Filters } from "@/components/erp/page"
import { TablePagination } from "@/components/erp/pagination"
import { Select } from "@/components/erp/controls"
import { FormField } from "@/components/form-field"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { BookingOfficePicker } from "@/components/appointments/choice-picker"
import { formatReportDateTime } from "@/lib/report-dates"
import type {
  CouponUsageReportRow,
  CouponUsageReportStatus,
  CouponUsageReportSummary,
  CouponUsageReportResponse,
  CouponUsageReportContext,
} from "@/types/reports"

const defaultSummary: CouponUsageReportSummary = {
  totalCustomers: 0,
  usedCustomers: 0,
  notUsedCustomers: 0,
  totalRedemptions: 0,
}

function CouponUsageContent() {
  const [items, setItems] = React.useState<CouponUsageReportRow[]>([])
  const [error, setError] = React.useState("")
  const [refresh, setRefresh] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [search, setSearch] = React.useState("")
  const [status, setStatus] = React.useState<CouponUsageReportStatus>("used")
  const [couponCode, setCouponCode] = React.useState("")
  const [dateFrom, setDateFrom] = React.useState("")
  const [dateTo, setDateTo] = React.useState("")
  const [officeId, setOfficeId] = React.useState("all")
  const [context, setContext] = React.useState<CouponUsageReportContext | null>(null)
  const [summary, setSummary] = React.useState<CouponUsageReportSummary>(defaultSummary)
  const [totalRows, setTotalRows] = React.useState(0)
  const [pagination, setPagination] = React.useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  })

  const loadReport = React.useCallback(async (signal: AbortSignal) => {
    setLoading(true)
    setItems([])
    setSummary(defaultSummary)
    setTotalRows(0)
    setContext(null)
    const params = new URLSearchParams()
    params.set("page", String(pagination.pageIndex + 1))
    params.set("pageSize", String(pagination.pageSize))
    params.set("status", status)
    if (search.trim()) params.set("q", search.trim())
    if (couponCode.trim()) params.set("couponCode", couponCode.trim().toUpperCase())
    if (officeId !== "all") params.set("officeId", officeId)
    if (dateFrom) params.set("dateFrom", dateFrom)
    if (dateTo) params.set("dateTo", dateTo)

    setError("")
    try {
      const response = await fetch(`/api/reports/coupon-usage?${params.toString()}`, { cache: "no-store", signal })
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error || "Unable to load report.")
      }
      const data = await response.json() as CouponUsageReportResponse
      if (signal.aborted) return
      setContext(data.context)
      setItems(data.items)
      setTotalRows(data.total)
      setSummary(data.summary)
    } catch (error) {
      if (signal.aborted) return
      setError(error instanceof Error ? error.message : "Unable to load report.")
      setItems([])
      setTotalRows(0)
      setSummary(defaultSummary)
    } finally {
      if (!signal.aborted) setLoading(false)
    }
  }, [officeId, couponCode, dateFrom, dateTo, pagination.pageIndex, pagination.pageSize, search, status])

  React.useEffect(() => {
    const controller = new AbortController()
    void loadReport(controller.signal)
    return () => controller.abort()
  }, [loadReport, refresh])

  const columns = React.useMemo<ColumnDef<CouponUsageReportRow>[]>(
    () => [
      {
        id: "customer",
        header: "Customer",
        accessorFn: (row) => row.customerName || "Unnamed customer",
      },
      {
        id: "contact",
        header: "Contact",
        cell: ({ row }) => (
          <div className="space-y-1">
            <div>{row.original.customerEmail}</div>
            <div className="text-xs text-muted-foreground">{row.original.customerPhone || "-"}</div>
          </div>
        ),
      },
      {
        id: "usage",
        header: "Usage count",
        accessorFn: (row) => row.couponUsageCount,
      },
      {
        id: "distinct",
        header: "Distinct coupons",
        accessorFn: (row) => row.distinctCouponCount,
      },
      {
        id: "lastUsed",
        header: "Latest matching booking",
        accessorFn: (row) => formatReportDateTime(row.lastCouponUsedAt, context),
      },
      {
        id: "codes",
        header: "Coupon codes",
        cell: ({ row }) =>
          row.original.usedCouponCodes.length ? row.original.usedCouponCodes.join(", ") : "-",
      },
    ],
    [context]
  )

  const table = useReactTable({
    data: items,
    columns,
    state: { pagination, globalFilter: search },
    onPaginationChange: updater => setPagination(previous => {
      const next = typeof updater === "function" ? updater(previous) : updater
      return next.pageSize !== previous.pageSize ? { ...next, pageIndex: 0 } : next
    }),
    onGlobalFilterChange: (value) => {
      setSearch(String(value))
      setPagination((prev) => ({ ...prev, pageIndex: 0 }))
    },
    getCoreRowModel: getCoreRowModel(),
    manualFiltering: true,
    manualPagination: true,
    pageCount: Math.max(1, Math.ceil(totalRows / pagination.pageSize)),
  })

  return (
    <div className={pageClass}>
      <PageHeader title="Coupon usage report" description="Customers with readable, non-canceled bookings in the selected period." actions={<Button variant="outline" disabled={loading} onClick={() => setRefresh(value => value + 1)}>Refresh</Button>} />

      {context && !loading && !error && <p className="text-sm text-muted-foreground" role="status">{context.office ? `${context.office.companyName} / ${context.office.name}${context.office.active ? "" : " (Closed)"}` : "All readable booking offices"}. Booking creation dates in {context.timeZone}.</p>}
      {!loading && !error && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Customers in report", value: summary.totalCustomers }, { label: "With matching coupon use", value: summary.usedCustomers },
          { label: "No matching coupon use", value: summary.notUsedCustomers }, { label: "Coupon redemptions", value: summary.totalRedemptions },
        ].map(item => <Surface key={item.label}><p className="text-sm text-muted-foreground">{item.label}</p><p className="text-2xl font-semibold">{item.value}</p></Surface>)}
      </div>}

      <Surface>
      <TableToolbar table={table} searchPlaceholder="Search customer name, email, or phone"><FormField id="report-status" label="Status">
            <Select
              id="report-status"
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={status}
              onValueChange={(value) => {
                setStatus(value as CouponUsageReportStatus)
                setPagination((prev) => ({ ...prev, pageIndex: 0 }))
              }}
            >
              <option value="used">With matching coupon use</option>
              <option value="not_used">No matching coupon use</option>
            </Select>
          </FormField><Filters activeCount={[officeId !== "all" ? officeId : "", couponCode, dateFrom, dateTo].filter(Boolean).length} onReset={() => {
              setOfficeId("all")
              setCouponCode("")
              setDateFrom("")
              setDateTo("")
              setSearch("")
              setStatus("used")
              setPagination({ pageIndex: 0, pageSize: 10 })
            }}><FormField id="report-office" label="Booking office"><BookingOfficePicker id="report-office" value={officeId} onChange={value => { setOfficeId(value); setPagination(previous => ({ ...previous, pageIndex: 0 })) }} /></FormField><FormField id="report-coupon-code" label="Coupon code">
            <Input
              id="report-coupon-code"
              value={couponCode}
              onChange={(event) => {
                setCouponCode(event.target.value.toUpperCase())
                setPagination((prev) => ({ ...prev, pageIndex: 0 }))
              }}
              placeholder="Any code"
              className="w-full"
            />
          </FormField>
<FormField id="report-date-from" label="Date from">
            <Input
              id="report-date-from"
              type="date"
              value={dateFrom}
              onChange={(event) => {
                setDateFrom(event.target.value)
                setPagination((prev) => ({ ...prev, pageIndex: 0 }))
              }}
            />
          </FormField>
<FormField id="report-date-to" label="Date to">
            <Input
              id="report-date-to"
              type="date"
              value={dateTo}
              onChange={(event) => {
                setDateTo(event.target.value)
                setPagination((prev) => ({ ...prev, pageIndex: 0 }))
              }}
            />
          </FormField></Filters></TableToolbar>

      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : <DataTable
        table={table}
        loading={loading}
        emptyMessage={status === "used" ? "No matching coupon use found." : "No customers without matching coupon use in this report."}
      />}
      <TablePagination table={table} totalRows={totalRows} loading={loading} />
      </Surface>
    </div>
  )
}


export default function CouponUsageReportPage() {
  return <BusinessViewGuard module="appointments"><CouponUsageContent /></BusinessViewGuard>
}
