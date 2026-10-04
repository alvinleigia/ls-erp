"use client"
import { useBusinessModules } from "@/platform/module-provider"
import { useCurrentResourceAction } from "@/platform/access/view-guard"

import { ActionDialogContent } from "@/components/erp/action-dialog"

import { PageHeader, pageClass, Surface, TableToolbar } from "@/components/erp/page"
import { TablePagination } from "@/components/erp/pagination"

import { Select, Checkbox } from "@/components/erp/controls"

import * as React from "react"
import {
  ColumnDef,
  RowSelectionState,
  SortingState,
  VisibilityState,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table"
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon, MoreHorizontalIcon } from "lucide-react"
import Link from "next/link"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { LeaveRequestDetailsDialog } from "../request-details-dialog"
import { DataTable } from "@/components/data-table"
import { FormField } from "@/components/form-field"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import type { ListResponse } from "@/types/api"
import type { LeaveRequestRow, LeaveRequestStatus } from "@/types/leaves"

type PaginationState = { pageIndex: number; pageSize: number }
type LeaveApprovalConflict = {
  requestId: string
  conflictCount: number
  conflictingAppointments: Array<{
    id: string
    startAt: string
    endAt: string
    customerName: string | null
    serviceName: string | null
  }>
}

type ConflictAppointmentPreview = {
  id: string
  startAt: string
  endAt: string
  customerName: string | null
  serviceName: string | null
}
type ConflictResolutionContext =
  | {
      mode: "single"
      item: LeaveRequestRow
      reviewerComment: string
      conflicts: LeaveApprovalConflict[]
    }
  | {
      mode: "bulk"
      items: LeaveRequestRow[]
      reviewerComment: string
      conflicts: LeaveApprovalConflict[]
    }

const sortFieldMap: Record<string, "startDate" | "endDate" | "status" | "daysCount" | "createdAt" | "updatedAt"> =
  {
    startDate: "startDate",
    endDate: "endDate",
    status: "status",
    daysCount: "daysCount",
    createdAt: "createdAt",
    updatedAt: "updatedAt",
  }

const statusOptions: Array<LeaveRequestStatus | "all"> = [
  "all",
  "PENDING",
  "APPROVED",
  "REJECTED",
  "CANCELED",
  "REVOKED",
]

const SortIndicator = ({ value }: { value: false | "asc" | "desc" }) => {
  if (value === "asc") return <ArrowUpIcon className="h-4 w-4" />
  if (value === "desc") return <ArrowDownIcon className="h-4 w-4" />
  return <ArrowUpDownIcon className="h-4 w-4" />
}

