"use client"

import { PurchaseView } from "@/modules/inventory/record-view"

import { Select, Textarea } from "@/components/erp/controls"

import { useCurrentResourceAction } from "@/platform/access/view-guard"
import { useBusinessModules } from "@/platform/module-provider"

import * as React from "react"
import {
  ColumnDef,
  SortingState,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table"
import {
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  MoreHorizontalIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react"
import { toast } from "sonner"

import { DataTable } from "@/components/data-table"
import { PageHeader, Surface, TableToolbar, pageClass } from "@/components/erp/page"
import { TablePagination } from "@/components/erp/pagination"
import { DraftPanel } from "@/components/erp/record-detail"
import { Section } from "@/components/erp/section"
import { ConfirmAction } from "@/components/erp/confirm-action"
import { FormField } from "@/components/form-field"
import { RecordSelect } from "@/components/erp/record-select"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { formatDateForDisplay, DEFAULT_DATE_FORMAT } from "@/lib/date"
import { formatCurrencyFromCents } from "@/lib/formatting"
import type { ListResponse } from "@/types/api"
import type {
  PurchaseOrderFormValues,
  PurchaseOrderRow,
} from "@/types/inventory"
import type { AppSettingsPayload } from "@/types/scheduling"

const defaultValues: PurchaseOrderFormValues = {
  supplierId: "",
  orderDate: new Date().toISOString().slice(0, 10),
  expectedDate: "",
  status: "ORDERED",
  notes: "",
  items: [{ productId: "", quantity: 1, unitCost: "0.00" }],
}

type PaginationState = { pageIndex: number; pageSize: number }

const SortIndicator = ({ value }: { value: false | "asc" | "desc" }) => {
  if (value === "asc") return <ArrowUpIcon className="h-4 w-4" />
  if (value === "desc") return <ArrowDownIcon className="h-4 w-4" />
  return <ArrowUpDownIcon className="h-4 w-4" />
}

export default function InventoryPurchasesPage() {
  const canCreate = useCurrentResourceAction("create")
  const canEdit = useCurrentResourceAction("edit")
  const { can } = useBusinessModules()
  const canReceiveStock = can("inventoryProducts.edit")
  const canReceive = canEdit && canReceiveStock

  const [items, setItems] = React.useState<PurchaseOrderRow[]>([])
  const [totalRows, setTotalRows] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [statusFilter, setStatusFilter] = React.useState("all")
  const listRequest = React.useRef<AbortController | null>(null)
  const [search, setSearch] = React.useState("")
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [pagination, setPagination] = React.useState<PaginationState>({ pageIndex: 0, pageSize: 10 })
  const [receiveTarget, setReceiveTarget] = React.useState<PurchaseOrderRow | null>(null)
  const [receiving, setReceiving] = React.useState(false)
  const [viewing, setViewing] = React.useState<PurchaseOrderRow | null>(null)
  const [formOpen, setFormOpen] = React.useState(false)
  const [formError, setFormError] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  const [formValues, setFormValues] = React.useState<PurchaseOrderFormValues>(defaultValues)
  const [dateFormat, setDateFormat] = React.useState(DEFAULT_DATE_FORMAT)
  const [settings, setSettings] = React.useState<
    Required<
      Pick<
        AppSettingsPayload,
        "locale" | "currency" | "currencySymbolPlacement" | "numberFormat"
      >
    >
  >({
    locale: "en-US",
    currency: "USD",
    currencySymbolPlacement: "BEFORE",
    numberFormat: "US_UK",
  })

  const parseMoney = (value: string) => {
    const normalized = value.replace(/[^0-9.]/g, "")
    const parsed = Number.parseFloat(normalized)
    if (Number.isNaN(parsed)) return 0
    return Math.round(parsed * 100)
  }

  const formatMoney = React.useCallback(
    (cents: number) => formatCurrencyFromCents(cents, settings),
    [settings]
  )
  const formatDate = React.useCallback((value: string) => formatDateForDisplay(value, dateFormat), [dateFormat])
  const loadItems = React.useCallback(async () => {
    listRequest.current?.abort()
    const controller = new AbortController()
    listRequest.current = controller
    const signal = controller.signal
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set("page", String(pagination.pageIndex + 1))
      params.set("pageSize", String(pagination.pageSize))
      if (statusFilter !== "all") params.set("status", statusFilter)
      if (search.trim()) params.set("q", search.trim())
      if (sorting[0]) {
        params.set("sort", sorting[0].id)
        params.set("order", sorting[0].desc ? "desc" : "asc")
      }
      const response = await fetch(`/api/inventory/purchases?${params.toString()}`, { signal })
      if (!response.ok) {
        toast.error("Unable to load purchase orders.")
        setItems([])
        setTotalRows(0)
        setLoading(false)
        return
      }
      const data = (await response.json()) as ListResponse<PurchaseOrderRow>
      if (signal.aborted) return
      setItems(data.items)
      setTotalRows(data.total)
      setLoading(false)
    } catch { if (!signal.aborted) toast.error("Unable to load records. Please refresh.") } finally { if (!signal.aborted) setLoading(false) }
  }, [pagination.pageIndex, pagination.pageSize, search, sorting, statusFilter])

  React.useEffect(() => {
    void loadItems()
    return () => listRequest.current?.abort()
  }, [loadItems])

  React.useEffect(() => {
    const loadDependencies = async () => {
      const settingsResponse = await fetch("/api/settings/display", { cache: "no-store" })
      if (settingsResponse.ok) {
        const data = (await settingsResponse.json()) as { settings?: AppSettingsPayload }
        if (data.settings?.dateFormat) setDateFormat(data.settings.dateFormat)
        if (data.settings?.locale && data.settings.currency) {
          setSettings({
            locale: data.settings.locale,
            currency: data.settings.currency,
            currencySymbolPlacement: data.settings.currencySymbolPlacement ?? "BEFORE",
            numberFormat: data.settings.numberFormat ?? "US_UK",
          })
        }
      }
    }
    void loadDependencies()
  }, [])

  const save = async () => {
    setSaving(true)
    setFormError("")
    try {
      const payload = {
        ...formValues,
        items: formValues.items
          .filter((item) => item.productId)
          .map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            unitCostCents: parseMoney(item.unitCost),
          })),
      }
      const response = await fetch("/api/inventory/purchases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string }
        setFormError(data.error ?? "Unable to save. Check the form and try again.")
        toast.error(data.error ?? "Unable to create purchase order.")
        setSaving(false)
        return
      }
      toast.success("Purchase order created.")
      setSaving(false)
      setFormOpen(false)
      setFormValues(defaultValues)
      await loadItems()
    } catch { setFormError("Unable to save. Please try again."); toast.error("Unable to save. Please try again.") } finally { setSaving(false) }
  }

  const markReceived = React.useCallback(async (order: PurchaseOrderRow) => {
    if (order.status === "RECEIVED") return
    setReceiving(true)
    try {
      const response = await fetch(`/api/inventory/purchases/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "RECEIVED" }),
      })
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string }
        toast.error(data.error ?? "Unable to mark as received.")
        return
      }
      toast.success("Purchase order received. Stock updated.")
      setReceiveTarget(null)
      setViewing(null)
      await loadItems()
    } catch { toast.error("Unable to receive stock. Please try again.") } finally { setReceiving(false) }
  }, [loadItems])

  const columns = React.useMemo<ColumnDef<PurchaseOrderRow>[]>(
    () => [
      {
        accessorKey: "orderNumber",
        cell: ({ row }) => <button type="button" className="font-medium underline underline-offset-4" onClick={() => setViewing(row.original)}>{row.original.orderNumber}</button>,
        meta: { label: "PO number" },
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-2 text-sm font-medium"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            PO number
            <SortIndicator value={column.getIsSorted()} />
          </button>
        ),
      },
      {
        id: "supplier",
        accessorFn: (row) => row.supplier.name,
        meta: { label: "Supplier" },
        header: "Supplier",
      },
      { accessorKey: "orderDate", meta: { label: "Order date" }, header: "Order date", cell: ({ row }) => formatDate(row.original.orderDate) },
      { accessorKey: "status", meta: { label: "Status" }, header: "Status" },
      {
        accessorKey: "totalCents",
        meta: { label: "Total" },
        header: "Total",
        cell: ({ row }) => formatMoney(row.original.totalCents),
      },
      {
        id: "actions",
        meta: { label: "Actions" },
        header: "",
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" aria-label="Record actions">
                <MoreHorizontalIcon className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                disabled={!canReceive || row.original.status === "RECEIVED"}
                onSelect={() => setReceiveTarget(row.original)}
              >
                Mark as received
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [formatMoney, canReceive, formatDate]
  )

  const table = useReactTable({
    data: items,
    columns,
    state: { sorting, pagination, globalFilter: search },
    onSortingChange: value => { setSorting(value); setPagination(prev => ({ ...prev, pageIndex: 0 })) },
    onGlobalFilterChange: value => { setSearch(value); setPagination(prev => ({ ...prev, pageIndex: 0 })) },
    onPaginationChange: (updater) => {
      setPagination((prev) =>
        typeof updater === "function" ? (updater(prev as never) as PaginationState) : updater
      )
    },
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    pageCount: Math.max(1, Math.ceil(totalRows / pagination.pageSize)),
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <div className={pageClass}>
      <PageHeader title="Purchase orders" description="Create supplier purchases and receive stock into inventory." actions={<Button
          disabled={!canCreate}
          onClick={() => {
            setFormValues(defaultValues)
            setFormError(""); setFormOpen(true)
          }}
        >
          <PlusIcon className="mr-2 h-4 w-4" />
          New PO
        </Button>} />

      <Surface>
      <TableToolbar table={table} searchPlaceholder="Search by PO number or supplier"><Select aria-label="Status filter" value={statusFilter} onValueChange={value => { setStatusFilter(value); setPagination(prev => ({ ...prev, pageIndex: 0 })) }}><option value="all">All statuses</option><option value="DRAFT">Draft</option><option value="ORDERED">Ordered</option><option value="RECEIVED">Received</option><option value="CANCELED">Canceled</option></Select><Button type="button" variant="outline" disabled={loading} onClick={() => void loadItems()}>Refresh</Button></TableToolbar>
      <DataTable table={table} loading={loading} emptyMessage="No purchase orders found." />
      <TablePagination table={table} totalRows={totalRows} loading={loading} />
      </Surface>

      {receiveTarget && <ConfirmAction title="Receive purchase order" description={`Receive ${receiveTarget.orderNumber}? This adds the ordered quantities to stock.`} label="Receive stock" busy={receiving} onCancel={() => setReceiveTarget(null)} onConfirm={() => void markReceived(receiveTarget)} />}

      {viewing && <PurchaseView item={viewing} onClose={() => setViewing(null)} formatMoney={formatMoney} formatDate={formatDate} actions={canReceive && viewing.status !== "RECEIVED" ? <Button onClick={() => { setReceiveTarget(viewing); setViewing(null) }}>Mark as received</Button> : undefined} />}

      {formOpen && <DraftPanel error={formError} fingerprint={formValues} title="New purchase order" description="Enter purchase order details in the sections below." onClose={() => setFormOpen(false)} onSubmit={() => void save()} saving={saving} disabled={!canCreate} saveLabel="Create purchase order">
          <div className="space-y-5"><Section title="Order details">
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField id="po-supplier" label="Supplier">
                <RecordSelect
                  id="po-supplier"
                  value={formValues.supplierId}
                  placeholder="Select supplier"
                  endpoint="/api/inventory/suppliers?status=ACTIVE"
                  onChange={(nextValue) =>
                    setFormValues((prev) => ({ ...prev, supplierId: nextValue }))
                  }
                />
              </FormField>
              <FormField id="po-order-date" label="Order date">
                <Input
                  id="po-order-date"
                  type="date"
                  value={formValues.orderDate}
                  onChange={(event) =>
                    setFormValues((prev) => ({ ...prev, orderDate: event.target.value }))
                  }
                />
              </FormField>
              <FormField id="po-expected-date" label="Expected date">
                <Input
                  id="po-expected-date"
                  type="date"
                  value={formValues.expectedDate}
                  onChange={(event) =>
                    setFormValues((prev) => ({ ...prev, expectedDate: event.target.value }))
                  }
                />
              </FormField>
              <FormField id="po-status" label="Status">
                <Select
                  id="po-status"
                  className="w-full"
                  value={formValues.status}
                  onValueChange={(value) =>
                    setFormValues((prev) => ({
                      ...prev,
                      status: value as PurchaseOrderFormValues["status"],
                    }))
                  }
                >
                  <option value="ORDERED">Ordered</option>
                  <option value="DRAFT">Draft</option>
                  <option disabled={!canReceiveStock} value="RECEIVED">Received</option>
                </Select>
              </FormField>
            </div>

            <FormField id="po-notes" label="Notes">
              <Textarea
                id="po-notes"
                value={formValues.notes}
                onChange={(event) =>
                  setFormValues((prev) => ({ ...prev, notes: event.target.value }))
                }
              />
            </FormField>

            </Section><Section title="Order items">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Items</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setFormValues((prev) => ({
                      ...prev,
                      items: [...prev.items, { productId: "", quantity: 1, unitCost: "0.00" }],
                    }))
                  }
                >
                  Add item
                </Button>
              </div>
              {formValues.items.map((item, index) => (
                <div key={index} className="grid gap-3 md:grid-cols-[2fr_1fr_1fr_auto]">
                  <FormField id={`po-item-product-${index}`} label="Product">
                    <RecordSelect
                      id={`po-item-product-${index}`}
                      value={item.productId}
                      placeholder="Select product"
                      endpoint="/api/inventory/products?status=ACTIVE"
                      onChange={(event) =>
                        setFormValues((prev) => ({
                          ...prev,
                          items: prev.items.map((row, rowIndex) =>
                            rowIndex === index ? { ...row, productId: event } : row
                          ),
                        }))
                      }
                    />
                  </FormField>
                  <FormField id={`po-item-qty-${index}`} label="Qty">
                    <Input
                      id={`po-item-qty-${index}`}
                      type="number"
                      min={1}
                      value={item.quantity}
                      onChange={(event) =>
                        setFormValues((prev) => ({
                          ...prev,
                          items: prev.items.map((row, rowIndex) =>
                            rowIndex === index
                              ? { ...row, quantity: Math.max(1, Number(event.target.value || 1)) }
                              : row
                          ),
                        }))
                      }
                    />
                  </FormField>
                  <FormField id={`po-item-cost-${index}`} label="Unit cost">
                    <Input
                      id={`po-item-cost-${index}`}
                      value={item.unitCost}
                      onChange={(event) =>
                        setFormValues((prev) => ({
                          ...prev,
                          items: prev.items.map((row, rowIndex) =>
                            rowIndex === index ? { ...row, unitCost: event.target.value } : row
                          ),
                        }))
                      }
                    />
                  </FormField>
                  <div className="pt-8">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      aria-label="Remove item"
                      onClick={() =>
                        setFormValues((prev) => ({
                          ...prev,
                          items: prev.items.filter((_, rowIndex) => rowIndex !== index),
                        }))
                      }
                      disabled={formValues.items.length === 1}
                    >
                      <Trash2Icon className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </Section></div>
      </DraftPanel>}
    </div>
  )
}
