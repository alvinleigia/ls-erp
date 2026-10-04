"use client"
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

import { DataTable, DataTablePagination, DataTableToolbar } from "@/components/data-table"
import { FormField } from "@/components/form-field"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { useFormErrors } from "@/hooks/use-form-errors"
import type { ListResponse } from "@/types/api"
import type { TaxRow } from "@/types/scheduling"

type TaxFormValues = {
  name: string
  percent: number
  isActive: boolean
  sortOrder: number
}

const defaultTaxFormValues: TaxFormValues = {
  name: "",
  percent: 0,
  isActive: true,
  sortOrder: 0,
}

type PaginationState = { pageIndex: number; pageSize: number }

const SortIndicator = ({ value }: { value: false | "asc" | "desc" }) => {
  if (value === "asc") return <ArrowUpIcon className="h-4 w-4" />
  if (value === "desc") return <ArrowDownIcon className="h-4 w-4" />
  return <ArrowUpDownIcon className="h-4 w-4" />
}

export default function SettingsTaxesPage() {
  const canCreate = useCurrentResourceAction("create"), canEdit = useCurrentResourceAction("edit"), canArchive = useCurrentResourceAction("archive")
  const [items, setItems] = React.useState<TaxRow[]>([])
  const [totalRows, setTotalRows] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [search, setSearch] = React.useState("")
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [pagination, setPagination] = React.useState<PaginationState>({ pageIndex: 0, pageSize: 10 })
  const [formOpen, setFormOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<TaxRow | null>(null)
  const [formValues, setFormValues] = React.useState<TaxFormValues>(defaultTaxFormValues)
  const { errors, setErrorsFromResponse, clearErrors } = useFormErrors()

  const loadTaxes = React.useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    params.set("page", String(pagination.pageIndex + 1))
    params.set("pageSize", String(pagination.pageSize))
    if (search.trim()) params.set("q", search.trim())

    const response = await fetch(`/api/settings/taxes?${params.toString()}`, {
      cache: "no-store",
    })
    if (!response.ok) {
      toast.error("Unable to load taxes.")
      setItems([])
      setTotalRows(0)
      setLoading(false)
      return
    }
    const data = (await response.json()) as ListResponse<TaxRow>
    setItems(data.items)
    setTotalRows(data.total)
    setLoading(false)
  }, [pagination.pageIndex, pagination.pageSize, search])

  React.useEffect(() => {
    void loadTaxes()
  }, [loadTaxes])

  const openCreate = () => {
    setEditing(null)
    setFormValues(defaultTaxFormValues)
    clearErrors()
    setFormOpen(true)
  }

  const openEdit = React.useCallback((tax: TaxRow) => {
    setEditing(tax)
    setFormValues({
      name: tax.name,
      percent: tax.percent,
      isActive: tax.isActive,
      sortOrder: tax.sortOrder,
    })
    clearErrors()
    setFormOpen(true)
  }, [clearErrors])

  const save = async () => {
    setSaving(true)
    clearErrors()
    const response = await fetch(
      editing ? `/api/settings/taxes/${editing.id}` : "/api/settings/taxes",
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
      toast.error(data.error ?? "Unable to save tax.")
      setSaving(false)
      return
    }

    toast.success(editing ? "Tax updated." : "Tax created.")
    setSaving(false)
    setFormOpen(false)
    await loadTaxes()
  }

  const removeTax = React.useCallback(async (tax: TaxRow) => {
    const response = await fetch(`/api/settings/taxes/${tax.id}`, { method: "DELETE" })
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string }
      toast.error(data.error ?? "Unable to delete tax.")
      return
    }
    toast.success("Tax deleted.")
    await loadTaxes()
  }, [loadTaxes])

  const columns = React.useMemo<ColumnDef<TaxRow>[]>(
    () => [
      {
        id: "name",
        meta: { label: "Name" },
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-2 text-sm font-medium"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Name
            <SortIndicator value={column.getIsSorted()} />
          </button>
        ),
        accessorFn: (row) => row.name,
      },
      {
        id: "percent",
        meta: { label: "Percent" },
        header: "Percent",
        accessorFn: (row) => `${row.percent}%`,
      },
      {
        id: "status",
        meta: { label: "Status" },
        header: "Status",
        accessorFn: (row) => (row.isActive ? "Active" : "Inactive"),
      },
      {
        id: "actions",
        meta: { label: "Actions" },
        header: "",
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost">
                <MoreHorizontalIcon className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={!canEdit} onSelect={() => openEdit(row.original)}>Edit</DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive"
                disabled={!canArchive} onSelect={() => void removeTax(row.original)}
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [openEdit, removeTax, canEdit, canArchive]
  )

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: items,
    columns,
    state: { sorting, pagination, globalFilter: search },
    onSortingChange: setSorting,
    onGlobalFilterChange: setSearch,
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Taxes</h1>
          <p className="text-sm text-muted-foreground">
            Create tax definitions and apply them to booking orders.
          </p>
        </div>
        <Button disabled={!canCreate} onClick={openCreate}>
          <PlusIcon className="mr-2 h-4 w-4" />
          New tax
        </Button>
      </div>

      <DataTableToolbar table={table} searchPlaceholder="Search taxes" />
      <DataTable table={table} loading={loading} emptyMessage="No taxes found." />
      <DataTablePagination table={table} totalRows={totalRows} />

      <Dialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open)
          if (!open) {
            setEditing(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit tax" : "New tax"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <FormField id="tax-name" label="Name" error={errors.name}>
              <Input
                id="tax-name"
                value={formValues.name}
                onChange={(event) => setFormValues((prev) => ({ ...prev, name: event.target.value }))}
              />
            </FormField>
            <FormField id="tax-percent" label="Percent (%)" error={errors.percent}>
              <Input
                id="tax-percent"
                type="number"
                min={0}
                step="0.01"
                value={formValues.percent}
                onChange={(event) =>
                  setFormValues((prev) => ({
                    ...prev,
                    percent: Math.max(0, Number(event.target.value || 0)),
                  }))
                }
              />
            </FormField>
            <FormField id="tax-sort-order" label="Sort order" error={errors.sortOrder}>
              <Input
                id="tax-sort-order"
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
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                disabled={!canArchive}
                  checked={formValues.isActive}
                onChange={(event) =>
                  setFormValues((prev) => ({ ...prev, isActive: event.target.checked }))
                }
              />
              Active
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button disabled={editing ? !canEdit : !canCreate} onClick={save} loading={saving} loadingText="Saving...">
              {editing ? "Save changes" : "Create tax"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
