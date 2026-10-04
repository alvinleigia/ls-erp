"use client"

import { Select } from "@/components/erp/controls"

import { ProductView } from "@/modules/inventory/record-view"

import { useCurrentResourceAction } from "@/platform/access/view-guard"

import * as React from "react"
import {
  ColumnDef,
  SortingState,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table"
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon, MoreHorizontalIcon } from "lucide-react"
import { toast } from "sonner"

import { DataTable } from "@/components/data-table"
import { PageHeader, Surface, TableToolbar, pageClass } from "@/components/erp/page"
import { TablePagination } from "@/components/erp/pagination"
import { DraftPanel } from "@/components/erp/record-detail"
import { ConfirmAction } from "@/components/erp/confirm-action"
import { Button } from "@/components/ui/button"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useFormErrors } from "@/hooks/use-form-errors"
import { formatCurrencyFromCents } from "@/lib/formatting"
import type { ListResponse } from "@/types/api"
import type {
  InventoryProductFormValues,
  InventoryProductRow,
} from "@/types/inventory"
import type { AppSettingsPayload, TaxRow } from "@/types/scheduling"
import { ProductFormFields } from "./product-form-fields"
import { defaultInventoryProductFormValues } from "./product-form-model"

type PaginationState = { pageIndex: number; pageSize: number }

const SortIndicator = ({ value }: { value: false | "asc" | "desc" }) => {
  if (value === "asc") return <ArrowUpIcon className="h-4 w-4" />
  if (value === "desc") return <ArrowDownIcon className="h-4 w-4" />
  return <ArrowUpDownIcon className="h-4 w-4" />
}

