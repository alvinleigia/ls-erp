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
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon, MoreHorizontalIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { DataTable } from "@/components/data-table"
import { PageHeader, Surface, TableToolbar, pageClass } from "@/components/erp/page"
import { TablePagination } from "@/components/erp/pagination"
import { DraftPanel, RecordPanel, ReadOnlyFields } from "@/components/erp/record-detail"
import { Section } from "@/components/erp/section"
import { ConfirmAction } from "@/components/erp/confirm-action"
import { Select } from "@/components/erp/controls"
import { useFormErrors } from "@/hooks/use-form-errors"
import { useDateFormatter } from "@/hooks/use-date-formatter"
import type { ListResponse } from "@/types/api"
import type { CategoryFormValues, CategoryRow, CategoryStatus } from "@/types/services"
import { CategoryFormFields } from "./category-form-fields"
import {
  categoryStatusOptions,
  defaultCategoryFormValues,
} from "./category-form-model"

const SortIndicator = ({ value }: { value: false | "asc" | "desc" }) => {
  if (value === "asc") return <ArrowUpIcon className="h-4 w-4" />
  if (value === "desc") return <ArrowDownIcon className="h-4 w-4" />
  return <ArrowUpDownIcon className="h-4 w-4" />
}

export default function ServiceCategoriesPage() {
  const canCreate = useCurrentResourceAction("create")
  const canEdit = useCurrentResourceAction("edit")
  const canArchive = useCurrentResourceAction("archive")
  const { formatDate } = useDateFormatter()
  type PaginationState = { pageIndex: number; pageSize: number }

  const [categories, setCategories] = React.useState<CategoryRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [totalRows, setTotalRows] = React.useState(0)

  const [search, setSearch] = React.useState("")
  const [statusFilter, setStatusFilter] = React.useState<"all" | CategoryStatus>(
    "all"
  )

  const [sorting, setSorting] = React.useState<SortingState>([])
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([])
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({
    name: true,
    status: true,
    sortOrder: true,
  })
  const [pagination, setPagination] = React.useState({ pageIndex: 0, pageSize: 10 })

  const [createOpen, setCreateOpen] = React.useState(false)
  const [editOpen, setEditOpen] = React.useState(false)
  const [editingCategory, setEditingCategory] = React.useState<CategoryRow | null>(null)
  const [viewing, setViewing] = React.useState<CategoryRow | null>(null)
  const [formError, setFormError] = React.useState("")
  const listRequest = React.useRef<AbortController | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [deleteTarget, setDeleteTarget] = React.useState<CategoryRow | null>(null)
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

  const [newCategory, setNewCategory] = React.useState<CategoryFormValues>(
    defaultCategoryFormValues
  )

  const [editValues, setEditValues] = React.useState<CategoryFormValues>(
    defaultCategoryFormValues
  )

  const totalPages = Math.max(1, Math.ceil(totalRows / pagination.pageSize))

  const loadCategories = React.useCallback(async () => {
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
      if (sorting[0]) {
        params.set("sort", sorting[0].id)
        params.set("order", sorting[0].desc ? "desc" : "asc")
      }
      const response = await fetch(`/api/service-categories?${params.toString()}`, { signal })
      if (!response.ok) {
        toast.error("Unable to load categories.")
        setCategories([])
        setTotalRows(0)
        return
      }
      const data = (await response.json()) as ListResponse<CategoryRow>
      if (signal.aborted) return
      setCategories(data.items)
      setTotalRows(data.total)
    } catch { if (!signal.aborted) toast.error("Unable to load records. Please refresh.") } finally { if (!signal.aborted) setLoading(false) }
  }, [
    pagination.pageIndex,
    pagination.pageSize,
    search,
    sorting,
    statusFilter,
  ])

  React.useEffect(() => {
    void loadCategories()
    return () => listRequest.current?.abort()
  }, [loadCategories])


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

  const createCategory = async () => {
    setSaving(true)
    setFormError("")
    try {
      clearCreateErrors()
      const response = await fetch("/api/service-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newCategory),
      })

      if (!response.ok) {
        const data = (await response.json()) as {
          error?: string
          details?: { fieldErrors?: Record<string, string[]> }
        }
        setCreateErrorsFromResponse(data)
        setFormError(data.error ?? "Unable to save. Check the form and try again.")
        toast.error(data.error ?? "Unable to create category.")
        return
      }

      toast.success("Category created.")
      setNewCategory(defaultCategoryFormValues)
      setCreateOpen(false)
      await loadCategories()
    } catch { setFormError("Unable to save. Please try again.") } finally { setSaving(false) }

  }

  const startEdit = React.useCallback((category: CategoryRow) => {
    setViewing(null)
    setFormError("")
    setEditingCategory(category)
    clearEditErrors()
    setEditValues({
      name: category.name,
      description: category.description ?? "",
      status: category.status,
      sortOrder: category.sortOrder,
    })
    setEditOpen(true)
  }, [clearEditErrors])

  const saveEdit = async () => {
    if (!editingCategory) return
    setSaving(true)
    setFormError("")
    try {
      const response = await fetch(`/api/service-categories/${editingCategory.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editValues),
      })

      if (!response.ok) {
        const data = (await response.json()) as {
          error?: string
          details?: { fieldErrors?: Record<string, string[]> }
        }
        setEditErrorsFromResponse(data)
        setFormError(data.error ?? "Unable to save. Check the form and try again.")
        toast.error(data.error ?? "Unable to update category.")
        return
      }

      toast.success("Category updated.")
      setEditOpen(false)
      setEditingCategory(null)
      await loadCategories()
    } catch { setFormError("Unable to save. Please try again.") } finally { setSaving(false) }

  }

  const requestDelete = React.useCallback((category: CategoryRow) => {
    setDeleteTarget(category)
    setDeleteOpen(true)
  }, [])

  const confirmDelete = React.useCallback(async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const response = await fetch(`/api/service-categories/${deleteTarget.id}`, {
        method: "DELETE",
      })
      if (!response.ok) {
        const data = (await response.json()) as { error?: string }
        toast.error(data.error ?? "Unable to delete category.")
        return
      }
      toast.success("Category deleted.")
      setDeleteOpen(false)
      setDeleteTarget(null)
      await loadCategories()
    } catch { toast.error("Unable to delete. Please try again.") } finally { setDeleting(false) }

  }, [deleteTarget, loadCategories])

  const columns = React.useMemo<ColumnDef<CategoryRow>[]>(
    () => [
      {
        accessorKey: "name",
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
        accessorKey: "sortOrder",
        meta: { label: "Order" },
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-2 text-sm font-medium"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Order
            <SortIndicator value={column.getIsSorted()} />
          </button>
        ),
      },
      {
        accessorKey: "createdAt",
        meta: { label: "Created" },
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-2 text-sm font-medium"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Created
            <SortIndicator value={column.getIsSorted()} />
          </button>
        ),
        cell: ({ row }) => formatDate(row.original.createdAt),
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
    [canEdit, canArchive, requestDelete, startEdit, formatDate]
  )

  const table = useReactTable({
    data: categories,
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
      <PageHeader title="Service categories" description="Organize services for booking and pricing." actions={<Button disabled={!canCreate} onClick={() => { setNewCategory(defaultCategoryFormValues); clearCreateErrors(); setFormError(""); setCreateOpen(true) }}>New category</Button>} />
      <Surface>
        <TableToolbar table={table} searchPlaceholder="Search categories">
          <Select aria-label="Status filter" value={statusFilter} onValueChange={value => { setStatusFilter(value as "all" | CategoryStatus); setPagination(prev => ({ ...prev, pageIndex: 0 })) }}>
            <option value="all">All statuses</option>{categoryStatusOptions.map(status => <option key={status} value={status}>{status === "ACTIVE" ? "Active" : "Inactive"}</option>)}
          </Select>
          <Button variant="outline" disabled={loading} onClick={() => void loadCategories()}>Refresh</Button>
        </TableToolbar>
        <DataTable table={table} loading={loading} emptyMessage="No categories found." />
        <TablePagination table={table} totalRows={totalRows} loading={loading} />
      </Surface>
      {viewing && <RecordPanel title={viewing.name} description="Service category" onClose={() => setViewing(null)} actions={canEdit ? <Button onClick={() => startEdit(viewing)}>Edit details</Button> : undefined}>
        <Section title="Category details"><ReadOnlyFields fields={[{ label: "Name", value: viewing.name }, { label: "Status", value: viewing.status === "ACTIVE" ? "Active" : "Inactive" }, { label: "Sort order", value: viewing.sortOrder }, { label: "Description", value: viewing.description }, { label: "Created", value: formatDate(viewing.createdAt) }]} /></Section>
      </RecordPanel>}
      {deleteOpen && deleteTarget && <ConfirmAction title="Delete category" description={`Delete "${deleteTarget.name}"? Categories linked to services are made inactive instead.`} label="Delete" destructive busy={deleting} onCancel={() => { setDeleteOpen(false); setDeleteTarget(null) }} onConfirm={() => void confirmDelete()} />}
      {createOpen && <DraftPanel disabled={!canCreate} title="New category" description="Create a service category." fingerprint={newCategory} error={formError} saving={saving} saveLabel="Create category" onClose={() => setCreateOpen(false)} onSubmit={() => void createCategory()}>
        <Section title="Category details"><CategoryFormFields mode="create" values={newCategory} errors={createErrors} onChange={setNewCategory} /></Section>
      </DraftPanel>}
      {editOpen && editingCategory && <DraftPanel disabled={!canEdit} title="Edit category" description="Update category details." fingerprint={editValues} error={formError} saving={saving} onClose={() => setEditOpen(false)} onSubmit={() => void saveEdit()}>
        <Section title="Category details"><CategoryFormFields mode="edit" values={editValues} errors={editErrors} onChange={setEditValues} /></Section>
      </DraftPanel>}
    </div>
  )
}
