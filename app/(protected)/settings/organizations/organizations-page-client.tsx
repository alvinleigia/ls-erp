"use client"

import * as React from "react"
import { ColumnDef, getCoreRowModel, useReactTable } from "@tanstack/react-table"
import { MoreHorizontalIcon, PlusIcon } from "lucide-react"
import { toast } from "sonner"

import { DataTable, DataTablePagination, DataTableToolbar } from "@/components/data-table"
import { FormField } from "@/components/form-field"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { useFormErrors } from "@/hooks/use-form-errors"
import type { ListResponse } from "@/types/api"

type PaginationState = { pageIndex: number; pageSize: number }

type OrganizationRow = {
  id: string
  name: string
  slug: string
  tenantCount: number
  memberCount: number
  createdAt: string
}

type OrganizationCreateFormValues = {
  name: string
  slug: string
}

type OrganizationMemberStatus = "ACTIVE" | "SUSPENDED" | "INVITED" | "ARCHIVED"
type OrganizationMemberRole = "OWNER" | "ADMIN" | "VIEWER"

type OrganizationMemberRow = {
  id: string
  role: OrganizationMemberRole
  userId: string
  name: string | null
  email: string
  phone: string | null
  userStatus: OrganizationMemberStatus
  createdAt: string
}

type OrganizationMemberCreateFormValues = {
  name: string
  email: string
  phone: string
  role: OrganizationMemberRole
  password: string
}

type OrganizationMemberEditFormValues = {
  name: string
  email: string
  phone: string
  role: OrganizationMemberRole
  status: OrganizationMemberStatus
  password: string
}

const defaultFormValues: OrganizationCreateFormValues = {
  name: "",
  slug: "",
}

const defaultMemberFormValues: OrganizationMemberCreateFormValues = {
  name: "",
  email: "",
  phone: "",
  role: "ADMIN",
  password: "",
}

const defaultMemberEditValues: OrganizationMemberEditFormValues = {
  name: "",
  email: "",
  phone: "",
  role: "ADMIN",
  status: "ACTIVE",
  password: "",
}

const formatDateTime = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return date.toLocaleString()
}

type OrganizationsPageClientProps = {
  platformAccessMode: "SUPER_ADMIN" | "ORG_MEMBER"
  organizationRolesById: Record<string, "OWNER" | "ADMIN" | "VIEWER">
}

