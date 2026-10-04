"use client"

import { CategoryView } from "@/modules/inventory/record-view"

import { Select, Textarea } from "@/components/erp/controls"

import { useCurrentResourceAction } from "@/platform/access/view-guard"

import * as React from "react"
import {
  ColumnDef,
  SortingState,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table"
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon, MoreHorizontalIcon, PlusIcon } from "lucide-react"
import { toast } from "sonner"

import { DataTable } from "@/components/data-table"
import { PageHeader, Surface, TableToolbar, pageClass } from "@/components/erp/page"
import { TablePagination } from "@/components/erp/pagination"
import { DraftPanel } from "@/components/erp/record-detail"
import { Section } from "@/components/erp/section"
import { ConfirmAction } from "@/components/erp/confirm-action"
import { FormField } from "@/components/form-field"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { useFormErrors } from "@/hooks/use-form-errors"
import type { ListResponse } from "@/types/api"
import type { InventoryCategoryRow } from "@/types/inventory"

type CategoryFormValues = {
  name: string
  description: string
  status: "ACTIVE" | "INACTIVE"
  sortOrder: number
}

const defaultValues: CategoryFormValues = {
  name: "",
  description: "",
  status: "ACTIVE",
  sortOrder: 0,
}

type PaginationState = { pageIndex: number; pageSize: number }

const SortIndicator = ({ value }: { value: false | "asc" | "desc" }) => {
  if (value === "asc") return <ArrowUpIcon className="h-4 w-4" />
  if (value === "desc") return <ArrowDownIcon className="h-4 w-4" />
  return <ArrowUpDownIcon className="h-4 w-4" />
}