export default function LeaveApprovalsPage() {
  const { can, enabled } = useBusinessModules()
  const canApprove = useCurrentResourceAction("approve")
  const canArchive = useCurrentResourceAction("archive")

  const { data: session } = useSession()
  const role = (session?.user as { role?: string })?.role
  const canManage = role === "ADMIN" || role === "MANAGER"
  const router = useRouter()

  const [loading, setLoading] = React.useState(true)
  const [rows, setRows] = React.useState<LeaveRequestRow[]>([])
  const [totalRows, setTotalRows] = React.useState(0)
  const [search, setSearch] = React.useState("")
  const [statusFilter, setStatusFilter] = React.useState<LeaveRequestStatus | "all">("PENDING")
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
  const [processing, setProcessing] = React.useState(false)
  const [rejectOpen, setRejectOpen] = React.useState(false)
  const [rejectComment, setRejectComment] = React.useState("")
  const [rejectTargets, setRejectTargets] = React.useState<LeaveRequestRow[]>([])
  const [revokeOpen, setRevokeOpen] = React.useState(false)
  const [revokeReason, setRevokeReason] = React.useState("")
  const [revokeTarget, setRevokeTarget] = React.useState<LeaveRequestRow | null>(null)
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({})
  const [detailOpen, setDetailOpen] = React.useState(false)
  const [detailRequestId, setDetailRequestId] = React.useState<string | null>(null)
  const [conflictDialogOpen, setConflictDialogOpen] = React.useState(false)
  const [conflictResolution, setConflictResolution] = React.useState<ConflictResolutionContext | null>(
    null
  )
  const [rescheduleDate, setRescheduleDate] = React.useState("")
  const [rescheduleTime, setRescheduleTime] = React.useState("")

  const buildApprovalConflictMessage = React.useCallback((conflicts: LeaveApprovalConflict[]) => {
    if (!conflicts.length) return "Active appointments overlap this leave date range."
    const first = conflicts[0]
    const countText =
      first.conflictCount > 1
        ? `${first.conflictCount} appointments`
        : `${first.conflictCount} appointment`
    const firstAppointment = first.conflictingAppointments?.[0]
    if (!firstAppointment) {
      return `Cannot approve due to ${countText} on this leave date range.`
    }
    const startsAt = new Date(firstAppointment.startAt).toLocaleString()
    const service = firstAppointment.serviceName ?? "Service"
    const customer = firstAppointment.customerName ?? "Customer"
    return `Cannot approve due to ${countText}. Example: ${service} for ${customer} at ${startsAt}.`
  }, [])

  const collectConflictAppointmentIds = React.useCallback((conflicts: LeaveApprovalConflict[]) => {
    return Array.from(
      new Set(
        conflicts.flatMap((item) => item.conflictingAppointments.map((appointment) => appointment.id))
      )
    )
  }, [])

  const conflictAppointments = React.useMemo<ConflictAppointmentPreview[]>(() => {
    const map = new Map<string, ConflictAppointmentPreview>()
    for (const conflict of conflictResolution?.conflicts ?? []) {
      for (const appointment of conflict.conflictingAppointments) {
        if (!map.has(appointment.id)) {
          map.set(appointment.id, appointment)
        }
      }
    }
    return Array.from(map.values()).sort(
      (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime()
    )
  }, [conflictResolution?.conflicts])

  const reschedulePreview = React.useMemo(() => {
    if (!rescheduleDate || !rescheduleTime || conflictAppointments.length === 0) return []
    const nextStart = new Date(`${rescheduleDate}T${rescheduleTime}:00`)
    if (Number.isNaN(nextStart.getTime())) return []

    const firstStart = new Date(conflictAppointments[0].startAt).getTime()
    return conflictAppointments.map((appointment) => {
      const originalStart = new Date(appointment.startAt)
      const originalEnd = new Date(appointment.endAt)
      const durationMinutes = Math.max(
        1,
        Math.round((originalEnd.getTime() - originalStart.getTime()) / 60000)
      )
      const offsetMinutes = Math.round((originalStart.getTime() - firstStart) / 60000)
      const proposedStart = new Date(nextStart)
      proposedStart.setMinutes(proposedStart.getMinutes() + offsetMinutes)
      const proposedEnd = new Date(proposedStart)
      proposedEnd.setMinutes(proposedEnd.getMinutes() + durationMinutes)
      return {
        ...appointment,
        proposedStart,
        proposedEnd,
      }
    })
  }, [conflictAppointments, rescheduleDate, rescheduleTime])

  React.useEffect(() => {
    if (role && !canManage) {
      router.replace("/leaves/requests")
    }
  }, [canManage, role, router])

  const loadRows = React.useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    params.set("page", String(pagination.pageIndex + 1))
    params.set("pageSize", String(pagination.pageSize))
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
      toast.error(data.error ?? "Unable to load leave approval queue.")
      setRows([])
      setTotalRows(0)
      setLoading(false)
      return
    }
    const data = (await response.json()) as ListResponse<LeaveRequestRow>
    setRows(data.items)
    setTotalRows(data.total)
    setRowSelection({})
    setLoading(false)
  }, [pagination.pageIndex, pagination.pageSize, search, sorting, statusFilter])

  React.useEffect(() => {
    if (canManage) {
      void loadRows()
    }
  }, [canManage, loadRows])

  React.useEffect(() => {
    setPagination((prev) => (prev.pageIndex === 0 ? prev : { ...prev, pageIndex: 0 }))
  }, [search, sorting, statusFilter])

  const reviewRequest = React.useCallback(
    async (
      item: LeaveRequestRow,
      status: "APPROVED" | "REJECTED",
      reviewerComment = "",
      enableConflictDialog = true
    ): Promise<boolean> => {
      setProcessing(true)
      const response = await fetch(`/api/leaves/requests/${item.id}/review`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, reviewerComment }),
      })
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: string
          conflicts?: LeaveApprovalConflict[]
        }
        if (response.status === 409 && data.conflicts?.length && enableConflictDialog && status === "APPROVED") {
          setConflictResolution({
            mode: "single",
            item,
            reviewerComment,
            conflicts: data.conflicts,
          })
          setConflictDialogOpen(true)
          toast.error(buildApprovalConflictMessage(data.conflicts))
        } else {
          toast.error(data.error ?? "Unable to review leave request.")
        }
        setProcessing(false)
        return false
      }
      toast.success(status === "APPROVED" ? "Leave request approved." : "Leave request rejected.")
      setProcessing(false)
      await loadRows()
      return true
    },
    [buildApprovalConflictMessage, loadRows]
  )

  const reviewBulkRequests = React.useCallback(
    async (
      items: LeaveRequestRow[],
      status: "APPROVED" | "REJECTED",
      reviewerComment = "",
      enableConflictDialog = true
    ): Promise<boolean> => {
      if (!items.length) return false
      setProcessing(true)
      const response = await fetch("/api/leaves/requests/review-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestIds: items.map((item) => item.id),
          status,
          reviewerComment,
        }),
      })
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: string
          conflicts?: LeaveApprovalConflict[]
        }
        if (response.status === 409 && data.conflicts?.length && enableConflictDialog && status === "APPROVED") {
          setConflictResolution({
            mode: "bulk",
            items,
            reviewerComment,
            conflicts: data.conflicts,
          })
          setConflictDialogOpen(true)
          toast.error(buildApprovalConflictMessage(data.conflicts))
        } else {
          toast.error(data.error ?? "Unable to bulk review leave requests.")
        }
        setProcessing(false)
        return false
      }
      const data = (await response.json()) as { updatedCount?: number; skippedCount?: number }
      const updatedCount = data.updatedCount ?? 0
      const skippedCount = data.skippedCount ?? 0
      toast.success(
        `${updatedCount} request(s) ${status === "APPROVED" ? "approved" : "rejected"}${skippedCount ? `, ${skippedCount} skipped` : ""}.`
      )
      setProcessing(false)
      await loadRows()
      return true
    },
    [buildApprovalConflictMessage, loadRows]
  )

  const openDetails = React.useCallback((item: LeaveRequestRow) => {
    setDetailRequestId(item.id)
    setDetailOpen(true)
  }, [])

  const openReject = React.useCallback((item: LeaveRequestRow) => {
    setRejectTargets([item])
    setRejectComment("")
    setRejectOpen(true)
  }, [])

  const openRevoke = React.useCallback((item: LeaveRequestRow) => {
    setRevokeTarget(item)
    setRevokeReason("")
    setRevokeOpen(true)
  }, [])

  const openBulkReject = React.useCallback((items: LeaveRequestRow[]) => {
    if (!items.length) return
    setRejectTargets(items)
    setRejectComment("")
    setRejectOpen(true)
  }, [])

  const confirmReject = React.useCallback(async () => {
    if (!rejectTargets.length) return
    if (!rejectComment.trim()) {
      toast.error("Comment is required to reject a leave request.")
      return
    }
    if (rejectTargets.length === 1) {
      await reviewRequest(rejectTargets[0], "REJECTED", rejectComment)
    } else {
      await reviewBulkRequests(rejectTargets, "REJECTED", rejectComment)
    }
    setRejectOpen(false)
    setRejectTargets([])
    setRejectComment("")
  }, [rejectComment, rejectTargets, reviewBulkRequests, reviewRequest])

  const confirmRevoke = React.useCallback(async () => {
    if (!revokeTarget) return
    if (!revokeReason.trim()) {
      toast.error("Reason is required to revoke an approved leave request.")
      return
    }
    setProcessing(true)
    const response = await fetch(`/api/leaves/requests/${revokeTarget.id}/revoke`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revokeReason }),
    })
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string }
      toast.error(data.error ?? "Unable to revoke leave request.")
      setProcessing(false)
      return
    }
    toast.success("Approved leave revoked.")
    setProcessing(false)
    setRevokeOpen(false)
    setRevokeReason("")
    setRevokeTarget(null)
    await loadRows()
  }, [loadRows, revokeReason, revokeTarget])

  const resolveConflictsAndApprove = React.useCallback(async (action: "cancel" | "reschedule") => {
    if (!conflictResolution) return
    const appointmentIds = collectConflictAppointmentIds(conflictResolution.conflicts)
    if (!appointmentIds.length) {
      toast.error("No conflicting appointments were found to cancel.")
      return
    }
    if (action === "reschedule") {
      if (!rescheduleDate || !rescheduleTime) {
        toast.error("Select reschedule date and time.")
        return
      }
    }
    setProcessing(true)
    const resolveResponse = await fetch("/api/appointments/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        appointmentIds,
        ...(action === "reschedule"
          ? { rescheduleDate, rescheduleTime }
          : {}),
      }),
    })
    if (!resolveResponse.ok) {
      const data = (await resolveResponse.json().catch(() => ({}))) as { error?: string }
      toast.error(
        data.error ??
          (action === "reschedule"
            ? "Unable to reschedule conflicting appointments."
            : "Unable to cancel conflicting appointments.")
      )
      setProcessing(false)
      return
    }

    let approved = false
    if (conflictResolution.mode === "single") {
      approved = await reviewRequest(
        conflictResolution.item,
        "APPROVED",
        conflictResolution.reviewerComment,
        false
      )
    } else {
      approved = await reviewBulkRequests(
        conflictResolution.items,
        "APPROVED",
        conflictResolution.reviewerComment,
        false
      )
    }

    if (approved) {
      setConflictDialogOpen(false)
      setConflictResolution(null)
      setRescheduleDate("")
      setRescheduleTime("")
    }
    setProcessing(false)
  }, [
    collectConflictAppointmentIds,
    conflictResolution,
    rescheduleDate,
    rescheduleTime,
    reviewBulkRequests,
    reviewRequest,
  ])

  const columns = React.useMemo<ColumnDef<LeaveRequestRow>[]>(
    () => [
      {
        id: "select",
        enableHiding: false,
        header: ({ table }) => (
          <Checkbox
            checked={table.getIsAllPageRowsSelected()}
            onChange={(event) => table.toggleAllPageRowsSelected(event.target.checked)}
            aria-label="Select all"
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            disabled={!row.getCanSelect()}
            onChange={(event) => row.toggleSelected(event.target.checked)}
            aria-label="Select row"
          />
        ),
      },
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
          `${new Date(row.original.startDate).toLocaleDateString()} - ${new Date(row.original.endDate).toLocaleDateString()}`,
      },
      {
        accessorKey: "daysCount",
        meta: { label: "Days" },
        header: "Days",
      },
      {
        accessorKey: "status",
        meta: { label: "Status" },
        header: "Status",
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
        cell: ({ row }) => new Date(row.original.createdAt).toLocaleString(),
      },
      {
        id: "actions",
        header: "",
        enableHiding: false,
        cell: ({ row }) => {
          const canReview = canApprove && row.original.status === "PENDING"
          const canRevoke = canArchive && row.original.status === "APPROVED"
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Record actions"
                  disabled={processing}
                >
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
                  disabled={!canReview || processing}
                  onSelect={() => void reviewRequest(row.original, "APPROVED")}
                >
                  Approve
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive"
                  disabled={!canReview || processing}
                  onSelect={() => openReject(row.original)}
                >
                  Reject
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive"
                  disabled={!canRevoke || processing}
                  onSelect={() => openRevoke(row.original)}
                >
                  Revoke approval
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )
        },
      },
    ],
    [openDetails, openReject, openRevoke, processing, reviewRequest, canApprove, canArchive]
  )

  const totalPages = Math.max(1, Math.ceil(totalRows / pagination.pageSize))
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, columnVisibility, globalFilter: search, pagination, rowSelection },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onGlobalFilterChange: setSearch,
    onPaginationChange: setPagination,
    onRowSelectionChange: setRowSelection,
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    enableRowSelection: (row) => canApprove && row.original.status === "PENDING",
    pageCount: totalPages,
    getCoreRowModel: getCoreRowModel(),
  })
  const selectedPendingRows = table
    .getSelectedRowModel()
    .rows.map((row) => row.original)
    .filter((row) => row.status === "PENDING")

  if (!canManage) {
    return null
  }

  return (
    <div className={pageClass}>
      <PageHeader title={<> Leave Approvals </>} description={<> Review and process pending leave requests. </>} actions={<> {can("leaveRequests.read") && <Button variant="outline" asChild>
          <Link href="/leaves/requests">My requests</Link>
        </Button>} </>} />

      <Surface>
      <TableToolbar table={table} searchPlaceholder="Search by staff, leave or reason">
        <Button
          variant="outline"
          disabled={!canApprove || !selectedPendingRows.length || processing}
          onClick={() => void reviewBulkRequests(selectedPendingRows, "APPROVED")}
        >
          Approve selected
        </Button>
        <Button
          variant="outline"
          className="text-destructive"
          disabled={!canApprove || !selectedPendingRows.length || processing}
          onClick={() => openBulkReject(selectedPendingRows)}
        >
          Reject selected
        </Button>
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

      <Dialog
        open={rejectOpen}
        onOpenChange={(open) => {
          setRejectOpen(open)
          if (!open) {
            setRejectTargets([])
            setRejectComment("")
          }
        }}
      >
        <ActionDialogContent title={<>{rejectTargets.length > 1 ? "Reject selected leave requests" : "Reject leave request"}</>} description={<>Add a reason for rejection. This comment will be shared with staff.
            </>} className="sm:max-w-md" actions={<> <Button variant="outline" onClick={() => setRejectOpen(false)} disabled={processing}>
              Back
            </Button><Button variant="destructive" onClick={() => void confirmReject()} disabled={processing}>
              {processing ? "Rejecting..." : "Reject"}
            </Button> </>}><FormField id="reject-comment" label="Comment">
            <Input
              id="reject-comment"
              value={rejectComment}
              onChange={(event) => setRejectComment(event.target.value)}
              placeholder="Reason for rejection"
            />
          </FormField></ActionDialogContent>
      </Dialog>

      <Dialog
        open={revokeOpen}
        onOpenChange={(open) => {
          setRevokeOpen(open)
          if (!open) {
            setRevokeReason("")
            setRevokeTarget(null)
          }
        }}
      >
        <ActionDialogContent title={<>Revoke approved leave</>} description={<>{revokeTarget
                ? `Revoke ${revokeTarget.leaveDefinition.code} from ${new Date(revokeTarget.startDate).toLocaleDateString()} to ${new Date(revokeTarget.endDate).toLocaleDateString()}?`
                : "Revoke this approved leave request?"}</>} className="sm:max-w-md" actions={<> <Button variant="outline" onClick={() => setRevokeOpen(false)} disabled={processing}>
              Back
            </Button><Button variant="destructive" onClick={() => void confirmRevoke()} disabled={processing}>
              {processing ? "Revoking..." : "Revoke"}
            </Button> </>}><FormField id="revoke-reason" label="Reason">
            <Input
              id="revoke-reason"
              value={revokeReason}
              onChange={(event) => setRevokeReason(event.target.value)}
              placeholder="Reason for revocation"
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

      <Dialog
        open={conflictDialogOpen}
        onOpenChange={(open) => {
          setConflictDialogOpen(open)
          if (!open) {
            setConflictResolution(null)
            setRescheduleDate("")
            setRescheduleTime("")
          }
        }}
      >
        <ActionDialogContent title={<>Conflicting appointments found</>} description={<>Leave approval overlaps active appointments. Cancel conflicts to proceed with approval.
            </>} className="sm:max-w-2xl" actions={<> <Button
              variant="outline"
              onClick={() => {
                setConflictDialogOpen(false)
                setConflictResolution(null)
              }}
              disabled={processing}
            >
              Close
            </Button><Button
              variant="destructive"
              onClick={() => void resolveConflictsAndApprove("cancel")}
              disabled={!canApprove || !enabled("appointments") || !can("appointments.archive") || processing}
            >
              {processing ? "Processing..." : "Cancel conflicts and approve"}
            </Button><Button
              onClick={() => void resolveConflictsAndApprove("reschedule")}
              disabled={!canApprove || !enabled("appointments") || !enabled("services") || !can("services.read") || !can("appointments.edit") || processing}
            >
              {processing ? "Processing..." : "Reschedule conflicts and approve"}
            </Button> </>}><div className="max-h-80 space-y-3 overflow-y-auto pr-1">
            {(conflictResolution?.conflicts ?? []).map((conflict) => (
              <div key={conflict.requestId} className="rounded-md border p-3">
                <p className="text-sm font-medium">
                  Request {conflict.requestId}: {conflict.conflictCount} conflicting appointment(s)
                </p>
                <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                  {conflict.conflictingAppointments.map((appointment) => (
                    <p key={appointment.id}>
                      {new Date(appointment.startAt).toLocaleString()} -{" "}
                      {new Date(appointment.endAt).toLocaleTimeString()} |{" "}
                      {appointment.serviceName ?? "Service"} |{" "}
                      {appointment.customerName ?? "Customer"}
                    </p>
                  ))}
                </div>
              </div>
            ))}
          </div><div className="grid gap-3 sm:grid-cols-2">
            <FormField id="reschedule-date" label="Reschedule date">
              <Input
                id="reschedule-date"
                type="date"
                value={rescheduleDate}
                onChange={(event) => setRescheduleDate(event.target.value)}
              />
            </FormField>
            <FormField id="reschedule-time" label="Reschedule start time">
              <Input
                id="reschedule-time"
                type="time"
                value={rescheduleTime}
                onChange={(event) => setRescheduleTime(event.target.value)}
              />
            </FormField>
          </div>{reschedulePreview.length > 0 ? (
            <div className="rounded-md border p-3">
              <p className="text-sm font-medium">Proposed reschedule preview</p>
              <div className="mt-2 max-h-40 space-y-1 overflow-y-auto text-sm text-muted-foreground">
                {reschedulePreview.map((appointment) => (
                  <p key={appointment.id}>
                    {appointment.serviceName ?? "Service"} | {appointment.customerName ?? "Customer"} |{" "}
                    {appointment.proposedStart.toLocaleString()} -{" "}
                    {appointment.proposedEnd.toLocaleTimeString()}
                  </p>
                ))}
              </div>
            </div>
          ) : null}</ActionDialogContent>
      </Dialog>
    </div>
  )
}
