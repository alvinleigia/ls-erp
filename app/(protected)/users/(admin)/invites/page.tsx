"use client"

import * as React from "react"
import {
  ColumnDef,
  SortingState,
  VisibilityState,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table"
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon, MoreHorizontalIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  DataTable,
  DataTablePagination,
  DataTableToolbar,
} from "@/components/data-table"
import { useFormErrors } from "@/hooks/use-form-errors"
import { useDateFormatter } from "@/hooks/use-date-formatter"
import type { ListResponse } from "@/types/api"
import type { InviteRow, InviteStatusFilter } from "@/types/invites"
import { InviteFormFields } from "./invite-form-fields"
import { ConfirmAction } from "@/components/erp/confirm-action"
import {
  defaultInviteFormValues,
  type InviteFormValues,
} from "./invite-form-model"

const SortIndicator = ({ value }: { value: false | "asc" | "desc" }) => {
  if (value === "asc") return <ArrowUpIcon className="h-4 w-4" />
  if (value === "desc") return <ArrowDownIcon className="h-4 w-4" />
  return <ArrowUpDownIcon className="h-4 w-4" />
}

export default function InvitesPage() {
  const { formatDate } = useDateFormatter()
  type PaginationState = { pageIndex: number; pageSize: number }

  const [inviteOpen, setInviteOpen] = React.useState(false)
  const [invites, setInvites] = React.useState<InviteRow[]>([])
  const {
    errors: inviteErrors,
    setErrorsFromResponse: setInviteErrorsFromResponse,
    clearErrors: clearInviteErrors,
  } = useFormErrors()
  const [inviting, setInviting] = React.useState(false)
  const [revokeTarget, setRevokeTarget] = React.useState<string | null>(null)
  const [revoking, setRevoking] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [totalRows, setTotalRows] = React.useState(0)

  const [sorting, setSorting] = React.useState<SortingState>([])
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({})
  const [pagination, setPagination] = React.useState({ pageIndex: 0, pageSize: 10 })
  const [search, setSearch] = React.useState("")
  const [statusFilter, setStatusFilter] = React.useState<InviteStatusFilter>("pending")

  const [inviteValues, setInviteValues] = React.useState<InviteFormValues>(
    defaultInviteFormValues
  )

  const totalPages = Math.max(1, Math.ceil(totalRows / pagination.pageSize))

  const loadInvites = React.useCallback(async () => {
    setLoading(true)
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
    const response = await fetch(`/api/invites?${params.toString()}`)
    if (!response.ok) {
      toast.error("Unable to load invites.")
      setLoading(false)
      return
    }
    const data = (await response.json()) as ListResponse<InviteRow>
    setInvites(data.items)
    setTotalRows(data.total)
    setLoading(false)
  }, [pagination.pageIndex, pagination.pageSize, search, sorting, statusFilter])

  React.useEffect(() => {
    void loadInvites()
  }, [loadInvites])

  React.useEffect(() => {
    setPagination((prev) =>
      prev.pageIndex === 0 ? prev : { ...prev, pageIndex: 0 }
    )
  }, [search, sorting, statusFilter])

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

  const sendInvite = async () => {
    setInviting(true)
    clearInviteErrors()
    const response = await fetch("/api/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(inviteValues),
    })

    if (!response.ok) {
      const data = (await response.json()) as {
        error?: string
        details?: { fieldErrors?: Record<string, string[]> }
      }
      setInviteErrorsFromResponse(data)
      toast.error(data.error ?? "Unable to send invite.")
      setInviting(false)
      return
    }

    const result = await response.json() as { emailSent: boolean; warning?: string }
    if (result.warning) toast.warning(result.warning)
    else toast.success(result.emailSent ? "Invite sent." : "Invitation link created. Use Copy invite link from the list.")
    setInviteValues(defaultInviteFormValues)
    setInviting(false)
    setInviteOpen(false)
    await loadInvites()
  }

  const copyInviteLink = React.useCallback(async (invite: InviteRow) => {
    const origin = window.location.origin
    const link = `${origin}/auth/invite?token=${invite.token}`
    await navigator.clipboard.writeText(link)
    toast.success("Invite link copied.")
  }, [])

  const revokeInvite = React.useCallback(async (inviteId: string) => {
    setRevoking(true)
    try {
      const response = await fetch(`/api/invites/${inviteId}`, { method: "DELETE" })
      if (!response.ok) { toast.error((await response.json()).error || "Unable to revoke invite."); return }
      toast.success("Invite revoked.")
      setInvites((prev) => prev.filter((invite) => invite.id !== inviteId))
      setTotalRows(prev => Math.max(0, prev - 1))
      setRevokeTarget(null)
    } finally { setRevoking(false) }
  }, [])

  const columns = React.useMemo<ColumnDef<InviteRow>[]>(
    () => [
      {
        accessorKey: "email",
        meta: { label: "Email" },
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-2 text-sm font-medium"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Email
            <SortIndicator value={column.getIsSorted()} />
          </button>
        ),
      },
      {
        accessorKey: "role",
        meta: { label: "Role" },
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-2 text-sm font-medium"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Role
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
        accessorKey: "expiresAt",
        meta: { label: "Expires" },
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-2 text-sm font-medium"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Expires
            <SortIndicator value={column.getIsSorted()} />
          </button>
        ),
        cell: ({ row }) => formatDate(row.original.expiresAt),
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => {
          const status = row.original.acceptedAt
            ? "Accepted"
            : new Date(row.original.expiresAt) < new Date()
              ? "Expired"
              : "Pending"
          return status
        },
      },
      {
        id: "actions",
        header: "",
        enableHiding: false,
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" disabled={Boolean(row.original.acceptedAt)}>
                <MoreHorizontalIcon className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void copyInviteLink(row.original)}>
                Copy invite link
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive"
                onSelect={() => setRevokeTarget(row.original.id)}
              >
                Revoke invite
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [copyInviteLink, formatDate]
  )

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: invites,
    columns,
    state: { sorting, columnVisibility, pagination, globalFilter: search },
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
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Invites</h1>
          <p className="text-sm text-muted-foreground">
            Track pending invitations and revoke access.
          </p>
        </div>
        <Button onClick={() => setInviteOpen(true)}>Invite user</Button>
      </div>

      <DataTableToolbar table={table} searchPlaceholder="Search by email">
        <select
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          value={statusFilter}
          onChange={(event) =>
            setStatusFilter(
              event.target.value as "all" | "pending" | "accepted" | "expired"
            )
          }
        >
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="accepted">Accepted</option>
          <option value="expired">Expired</option>
        </select>
      </DataTableToolbar>

      <DataTable table={table} loading={loading} emptyMessage="No invites yet." />

      <DataTablePagination table={table} totalRows={totalRows} />

      {revokeTarget && <ConfirmAction title="Revoke invitation?" description="This link will stop working. You can create a new invitation later." label="Revoke invitation" busy={revoking} destructive onCancel={() => setRevokeTarget(null)} onConfirm={() => void revokeInvite(revokeTarget)} />}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Invite user</DialogTitle>
            <DialogDescription>
              Send a secure invite link to set a password.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto">
            <InviteFormFields
              values={inviteValues}
              errors={inviteErrors}
              onChange={setInviteValues}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>
              Cancel
            </Button>
            <Button onClick={sendInvite} loading={inviting} loadingText={inviteValues.delivery === "EMAIL" ? "Sending..." : "Creating..."}>
              {inviteValues.delivery === "EMAIL" ? "Send invite" : "Create invite link"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
