"use client"

import { SupplierView } from "@/modules/inventory/record-view"

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
import { COUNTRY_OPTIONS, getStateOptionsByCountry } from "@/lib/constants/countries"
import { useFormErrors } from "@/hooks/use-form-errors"
import type { ListResponse } from "@/types/api"
import type { SupplierRow } from "@/types/inventory"

type SupplierFormValues = {
  name: string
  contactPerson: string
  email: string
  phone: string
  isTaxRegistered: boolean
  taxRegistrationType: "VAT" | "GST" | "SALES_TAX_ID" | "EIN" | "OTHER" | ""
  taxRegistrationNumber: string
  leadTimeDays: number
  city: string
  state: string
  country: string
  notes: string
  status: "ACTIVE" | "INACTIVE"
}

const defaultValues: SupplierFormValues = {
  name: "",
  contactPerson: "",
  email: "",
  phone: "",
  isTaxRegistered: false,
  taxRegistrationType: "",
  taxRegistrationNumber: "",
  leadTimeDays: 0,
  city: "",
  state: "",
  country: "",
  notes: "",
  status: "ACTIVE",
}

type PaginationState = { pageIndex: number; pageSize: number }

const SortIndicator = ({ value }: { value: false | "asc" | "desc" }) => {
  if (value === "asc") return <ArrowUpIcon className="h-4 w-4" />
  if (value === "desc") return <ArrowDownIcon className="h-4 w-4" />
  return <ArrowUpDownIcon className="h-4 w-4" />
}