export default function InventoryCategoriesPage() {
  const canCreate = useCurrentResourceAction("create")
  const canEdit = useCurrentResourceAction("edit")
  const canArchive = useCurrentResourceAction("archive")

  const [items, setItems] = React.useState<InventoryCategoryRow[]>([])
  const [totalRows, setTotalRows] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [statusFilter, setStatusFilter] = React.useState("all")
  const listRequest = React.useRef<AbortController | null>(null)
  const [search, setSearch] = React.useState("")
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [pagination, setPagination] = React.useState<PaginationState>({ pageIndex: 0, pageSize: 10 })
  const [deleteTarget, setDeleteTarget] = React.useState<InventoryCategoryRow | null>(null)
  const [deleting, setDeleting] = React.useState(false)
  const [viewing, setViewing] = React.useState<InventoryCategoryRow | null>(null)
  const [formOpen, setFormOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<InventoryCategoryRow | null>(null)
  const [formValues, setFormValues] = React.useState<CategoryFormValues>(defaultValues)
  const [formError, setFormError] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  const { errors, setErrorsFromResponse, clearErrors } = useFormErrors()

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
      const response = await fetch(`/api/inventory/categories?${params.toString()}`, { signal })
      if (!response.ok) {
        toast.error("Unable to load categories.")
        setItems([])
        setTotalRows(0)
        setLoading(false)
        return
      }
      const data = (await response.json()) as ListResponse<InventoryCategoryRow>
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

  const save = async () => {
    setSaving(true)
    setFormError("")
    try {
      clearErrors()
      const response = await fetch(
        editing ? `/api/inventory/categories/${editing.id}` : "/api/inventory/categories",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(formValues),
        }
      )
      if (!response.ok) {
        const data = (await response.json()) as {
          error?: string
          details?: { fieldErrors?: Record<string, string[]> }
        }
        setErrorsFromResponse(data)
        setFormError(data.error ?? "Unable to save. Check the form and try again.")
        toast.error(data.error ?? "Unable to save category.")
        setSaving(false)
        return
      }
      toast.success(editing ? "Category updated." : "Category created.")
      setSaving(false)
      setFormOpen(false)
      setEditing(null)
      setFormValues(defaultValues)
      await loadItems()
    } catch { setFormError("Unable to save. Please try again."); toast.error("Unable to save. Please try again.") } finally { setSaving(false) }
  }

  const removeItem = React.useCallback(async (item: InventoryCategoryRow) => {
    setDeleting(true)
    try {
      const response = await fetch(`/api/inventory/categories/${item.id}`, { method: "DELETE" })
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string }
        toast.error(data.error ?? "Unable to delete category.")
        return
      }
      toast.success("Category deleted.")
      await loadItems()
      setDeleteTarget(null)
    } catch { toast.error("Unable to delete. Please try again.") } finally { setDeleting(false) }
  }, [loadItems])

  const openEdit = React.useCallback((item: InventoryCategoryRow) => {
    setViewing(null)
    setEditing(item)
    setFormValues({
      name: item.name,
      description: item.description ?? "",
      status: item.status,
      sortOrder: item.sortOrder,
    })
    clearErrors()
    setFormError(""); setFormOpen(true)
  }, [clearErrors])

  const columns = React.useMemo<ColumnDef<InventoryCategoryRow>[]>(
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
              <span className="text-xs text-muted-foreground">{row.original.description}</span>
            ) : null}
          </div>
        ),
      },
      { accessorKey: "sortOrder", meta: { label: "Order" }, header: "Order" },
      {
        accessorKey: "status",
        meta: { label: "Status" },
        header: "Status",
        cell: ({ row }) => (row.original.status === "ACTIVE" ? "Active" : "Inactive"),
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
              <DropdownMenuItem disabled={!canEdit} onSelect={() => openEdit(row.original)}>Edit</DropdownMenuItem>
              <DropdownMenuItem
                disabled={!canArchive}
                className="text-destructive"
                onSelect={() => setDeleteTarget(row.original)}
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [openEdit, canEdit, canArchive]
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
      <PageHeader title="Inventory categories" description="Organize products for stock and purchasing." actions={<Button
          disabled={!canCreate}
          onClick={() => {
            setEditing(null)
            setFormValues(defaultValues)
            clearErrors()
            setFormError(""); setFormOpen(true)
          }}
        >
          <PlusIcon className="mr-2 h-4 w-4" />
          New category
        </Button>} />

      <Surface>
      <TableToolbar table={table} searchPlaceholder="Search categories"><Select aria-label="Status filter" value={statusFilter} onValueChange={value => { setStatusFilter(value); setPagination(prev => ({ ...prev, pageIndex: 0 })) }}><option value="all">All statuses</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></Select><Button type="button" variant="outline" disabled={loading} onClick={() => void loadItems()}>Refresh</Button></TableToolbar>
      <DataTable table={table} loading={loading} emptyMessage="No categories found." />
      <TablePagination table={table} totalRows={totalRows} loading={loading} />
      </Surface>

      {deleteTarget && <ConfirmAction title="Delete category" description={`Delete "${deleteTarget.name}"? If this record is in use, it will be made inactive instead.`} label="Delete" destructive busy={deleting} onCancel={() => setDeleteTarget(null)} onConfirm={() => void removeItem(deleteTarget)} />}

      {viewing && <CategoryView item={viewing} onClose={() => setViewing(null)} onEdit={canEdit ? () => openEdit(viewing) : undefined} />}

      {formOpen && <DraftPanel error={formError} fingerprint={formValues} title={editing ? "Edit category" : "New category"} description="Update category details in the sections below." onClose={() => setFormOpen(false)} onSubmit={() => void save()} saving={saving} disabled={!(editing ? canEdit : canCreate)} saveLabel={editing ? "Save changes" : "Create category"}>
          <Section title="Category details"><div className="grid gap-3">
            <FormField id="cat-name" label="Name" error={errors.name}>
              <Input
                id="cat-name"
                required minLength={2}
                value={formValues.name}
                onChange={(event) => setFormValues((prev) => ({ ...prev, name: event.target.value }))}
              />
            </FormField>
            <FormField id="cat-description" label="Description" error={errors.description}>
              <Textarea
                id="cat-description"
                value={formValues.description}
                onChange={(event) =>
                  setFormValues((prev) => ({ ...prev, description: event.target.value }))
                }
              />
            </FormField>
            <FormField id="cat-order" label="Sort order" error={errors.sortOrder}>
              <Input
                id="cat-order"
                type="number"
                min={0}
                value={formValues.sortOrder}
                onChange={(event) =>
                  setFormValues((prev) => ({
                    ...prev,
                    sortOrder: Math.max(0, Number(event.target.value || 0)),
                  }))
                }
              />
            </FormField>
            <FormField id="cat-status" label="Status" error={errors.status}>
              <Select
                id="cat-status"
                disabled={!canArchive}
                className="w-full"
                value={formValues.status}
                onValueChange={(value) =>
                  setFormValues((prev) => ({
                    ...prev,
                    status: value as CategoryFormValues["status"],
                  }))
                }
              >
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </Select>
            </FormField>
          </div>
      </Section>
      </DraftPanel>}
    </div>
  )
}
