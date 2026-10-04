"use client"
import { useDateFormatter } from "@/hooks/use-date-formatter"
import { useBusinessModules } from "@/platform/module-provider"
import { useCurrentResourceAction } from "@/platform/access/view-guard"

import { DraftPanel } from "@/components/erp/record-detail"
import { Section } from "@/components/erp/section"

import { ActionDialogContent } from "@/components/erp/action-dialog"

import { PageHeader, pageClass, Surface, TableToolbar } from "@/components/erp/page"
import { TablePagination } from "@/components/erp/pagination"

import { Select } from "@/components/erp/controls"

import * as React from "react"
import {
  ColumnDef,
  SortingState,
  VisibilityState,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table"
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon, MoreHorizontalIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import Link from "next/link"
import { toast } from "sonner"

import { LeaveRequestDetailsDialog } from "../request-details-dialog"
import { DataTable } from "@/components/data-table"
import { FormField } from "@/components/form-field"
import { SearchableSelect } from "@/components/searchable-select"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { useFormErrors } from "@/hooks/use-form-errors"
import type { ListResponse } from "@/types/api"
import type { LeaveRequestRow, LeaveRequestStatus } from "@/types/leaves"

type PaginationState = { pageIndex: number; pageSize: number }

type LeaveRequestFormValues = {
  leaveDefinitionId: string
  startDate: string
  endDate: string
  reason: string
}

const defaultFormValues: LeaveRequestFormValues = {
  leaveDefinitionId: "",
  startDate: "",
  endDate: "",
  reason: "",
}

const statusOptions: Array<LeaveRequestStatus | "all"> = [
  "all",
  "PENDING",
  "APPROVED",
  "REJECTED",
  "CANCELED",
  "REVOKED",
]

const sortFieldMap: Record<string, "startDate" | "endDate" | "status" | "daysCount" | "createdAt" | "updatedAt"> =
  {
    startDate: "startDate",
    endDate: "endDate",
    status: "status",
    daysCount: "daysCount",
    createdAt: "createdAt",
    updatedAt: "updatedAt",
  }

const SortIndicator = ({ value }: { value: false | "asc" | "desc" }) => {
  if (value === "asc") return <ArrowUpIcon className="h-4 w-4" />
  if (value === "desc") return <ArrowDownIcon className="h-4 w-4" />
  return <ArrowUpDownIcon className="h-4 w-4" />
}

export default function LeaveRequestsPage() {
  const { formatDateOnly, formatDateTime } = useDateFormatter()
  const { can, enabled } = useBusinessModules()
  const canCreate = useCurrentResourceAction("create")
  const canArchive = useCurrentResourceAction("archive")

  const { data: session } = useSession()
  const router = useRouter()
  const role = (session?.user as { role?: string })?.role
  const canManage = role === "MANAGER"

  React.useEffect(() => {
    if (role === "ADMIN") {
      router.replace("/leaves/approvals")
    }
  }, [role, router])

  const [formError, setFormError] = React.useState("")
  const [loading, setLoading] = React.useState(true)
  const [rows, setRows] = React.useState<LeaveRequestRow[]>([])
  const [totalRows, setTotalRows] = React.useState(0)
  const [search, setSearch] = React.useState("")
  const [statusFilter, setStatusFilter] = React.useState<LeaveRequestStatus | "all">("all")
  const [sorting, setSorting] = React.useState<SortingState>([{ id: "createdAt", desc: true }])
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({
    staff: true,
    leave: true,
    range: true,
    days: true,
    status: true,
    reason: true,
    createdAt: true,
  })
  const [pagination, setPagination] = React.useState<PaginationState>({ pageIndex: 0, pageSize: 10 })
  const [createOpen, setCreateOpen] = React.useState(false)
  const [creating, setCreating] = React.useState(false)
  const [formValues, setFormValues] = React.useState<LeaveRequestFormValues>(defaultFormValues)
  const [leaveOptions, setLeaveOptions] = React.useState<Array<{ value: string; label: string }>>([])
  const [cancelOpen, setCancelOpen] = React.useState(false)
  const [canceling, setCanceling] = React.useState(false)
  const [cancelReason, setCancelReason] = React.useState("")
  const [cancelTarget, setCancelTarget] = React.useState<LeaveRequestRow | null>(null)
  const [detailOpen, setDetailOpen] = React.useState(false)
  const [detailRequestId, setDetailRequestId] = React.useState<string | null>(null)
  const { errors, setErrorsFromResponse, clearErrors } = useFormErrors()

  const loadLeaveOptions = React.useCallback(async () => {
    const response = await fetch("/api/leaves/request-options", { cache: "no-store" })
    if (!response.ok) {
      setLeaveOptions([])
      return
    }
    const data = (await response.json()) as { items?: Array<{ value: string; label: string }> }
    setLeaveOptions(data.items ?? [])
  }, [])

  const loadRows = React.useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    params.set("page", String(pagination.pageIndex + 1))
    params.set("pageSize", String(pagination.pageSize))
    params.set("mineOnly", "true")
    if (search.trim()) params.set("q", search.trim())
    if (statusFilter !== "all") params.set("status", statusFilter)
    const sortField = sorting[0] ? sortFieldMap[sorting[0].id] : undefined
    if (sortField && sorting[0]) {
      params.set("sort", sortField)
      params.set("order", sorting[0].desc ? "desc" : "asc")
    }

    const response = await fetch(`/api/leaves/requests?${params.toString()}`, { cache: "no-store" })
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string }
      toast.error(data.error ?? "Unable to load leave requests.")
      setRows([])
      setTotalRows(0)
      setLoading(false)
      return
    }

    const data = (await response.json()) as ListResponse<LeaveRequestRow>
    setRows(data.items)
    setTotalRows(data.total)
    setLoading(false)
  }, [pagination.pageIndex, pagination.pageSize, search, sorting, statusFilter])

  React.useEffect(() => {
    void loadRows()
  }, [loadRows])

  React.useEffect(() => {
    void loadLeaveOptions()
  }, [loadLeaveOptions])

  React.useEffect(() => {
    setPagination((prev) => (prev.pageIndex === 0 ? prev : { ...prev, pageIndex: 0 }))
  }, [search, sorting, statusFilter])

  const requestCancel = React.useCallback((item: LeaveRequestRow) => {
    setCancelTarget(item)
    setCancelReason("")
    setCancelOpen(true)
  }, [])

  const openDetails = React.useCallback((item: LeaveRequestRow) => {
    setDetailRequestId(item.id)
    setDetailOpen(true)
  }, [])

  const confirmCancel = React.useCallback(async () => {
    if (!cancelTarget) return
    setCanceling(true)
    const response = await fetch(`/api/leaves/requests/${cancelTarget.id}/cancel`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cancelReason }),
    })
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string }
      toast.error(data.error ?? "Unable to cancel leave request.")
      setCanceling(false)
      return
    }
    toast.success("Leave request canceled.")
    setCanceling(false)
    setCancelOpen(false)
    setCancelTarget(null)
    await loadRows()
  }, [cancelReason, cancelTarget, loadRows])

  const createRequest = async () => {
    setFormError(""); setCreating(true)
    try {
      clearErrors()
      const response = await fetch("/api/leaves/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formValues),
      })
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: string
          details?: { fieldErrors?: Record<string, string[]> }
        }
        setErrorsFromResponse(data)
        setFormError(data.error ?? "Unable to create leave request."); toast.error(data.error ?? "Unable to create leave request.")
        setCreating(false)
        return
      }
      toast.success("Leave request submitted.")
      setFormValues(defaultFormValues)
      setCreating(false)
      setCreateOpen(false)
      await loadRows()
    } catch {
      setFormError("Unable to save. Please try again.")
    } finally {
      setCreating(false)
    }
  }

  const columns = React.useMemo<ColumnDef<LeaveRequestRow>[]>(
    () => [
      {
        id: "staff",
        meta: { label: "Staff" },
        header: "Staff",
        cell: ({ row }) => row.original.staff.name || row.original.staff.email,
      },
      {
        id: "leave",
        meta: { label: "Leave type" },
        header: "Leave type",
        cell: ({ row }) => `${row.original.leaveDefinition.code} - ${row.original.leaveDefinition.name}`,
      },
      {
        id: "range",
        meta: { label: "Date range" },
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-2 text-sm font-medium"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Date range
            <SortIndicator value={column.getIsSorted()} />
          </button>
        ),
        accessorFn: (row) => row.startDate,
        cell: ({ row }) =>
          `${formatDateOnly(row.original.startDate)} - ${formatDateOnly(row.original.endDate)}`,
      },
      {
        accessorKey: "daysCount",
        meta: { label: "Days" },
        header: "Days",
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
      },
      {
        accessorKey: "reason",
        meta: { label: "Reason" },
        header: "Reason",
        cell: ({ row }) => row.original.reason || "-",
      },
      {
        accessorKey: "createdAt",
        meta: { label: "Requested" },
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-2 text-sm font-medium"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Requested
            <SortIndicator value={column.getIsSorted()} />
          </button>
        ),
        cell: ({ row }) => formatDateTime(row.original.createdAt),
      },
      {
        id: "actions",
        header: "",
        enableHiding: false,
        cell: ({ row }) => {
          const canCancel = canArchive && (row.original.status === "PENDING" || row.original.status === "APPROVED")
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" aria-label="Record actions">
                  <MoreHorizontalIcon className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={() => openDetails(row.original)}
                >
                  View details
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!canCancel}
                  className={canCancel ? "text-destructive" : undefined}
                  onSelect={() => requestCancel(row.original)}
                >
                  Cancel request
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )
        },
      },
    ],
    [openDetails, requestCancel, canArchive, formatDateOnly, formatDateTime]
  )

  const totalPages = Math.max(1, Math.ceil(totalRows / pagination.pageSize))
  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, columnVisibility, globalFilter: search, pagination },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onGlobalFilterChange: setSearch,
    onPaginationChange: setPagination,
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    pageCount: totalPages,
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <div className={pageClass}>
      <PageHeader title={<> Leave Requests </>} description={<> Submit leave requests and track approval status. </>} actions={<> <div className="flex items-center gap-2">
          {canManage && enabled("leaves") && can("leaveApprovals.read") ? (
            <Button variant="outline" asChild>
              <Link href="/leaves/approvals">Approval queue</Link>
            </Button>
          ) : null}
          <Button disabled={!canCreate} onClick={() => { setFormError(""); setCreateOpen(true) }}>Apply leave</Button>
        </div> </>} />

      <Surface>
      <TableToolbar table={table} searchPlaceholder="Search by reason or leave type">
        <Select
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          value={statusFilter}
          onValueChange={(value) => setStatusFilter(value as LeaveRequestStatus | "all")}
        >
          {statusOptions.map((item) => (
            <option key={item} value={item}>
              {item === "all" ? "All statuses" : item}
            </option>
          ))}
        </Select>
      </TableToolbar>

      <DataTable table={table} loading={loading} emptyMessage="No leave requests found." />
      <TablePagination table={table} totalRows={totalRows} />
      </Surface>

      {canCreate && createOpen && <DraftPanel title="Apply leave" description="Submit a leave request for review." fingerprint={formValues} saving={creating} error={formError} saveLabel="Submit request" onClose={() => { setCreateOpen(false); setFormValues(defaultFormValues); clearErrors() }} onSubmit={() => void createRequest()}><Section title="Request details"><div className="grid gap-3">
            <FormField id="leave-definition-id" label="Leave type" error={errors.leaveDefinitionId}>
              <SearchableSelect
                id="leave-definition-id"
                value={formValues.leaveDefinitionId}
                onChange={(value) => setFormValues((prev) => ({ ...prev, leaveDefinitionId: value }))}
                options={leaveOptions}
                placeholder="Select leave type"
                searchPlaceholder="Search leave type..."
              />
            </FormField>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField id="leave-start-date" label="Start date" error={errors.startDate}>
                <Input
                  id="leave-start-date"
                  type="date"
                  value={formValues.startDate}
                  onChange={(event) =>
                    setFormValues((prev) => ({ ...prev, startDate: event.target.value }))
                  }
                />
              </FormField>
              <FormField id="leave-end-date" label="End date" error={errors.endDate}>
                <Input
                  id="leave-end-date"
                  type="date"
                  value={formValues.endDate}
                  onChange={(event) =>
                    setFormValues((prev) => ({ ...prev, endDate: event.target.value }))
                  }
                />
              </FormField>
            </div>
            <FormField id="leave-reason" label="Reason" error={errors.reason}>
              <Input
                id="leave-reason"
                value={formValues.reason}
                onChange={(event) =>
                  setFormValues((prev) => ({ ...prev, reason: event.target.value }))
                }
                placeholder="Optional"
              />
            </FormField>
          </div></Section></DraftPanel>}

      <Dialog
        open={cancelOpen}
        onOpenChange={(open) => {
          setCancelOpen(open)
          if (!open) {
            setCancelReason("")
            setCancelTarget(null)
          }
        }}
      >
        <ActionDialogContent title={<>Cancel leave request</>} description={<>{cancelTarget
                ? `Cancel ${cancelTarget.leaveDefinition.code} request from ${formatDateOnly(cancelTarget.startDate)} to ${formatDateOnly(cancelTarget.endDate)}?`
                : "Cancel this leave request?"}</>} className="sm:max-w-md" actions={<> <Button variant="outline" onClick={() => setCancelOpen(false)} disabled={canceling}>
              Back
            </Button><Button variant="destructive" onClick={() => void confirmCancel()} disabled={canceling}>
              {canceling ? "Canceling..." : "Cancel request"}
            </Button> </>}><FormField id="cancel-reason" label="Cancel reason (optional)">
            <Input
              id="cancel-reason"
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value)}
            />
          </FormField></ActionDialogContent>
      </Dialog>

      <LeaveRequestDetailsDialog
        requestId={detailRequestId}
        open={detailOpen}
        onOpenChange={(open) => {
          setDetailOpen(open)
          if (!open) setDetailRequestId(null)
        }}
      />
    </div>
  )
}
