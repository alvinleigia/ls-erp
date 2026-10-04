"use client"

import * as React from "react"
import { useCurrentResourceAction } from "@/platform/access/view-guard"
import {
  ColumnDef,
  ColumnFiltersState,
  SortingState,
  VisibilityState,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table"
import {
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  MoreHorizontalIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { DataTable } from "@/components/data-table"
import { PageHeader, Surface, TableToolbar, Filters, pageClass } from "@/components/erp/page"
import { TablePagination } from "@/components/erp/pagination"
import { DraftPanel, RecordPanel, ReadOnlyFields } from "@/components/erp/record-detail"
import { Section } from "@/components/erp/section"
import { ConfirmAction } from "@/components/erp/confirm-action"
import { Select } from "@/components/erp/controls"
import { RecordSelect } from "@/components/erp/record-select"
import { FormField } from "@/components/form-field"
import { useFormErrors } from "@/hooks/use-form-errors"
import type { AppSettingsPayload, TaxRow } from "@/types/scheduling"
import { formatCurrencyFromCents } from "@/lib/formatting"
import type { ListResponse } from "@/types/api"
import type {
  ServiceFormValues,
  ServiceRow,
  ServiceStatus,
} from "@/types/services"
import { ServiceFormFields } from "./service-form-fields"
import {
  defaultServiceFormValues,
  serviceStatusOptions,
} from "./service-form-model"

const SortIndicator = ({ value }: { value: false | "asc" | "desc" }) => {
  if (value === "asc") return <ArrowUpIcon className="h-4 w-4" />
  if (value === "desc") return <ArrowDownIcon className="h-4 w-4" />
  return <ArrowUpDownIcon className="h-4 w-4" />
}

export default function ServicesPage() {
  const canCreate = useCurrentResourceAction("create")
  const canEdit = useCurrentResourceAction("edit")
  const canArchive = useCurrentResourceAction("archive")
  type PaginationState = { pageIndex: number; pageSize: number }

  const [services, setServices] = React.useState<ServiceRow[]>([])
  const [taxOptions, setTaxOptions] = React.useState<TaxRow[]>([])
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
  const [loading, setLoading] = React.useState(true)
  const [totalRows, setTotalRows] = React.useState(0)

  const [search, setSearch] = React.useState("")
  const [statusFilter, setStatusFilter] = React.useState<"all" | ServiceStatus>("all")
  const [categoryFilter, setCategoryFilter] = React.useState("all")

  const [sorting, setSorting] = React.useState<SortingState>([])
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([])
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({
    name: true,
    category: true,
    durationMinutes: true,
    priceCents: true,
    taxMode: true,
    taxes: true,
    taxAmount: true,
    totalWithTax: true,
    status: true,
    type: true,
  })
  const [pagination, setPagination] = React.useState({ pageIndex: 0, pageSize: 10 })

  const [createOpen, setCreateOpen] = React.useState(false)
  const [editOpen, setEditOpen] = React.useState(false)
  const [editingService, setEditingService] = React.useState<ServiceRow | null>(null)
  const [viewing, setViewing] = React.useState<ServiceRow | null>(null)
  const [formError, setFormError] = React.useState("")
  const listRequest = React.useRef<AbortController | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [deleteTarget, setDeleteTarget] = React.useState<ServiceRow | null>(null)
  const [deleting, setDeleting] = React.useState(false)

  const {
    errors: createErrors,
    setErrorsFromResponse: setCreateErrorsFromResponse,
    clearErrors: clearCreateErrors,
  } = useFormErrors()
  const {
    errors: editErrors,
    setErrorsFromResponse: setEditErrorsFromResponse,
    clearErrors: clearEditErrors,
  } = useFormErrors()

  const [newService, setNewService] = React.useState<ServiceFormValues>(
    defaultServiceFormValues
  )

  const [editValues, setEditValues] = React.useState<ServiceFormValues>(
    defaultServiceFormValues
  )

  const totalPages = Math.max(1, Math.ceil(totalRows / pagination.pageSize))


  const loadSettings = React.useCallback(async () => {
    const response = await fetch("/api/settings/display", { cache: "no-store" })
    if (!response.ok) {
      return
    }
    const data = (await response.json()) as { settings?: AppSettingsPayload }
    if (data.settings?.locale && data.settings?.currency) {
      setSettings({
        locale: data.settings.locale,
        currency: data.settings.currency,
        currencySymbolPlacement: data.settings.currencySymbolPlacement ?? "BEFORE",
        numberFormat: data.settings.numberFormat ?? "US_UK",
      })
    }
  }, [])

  const loadServices = React.useCallback(async () => {
    listRequest.current?.abort()
    const controller = new AbortController()
    listRequest.current = controller
    const signal = controller.signal
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set("page", String(pagination.pageIndex + 1))
      params.set("pageSize", String(pagination.pageSize))
      if (search) {
        params.set("q", search)
      }
      if (statusFilter !== "all") {
        params.set("status", statusFilter)
      }
      if (categoryFilter !== "all") {
        params.set("categoryId", categoryFilter)
      }
      if (sorting[0]) {
        params.set("sort", sorting[0].id)
        params.set("order", sorting[0].desc ? "desc" : "asc")
      }
      const response = await fetch(`/api/services?${params.toString()}`, { signal })
      if (!response.ok) {
        toast.error("Unable to load services.")
        setServices([])
        setTotalRows(0)
        return
      }
      const data = (await response.json()) as ListResponse<ServiceRow>
      if (signal.aborted) return
      setServices(data.items)
      setTotalRows(data.total)
    } catch { if (!signal.aborted) toast.error("Unable to load records. Please refresh.") } finally { if (!signal.aborted) setLoading(false) }
  }, [
    pagination.pageIndex,
    pagination.pageSize,
    search,
    statusFilter,
    categoryFilter,
    sorting,
  ])


  const loadTaxOptions = React.useCallback(async () => {
    const response = await fetch("/api/lookups/taxes?page=1&pageSize=100", {
      cache: "no-store",
    })
    if (!response.ok) {
      setTaxOptions([])
      return
    }
    const data = (await response.json()) as ListResponse<TaxRow>
    setTaxOptions(data.items)
  }, [])


  React.useEffect(() => {
    void loadServices()
    return () => listRequest.current?.abort()
  }, [loadServices])

  React.useEffect(() => {
    void loadSettings()
  }, [loadSettings])


  React.useEffect(() => {
    void loadTaxOptions()
  }, [loadTaxOptions])


  const handlePaginationChange = React.useCallback(
    (updater: PaginationState | ((prev: PaginationState) => PaginationState)) => {
      setPagination((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater
        if (next.pageSize !== prev.pageSize) {
          return { ...next, pageIndex: 0 }
        }
        return next
      })
    },
    []
  )

  const priceToCents = (value: string) => {
    const normalized = value.replace(/[^0-9.]/g, "")
    const parsed = Number.parseFloat(normalized)
    if (Number.isNaN(parsed)) return 0
    return Math.round(parsed * 100)
  }

  const formatPrice = React.useCallback(
    (cents: number) => formatCurrencyFromCents(cents, settings),
    [settings]
  )

  const resolveTaxes = React.useCallback(
    (service: ServiceRow) =>
      (service.taxIds ?? [])
        .map((taxId) => taxOptions.find((tax) => tax.id === taxId))
        .filter((tax): tax is TaxRow => Boolean(tax)),
    [taxOptions]
  )

  const taxSummary = React.useCallback(
    (service: ServiceRow) => {
      const taxes = resolveTaxes(service)
      if (!taxes.length) return { label: "None", percentTotal: 0 }
      return {
        label: taxes.map((tax) => `${tax.name} ${tax.percent}%`).join(", "),
        percentTotal: taxes.reduce((sum, tax) => sum + Math.max(0, tax.percent), 0),
      }
    },
    [resolveTaxes]
  )

  const computeTaxCents = React.useCallback(
    (service: ServiceRow) => {
      const base = Math.max(0, service.priceCents)
      const { percentTotal } = taxSummary(service)
      if (percentTotal <= 0 || base <= 0) return 0
      if (service.taxMode === "INCLUSIVE") {
        const net = Math.round((base * 100) / (100 + percentTotal))
        return Math.max(0, base - net)
      }
      return Math.max(0, Math.round((base * percentTotal) / 100))
    },
    [taxSummary]
  )

  const computeTotalWithTax = React.useCallback(
    (service: ServiceRow) => {
      const base = Math.max(0, service.priceCents)
      const taxCents = computeTaxCents(service)
      return service.taxMode === "INCLUSIVE" ? base : base + taxCents
    },
    [computeTaxCents]
  )

  const computeNetPriceCents = React.useCallback(
    (service: ServiceRow) => {
      const base = Math.max(0, service.priceCents)
      const taxCents = computeTaxCents(service)
      return service.taxMode === "INCLUSIVE" ? Math.max(0, base - taxCents) : base
    },
    [computeTaxCents]
  )

  const createService = async () => {
    setSaving(true)
    setFormError("")
    try {
      clearCreateErrors()
      const response = await fetch("/api/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newService.name,
          description: newService.description,
          categoryId: newService.categoryId,
          durationMinutes: Number(newService.durationMinutes),
          priceCents: priceToCents(newService.price),
          status: newService.status,
          type: newService.type,
          packageItemIds:
            newService.type === "PACKAGE" ? newService.packageItemIds : [],
          taxIds: newService.taxIds,
          taxMode: newService.taxMode,
        }),
      })

      if (!response.ok) {
        const data = (await response.json()) as {
          error?: string
          details?: { fieldErrors?: Record<string, string[]> }
        }
        setCreateErrorsFromResponse(data)
        setFormError(data.error ?? "Unable to save. Check the form and try again.")
        toast.error(data.error ?? "Unable to create service.")
        return
      }

      toast.success("Service created.")
      setNewService(defaultServiceFormValues)
      setCreateOpen(false)
      await loadServices()
    } catch { setFormError("Unable to save. Please try again.") } finally { setSaving(false) }

  }

  const startEdit = React.useCallback((service: ServiceRow) => {
    setViewing(null)
    setFormError("")
    setEditingService(service)
    clearEditErrors()
    setEditValues({
      name: service.name,
      description: service.description ?? "",
      categoryId: service.category.id,
      durationMinutes: service.durationMinutes,
      price: (service.priceCents / 100).toFixed(2),
      status: service.status,
      type: service.type ?? "STANDARD",
      packageItemIds:
        service.packageItems?.map((item) => item.itemService.id) ?? [],
      taxIds: service.taxIds ?? [],
      taxMode: service.taxMode ?? "EXCLUSIVE",
    })
    setEditOpen(true)
  }, [clearEditErrors])

  const saveEdit = async () => {
    if (!editingService) return
    setSaving(true)
    setFormError("")
    try {
      const response = await fetch(`/api/services/${editingService.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editValues.name,
          description: editValues.description,
          categoryId: editValues.categoryId,
          durationMinutes: Number(editValues.durationMinutes),
          priceCents: priceToCents(editValues.price),
          status: editValues.status,
          type: editValues.type,
          packageItemIds:
            editValues.type === "PACKAGE" ? editValues.packageItemIds : [],
          taxIds: editValues.taxIds,
          taxMode: editValues.taxMode,
        }),
      })

      if (!response.ok) {
        const data = (await response.json()) as {
          error?: string
          details?: { fieldErrors?: Record<string, string[]> }
        }
        setEditErrorsFromResponse(data)
        setFormError(data.error ?? "Unable to save. Check the form and try again.")
        toast.error(data.error ?? "Unable to update service.")
        return
      }

      toast.success("Service updated.")
      setEditOpen(false)
      setEditingService(null)
      await loadServices()
    } catch { setFormError("Unable to save. Please try again.") } finally { setSaving(false) }

  }

  const requestDelete = React.useCallback((service: ServiceRow) => {
    setDeleteTarget(service)
    setDeleteOpen(true)
  }, [])

  const confirmDelete = React.useCallback(async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const response = await fetch(`/api/services/${deleteTarget.id}`, {
        method: "DELETE",
      })
      if (!response.ok) {
        const data = (await response.json()) as { error?: string }
        toast.error(data.error ?? "Unable to delete service.")
        return
      }
      toast.success("Service deleted.")
      setDeleteOpen(false)
      setDeleteTarget(null)
      await loadServices()
    } catch { toast.error("Unable to delete. Please try again.") } finally { setDeleting(false) }

  }, [deleteTarget, loadServices])

  const columns = React.useMemo<ColumnDef<ServiceRow>[]>(
    () => [
      {
        accessorKey: "name",
        meta: { label: "Service" },
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-2 text-sm font-medium"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Service
            <SortIndicator value={column.getIsSorted()} />
          </button>
        ),
        cell: ({ row }) => (
          <div className="flex flex-col">
            <button type="button" className="text-left font-medium underline underline-offset-4 hover:text-primary" onClick={() => setViewing(row.original)}>{row.original.name}</button>
            {row.original.description ? (
              <span className="text-xs text-muted-foreground">
                {row.original.description}
              </span>
            ) : null}
          </div>
        ),
      },
      {
        id: "category",
        accessorFn: (row) => row.category.name,
        meta: { label: "Category" },
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-2 text-sm font-medium"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Category
            <SortIndicator value={column.getIsSorted()} />
          </button>
        ),
        cell: ({ row }) => row.original.category.name,
      },
      {
        accessorKey: "durationMinutes",
        meta: { label: "Duration" },
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-2 text-sm font-medium"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Duration
            <SortIndicator value={column.getIsSorted()} />
          </button>
        ),
        cell: ({ row }) => `${row.original.durationMinutes} min`,
      },
      {
        accessorKey: "priceCents",
        meta: { label: "Price" },
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-2 text-sm font-medium"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Price
            <SortIndicator value={column.getIsSorted()} />
          </button>
        ),
        cell: ({ row }) => formatPrice(computeNetPriceCents(row.original)),
      },
      {
        id: "taxMode",
        accessorFn: (row) => row.taxMode ?? "EXCLUSIVE",
        meta: { label: "Tax mode" },
        enableSorting: false,
        header: "Tax mode",
        cell: ({ row }) => (row.original.taxMode === "INCLUSIVE" ? "Inclusive" : "Exclusive"),
      },
      {
        id: "taxes",
        meta: { label: "Taxes" },
        enableSorting: false,
        header: "Taxes",
        cell: ({ row }) => (
          <div className="text-xs text-muted-foreground">
            {taxSummary(row.original).label}
          </div>
        ),
      },
      {
        id: "taxAmount",
        meta: { label: "Tax" },
        enableSorting: false,
        header: "Tax",
        cell: ({ row }) => formatPrice(computeTaxCents(row.original)),
      },
      {
        id: "totalWithTax",
        meta: { label: "Total" },
        enableSorting: false,
        header: "Total",
        cell: ({ row }) => (
          <span className="font-medium">{formatPrice(computeTotalWithTax(row.original))}</span>
        ),
      },
      {
        accessorKey: "status",
        meta: { label: "Status" },
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-2 text-sm font-medium"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Status
            <SortIndicator value={column.getIsSorted()} />
          </button>
        ),
        cell: ({ row }) => (
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${row.original.status === "ACTIVE"
              ? "bg-emerald-500/10 text-emerald-500"
              : "bg-muted text-muted-foreground"
              }`}
          >
            {row.original.status === "ACTIVE" ? "Active" : "Inactive"}
          </span>
        ),
      },
      {
        accessorKey: "type",
        meta: { label: "Type" },
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-2 text-sm font-medium"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Type
            <SortIndicator value={column.getIsSorted()} />
          </button>
        ),
        cell: ({ row }) =>
          row.original.type === "PACKAGE" ? "Package" : "Standard",
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
              <DropdownMenuItem disabled={!canEdit} onSelect={() => startEdit(row.original)}>
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!canArchive}
                onSelect={() => requestDelete(row.original)}
                className="text-destructive"
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [
      canEdit, canArchive,
      computeNetPriceCents,
      computeTaxCents,
      computeTotalWithTax,
      formatPrice,
      requestDelete,
      startEdit,
      taxSummary,
    ]
  )

  const table = useReactTable({
    data: services,
    columns,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      globalFilter: search,
      pagination,
    },
    onSortingChange: value => { setSorting(value); setPagination(prev => ({ ...prev, pageIndex: 0 })) },
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onGlobalFilterChange: value => { setSearch(value); setPagination(prev => ({ ...prev, pageIndex: 0 })) },
    onPaginationChange: handlePaginationChange,
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    pageCount: totalPages,
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <div className={pageClass}>
      <PageHeader title="Services" description="Manage services, packages, pricing and durations." actions={<Button disabled={!canCreate} onClick={() => { setNewService(defaultServiceFormValues); clearCreateErrors(); setFormError(""); setCreateOpen(true) }}>New service</Button>} />
      <Surface>
        <TableToolbar table={table} searchPlaceholder="Search services">
          <Select aria-label="Status filter" value={statusFilter} onValueChange={value => { setStatusFilter(value as "all" | ServiceStatus); setPagination(prev => ({ ...prev, pageIndex: 0 })) }}>
            <option value="all">All statuses</option>{serviceStatusOptions.map(status => <option key={status} value={status}>{status === "ACTIVE" ? "Active" : "Inactive"}</option>)}
          </Select>
          <Filters activeCount={categoryFilter === "all" ? 0 : 1} onReset={() => { setCategoryFilter("all"); setPagination(prev => ({ ...prev, pageIndex: 0 })) }}>
            <FormField id="category-filter" label="Category"><RecordSelect id="category-filter" endpoint="/api/service-categories" value={categoryFilter === "all" ? "" : categoryFilter} placeholder="All categories" onChange={value => { setCategoryFilter(value || "all"); setPagination(prev => ({ ...prev, pageIndex: 0 })) }} /></FormField>
          </Filters>
          <Button variant="outline" disabled={loading} onClick={() => void loadServices()}>Refresh</Button>
        </TableToolbar>
        <DataTable table={table} loading={loading} emptyMessage="No services found." />
        <TablePagination table={table} totalRows={totalRows} loading={loading} />
      </Surface>
      {viewing && <RecordPanel title={viewing.name} description={viewing.type === "PACKAGE" ? "Service package" : "Service details"} onClose={() => setViewing(null)} actions={canEdit ? <Button onClick={() => startEdit(viewing)}>Edit details</Button> : undefined}>
        <Section title="Service details"><ReadOnlyFields fields={[{ label: "Category", value: viewing.category.name }, { label: "Type", value: viewing.type === "PACKAGE" ? "Package" : "Standard" }, { label: "Status", value: viewing.status === "ACTIVE" ? "Active" : "Inactive" }, { label: "Duration", value: `${viewing.durationMinutes} minutes` }, { label: "Description", value: viewing.description }]} /></Section>
        <Section title="Pricing and taxes"><ReadOnlyFields fields={[{ label: "Price before tax", value: formatPrice(computeNetPriceCents(viewing)) }, { label: "Tax mode", value: viewing.taxMode === "INCLUSIVE" ? "Inclusive" : "Exclusive" }, { label: "Default taxes", value: taxSummary(viewing).label }, { label: "Tax amount", value: formatPrice(computeTaxCents(viewing)) }, { label: "Total with tax", value: formatPrice(computeTotalWithTax(viewing)) }]} /></Section>
        {viewing.type === "PACKAGE" && <Section title="Package items"><ul className="space-y-2 text-sm">{viewing.packageItems?.map(item => <li key={item.itemService.id} className="rounded-lg border p-3">{item.itemService.name}</li>)}</ul>{!viewing.packageItems?.length && <p className="text-sm text-muted-foreground">No services in this package.</p>}</Section>}
      </RecordPanel>}
      {deleteOpen && deleteTarget && <ConfirmAction title="Delete service" description={`Delete "${deleteTarget.name}"? Services linked to packages are made inactive instead.`} label="Delete" destructive busy={deleting} onCancel={() => { setDeleteOpen(false); setDeleteTarget(null) }} onConfirm={() => void confirmDelete()} />}
      {createOpen && <DraftPanel disabled={!canCreate} title="New service" description="Create a service or package." fingerprint={newService} error={formError} saving={saving} saveLabel="Create service" onClose={() => setCreateOpen(false)} onSubmit={() => void createService()}>
        <ServiceFormFields mode="create" values={newService} errors={createErrors} taxOptions={taxOptions} onChange={setNewService} />
      </DraftPanel>}
      {editOpen && editingService && <DraftPanel disabled={!canEdit} title="Edit service" description="Update the service in the sections below." fingerprint={editValues} error={formError} saving={saving} onClose={() => setEditOpen(false)} onSubmit={() => void saveEdit()}>
        <ServiceFormFields mode="edit" values={editValues} errors={editErrors} selectedCategory={editingService.category} selectedServices={editingService.packageItems?.map(item => item.itemService)} taxOptions={taxOptions} onChange={setEditValues} />
      </DraftPanel>}
    </div>
  )
}
