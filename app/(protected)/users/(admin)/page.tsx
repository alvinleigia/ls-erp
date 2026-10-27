"use client"

import * as React from "react"
import { useSession } from "next-auth/react"
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

import { InitialOfficeAccess, initialOfficeReady } from "@/platform/companies/initial-office-access"
import type { MembershipValidation } from "@/platform/companies/membership-choice"
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
import { canInvite, type Role } from "@/lib/permissions"
import type { ListResponse } from "@/types/api"
import type { UserFormValues, UserRow, UserStatus } from "@/types/users"
import { OfficeMembershipEditor } from "@/platform/companies/membership-editor"
import { UserFormFields } from "./user-form-fields"
import {
  defaultUserFormValues,
  roleOptions,
  statusOptions,
  toDateInput,
} from "./user-form-model"

const SortIndicator = ({ value }: { value: false | "asc" | "desc" }) => {
  if (value === "asc") return <ArrowUpIcon className="h-4 w-4" />
  if (value === "desc") return <ArrowDownIcon className="h-4 w-4" />
  return <ArrowUpDownIcon className="h-4 w-4" />
}

export default function UsersPage() {
  type PaginationState = { pageIndex: number; pageSize: number }

  const { data: session } = useSession()
  const currentRole = (session?.user as { role?: Role })?.role ?? null
  const canManage = canInvite(currentRole)
  const sessionUserId = session?.user?.id

  const [search, setSearch] = React.useState("")
  const [roleFilter, setRoleFilter] = React.useState<"all" | Role>("all")
  const [statusFilter, setStatusFilter] = React.useState<"all" | UserStatus>("all")

  const [users, setUsers] = React.useState<UserRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [officeValidation, setOfficeValidation] = React.useState<MembershipValidation | null>(null)
  const [officeDenied, setOfficeDenied] = React.useState(false)
  const [officeRefresh, setOfficeRefresh] = React.useState(0)
  const denyOffice = React.useCallback(() => setOfficeDenied(true), [])
  const [creating, setCreating] = React.useState(false)
  const [updating, setUpdating] = React.useState(false)
  const [createOpen, setCreateOpen] = React.useState(false)
  const [editOpen, setEditOpen] = React.useState(false)
  const [officeUser, setOfficeUser] = React.useState<UserRow | null>(null)
  const [editingUser, setEditingUser] = React.useState<UserRow | null>(null)
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
  const [totalRows, setTotalRows] = React.useState(0)

  const [sorting, setSorting] = React.useState<SortingState>([])
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([])
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({
    name: true,
    email: true,
    phone: true,
    role: true,
    status: true,
  })
  const [pagination, setPagination] = React.useState({ pageIndex: 0, pageSize: 10 })

  const [newUser, setNewUser] = React.useState<UserFormValues>(defaultUserFormValues)
  const [editValues, setEditValues] = React.useState<UserFormValues>(defaultUserFormValues)

  const totalPages = Math.max(1, Math.ceil(totalRows / pagination.pageSize))

  const loadUsers = React.useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    params.set("page", String(pagination.pageIndex + 1))
    params.set("pageSize", String(pagination.pageSize))
    if (search) {
      params.set("q", search)
    }
    if (roleFilter !== "all") {
      params.set("role", roleFilter)
    }
    if (statusFilter !== "all") {
      params.set("status", statusFilter)
    }
    if (sorting[0]) {
      params.set("sort", sorting[0].id)
      params.set("order", sorting[0].desc ? "desc" : "asc")
    }
    const response = await fetch(`/api/users?${params.toString()}`)
    if (!response.ok) {
      toast.error("Unable to load users.")
      setUsers([])
      setTotalRows(0)
      setLoading(false)
      return
    }
    const data = (await response.json()) as ListResponse<UserRow>
    setUsers(data.items)
    setTotalRows(data.total)
    setLoading(false)
  }, [
    pagination.pageIndex,
    pagination.pageSize,
    roleFilter,
    search,
    sorting,
    statusFilter,
  ])

  React.useEffect(() => {
    void loadUsers()
  }, [loadUsers])


  React.useEffect(() => {
    setPagination((prev) =>
      prev.pageIndex === 0 ? prev : { ...prev, pageIndex: 0 }
    )
  }, [roleFilter, search, sorting, statusFilter])

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

  const startEdit = React.useCallback((user: UserRow) => {
    setEditingUser(user)
    clearEditErrors()
    setEditValues({
      name: user.name ?? "",
      email: user.email,
      phone: user.phone ?? "",
      image: user.image ?? "",
      dateOfBirth: toDateInput(user.dateOfBirth),
      gender: user.gender ?? "PREFER_NOT_TO_SAY",
      status: user.status ?? "ACTIVE",
      marketingOptIn: user.role === "STAFF" ? false : Boolean(user.marketingOptIn),
      addressLine1: user.addressLine1 ?? "",
      addressLine2: user.addressLine2 ?? "",
      city: user.city ?? "",
      state: user.state ?? "",
      postalCode: user.postalCode ?? "",
      country: user.country ?? "",
      role: user.role,
      password: "",
    })
    setEditOpen(true)
  }, [clearEditErrors])

  const saveEdit = async () => {
    if (!editingUser) return
    setUpdating(true)
    clearEditErrors()
    const response = await fetch(`/api/users/${editingUser.id}`, {
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
      toast.error(data.error ?? "Unable to update user.")
      setUpdating(false)
      return
    }

    toast.success("User updated.")
    setUpdating(false)
    setEditOpen(false)
    setEditingUser(null)
    await loadUsers()
  }

  const officeReady = !officeDenied && initialOfficeReady(newUser.role, newUser.status, newUser.officeAccess, officeValidation)
  const createUser = async () => {
    if (!officeReady || creating) return
    if (!canManage) return
    setCreating(true)
    clearCreateErrors()
    try {
      const response = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newUser),
      })

      if (!response.ok) {
        const data = (await response.json()) as {
          error?: string
          details?: { fieldErrors?: Record<string, string[]> }
        }
        setCreateErrorsFromResponse(data)
        if ([401, 403].includes(response.status)) setOfficeDenied(true)
        setOfficeValidation(null); setOfficeRefresh(value => value+1)
        toast.error(data.error ?? "Unable to create user.")
        return
      }

      toast.success("User created.")
      setNewUser(defaultUserFormValues)
      setCreateOpen(false)
      await loadUsers()
    } catch {
      toast.error("Unable to confirm the request. Check the list before trying again.")
      setOfficeValidation(null); setOfficeRefresh(value => value+1)
    } finally { setCreating(false) }
  }

  const canEditUser = React.useCallback(
    (user: UserRow) => canManage || sessionUserId === user.id,
    [canManage, sessionUserId]
  )

  const canEditProfile =
    canManage || Boolean(editingUser && sessionUserId === editingUser.id)

  const columns = React.useMemo<ColumnDef<UserRow>[]>(
    () => [
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
        cell: ({ row }) => (
          <button
            type="button"
            className="text-left text-sm font-medium text-primary underline-offset-4 hover:underline"
            onClick={() => window.location.assign(`/users/${row.original.id}`)}
          >
            {row.original.name ?? "-"}
          </button>
        ),
      },
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
        accessorKey: "phone",
        meta: { label: "Phone" },
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-2 text-sm font-medium"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Phone
            <SortIndicator value={column.getIsSorted()} />
          </button>
        ),
        cell: ({ row }) => row.original.phone ?? "-",
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
        filterFn: (row, id, value) => (value ? row.getValue(id) === value : true),
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
        cell: ({ row }) => row.original.status ?? "ACTIVE",
        filterFn: (row, id, value) => (value ? row.getValue(id) === value : true),
      },
      {
        id: "actions",
        header: "",
        enableHiding: false,
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" disabled={!canEditUser(row.original)}>
                <MoreHorizontalIcon className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() => startEdit(row.original)}
                disabled={!canEditUser(row.original)}
              >
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => window.location.assign(`/users/${row.original.id}`)}
              >
                View details
              </DropdownMenuItem>
              {canManage && ["ADMIN", "MANAGER", "STAFF"].includes(row.original.role) && <DropdownMenuItem onSelect={() => setOfficeUser(row.original)}>Office access</DropdownMenuItem>}
              {!row.original.collaboratorId && ["STAFF", "MANAGER"].includes(row.original.role) ? (
                <DropdownMenuItem
                  onSelect={() => window.location.assign(`/users/${row.original.id}/staff`)}
                >
                  Staff profile
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [canEditUser, canManage, startEdit]
  )

  const table = useReactTable({
    data: users,
    columns,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      globalFilter: search,
      pagination,
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onGlobalFilterChange: setSearch,
    onPaginationChange: handlePaginationChange,
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    pageCount: totalPages,
    getCoreRowModel: getCoreRowModel(),
  })

  const handleRoleFilter = (value: "all" | Role) => {
    setRoleFilter(value)
    table.getColumn("role")?.setFilterValue(value === "all" ? undefined : value)
  }

  const handleStatusFilter = (value: "all" | UserStatus) => {
    setStatusFilter(value)
    table.getColumn("status")?.setFilterValue(value === "all" ? undefined : value)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Users</h1>
          <p className="text-sm text-muted-foreground">
            Manage users, roles, and password resets.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => { setNewUser(defaultUserFormValues); setOfficeValidation(null); setOfficeDenied(false); setCreateOpen(true) }} disabled={!canManage}>
            New user
          </Button>
        </div>
      </div>

      <DataTableToolbar table={table} searchPlaceholder="Search by name, email, or phone">
        <select
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          value={roleFilter}
          onChange={(event) => handleRoleFilter(event.target.value as Role | "all")}
        >
          <option value="all">All roles</option>
          {roleOptions.map((role) => (
            <option key={role} value={role}>
              {role}
            </option>
          ))}
        </select>
        <select
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          value={statusFilter}
          onChange={(event) => handleStatusFilter(event.target.value as UserStatus | "all")}
        >
          <option value="all">All status</option>
          {statusOptions.map((status) => (
            <option key={status} value={status}>
              {status.replaceAll("_", " ")}
            </option>
          ))}
        </select>
      </DataTableToolbar>

      <DataTable table={table} loading={loading} emptyMessage="No users found." />

      <DataTablePagination table={table} totalRows={totalRows} />

      {officeUser && <OfficeMembershipEditor key={officeUser.id} user={officeUser} onClose={() => setOfficeUser(null)} onSaved={() => setOfficeUser(null)} />}
      <Dialog open={createOpen} onOpenChange={open => { if (!creating) setCreateOpen(open) }}>
        <DialogContent className="max-h-[90vh] flex flex-col overflow-y-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>Create user</DialogTitle>
            <DialogDescription>
              Add a new user and assign a role.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <fieldset disabled={creating} className="min-w-0 space-y-5">
              <UserFormFields
                mode="create"
                values={newUser}
                errors={createErrors}
                onChange={setNewUser}
                canManage={canManage}
                canEditProfile={true}
              />
              <InitialOfficeAccess role={newUser.role} status={newUser.status} draft={newUser.officeAccess} onChange={officeAccess => setNewUser(previous => ({ ...previous, officeAccess }))} validation={officeValidation} onValidation={setOfficeValidation} onDenied={denyOffice} denied={officeDenied} saving={creating} refresh={officeRefresh} />
            </fieldset>
          </div>

          <DialogFooter className="shrink-0 pt-2">
            <Button variant="outline" disabled={creating} onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={createUser} disabled={!officeReady} loading={creating} loadingText="Creating...">
              Create user
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editOpen}
        onOpenChange={(open) => {
          setEditOpen(open)
          if (!open) {
            setEditingUser(null)
            clearEditErrors()
          }
        }}
      >
        <DialogContent className="max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Edit user</DialogTitle>
            <DialogDescription>Update details or reset a password.</DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto">
            <UserFormFields
              mode="edit"
              values={editValues}
              errors={editErrors}
              onChange={setEditValues}
              canManage={canManage}
              canEditProfile={canEditProfile}
            />
          </div>

          <DialogFooter className="pt-2">
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveEdit} loading={updating} loadingText="Saving...">
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