export default function InventoryProductsPage() {
  const canCreate = useCurrentResourceAction("create")
  const canEdit = useCurrentResourceAction("edit")
  const canArchive = useCurrentResourceAction("archive")

  const [items, setItems] = React.useState<InventoryProductRow[]>([])
  const [taxes, setTaxes] = React.useState<TaxRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [totalRows, setTotalRows] = React.useState(0)
  const [statusFilter, setStatusFilter] = React.useState("all")
  const listRequest = React.useRef<AbortController | null>(null)
  const [search, setSearch] = React.useState("")
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [pagination, setPagination] = React.useState<PaginationState>({ pageIndex: 0, pageSize: 10 })
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

  const [viewing, setViewing] = React.useState<InventoryProductRow | null>(null)
  const [formOpen, setFormOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<InventoryProductRow | null>(null)
  const [formValues, setFormValues] = React.useState<InventoryProductFormValues>(
    defaultInventoryProductFormValues
  )
  const [formError, setFormError] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [deleteTarget, setDeleteTarget] = React.useState<InventoryProductRow | null>(null)
  const [deleting, setDeleting] = React.useState(false)
  const { errors, setErrorsFromResponse, clearErrors } = useFormErrors()

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

  const loadProducts = React.useCallback(async () => {
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

      const response = await fetch(`/api/inventory/products?${params.toString()}`, { signal })
      if (!response.ok) {
        toast.error("Unable to load products.")
        setItems([])
        setTotalRows(0)
        setLoading(false)
        return
      }
      const data = (await response.json()) as ListResponse<InventoryProductRow>
      if (signal.aborted) return
      setItems(data.items)
      setTotalRows(data.total)
      setLoading(false)
    } catch { if (!signal.aborted) toast.error("Unable to load records. Please refresh.") } finally { if (!signal.aborted) setLoading(false) }
  }, [pagination.pageIndex, pagination.pageSize, search, sorting, statusFilter])

  React.useEffect(() => {
    void loadProducts()
    return () => listRequest.current?.abort()
  }, [loadProducts])

  React.useEffect(() => {
    const loadDependencies = async () => {
      const [taxResponse, settingsResponse] = await Promise.all([
        fetch("/api/lookups/taxes?page=1&pageSize=100", { cache: "no-store" }),
        fetch("/api/settings/display", { cache: "no-store" }),
      ])
      if (taxResponse.ok) {
        const data = (await taxResponse.json()) as ListResponse<TaxRow>
        setTaxes(data.items)
      }
      if (settingsResponse.ok) {
        const data = (await settingsResponse.json()) as { settings?: AppSettingsPayload }
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

  const resetForm = () => {
    setEditing(null)
    setFormValues(defaultInventoryProductFormValues)
    clearErrors()
  }

  const openCreate = () => {
    resetForm()
    setFormError(""); setFormOpen(true)
  }

  const openEdit = React.useCallback((item: InventoryProductRow) => {
    setViewing(null)
    setEditing(item)
    clearErrors()
    setFormValues({
      sku: item.sku,
      name: item.name,
      description: item.description ?? "",
      unit: item.unit,
      categoryId: item.category.id,
      status: item.status,
      costPrice: (item.costPriceCents / 100).toFixed(2),
      mrp: (item.mrpCents / 100).toFixed(2),
      reorderPoint: item.reorderPoint,
      reorderQty: item.reorderQty,
      onHandQty: item.onHandQty,
      isPhysical: item.isPhysical,
      taxIds: item.taxIds ?? [],
      supplierLinks: item.supplierLinks.map((link) => ({
        supplierId: link.supplierId,
        supplierSku: link.supplierSku ?? "",
        supplierCost:
          typeof link.supplierCostCents === "number"
            ? (link.supplierCostCents / 100).toFixed(2)
            : "",
        minOrderQty: link.minOrderQty,
        leadTimeDays: link.leadTimeDays ?? 0,
        isPreferred: link.isPreferred,
      })),
    })
    setFormError(""); setFormOpen(true)
  }, [clearErrors])

  const save = async () => {
    setSaving(true)
    setFormError("")
    try {
      clearErrors()
      const payload = {
        sku: formValues.sku,
        name: formValues.name,
        description: formValues.description,
        unit: formValues.unit,
        categoryId: formValues.categoryId,
        status: formValues.status,
        costPriceCents: parseMoney(formValues.costPrice),
        mrpCents: parseMoney(formValues.mrp),
        reorderPoint: formValues.reorderPoint,
        reorderQty: formValues.reorderQty,
        onHandQty: formValues.onHandQty,
        isPhysical: formValues.isPhysical,
        taxIds: formValues.taxIds,
        supplierLinks: formValues.supplierLinks
          .filter((link) => link.supplierId)
          .map((link) => ({
            supplierId: link.supplierId,
            supplierSku: link.supplierSku,
            supplierCostCents: link.supplierCost ? parseMoney(link.supplierCost) : undefined,
            minOrderQty: link.minOrderQty,
            leadTimeDays: link.leadTimeDays,
            isPreferred: link.isPreferred,
          })),
      }

      const response = await fetch(
        editing ? `/api/inventory/products/${editing.id}` : "/api/inventory/products",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      )

      if (!response.ok) {
        const data = (await response.json()) as {
          error?: string
          details?: { fieldErrors?: Record<string, string[]> }
        }
        setErrorsFromResponse(data)
        setFormError(data.error ?? "Unable to save. Check the form and try again.")
        toast.error(data.error ?? "Unable to save product.")
        setSaving(false)
        return
      }

      toast.success(editing ? "Product updated." : "Product created.")
      setSaving(false)
      setFormOpen(false)
      resetForm()
      await loadProducts()
    } catch { setFormError("Unable to save. Please try again."); toast.error("Unable to save. Please try again.") } finally { setSaving(false) }
  }

  const removeProduct = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const response = await fetch(`/api/inventory/products/${deleteTarget.id}`, {
        method: "DELETE",
      })
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string }
        toast.error(data.error ?? "Unable to delete product.")
        setDeleting(false)
        return
      }
      toast.success("Product deleted.")
      setDeleting(false)
      setDeleteOpen(false)
      setDeleteTarget(null)
      await loadProducts()
    } catch { toast.error("Unable to delete. Please try again.") } finally { setDeleting(false) }
  }

  const columns = React.useMemo<ColumnDef<InventoryProductRow>[]>(
    () => [
      {
        accessorKey: "sku",
        meta: { label: "SKU" },
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-2 text-sm font-medium"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            SKU
            <SortIndicator value={column.getIsSorted()} />
          </button>
        ),
      },
      {
        id: "name",
        accessorFn: (row) => row.name,
        meta: { label: "Product" },
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-2 text-sm font-medium"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Product
            <SortIndicator value={column.getIsSorted()} />
          </button>
        ),
        cell: ({ row }) => (
          <div className="flex flex-col">
            <button type="button" className="text-left font-medium underline underline-offset-4 hover:text-primary" onClick={() => setViewing(row.original)}>{row.original.name}</button>
            <span className="text-xs text-muted-foreground">{row.original.category.name}</span>
          </div>
        ),
      },
      {
        accessorKey: "costPriceCents",
        meta: { label: "CP" },
        header: "CP",
        cell: ({ row }) => formatMoney(row.original.costPriceCents),
      },
      {
        accessorKey: "mrpCents",
        meta: { label: "MRP" },
        header: "MRP",
        cell: ({ row }) => formatMoney(row.original.mrpCents),
      },
      {
        accessorKey: "onHandQty",
        meta: { label: "On hand" },
        header: "On hand",
      },
      {
        id: "reorder",
        meta: { label: "Reorder" },
        header: "Reorder",
        cell: ({ row }) => `${row.original.reorderPoint}/${row.original.reorderQty}`,
      },
      {
        id: "supplierCount",
        meta: { label: "Suppliers" },
        header: "Suppliers",
        cell: ({ row }) => row.original.supplierLinks.length,
      },
      {
        accessorKey: "status",
        meta: { label: "Status" },
        header: "Status",
        cell: ({ row }) => (row.original.status === "ACTIVE" ? "Active" : "Inactive"),
      },
      {
        id: "actions",
        header: "",
        enableHiding: false,
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" aria-label="Record actions">
                <MoreHorizontalIcon className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={!canEdit} onSelect={() => openEdit(row.original)}>
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!canArchive}
                className="text-destructive"
                onSelect={() => {
                  setDeleteTarget(row.original)
                  setDeleteOpen(true)
                }}
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [formatMoney, openEdit, canEdit, canArchive]
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
      <PageHeader title="Inventory products" description="Track products, supplier mapping, taxes, and stock levels." actions={<Button disabled={!canCreate} onClick={openCreate}>New product</Button>} />

      <Surface>
      <TableToolbar table={table} searchPlaceholder="Search products by name/SKU"><Select aria-label="Status filter" value={statusFilter} onValueChange={value => { setStatusFilter(value); setPagination(prev => ({ ...prev, pageIndex: 0 })) }}><option value="all">All statuses</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></Select><Button type="button" variant="outline" disabled={loading} onClick={() => void loadProducts()}>Refresh</Button></TableToolbar>
      <DataTable table={table} loading={loading} emptyMessage="No products found." />
      <TablePagination table={table} totalRows={totalRows} loading={loading} />
      </Surface>

      {deleteOpen && deleteTarget && <ConfirmAction title="Delete product" description={`Delete "${deleteTarget.name}"? If this record is in use, it will be made inactive instead.`} label="Delete" destructive busy={deleting} onCancel={() => { setDeleteOpen(false); setDeleteTarget(null) }} onConfirm={() => void removeProduct()} />}

      {viewing && <ProductView item={viewing} onClose={() => setViewing(null)} onEdit={canEdit ? () => openEdit(viewing) : undefined} formatMoney={formatMoney} taxNames={taxes.filter(tax => viewing.taxIds.includes(tax.id)).map(tax => tax.name)} />}

      {formOpen && <DraftPanel error={formError} fingerprint={formValues} title={editing ? "Edit product" : "New product"} description="Update product details in the sections below." onClose={() => setFormOpen(false)} onSubmit={() => void save()} saving={saving} disabled={!(editing ? canEdit : canCreate)} saveLabel={editing ? "Save changes" : "Create product"}>
          <div className="flex-1 overflow-y-auto px-1">
            <ProductFormFields
              values={formValues}
              errors={errors}
              selectedCategory={editing?.category}
              selectedSuppliers={editing?.supplierLinks ?? []}
              taxes={taxes}
              onChange={setFormValues}
            />
          </div>
      </DraftPanel>}
    </div>
  )
}
