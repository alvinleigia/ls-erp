"use client"
import { useDateFormatter } from "@/hooks/use-date-formatter"
import { useCurrentResourceAction } from "@/platform/access/view-guard"

import { ActionDialogContent } from "@/components/erp/action-dialog"

import { PageHeader, pageClass, Surface, TableToolbar } from "@/components/erp/page"
import { TablePagination } from "@/components/erp/pagination"

import { Select } from "@/components/erp/controls"

import * as React from "react"
import Link from "next/link"
import {
  ColumnDef,
  SortingState,
  VisibilityState,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table"
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon, MoreHorizontalIcon } from "lucide-react"
import { toast } from "sonner"

import { DataTable } from "@/components/data-table"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { ListResponse } from "@/types/api"
import type { LeaveGroupAssignmentMode, LeaveGroupRow, LeaveGroupStatus } from "@/types/leaves"

type PaginationState = { pageIndex: number; pageSize: number }

const sortFieldMap: Record<string, "code" | "name" | "assignmentMode" | "status" | "sortOrder" | "updatedAt"> = {
  code: "code",
  name: "name",
  assignmentMode: "assignmentMode",
  status: "status",
  sortOrder: "sortOrder",
  updatedAt: "updatedAt",
}

const assignmentModeOptions: LeaveGroupAssignmentMode[] = ["ALL_STAFF", "SELECTED_STAFF"]
const statusOptions: LeaveGroupStatus[] = ["ACTIVE", "INACTIVE"]

const SortIndicator = ({ value }: { value: false | "asc" | "desc" }) => {
  if (value === "asc") return <ArrowUpIcon className="h-4 w-4" />
  if (value === "desc") return <ArrowDownIcon className="h-4 w-4" />
  return <ArrowUpDownIcon className="h-4 w-4" />
}

