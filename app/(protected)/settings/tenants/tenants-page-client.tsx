"use client"

import * as React from "react"
import {
  ColumnDef,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table"
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { useFormErrors } from "@/hooks/use-form-errors"
import type { ListResponse } from "@/types/api"

type PaginationState = { pageIndex: number; pageSize: number }
type TenantStatus = "ACTIVE" | "SUSPENDED" | "ARCHIVED"

type TenantRow = {
  id: string
  name: string
  slug: string
  status: TenantStatus
  userCount: number
  organizationId: string | null
  organizationName: string | null
  customDomain: string | null
  createdAt: string
}

type OrganizationOption = {
  id: string
  name: string
  slug: string
}

type TenantCreateFormValues = {
  name: string
  slug: string
  organizationId: string
  customDomain: string
  adminName: string
  adminEmail: string
  adminPassword: string
}

type TenantAdminEditValues = {
  id: string
  name: string
  email: string
  phone: string
  status: "ACTIVE" | "SUSPENDED" | "ARCHIVED"
  password: string
}

const defaultFormValues: TenantCreateFormValues = {
  name: "",
  slug: "",
  organizationId: "",
  customDomain: "",
  adminName: "",
  adminEmail: "",
  adminPassword: "",
}

const defaultAdminEditValues: TenantAdminEditValues = {
  id: "",
  name: "",
  email: "",
  phone: "",
  status: "ACTIVE",
  password: "",
}

const formatDateTime = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return date.toLocaleString()
}

const tenantDomainHelpText =
  "Leave this blank to use the default tenant subdomain. Add a custom domain only after its DNS is pointed to this app."

const tenantDomainDnsHelpText =
  "For a custom domain, the app can add it to Vercel automatically when VERCEL_API_TOKEN and VERCEL_PROJECT_ID or VERCEL_PROJECT_NAME are configured. The client still needs to update DNS: CNAME for subdomains like app.client.com, or Vercel's apex-domain setup for root domains like client.com."

const getTenantAccessUrl = (tenant: TenantRow, rootDomain: string) => {
  if (tenant.customDomain) {
    return `https://${tenant.customDomain}`
  }

  if (rootDomain) {
    return `https://${tenant.slug}.${rootDomain}`
  }

  return tenant.slug
}

type TenantsPageClientProps = {
  rootDomain: string
  platformAccessMode: "SUPER_ADMIN" | "ORG_MEMBER"
}