export default function OrganizationsPageClient({
  platformAccessMode,
  organizationRolesById,
}: OrganizationsPageClientProps) {
  const canCreateOrganizations = platformAccessMode === "SUPER_ADMIN"
  const [items, setItems] = React.useState<OrganizationRow[]>([])
  const [totalRows, setTotalRows] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [creating, setCreating] = React.useState(false)
  const [search, setSearch] = React.useState("")
  const [pagination, setPagination] = React.useState<PaginationState>({ pageIndex: 0, pageSize: 10 })
  const [createOpen, setCreateOpen] = React.useState(false)
  const [membersOpen, setMembersOpen] = React.useState(false)
  const [memberEditorOpen, setMemberEditorOpen] = React.useState(false)
  const [memberDeleteOpen, setMemberDeleteOpen] = React.useState(false)
  const [selectedOrganization, setSelectedOrganization] = React.useState<OrganizationRow | null>(null)
  const [memberItems, setMemberItems] = React.useState<OrganizationMemberRow[]>([])
  const [membersLoading, setMembersLoading] = React.useState(false)
  const [memberCreating, setMemberCreating] = React.useState(false)
  const [memberSavingId, setMemberSavingId] = React.useState<string | null>(null)
  const [memberResettingId, setMemberResettingId] = React.useState<string | null>(null)
  const [memberDeletingId, setMemberDeletingId] = React.useState<string | null>(null)
  const [editingMember, setEditingMember] = React.useState<OrganizationMemberRow | null>(null)
  const [pendingDeleteMember, setPendingDeleteMember] = React.useState<OrganizationMemberRow | null>(null)
  const [formValues, setFormValues] = React.useState<OrganizationCreateFormValues>(defaultFormValues)
  const [memberFormValues, setMemberFormValues] = React.useState<OrganizationMemberCreateFormValues>(defaultMemberFormValues)
  const [memberEditValues, setMemberEditValues] = React.useState<OrganizationMemberEditFormValues>(defaultMemberEditValues)
  const { errors, setErrorsFromResponse, clearErrors } = useFormErrors()
  const {
    errors: memberErrors,
    setErrorsFromResponse: setMemberErrorsFromResponse,
    clearErrors: clearMemberErrors,
  } = useFormErrors()
  const {
    errors: memberEditErrors,
    setErrorsFromResponse: setMemberEditErrorsFromResponse,
    clearErrors: clearMemberEditErrors,
  } = useFormErrors()

  const selectedOrganizationRole = selectedOrganization
    ? organizationRolesById[selectedOrganization.id]
    : undefined
  const canManageMembersInSelectedOrganization =
    platformAccessMode === "SUPER_ADMIN" ||
    selectedOrganizationRole === "OWNER" ||
    selectedOrganizationRole === "ADMIN"
  const canAssignOwnerRole =
    platformAccessMode === "SUPER_ADMIN" || selectedOrganizationRole === "OWNER"

  const loadOrganizations = React.useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    params.set("page", String(pagination.pageIndex + 1))
    params.set("pageSize", String(pagination.pageSize))
    if (search.trim()) params.set("q", search.trim())

    const response = await fetch(`/api/organizations?${params.toString()}`, { cache: "no-store" })
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string }
      toast.error(data.error ?? "Unable to load organizations.")
      setItems([])
      setTotalRows(0)
      setLoading(false)
      return
    }

    const data = (await response.json()) as ListResponse<OrganizationRow>
    setItems(data.items)
    setTotalRows(data.total)
    setLoading(false)
  }, [pagination.pageIndex, pagination.pageSize, search])

  React.useEffect(() => {
    void loadOrganizations()
  }, [loadOrganizations])

  React.useEffect(() => {
    setPagination((prev) =>
      prev.pageIndex === 0 ? prev : { ...prev, pageIndex: 0 }
    )
  }, [search])

  const loadOrganizationMembers = React.useCallback(async (organizationId: string) => {
    setMembersLoading(true)
    const response = await fetch(
      `/api/organizations/${organizationId}/members?page=1&pageSize=100`,
      { cache: "no-store" }
    )
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string }
      toast.error(data.error ?? "Unable to load organization members.")
      setMemberItems([])
      setMembersLoading(false)
      return
    }

    const data = (await response.json()) as ListResponse<OrganizationMemberRow>
    setMemberItems(data.items)
    setMembersLoading(false)
  }, [])

  const refreshOrganizationMembers = React.useCallback(async () => {
    if (!selectedOrganization) return
    await Promise.all([
      loadOrganizations(),
      loadOrganizationMembers(selectedOrganization.id),
    ])
  }, [loadOrganizations, loadOrganizationMembers, selectedOrganization])

  const createOrganization = async () => {
    setCreating(true)
    clearErrors()
    const response = await fetch("/api/organizations", {
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
      toast.error(data.error ?? "Unable to create organization.")
      setCreating(false)
      return
    }

    toast.success("Organization created.")
    setCreating(false)
    setCreateOpen(false)
    setFormValues(defaultFormValues)
    await loadOrganizations()
  }

  const openMembersDialog = React.useCallback(async (organization: OrganizationRow) => {
    clearMemberErrors()
    clearMemberEditErrors()
    setSelectedOrganization(organization)
    setMemberFormValues(defaultMemberFormValues)
    setMemberEditValues(defaultMemberEditValues)
    setEditingMember(null)
    setPendingDeleteMember(null)
    setMembersOpen(true)
    await loadOrganizationMembers(organization.id)
  }, [clearMemberErrors, clearMemberEditErrors, loadOrganizationMembers])

  const createMember = async () => {
    if (!selectedOrganization) return
    setMemberCreating(true)
    clearMemberErrors()
    const response = await fetch(`/api/organizations/${selectedOrganization.id}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(memberFormValues),
    })
    const data = (await response.json().catch(() => ({}))) as {
      error?: string
      details?: { fieldErrors?: Record<string, string[]> }
      onboarding?: { delivery: "email" | "manual"; resetUrl?: string }
    }
    if (!response.ok) {
      setMemberErrorsFromResponse(data)
      toast.error(data.error ?? "Unable to add organization member.")
      setMemberCreating(false)
      return
    }

    if (data.onboarding?.delivery === "manual" && data.onboarding.resetUrl) {
      try {
        await navigator.clipboard.writeText(data.onboarding.resetUrl)
        toast.success("Member invited. Reset link copied to clipboard.")
      } catch {
        toast.success("Member invited. Reset link was generated.")
      }
    } else if (data.onboarding?.delivery === "email") {
      toast.success("Member invited. Reset link sent by email.")
    } else {
      toast.success("Organization member added.")
    }

    setMemberCreating(false)
    setMemberFormValues(defaultMemberFormValues)
    await refreshOrganizationMembers()
  }

  const openEditMemberDialog = (member: OrganizationMemberRow) => {
    clearMemberEditErrors()
    setEditingMember(member)
    setMemberEditValues({
      name: member.name ?? "",
      email: member.email,
      phone: member.phone ?? "",
      role: member.role,
      status: member.userStatus,
      password: "",
    })
    setMemberEditorOpen(true)
  }

  const saveMemberDetails = async () => {
    if (!selectedOrganization || !editingMember) return
    setMemberSavingId(editingMember.id)
    clearMemberEditErrors()
    const response = await fetch(
      `/api/organizations/${selectedOrganization.id}/members/${editingMember.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(memberEditValues),
      }
    )
    const data = (await response.json().catch(() => ({}))) as {
      error?: string
      details?: { fieldErrors?: Record<string, string[]> }
    }
    if (!response.ok) {
      setMemberEditErrorsFromResponse(data)
      toast.error(data.error ?? "Unable to update organization member.")
      setMemberSavingId(null)
      return
    }

    toast.success("Organization member updated.")
    setMemberSavingId(null)
    setMemberEditorOpen(false)
    setEditingMember(null)
    setMemberEditValues(defaultMemberEditValues)
    await refreshOrganizationMembers()
  }

  const sendMemberReset = async (member: OrganizationMemberRow) => {
    if (!selectedOrganization) return
    setMemberResettingId(member.id)
    const response = await fetch(
      `/api/organizations/${selectedOrganization.id}/members/${member.id}/reset`,
      {
        method: "POST",
      }
    )
    const data = (await response.json().catch(() => ({}))) as {
      error?: string
      delivery?: "email" | "manual"
      resetUrl?: string
    }
    if (!response.ok) {
      toast.error(data.error ?? "Unable to send member reset.")
      setMemberResettingId(null)
      return
    }

    if (data.delivery === "manual" && data.resetUrl) {
      try {
        await navigator.clipboard.writeText(data.resetUrl)
        toast.success("Reset link copied to clipboard.")
      } catch {
        toast.success("Reset link generated.")
      }
    } else {
      toast.success("Reset link sent by email.")
    }
    setMemberResettingId(null)
  }

  const removeMember = async () => {
    if (!selectedOrganization || !pendingDeleteMember) return
    setMemberDeletingId(pendingDeleteMember.id)
    const response = await fetch(
      `/api/organizations/${selectedOrganization.id}/members/${pendingDeleteMember.id}`,
      {
        method: "DELETE",
      }
    )
    const data = (await response.json().catch(() => ({}))) as {
      error?: string
      userArchived?: boolean
    }
    if (!response.ok) {
      toast.error(data.error ?? "Unable to remove organization member.")
      setMemberDeletingId(null)
      return
    }

    toast.success(
      data.userArchived
        ? "Organization member removed and user archived."
        : "Organization member removed."
    )
    setMemberDeletingId(null)
    setMemberDeleteOpen(false)
    setPendingDeleteMember(null)
    await refreshOrganizationMembers()
  }

  const columns = React.useMemo<ColumnDef<OrganizationRow>[]>(
    () => [
      {
        id: "name",
        meta: { label: "Name" },
        header: "Name",
        accessorFn: (row) => row.name,
      },
      {
        id: "slug",
        meta: { label: "Slug" },
        header: "Slug",
        accessorFn: (row) => row.slug,
      },
      {
        id: "tenantCount",
        meta: { label: "Tenants" },
        header: "Tenants",
        accessorFn: (row) => row.tenantCount,
      },
      {
        id: "memberCount",
        meta: { label: "Members" },
        header: "Members",
        accessorFn: (row) => row.memberCount,
      },
      {
        id: "createdAt",
        meta: { label: "Created" },
        header: "Created",
        accessorFn: (row) => formatDateTime(row.createdAt),
      },
      {
        id: "actions",
        meta: { label: "Actions" },
        header: "",
        cell: ({ row }) => {
          const organization = row.original
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost">
                  <MoreHorizontalIcon className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => void openMembersDialog(organization)}>
                  Manage members
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )
        },
      },
    ],
    [openMembersDialog]
  )

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: items,
    columns,
    state: { pagination, globalFilter: search },
    onGlobalFilterChange: setSearch,
    onPaginationChange: (updater) => {
      setPagination((prev) =>
        typeof updater === "function" ? (updater(prev as never) as PaginationState) : updater
      )
    },
    getCoreRowModel: getCoreRowModel(),
    manualFiltering: true,
    manualPagination: true,
    pageCount: Math.max(1, Math.ceil(totalRows / pagination.pageSize)),
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">Organizations</h1>
          <p className="text-sm text-muted-foreground">
            Manage parent companies that will own groups of business tenants.
          </p>
        </div>
        {canCreateOrganizations ? (
          <Button
            className="shrink-0"
            onClick={() => {
              clearErrors()
              setFormValues(defaultFormValues)
              setCreateOpen(true)
            }}
          >
            <PlusIcon className="mr-2 h-4 w-4" />
            New organization
          </Button>
        ) : null}
      </div>

      <DataTableToolbar table={table} searchPlaceholder="Search name or slug" />
      <DataTable table={table} loading={loading} emptyMessage="No organizations found." />
      <DataTablePagination table={table} totalRows={totalRows} />

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open)
          if (!open) {
            clearErrors()
            setFormValues(defaultFormValues)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New organization</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-sm text-muted-foreground">
              This creates the parent-company record. Child business tenants can be linked from the
              tenant management screen.
            </div>
            <FormField id="organization-name" label="Organization name" error={errors.name}>
              <Input
                id="organization-name"
                value={formValues.name}
                onChange={(event) =>
                  setFormValues((prev) => ({ ...prev, name: event.target.value }))
                }
              />
            </FormField>
            <FormField id="organization-slug" label="Organization slug" error={errors.slug}>
              <Input
                id="organization-slug"
                value={formValues.slug}
                onChange={(event) =>
                  setFormValues((prev) => ({
                    ...prev,
                    slug: event.target.value.trim().toLowerCase(),
                  }))
                }
                placeholder="parent-company-a"
              />
            </FormField>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void createOrganization()}
              loading={creating}
              loadingText="Creating..."
            >
              Create organization
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={membersOpen}
        onOpenChange={(open) => {
          setMembersOpen(open)
          if (!open) {
            setSelectedOrganization(null)
            setMemberItems([])
            setMemberFormValues(defaultMemberFormValues)
            setMemberEditValues(defaultMemberEditValues)
            setEditingMember(null)
            setPendingDeleteMember(null)
            clearMemberErrors()
            clearMemberEditErrors()
          }
        }}
      >
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              {selectedOrganization
                ? `Organization members: ${selectedOrganization.name}`
                : "Organization members"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6">
            <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-sm text-muted-foreground">
              Members created here can sign in on the platform domain and will only see the
              parent-company console for their own organization scope.
            </div>

            {canManageMembersInSelectedOrganization ? (
              <div className="space-y-3">
                <h2 className="text-sm font-semibold">Add member</h2>
                <div className="grid gap-3 md:grid-cols-2">
                  <FormField id="member-name" label="Name" error={memberErrors.name}>
                    <Input
                      id="member-name"
                      value={memberFormValues.name}
                      onChange={(event) =>
                        setMemberFormValues((prev) => ({ ...prev, name: event.target.value }))
                      }
                    />
                  </FormField>
                  <FormField id="member-email" label="Email" error={memberErrors.email}>
                    <Input
                      id="member-email"
                      type="email"
                      value={memberFormValues.email}
                      onChange={(event) =>
                        setMemberFormValues((prev) => ({ ...prev, email: event.target.value }))
                      }
                    />
                  </FormField>
                  <FormField id="member-phone" label="Phone" error={memberErrors.phone}>
                    <Input
                      id="member-phone"
                      value={memberFormValues.phone}
                      onChange={(event) =>
                        setMemberFormValues((prev) => ({ ...prev, phone: event.target.value }))
                      }
                    />
                  </FormField>
                  <FormField
                    id="member-password"
                    label="Temporary password (optional)"
                    error={memberErrors.password}
                  >
                    <Input
                      id="member-password"
                      type="password"
                      value={memberFormValues.password}
                      onChange={(event) =>
                        setMemberFormValues((prev) => ({ ...prev, password: event.target.value }))
                      }
                    />
                  </FormField>
                  <FormField id="member-role" label="Membership role" error={memberErrors.role}>
                    <select
                      id="member-role"
                      className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                      value={memberFormValues.role}
                      onChange={(event) =>
                        setMemberFormValues((prev) => ({
                          ...prev,
                          role: event.target.value as OrganizationMemberRole,
                        }))
                      }
                    >
                      {canAssignOwnerRole ? <option value="OWNER">Owner</option> : null}
                      <option value="ADMIN">Admin</option>
                      <option value="VIEWER">Viewer</option>
                    </select>
                  </FormField>
                </div>
                <p className="text-xs text-muted-foreground">
                  Leave the password blank to send the member a set-password link instead.
                </p>
                <div className="flex justify-end">
                  <Button
                    onClick={() => void createMember()}
                    loading={memberCreating}
                    loadingText="Adding..."
                    disabled={!selectedOrganization}
                  >
                    Add member
                  </Button>
                </div>
              </div>
            ) : (
              <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-sm text-muted-foreground">
                You have read-only access for this organization.
              </div>
            )}

            <div className="space-y-3">
              <h2 className="text-sm font-semibold">Current members</h2>
              <div className="overflow-x-auto rounded-md border">
                <table className="min-w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Name</th>
                      <th className="px-3 py-2 text-left font-medium">Email</th>
                      <th className="px-3 py-2 text-left font-medium">Role</th>
                      <th className="px-3 py-2 text-left font-medium">User status</th>
                      <th className="px-3 py-2 text-left font-medium">Created</th>
                      <th className="px-3 py-2 text-left font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {membersLoading ? (
                      <tr>
                        <td className="px-3 py-4 text-muted-foreground" colSpan={6}>
                          Loading members...
                        </td>
                      </tr>
                    ) : memberItems.length === 0 ? (
                      <tr>
                        <td className="px-3 py-4 text-muted-foreground" colSpan={6}>
                          No members found.
                        </td>
                      </tr>
                    ) : (
                      memberItems.map((member) => {
                        const busy =
                          memberSavingId === member.id ||
                          memberResettingId === member.id ||
                          memberDeletingId === member.id
                        const canManageThisMember =
                          canManageMembersInSelectedOrganization &&
                          (platformAccessMode === "SUPER_ADMIN" || member.role !== "OWNER")

                        return (
                          <tr key={member.id} className="border-t">
                            <td className="px-3 py-2">{member.name || "-"}</td>
                            <td className="px-3 py-2">{member.email}</td>
                            <td className="px-3 py-2">{member.role}</td>
                            <td className="px-3 py-2">{member.userStatus}</td>
                            <td className="px-3 py-2">{formatDateTime(member.createdAt)}</td>
                            <td className="px-3 py-2">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    disabled={busy || !canManageThisMember}
                                  >
                                    <MoreHorizontalIcon className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onSelect={() => openEditMemberDialog(member)}>
                                    Edit member
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onSelect={() => void sendMemberReset(member)}>
                                    Send reset link
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    className="text-destructive"
                                    onSelect={() => {
                                      setPendingDeleteMember(member)
                                      setMemberDeleteOpen(true)
                                    }}
                                  >
                                    Remove member
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setMembersOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={memberEditorOpen}
        onOpenChange={(open) => {
          setMemberEditorOpen(open)
          if (!open) {
            setEditingMember(null)
            setMemberEditValues(defaultMemberEditValues)
            clearMemberEditErrors()
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit organization member</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <FormField id="member-edit-name" label="Name" error={memberEditErrors.name}>
              <Input
                id="member-edit-name"
                value={memberEditValues.name}
                onChange={(event) =>
                  setMemberEditValues((prev) => ({ ...prev, name: event.target.value }))
                }
              />
            </FormField>
            <FormField id="member-edit-email" label="Email" error={memberEditErrors.email}>
              <Input
                id="member-edit-email"
                type="email"
                value={memberEditValues.email}
                onChange={(event) =>
                  setMemberEditValues((prev) => ({ ...prev, email: event.target.value }))
                }
              />
            </FormField>
            <FormField id="member-edit-phone" label="Phone" error={memberEditErrors.phone}>
              <Input
                id="member-edit-phone"
                value={memberEditValues.phone}
                onChange={(event) =>
                  setMemberEditValues((prev) => ({ ...prev, phone: event.target.value }))
                }
              />
            </FormField>
            <FormField id="member-edit-role" label="Membership role" error={memberEditErrors.role}>
              <select
                id="member-edit-role"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={memberEditValues.role}
                onChange={(event) =>
                  setMemberEditValues((prev) => ({
                    ...prev,
                    role: event.target.value as OrganizationMemberRole,
                  }))
                }
              >
                {canAssignOwnerRole ? <option value="OWNER">Owner</option> : null}
                <option value="ADMIN">Admin</option>
                <option value="VIEWER">Viewer</option>
              </select>
            </FormField>
            <FormField id="member-edit-status" label="User status" error={memberEditErrors.status}>
              <select
                id="member-edit-status"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={memberEditValues.status}
                onChange={(event) =>
                  setMemberEditValues((prev) => ({
                    ...prev,
                    status: event.target.value as OrganizationMemberStatus,
                  }))
                }
              >
                <option value="ACTIVE">Active</option>
                <option value="SUSPENDED">Suspended</option>
                <option value="INVITED">Invited</option>
                <option value="ARCHIVED">Archived</option>
              </select>
            </FormField>
            <FormField
              id="member-edit-password"
              label="New password (optional)"
              error={memberEditErrors.password}
            >
              <Input
                id="member-edit-password"
                type="password"
                value={memberEditValues.password}
                onChange={(event) =>
                  setMemberEditValues((prev) => ({ ...prev, password: event.target.value }))
                }
              />
            </FormField>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMemberEditorOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void saveMemberDetails()}
              loading={Boolean(editingMember && memberSavingId === editingMember.id)}
              loadingText="Saving..."
            >
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={memberDeleteOpen}
        onOpenChange={(open) => {
          setMemberDeleteOpen(open)
          if (!open) {
            setPendingDeleteMember(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove organization member</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {pendingDeleteMember
              ? `Remove ${pendingDeleteMember.name || pendingDeleteMember.email} from this organization?`
              : ""}
          </p>
          <p className="text-sm text-muted-foreground">
            If this is the user&apos;s last organization membership, their platform-console login
            will be archived too.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMemberDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void removeMember()}
              loading={Boolean(
                pendingDeleteMember && memberDeletingId === pendingDeleteMember.id
              )}
              loadingText="Removing..."
            >
              Remove member
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