export default function LeaveGroupsPage() {
  const canCreate = useCurrentResourceAction("create")
  const { formatDateTime } = useDateFormatter()
  const canArchive = useCurrentResourceAction("archive")

  const [loading, setLoading] = React.useState(true)
  const [rows, setRows] = React.useState<LeaveGroupRow[]>([])
  const [totalRows, setTotalRows] = React.useState(0)
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [deleteTarget, setDeleteTarget] = React.useState<LeaveGroupRow | null>(null)
  const [search, setSearch] = React.useState("")
  const [assignmentModeFilter, setAssignmentModeFilter] =
    React.useState<LeaveGroupAssignmentMode | "all">("all")
  const [statusFilter, setStatusFilter] = React.useState<LeaveGroupStatus | "all">("all")
  const [sorting, setSorting] = React.useState<SortingState>([{ id: "sortOrder", desc: false }])
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({
    code: true,
    name: true,
    assignmentMode: true,
    status: true,
    leaves: true,
    staff: true,
    updatedAt: true,
  })
  const [pagination, setPagination] = React.useState<PaginationState>({ pageIndex: 0, pageSize: 10 })

  const loadRows = React.useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    params.set("page", String(pagination.pageIndex + 1))
    params.set("pageSize", String(pagination.pageSize))
    if (search.trim()) params.set("q", search.trim())
    if (assignmentModeFilter !== "all") params.set("assignmentMode", assignmentModeFilter)
    if (statusFilter !== "all") params.set("status", statusFilter)
    const sortField = sorting[0] ? sortFieldMap[sorting[0].id] : undefined
    if (sortField && sorting[0]) {
      params.set("sort", sortField)
      params.set("order", sorting[0].desc ? "desc" : "asc")
    }

    const response = await fetch(`/api/leaves/groups?${params.toString()}`, { cache: "no-store" })
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string }
      toast.error(data.error ?? "Unable to load leave groups.")
      setRows([])
      setTotalRows(0)
      setLoading(false)
      return
    }

    const data = (await response.json()) as ListResponse<LeaveGroupRow>
    setRows(data.items)
    setTotalRows(data.total)
    setLoading(false)
  }, [assignmentModeFilter, pagination.pageIndex, pagination.pageSize, search, sorting, statusFilter])

  React.useEffect(() => {
    void loadRows()
  }, [loadRows])

  React.useEffect(() => {
    setPagination((prev) => (prev.pageIndex === 0 ? prev : { ...prev, pageIndex: 0 }))
  }, [assignmentModeFilter, search, sorting, statusFilter])

  const handlePaginationChange = React.useCallback(
    (updater: PaginationState | ((prev: PaginationState) => PaginationState)) => {
      setPagination((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater
        if (next.pageSize !== prev.pageSize) return { ...next, pageIndex: 0 }
        return next
      })
    },
    []
  )

  const requestDelete = React.useCallback((row: LeaveGroupRow) => {
    setDeleteTarget(row)
    setDeleteOpen(true)
  }, [])

  const confirmDelete = React.useCallback(async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const response = await fetch(`/api/leaves/groups/${deleteTarget.id}`, {
        method: "DELETE",
      })
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string }
        toast.error(data.error ?? "Unable to delete leave group.")
        setDeleting(false)
        return
      }
      toast.success("Leave group deleted.")
      setDeleting(false)
      setDeleteOpen(false)
      setDeleteTarget(null)
      await loadRows()
    } catch {
      toast.error("Unable to complete this action. Please try again.")
    } finally {
      setDeleting(false)
    }
  }, [deleteTarget, loadRows])

  const columns = React.useMemo<ColumnDef<LeaveGroupRow>[]>(
    () => [
      {
        accessorKey: "code",
        meta: { label: "Code" },
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-2 text-sm font-medium"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Code
            <SortIndicator value={column.getIsSorted()} />
          </button>
        ),
      },
      {
        accessorKey: "name",
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
        cell: ({ row }) => <Link className="font-medium underline underline-offset-4" href={`/leaves/groups/${row.original.id}`}>{row.original.name}</Link>,
      },
      { accessorKey: "assignmentMode", meta: { label: "Assignment" }, header: "Assignment" },
      { accessorKey: "status", meta: { label: "Status" }, header: "Status" },
      {
        id: "leaves",
        meta: { label: "Leaves" },
        header: "Leaves",
        cell: ({ row }) => row.original.leaveDefinitions.length,
      },
      {
        id: "staff",
        meta: { label: "Employees" },
        header: "Employees",
        cell: ({ row }) =>
          row.original.assignmentMode === "ALL_STAFF"
            ? "All staff"
            : row.original.assignedStaff.length,
      },
      {
        accessorKey: "updatedAt",
        meta: { label: "Updated" },
        header: "Updated",
        cell: ({ row }) => formatDateTime(row.original.updatedAt),
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
              <DropdownMenuItem asChild>
                <Link href={`/leaves/groups/${row.original.id}`}>View details</Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive"
                disabled={!canArchive} onSelect={() => requestDelete(row.original)}
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [requestDelete, canArchive, formatDateTime]
  )

  const totalPages = Math.max(1, Math.ceil(totalRows / pagination.pageSize))
  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, columnVisibility, globalFilter: search, pagination },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onGlobalFilterChange: setSearch,
    onPaginationChange: handlePaginationChange,
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    pageCount: totalPages,
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <div className={pageClass}>
      <PageHeader title={<> Leave Groups </>} description={<> Bundle leave definitions and assign them to all or selected employees. </>} actions={<> <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link href="/leaves">Leave definitions</Link>
          </Button>
          {canCreate && <Button asChild>
            <Link href="/leaves/groups/new">New leave group</Link>
          </Button>}
        </div> </>} />

      <Surface>
      <TableToolbar table={table} searchPlaceholder="Search by code or name">
        <Select
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          value={assignmentModeFilter}
          onValueChange={(value) =>
            setAssignmentModeFilter(value as LeaveGroupAssignmentMode | "all")
          }
        >
          <option value="all">All assignment modes</option>
          {assignmentModeOptions.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </Select>
        <Select
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          value={statusFilter}
          onValueChange={(value) => setStatusFilter(value as LeaveGroupStatus | "all")}
        >
          <option value="all">All status</option>
          {statusOptions.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </Select>
      </TableToolbar>

      <DataTable table={table} loading={loading} emptyMessage="No leave groups found." />
      <TablePagination table={table} totalRows={totalRows} />
      </Surface>

      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => {
          setDeleteOpen(open)
          if (!open) {
            setDeleteTarget(null)
            setDeleting(false)
          }
        }}
      >
        <ActionDialogContent title={<>Delete leave group</>} description={<>{deleteTarget
                ? `Delete "${deleteTarget.name}"? This cannot be undone.`
                : "Delete this leave group? This cannot be undone."}</>} className="sm:max-w-md" actions={<> <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleting}>
              Cancel
            </Button><Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
              {deleting ? "Deleting..." : "Delete"}
            </Button> </>}></ActionDialogContent>
      </Dialog>
    </div>
  )
}