export default function InventorySuppliersPage() {
  const canCreate = useCurrentResourceAction("create")
  const canEdit = useCurrentResourceAction("edit")
  const canArchive = useCurrentResourceAction("archive")

  const [items, setItems] = React.useState<SupplierRow[]>([])
  const [totalRows, setTotalRows] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [statusFilter, setStatusFilter] = React.useState("all")
  const listRequest = React.useRef<AbortController | null>(null)
  const [search, setSearch] = React.useState("")
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [pagination, setPagination] = React.useState<PaginationState>({ pageIndex: 0, pageSize: 10 })
  const [deleteTarget, setDeleteTarget] = React.useState<SupplierRow | null>(null)
  const [deleting, setDeleting] = React.useState(false)
  const [viewing, setViewing] = React.useState<SupplierRow | null>(null)
  const [formOpen, setFormOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<SupplierRow | null>(null)
  const [formValues, setFormValues] = React.useState<SupplierFormValues>(defaultValues)
  const [formError, setFormError] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  const { errors, setErrorsFromResponse, clearErrors } = useFormErrors()
  const stateOptions = getStateOptionsByCountry(formValues.country)

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
      const response = await fetch(`/api/inventory/suppliers?${params.toString()}`, { signal })
      if (!response.ok) {
        toast.error("Unable to load suppliers.")
        setItems([])
        setTotalRows(0)
        setLoading(false)
        return
      }
      const data = (await response.json()) as ListResponse<SupplierRow>
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
        editing ? `/api/inventory/suppliers/${editing.id}` : "/api/inventory/suppliers",
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
        toast.error(data.error ?? "Unable to save supplier.")
        setSaving(false)
        return
      }
      toast.success(editing ? "Supplier updated." : "Supplier created.")
      setSaving(false)
      setFormOpen(false)
      setEditing(null)
      setFormValues(defaultValues)
      await loadItems()
    } catch { setFormError("Unable to save. Please try again."); toast.error("Unable to save. Please try again.") } finally { setSaving(false) }
  }

  const removeItem = React.useCallback(async (item: SupplierRow) => {
    setDeleting(true)
    try {
      const response = await fetch(`/api/inventory/suppliers/${item.id}`, { method: "DELETE" })
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string }
        toast.error(data.error ?? "Unable to delete supplier.")
        return
      }
      toast.success("Supplier deleted.")
      await loadItems()
      setDeleteTarget(null)
    } catch { toast.error("Unable to delete. Please try again.") } finally { setDeleting(false) }
  }, [loadItems])

  const openEdit = React.useCallback((item: SupplierRow) => {
    setViewing(null)
    setEditing(item)
    setFormValues({
      name: item.name,
      contactPerson: item.contactPerson ?? "",
      email: item.email ?? "",
      phone: item.phone ?? "",
      isTaxRegistered: item.isTaxRegistered ?? false,
      taxRegistrationType: item.taxRegistrationType ?? "",
      taxRegistrationNumber: item.taxRegistrationNumber ?? "",
      leadTimeDays: item.leadTimeDays,
      city: item.city ?? "",
      state: item.state ?? "",
      country: item.country ?? "",
      notes: item.notes ?? "",
      status: item.status,
    })
    clearErrors()
    setFormError(""); setFormOpen(true)
  }, [clearErrors])

  const columns = React.useMemo<ColumnDef<SupplierRow>[]>(
    () => [
      {
        accessorKey: "name",
        meta: { label: "Supplier" },
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-2 text-sm font-medium"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Supplier
            <SortIndicator value={column.getIsSorted()} />
          </button>
        ),
        cell: ({ row }) => (
          <div className="flex flex-col">
            <button type="button" className="text-left font-medium underline underline-offset-4 hover:text-primary" onClick={() => setViewing(row.original)}>{row.original.name}</button>
            <span className="text-xs text-muted-foreground">
              {row.original.contactPerson || row.original.email || "No contact"}
            </span>
          </div>
        ),
      },
      { accessorKey: "phone", meta: { label: "Phone" }, header: "Phone" },
      { accessorKey: "city", meta: { label: "City" }, header: "City" },
      { accessorKey: "leadTimeDays", meta: { label: "Lead days" }, header: "Lead days" },
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
      <PageHeader title="Suppliers" description="Manage supplier master records for purchasing." actions={<Button
          disabled={!canCreate}
          onClick={() => {
            setEditing(null)
            setFormValues(defaultValues)
            clearErrors()
            setFormError(""); setFormOpen(true)
          }}
        >
          <PlusIcon className="mr-2 h-4 w-4" />
          New supplier
        </Button>} />

      <Surface>
      <TableToolbar table={table} searchPlaceholder="Search suppliers"><Select aria-label="Status filter" value={statusFilter} onValueChange={value => { setStatusFilter(value); setPagination(prev => ({ ...prev, pageIndex: 0 })) }}><option value="all">All statuses</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></Select><Button type="button" variant="outline" disabled={loading} onClick={() => void loadItems()}>Refresh</Button></TableToolbar>
      <DataTable table={table} loading={loading} emptyMessage="No suppliers found." />
      <TablePagination table={table} totalRows={totalRows} loading={loading} />
      </Surface>

      {deleteTarget && <ConfirmAction title="Delete supplier" description={`Delete "${deleteTarget.name}"? If this record is in use, it will be made inactive instead.`} label="Delete" destructive busy={deleting} onCancel={() => setDeleteTarget(null)} onConfirm={() => void removeItem(deleteTarget)} />}

      {viewing && <SupplierView item={viewing} onClose={() => setViewing(null)} onEdit={canEdit ? () => openEdit(viewing) : undefined} />}

      {formOpen && <DraftPanel error={formError} fingerprint={formValues} title={editing ? "Edit supplier" : "New supplier"} description="Update supplier details in the sections below." onClose={() => setFormOpen(false)} onSubmit={() => void save()} saving={saving} disabled={!(editing ? canEdit : canCreate)} saveLabel={editing ? "Save changes" : "Create supplier"}>
          <div className="space-y-5"><Section title="Contact and ordering"><div className="grid gap-4">
            <FormField id="sup-name" label="Name" error={errors.name}>
              <Input
                id="sup-name"
                required minLength={2}
                value={formValues.name}
                onChange={(event) => setFormValues((prev) => ({ ...prev, name: event.target.value }))}
              />
            </FormField>
            <div className="grid gap-3 md:grid-cols-2">
              <FormField id="sup-contact" label="Contact person" error={errors.contactPerson}>
                <Input
                  id="sup-contact"
                  value={formValues.contactPerson}
                  onChange={(event) =>
                    setFormValues((prev) => ({ ...prev, contactPerson: event.target.value }))
                  }
                />
              </FormField>
              <FormField id="sup-email" label="Email" error={errors.email}>
                <Input
                  id="sup-email"
                  value={formValues.email}
                  onChange={(event) => setFormValues((prev) => ({ ...prev, email: event.target.value }))}
                />
              </FormField>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField id="sup-phone" label="Phone" error={errors.phone}>
                <Input
                  id="sup-phone"
                  value={formValues.phone}
                  onChange={(event) => setFormValues((prev) => ({ ...prev, phone: event.target.value }))}
                />
              </FormField>
              <FormField id="sup-lead" label="Lead days" error={errors.leadTimeDays}>
                <Input
                  id="sup-lead"
                  type="number"
                  min={0}
                  value={formValues.leadTimeDays}
                  onChange={(event) =>
                    setFormValues((prev) => ({
                      ...prev,
                      leadTimeDays: Math.max(0, Number(event.target.value || 0)),
                    }))
                  }
                />
              </FormField>
              <FormField id="sup-status" label="Status" error={errors.status}>
                <Select
                  id="sup-status"
                  disabled={!canArchive}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={formValues.status}
                  onValueChange={(value) =>
                    setFormValues((prev) => ({
                      ...prev,
                      status: value as SupplierFormValues["status"],
                    }))
                  }
                >
                  <option value="ACTIVE">Active</option>
                  <option value="INACTIVE">Inactive</option>
                </Select>
              </FormField>
            </div>
            </div></Section><Section title="Tax registration"><div className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField id="sup-tax-registered" label="Tax registered" error={errors.isTaxRegistered}>
                <Select
                  id="sup-tax-registered"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={formValues.isTaxRegistered ? "YES" : "NO"}
                  onValueChange={(value) =>
                    setFormValues((prev) => ({
                      ...prev,
                      isTaxRegistered: value === "YES",
                      taxRegistrationType: value === "YES" ? prev.taxRegistrationType : "",
                      taxRegistrationNumber: value === "YES" ? prev.taxRegistrationNumber : "",
                    }))
                  }
                >
                  <option value="NO">No</option>
                  <option value="YES">Yes</option>
                </Select>
              </FormField>
              <FormField
                id="sup-tax-type"
                label="Tax registration type"
                error={errors.taxRegistrationType}
              >
                <Select
                  id="sup-tax-type"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={formValues.taxRegistrationType}
                  disabled={!formValues.isTaxRegistered}
                  onValueChange={(value) =>
                    setFormValues((prev) => ({
                      ...prev,
                      taxRegistrationType: value as SupplierFormValues["taxRegistrationType"],
                    }))
                  }
                >
                  <option value="">Select type</option>
                  <option value="VAT">VAT</option>
                  <option value="GST">GST</option>
                  <option value="SALES_TAX_ID">Sales Tax ID</option>
                  <option value="EIN">EIN</option>
                  <option value="OTHER">Other</option>
                </Select>
              </FormField>
              <FormField
                id="sup-tax-number"
                label="Tax registration no."
                error={errors.taxRegistrationNumber}
              >
                <Input
                  id="sup-tax-number"
                  value={formValues.taxRegistrationNumber}
                  disabled={!formValues.isTaxRegistered}
                  onChange={(event) =>
                    setFormValues((prev) => ({
                      ...prev,
                      taxRegistrationNumber: event.target.value,
                    }))
                  }
                />
              </FormField>
            </div>
            </div></Section><Section title="Address"><div className="grid gap-4">
            <div className="grid gap-3 md:grid-cols-2">
              <FormField id="sup-city" label="City" error={errors.city}>
                <Input
                  id="sup-city"
                  value={formValues.city}
                  onChange={(event) => setFormValues((prev) => ({ ...prev, city: event.target.value }))}
                />
              </FormField>
              <FormField id="sup-state" label="State / province" error={errors.state}>
                {stateOptions ? (
                  <Select
                    id="sup-state"
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={formValues.state}
                    onValueChange={(value) => setFormValues((prev) => ({ ...prev, state: value }))}
                  >
                    <option value="">Select state/province</option>
                    {stateOptions.map((state) => (
                      <option key={state} value={state}>
                        {state}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input
                    id="sup-state"
                    placeholder="State / province / region"
                    value={formValues.state}
                    onChange={(event) => setFormValues((prev) => ({ ...prev, state: event.target.value }))}
                  />
                )}
              </FormField>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <FormField id="sup-country" label="Country" error={errors.country}>
                <Select
                  id="sup-country"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={formValues.country}
                  onValueChange={(value) =>
                    setFormValues((prev) => {
                      const country = value
                      const nextStateOptions = getStateOptionsByCountry(country)
                      const shouldResetState = Boolean(
                        nextStateOptions && prev.state && !nextStateOptions.includes(prev.state)
                      )
                      return {
                        ...prev,
                        country,
                        state: shouldResetState ? "" : prev.state,
                      }
                    })
                  }
                >
                  <option value="">Select country</option>
                  {COUNTRY_OPTIONS.map((country) => (
                    <option key={country} value={country}>
                      {country}
                    </option>
                  ))}
                </Select>
              </FormField>
            </div>
            </div></Section><Section title="Notes">
            <FormField id="sup-notes" label="Notes" error={errors.notes}>
              <Textarea
                id="sup-notes"
                value={formValues.notes}
                onChange={(event) => setFormValues((prev) => ({ ...prev, notes: event.target.value }))}
              />
            </FormField>
          </Section></div>
      </DraftPanel>}
    </div>
  )
}