export default function TenantsPageClient({
  rootDomain,
  platformAccessMode,
}: TenantsPageClientProps) {
  const canReassignTenantOrganization = platformAccessMode === "SUPER_ADMIN"
  const canResetAllTenants = platformAccessMode === "SUPER_ADMIN"
  const [items, setItems] = React.useState<TenantRow[]>([])
  const [organizationOptions, setOrganizationOptions] = React.useState<OrganizationOption[]>([])
  const [totalRows, setTotalRows] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [creating, setCreating] = React.useState(false)
  const [search, setSearch] = React.useState("")
  const [statusFilter, setStatusFilter] = React.useState<"all" | TenantStatus>("all")
  const [pagination, setPagination] = React.useState<PaginationState>({ pageIndex: 0, pageSize: 10 })
  const [createOpen, setCreateOpen] = React.useState(false)
  const [editAdminOpen, setEditAdminOpen] = React.useState(false)
  const [editDomainOpen, setEditDomainOpen] = React.useState(false)
  const [editOrganizationOpen, setEditOrganizationOpen] = React.useState(false)
  const [resetAllOpen, setResetAllOpen] = React.useState(false)
  const [resetAllConfirmation, setResetAllConfirmation] = React.useState("")
  const [keepPlatformTenantOnReset, setKeepPlatformTenantOnReset] = React.useState(true)
  const [resettingAll, setResettingAll] = React.useState(false)
  const [lifecycleUpdatingId, setLifecycleUpdatingId] = React.useState<string | null>(null)
  const [adminResettingId, setAdminResettingId] = React.useState<string | null>(null)
  const [adminLoadingTenantId, setAdminLoadingTenantId] = React.useState<string | null>(null)
  const [adminSavingTenantId, setAdminSavingTenantId] = React.useState<string | null>(null)
  const [domainSavingTenantId, setDomainSavingTenantId] = React.useState<string | null>(null)
  const [organizationSavingTenantId, setOrganizationSavingTenantId] = React.useState<string | null>(null)
  const [editingTenantId, setEditingTenantId] = React.useState<string | null>(null)
  const [domainTenant, setDomainTenant] = React.useState<TenantRow | null>(null)
  const [domainValue, setDomainValue] = React.useState("")
  const [organizationTenant, setOrganizationTenant] = React.useState<TenantRow | null>(null)
  const [organizationValue, setOrganizationValue] = React.useState("")
  const [pendingStatusChange, setPendingStatusChange] = React.useState<{
    tenant: TenantRow
    status: TenantStatus
  } | null>(null)
  const [formValues, setFormValues] = React.useState<TenantCreateFormValues>(defaultFormValues)
  const [adminEditValues, setAdminEditValues] = React.useState<TenantAdminEditValues>(defaultAdminEditValues)
  const {
    errors,
    setErrorsFromResponse,
    clearErrors,
  } = useFormErrors()
  const {
    errors: adminErrors,
    setErrorsFromResponse: setAdminErrorsFromResponse,
    clearErrors: clearAdminErrors,
  } = useFormErrors()
  const {
    errors: domainErrors,
    setErrorsFromResponse: setDomainErrorsFromResponse,
    clearErrors: clearDomainErrors,
  } = useFormErrors()
  const {
    errors: organizationErrors,
    setErrorsFromResponse: setOrganizationErrorsFromResponse,
    clearErrors: clearOrganizationErrors,
  } = useFormErrors()

  const loadTenants = React.useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    params.set("page", String(pagination.pageIndex + 1))
    params.set("pageSize", String(pagination.pageSize))
    if (search.trim()) params.set("q", search.trim())
    if (statusFilter !== "all") params.set("status", statusFilter)

    const response = await fetch(`/api/tenants?${params.toString()}`, { cache: "no-store" })
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string }
      toast.error(data.error ?? "Unable to load tenants.")
      setItems([])
      setTotalRows(0)
      setLoading(false)
      return
    }
    const data = (await response.json()) as ListResponse<TenantRow>
    setItems(data.items)
    setTotalRows(data.total)
    setLoading(false)
  }, [pagination.pageIndex, pagination.pageSize, search, statusFilter])

  React.useEffect(() => {
    void loadTenants()
  }, [loadTenants])

  React.useEffect(() => {
    const loadOrganizations = async () => {
      const response = await fetch("/api/organizations?page=1&pageSize=100", { cache: "no-store" })
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string }
        toast.error(data.error ?? "Unable to load organizations.")
        setOrganizationOptions([])
        return
      }

      const data = (await response.json()) as ListResponse<OrganizationOption>
      setOrganizationOptions(data.items)
    }

    void loadOrganizations()
  }, [])

  React.useEffect(() => {
    setPagination((prev) =>
      prev.pageIndex === 0 ? prev : { ...prev, pageIndex: 0 }
    )
  }, [search, statusFilter])

  const createTenant = async () => {
    setCreating(true)
    clearErrors()
    const response = await fetch("/api/tenants", {
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
      toast.error(data.error ?? "Unable to create tenant.")
      setCreating(false)
      return
    }

    toast.success("Tenant created.")
    setCreating(false)
    setCreateOpen(false)
    setFormValues(defaultFormValues)
    await loadTenants()
  }

  const updateTenantStatus = async (tenant: TenantRow, status: TenantStatus) => {
    setLifecycleUpdatingId(tenant.id)
    const response = await fetch(`/api/tenants/${tenant.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    })
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string }
      toast.error(data.error ?? "Unable to update tenant status.")
      setLifecycleUpdatingId(null)
      return
    }
    toast.success(`Tenant moved to ${status}.`)
    setLifecycleUpdatingId(null)
    await loadTenants()
  }

  const sendAdminReset = async (tenant: TenantRow) => {
    setAdminResettingId(tenant.id)
    const response = await fetch(`/api/tenants/${tenant.id}/admin-reset`, {
      method: "POST",
    })
    const data = (await response.json().catch(() => ({}))) as {
      error?: string
      delivery?: "email" | "manual"
      resetUrl?: string
    }
    if (!response.ok) {
      toast.error(data.error ?? "Unable to send admin reset.")
      setAdminResettingId(null)
      return
    }

    if (data.delivery === "manual" && data.resetUrl) {
      try {
        await navigator.clipboard.writeText(data.resetUrl)
        toast.success("Email not configured. Reset link copied to clipboard.")
      } catch {
        toast.success("Email not configured. Reset link returned by API.")
      }
    } else {
      toast.success("Admin reset link sent.")
    }
    setAdminResettingId(null)
  }

  const openEditAdmin = async (tenant: TenantRow) => {
    setAdminLoadingTenantId(tenant.id)
    clearAdminErrors()
    const response = await fetch(`/api/tenants/${tenant.id}/admin`, { cache: "no-store" })
    const data = (await response.json().catch(() => ({}))) as {
      error?: string
      admin?: {
        id: string
        name: string | null
        email: string
        phone: string | null
        status: "ACTIVE" | "SUSPENDED" | "ARCHIVED"
      }
    }
    if (!response.ok || !data.admin) {
      toast.error(data.error ?? "Unable to load tenant admin.")
      setAdminLoadingTenantId(null)
      return
    }

    setEditingTenantId(tenant.id)
    setAdminEditValues({
      id: data.admin.id,
      name: data.admin.name ?? "",
      email: data.admin.email,
      phone: data.admin.phone ?? "",
      status: data.admin.status,
      password: "",
    })
    setAdminLoadingTenantId(null)
    setEditAdminOpen(true)
  }

  const saveAdminDetails = async () => {
    if (!editingTenantId) return
    setAdminSavingTenantId(editingTenantId)
    clearAdminErrors()
    const response = await fetch(`/api/tenants/${editingTenantId}/admin`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: adminEditValues.name,
        email: adminEditValues.email,
        phone: adminEditValues.phone,
        status: adminEditValues.status,
        password: adminEditValues.password,
      }),
    })
    const data = (await response.json().catch(() => ({}))) as {
      error?: string
      details?: { fieldErrors?: Record<string, string[]> }
    }
    if (!response.ok) {
      setAdminErrorsFromResponse(data)
      toast.error(data.error ?? "Unable to update tenant admin.")
      setAdminSavingTenantId(null)
      return
    }

    toast.success("Tenant admin updated.")
    setAdminSavingTenantId(null)
    setEditAdminOpen(false)
    setEditingTenantId(null)
    setAdminEditValues(defaultAdminEditValues)
    await loadTenants()
  }

  const openDomainEditor = (tenant: TenantRow) => {
    clearDomainErrors()
    setDomainTenant(tenant)
    setDomainValue(tenant.customDomain ?? "")
    setEditDomainOpen(true)
  }

  const openOrganizationEditor = (tenant: TenantRow) => {
    clearOrganizationErrors()
    setOrganizationTenant(tenant)
    setOrganizationValue(tenant.organizationId ?? "")
    setEditOrganizationOpen(true)
  }

  const saveTenantDomain = async () => {
    if (!domainTenant) return
    setDomainSavingTenantId(domainTenant.id)
    clearDomainErrors()
    const response = await fetch(`/api/tenants/${domainTenant.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customDomain: domainValue }),
    })
    const data = (await response.json().catch(() => ({}))) as {
      error?: string
      details?: { fieldErrors?: Record<string, string[]> }
    }
    if (!response.ok) {
      setDomainErrorsFromResponse(data)
      toast.error(data.error ?? "Unable to update tenant domain.")
      setDomainSavingTenantId(null)
      return
    }

    toast.success("Tenant domain updated.")
    setDomainSavingTenantId(null)
    setEditDomainOpen(false)
    setDomainTenant(null)
    setDomainValue("")
    await loadTenants()
  }

  const saveTenantOrganization = async () => {
    if (!organizationTenant) return
    setOrganizationSavingTenantId(organizationTenant.id)
    clearOrganizationErrors()
    const response = await fetch(`/api/tenants/${organizationTenant.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId: organizationValue }),
    })
    const data = (await response.json().catch(() => ({}))) as {
      error?: string
      details?: { fieldErrors?: Record<string, string[]> }
    }
    if (!response.ok) {
      setOrganizationErrorsFromResponse(data)
      toast.error(data.error ?? "Unable to update tenant organization.")
      setOrganizationSavingTenantId(null)
      return
    }

    toast.success("Tenant organization updated.")
    setOrganizationSavingTenantId(null)
    setEditOrganizationOpen(false)
    setOrganizationTenant(null)
    setOrganizationValue("")
    await loadTenants()
  }

  const resetAllTenants = async () => {
    if (resetAllConfirmation !== "RESET") {
      toast.error("Type RESET to continue.")
      return
    }
    setResettingAll(true)
    const response = await fetch("/api/tenants/reset-all", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        confirmation: "RESET",
        keepPlatformTenant: keepPlatformTenantOnReset,
      }),
    })
    const data = (await response.json().catch(() => ({}))) as {
      error?: string
      deletedTenantCount?: number
      deletedUserCount?: number
      keptTenantSlugs?: string[]
    }
    if (!response.ok) {
      toast.error(data.error ?? "Unable to reset tenant data.")
      setResettingAll(false)
      return
    }

    toast.success(
      `Reset complete. Deleted ${data.deletedTenantCount ?? 0} tenant(s) and ${data.deletedUserCount ?? 0} user(s). Kept: ${(data.keptTenantSlugs ?? []).join(", ") || "none"}.`
    )
    setResettingAll(false)
    setResetAllOpen(false)
    setResetAllConfirmation("")
    setKeepPlatformTenantOnReset(true)
    await loadTenants()
  }

  const columns = React.useMemo<ColumnDef<TenantRow>[]>(
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
        id: "organization",
        meta: { label: "Organization" },
        header: "Organization",
        accessorFn: (row) => row.organizationName ?? "Unassigned",
      },
      {
        id: "status",
        meta: { label: "Status" },
        header: "Status",
        accessorFn: (row) => row.status,
      },
      {
        id: "customDomain",
        meta: { label: "Custom domain" },
        header: "Custom domain",
        accessorFn: (row) => row.customDomain ?? "-",
      },
      {
        id: "accessUrl",
        meta: { label: "Access URL" },
        header: "Access URL",
        cell: ({ row }) => {
          const tenant = row.original
          const accessUrl = getTenantAccessUrl(tenant, rootDomain)
          const accessMode = tenant.customDomain ? "Custom domain" : "Default subdomain"

          return (
            <div className="space-y-1">
              <div className="font-medium">{accessUrl}</div>
              <div className="text-xs text-muted-foreground">{accessMode}</div>
            </div>
          )
        },
      },
      {
        id: "users",
        meta: { label: "Users" },
        header: "Users",
        accessorFn: (row) => row.userCount,
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
          const tenant = row.original
          const canMutate =
            lifecycleUpdatingId !== tenant.id &&
            adminResettingId !== tenant.id &&
            adminLoadingTenantId !== tenant.id &&
            domainSavingTenantId !== tenant.id &&
            organizationSavingTenantId !== tenant.id
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" disabled={!canMutate}>
                  <MoreHorizontalIcon className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {tenant.status !== "ACTIVE" ? (
                  <DropdownMenuItem
                    onSelect={() => setPendingStatusChange({ tenant, status: "ACTIVE" })}
                  >
                    Reactivate
                  </DropdownMenuItem>
                ) : null}
                {tenant.status !== "SUSPENDED" ? (
                  <DropdownMenuItem
                    onSelect={() => setPendingStatusChange({ tenant, status: "SUSPENDED" })}
                  >
                    Suspend
                  </DropdownMenuItem>
                ) : null}
                {tenant.status !== "ARCHIVED" ? (
                  <DropdownMenuItem
                    className="text-destructive"
                    onSelect={() => setPendingStatusChange({ tenant, status: "ARCHIVED" })}
                  >
                    Archive
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem onSelect={() => void openEditAdmin(tenant)}>
                  Edit admin details
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openDomainEditor(tenant)}>
                  Edit custom domain
                </DropdownMenuItem>
                {canReassignTenantOrganization ? (
                  <DropdownMenuItem onSelect={() => openOrganizationEditor(tenant)}>
                    Edit organization
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem onSelect={() => void sendAdminReset(tenant)}>
                  Send admin reset
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )
        },
      },
    ],
    [
      adminLoadingTenantId,
      adminResettingId,
      domainSavingTenantId,
      lifecycleUpdatingId,
      organizationSavingTenantId,
      rootDomain,
    ]
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Tenants</h1>
          <p className="text-sm text-muted-foreground">
            Provision tenant accounts and assign an initial admin user.
          </p>
        </div>
        <Button
          onClick={() => {
            clearErrors()
            setFormValues(defaultFormValues)
            setCreateOpen(true)
          }}
        >
          <PlusIcon className="mr-2 h-4 w-4" />
          New tenant
        </Button>
      </div>

      <DataTableToolbar table={table} searchPlaceholder="Search name, slug, organization or domain">
        <div className="flex items-end gap-2">
          <FormField id="tenant-status" label="Status">
            <select
              id="tenant-status"
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as "all" | TenantStatus)}
            >
              <option value="all">All statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="SUSPENDED">Suspended</option>
              <option value="ARCHIVED">Archived</option>
            </select>
          </FormField>
        </div>
      </DataTableToolbar>
      <DataTable table={table} loading={loading} emptyMessage="No tenants found." />
      <DataTablePagination table={table} totalRows={totalRows} />
      {canResetAllTenants ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
          <h2 className="text-base font-semibold text-destructive">Danger zone</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Test-only hard reset: delete tenant data in bulk while preserving the platform admin login tenant.
          </p>
          <div className="mt-3">
            <Button
              variant="destructive"
              onClick={() => {
                setResetAllConfirmation("")
                setKeepPlatformTenantOnReset(true)
                setResetAllOpen(true)
              }}
            >
              Reset all tenant data
            </Button>
          </div>
        </div>
      ) : null}

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
            <DialogTitle>New tenant</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-sm text-muted-foreground">
              If no custom domain is added, this tenant will use the standard slug-based URL.
              You can add or change the custom domain later.
            </div>
            <FormField id="tenant-name" label="Tenant name" error={errors.name}>
              <Input
                id="tenant-name"
                value={formValues.name}
                onChange={(event) =>
                  setFormValues((prev) => ({ ...prev, name: event.target.value }))
                }
              />
            </FormField>
            <FormField id="tenant-slug" label="Tenant slug" error={errors.slug}>
              <Input
                id="tenant-slug"
                value={formValues.slug}
                onChange={(event) =>
                  setFormValues((prev) => ({
                    ...prev,
                    slug: event.target.value.trim().toLowerCase(),
                  }))
                }
                placeholder="example-tenant"
              />
            </FormField>
            <FormField
              id="tenant-organization"
              label="Organization (optional)"
              error={errors.organizationId}
            >
              <select
                id="tenant-organization"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={formValues.organizationId}
                onChange={(event) =>
                  setFormValues((prev) => ({
                    ...prev,
                    organizationId: event.target.value,
                  }))
                }
              >
                <option value="">No parent organization</option>
                {organizationOptions.map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.name}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField
              id="tenant-custom-domain"
              label="Custom domain (optional)"
              error={errors.customDomain}
            >
              <div className="space-y-2">
                <Input
                  id="tenant-custom-domain"
                  value={formValues.customDomain}
                  onChange={(event) =>
                    setFormValues((prev) => ({
                      ...prev,
                      customDomain: event.target.value.toLowerCase(),
                    }))
                  }
                  placeholder="cheron.com"
                />
                <p className="text-xs text-muted-foreground">{tenantDomainHelpText}</p>
                <p className="text-xs text-muted-foreground">{tenantDomainDnsHelpText}</p>
              </div>
            </FormField>
            <FormField id="admin-name" label="Admin name" error={errors.adminName}>
              <Input
                id="admin-name"
                value={formValues.adminName}
                onChange={(event) =>
                  setFormValues((prev) => ({ ...prev, adminName: event.target.value }))
                }
              />
            </FormField>
            <FormField id="admin-email" label="Admin email" error={errors.adminEmail}>
              <Input
                id="admin-email"
                type="email"
                value={formValues.adminEmail}
                onChange={(event) =>
                  setFormValues((prev) => ({ ...prev, adminEmail: event.target.value }))
                }
              />
            </FormField>
            <FormField
              id="admin-password"
              label="Temporary password"
              error={errors.adminPassword}
            >
              <Input
                id="admin-password"
                type="password"
                value={formValues.adminPassword}
                onChange={(event) =>
                  setFormValues((prev) => ({ ...prev, adminPassword: event.target.value }))
                }
              />
            </FormField>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void createTenant()} loading={creating} loadingText="Creating...">
              Create tenant
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editOrganizationOpen}
        onOpenChange={(open) => {
          setEditOrganizationOpen(open)
          if (!open) {
            setOrganizationTenant(null)
            setOrganizationValue("")
            clearOrganizationErrors()
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit organization</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-sm text-muted-foreground">
              Attach this salon tenant to a parent company, or leave it unassigned for now.
            </div>
            <FormField
              id="tenant-organization-edit"
              label="Organization"
              error={organizationErrors.organizationId}
            >
              <select
                id="tenant-organization-edit"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={organizationValue}
                onChange={(event) => setOrganizationValue(event.target.value)}
              >
                <option value="">No parent organization</option>
                {organizationOptions.map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.name}
                  </option>
                ))}
              </select>
            </FormField>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOrganizationOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void saveTenantOrganization()}
              loading={Boolean(
                organizationTenant && organizationSavingTenantId === organizationTenant.id
              )}
              loadingText="Saving..."
            >
              Save organization
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editDomainOpen}
        onOpenChange={(open) => {
          setEditDomainOpen(open)
          if (!open) {
            setDomainTenant(null)
            setDomainValue("")
            clearDomainErrors()
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit custom domain</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-sm text-muted-foreground">
              Leave this blank to use the default tenant subdomain instead of a branded custom
              domain.
            </div>
            <FormField
              id="tenant-domain"
              label="Custom domain"
              error={domainErrors.customDomain}
            >
              <div className="space-y-2">
                <Input
                  id="tenant-domain"
                  value={domainValue}
                  onChange={(event) => setDomainValue(event.target.value.toLowerCase())}
                  placeholder="cheron.com"
                />
                <p className="text-xs text-muted-foreground">{tenantDomainHelpText}</p>
                <p className="text-xs text-muted-foreground">{tenantDomainDnsHelpText}</p>
              </div>
            </FormField>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDomainOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void saveTenantDomain()}
              loading={Boolean(domainTenant && domainSavingTenantId === domainTenant.id)}
              loadingText="Saving..."
            >
              Save domain
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editAdminOpen}
        onOpenChange={(open) => {
          setEditAdminOpen(open)
          if (!open) {
            setEditingTenantId(null)
            setAdminEditValues(defaultAdminEditValues)
            clearAdminErrors()
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit admin details</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <FormField id="tenant-admin-name" label="Admin name" error={adminErrors.name}>
              <Input
                id="tenant-admin-name"
                value={adminEditValues.name}
                onChange={(event) =>
                  setAdminEditValues((prev) => ({ ...prev, name: event.target.value }))
                }
              />
            </FormField>
            <FormField id="tenant-admin-email" label="Admin email" error={adminErrors.email}>
              <Input
                id="tenant-admin-email"
                type="email"
                value={adminEditValues.email}
                onChange={(event) =>
                  setAdminEditValues((prev) => ({ ...prev, email: event.target.value }))
                }
              />
            </FormField>
            <FormField id="tenant-admin-phone" label="Phone" error={adminErrors.phone}>
              <Input
                id="tenant-admin-phone"
                value={adminEditValues.phone}
                onChange={(event) =>
                  setAdminEditValues((prev) => ({ ...prev, phone: event.target.value }))
                }
              />
            </FormField>
            <FormField id="tenant-admin-status" label="Status" error={adminErrors.status}>
              <select
                id="tenant-admin-status"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={adminEditValues.status}
                onChange={(event) =>
                  setAdminEditValues((prev) => ({
                    ...prev,
                    status: event.target.value as "ACTIVE" | "SUSPENDED" | "ARCHIVED",
                  }))
                }
              >
                <option value="ACTIVE">Active</option>
                <option value="SUSPENDED">Suspended</option>
                <option value="ARCHIVED">Archived</option>
              </select>
            </FormField>
            <FormField
              id="tenant-admin-password"
              label="New password (optional)"
              error={adminErrors.password}
            >
              <Input
                id="tenant-admin-password"
                type="password"
                value={adminEditValues.password}
                onChange={(event) =>
                  setAdminEditValues((prev) => ({ ...prev, password: event.target.value }))
                }
              />
            </FormField>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditAdminOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void saveAdminDetails()}
              loading={Boolean(
                editingTenantId && adminSavingTenantId === editingTenantId
              )}
              loadingText="Saving..."
            >
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(pendingStatusChange)}
        onOpenChange={(open) => {
          if (!open) setPendingStatusChange(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm status change</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {pendingStatusChange
              ? `Change "${pendingStatusChange.tenant.name}" to ${pendingStatusChange.status}?`
              : ""}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingStatusChange(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!pendingStatusChange) return
                void updateTenantStatus(
                  pendingStatusChange.tenant,
                  pendingStatusChange.status
                )
                setPendingStatusChange(null)
              }}
              loading={Boolean(
                pendingStatusChange &&
                lifecycleUpdatingId === pendingStatusChange.tenant.id
              )}
              loadingText="Updating..."
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={resetAllOpen}
        onOpenChange={(open) => {
          setResetAllOpen(open)
          if (!open) {
            setResetAllConfirmation("")
            setKeepPlatformTenantOnReset(true)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset all tenant data</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This permanently hard-deletes tenants and all related data. Super-admin login tenant is always preserved.
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={keepPlatformTenantOnReset}
              onChange={(event) => setKeepPlatformTenantOnReset(event.target.checked)}
            />
            Keep platform tenant too
          </label>
          <FormField
            id="reset-all-confirmation"
            label='Type "RESET" to confirm'
          >
            <Input
              id="reset-all-confirmation"
              value={resetAllConfirmation}
              onChange={(event) => setResetAllConfirmation(event.target.value)}
              placeholder="RESET"
            />
          </FormField>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetAllOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void resetAllTenants()}
              loading={resettingAll}
              loadingText="Resetting..."
            >
              Reset data
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
