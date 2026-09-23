"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { signOut, useSession } from "next-auth/react"
import { useTheme } from "next-themes"
import {
  BarChart3Icon,
  Building2Icon,
  CalendarClockIcon,
  ChevronRightIcon,
  ClockIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  MailIcon,
  MoonIcon,
  PackageIcon,
  ScissorsIcon,
  SettingsIcon,
  SunIcon,
  TagIcon,
  UserIcon,
  UsersIcon,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarSeparator,
} from "@/components/ui/sidebar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { canInvite, canManageUsers, canUseCrm, type Role } from "@/lib/permissions"
import { cn } from "@/lib/utils"

type SubNavItem = {
  title: string
  href: string
  icon: LucideIcon
  isActive: (pathname: string) => boolean
}

type NavSection = {
  key: string
  title: string
  href: string
  icon: LucideIcon
  isActive: (pathname: string) => boolean
  items: SubNavItem[]
}

const navItems = [{ title: "Dashboard", href: "/", icon: LayoutDashboardIcon }]

export function AppSidebar() {
  const { data: session } = useSession()
  const { theme, setTheme } = useTheme()
  const pathname = usePathname()
  const user = session?.user
  const role = (user as { role?: Role })?.role
  const platformAccessMode = (user as {
    platformAccessMode?: "SUPER_ADMIN" | "ORG_MEMBER" | null
  })?.platformAccessMode
  const canManage = canManageUsers(role ?? null)
  const sessionTenantSlug = (user as { tenantSlug?: string | null } | undefined)?.tenantSlug
    ?.trim()
    .toLowerCase()

  const platformTenantSlug = process.env.NEXT_PUBLIC_PLATFORM_ADMIN_TENANT_SLUG?.trim().toLowerCase() || "platform"

  const tenantSlug = React.useMemo(() => {
    if (sessionTenantSlug) return sessionTenantSlug
    if (typeof window === "undefined") return null
    const hostname = window.location.hostname.toLowerCase()
    if (hostname === "localhost") return platformTenantSlug
    if (hostname.endsWith(".localhost")) {
      const slug = hostname.slice(0, -".localhost".length)
      return slug || null
    }
    return null
  }, [platformTenantSlug, sessionTenantSlug])

  const isPlatformConsoleUser =
    tenantSlug === platformTenantSlug &&
    (platformAccessMode === "SUPER_ADMIN" || platformAccessMode === "ORG_MEMBER")
  const isPlatformSuperAdmin =
    role === "ADMIN" &&
    tenantSlug === platformTenantSlug &&
    platformAccessMode === "SUPER_ADMIN"
  const [openSections, setOpenSections] = React.useState<Record<string, boolean>>({})
  const [logoLoadFailed, setLogoLoadFailed] = React.useState(false)
  const [crmEnabled, setCrmEnabled] = React.useState(false)
  React.useEffect(() => {
    if (isPlatformConsoleUser || !canUseCrm(role)) return
    const controller = new AbortController()
    const load = () => {
      void fetch("/api/modules", { cache: "no-store", signal: controller.signal })
        .then(async response => response.ok ? response.json() : null)
        .then(data => { if (!controller.signal.aborted) setCrmEnabled(!!data?.modules?.some((module: { key: string; enabled: boolean }) => module.key === "crm" && module.enabled)) })
        .catch(() => { if (!controller.signal.aborted) setCrmEnabled(false) })
    }
    load()
    window.addEventListener("business-modules-changed", load)
    return () => { controller.abort(); window.removeEventListener("business-modules-changed", load) }
  }, [role, isPlatformConsoleUser])

  const name = user?.name?.trim() || user?.email?.trim() || "Guest"
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("")

  const sections = React.useMemo<NavSection[]>(() => {
    const list: NavSection[] = []
    if (!isPlatformConsoleUser && canUseCrm(role) && crmEnabled) {
      list.push({ key: "crm", title: "CRM", href: "/crm/overview", icon: UsersIcon,
        isActive: current => current.startsWith("/crm"), items: [
          { title: "Overview", href: "/crm/overview", icon: BarChart3Icon, isActive: current => current.startsWith("/crm/overview") },
          { title: "Enquiries", href: "/crm/enquiries", icon: MailIcon, isActive: current => current.startsWith("/crm/enquiries") },
          { title: "Contacts", href: "/crm/contacts", icon: UsersIcon, isActive: current => current.startsWith("/crm/contacts") },
          { title: "Business accounts", href: "/crm/accounts", icon: Building2Icon, isActive: current => current.startsWith("/crm/accounts") },
          { title: "Opportunities", href: "/crm/opportunities", icon: Building2Icon, isActive: current => current.startsWith("/crm/opportunities") },
          { title: "Pipelines", href: "/crm/pipelines", icon: Building2Icon, isActive: current => current.startsWith("/crm/pipelines") },
          { title: "My Work", href: "/crm/activities", icon: CalendarClockIcon, isActive: current => current.startsWith("/crm/activities") || current.startsWith("/crm/tasks") },
          { title: "Calendar", href: "/crm/calendar", icon: CalendarClockIcon, isActive: current => current.startsWith("/crm/calendar") },
          { title: "Activity plans", href: "/crm/activity-plans", icon: CalendarClockIcon, isActive: current => current.startsWith("/crm/activity-plans") },
          { title: "Follow-up rules", href: "/crm/follow-up-rules", icon: CalendarClockIcon, isActive: current => current.startsWith("/crm/follow-up-rules") },
        ],
      })
    }

    if (!isPlatformSuperAdmin && (canManage || role === "STAFF")) {
      const leavesItems: SubNavItem[] = []
      if (role === "STAFF" || role === "MANAGER") {
        leavesItems.push({
          title: "Requests",
          href: "/leaves/requests",
          icon: CalendarClockIcon,
          isActive: (current) => current.startsWith("/leaves/requests"),
        })
      }
      if (canManage) {
        leavesItems.push(
          {
            title: "Approvals",
            href: "/leaves/approvals",
            icon: UsersIcon,
            isActive: (current) => current.startsWith("/leaves/approvals"),
          },
          {
            title: "Definitions",
            href: "/leaves",
            icon: CalendarClockIcon,
            isActive: (current) => current === "/leaves",
          },
          {
            title: "Groups",
            href: "/leaves/groups",
            icon: UsersIcon,
            isActive: (current) => current.startsWith("/leaves/groups"),
          }
        )
      }

      list.push({
        key: "leaves",
        title: "Leaves",
        href: role === "ADMIN" ? "/leaves/approvals" : "/leaves/requests",
        icon: CalendarClockIcon,
        isActive: (current) => current.startsWith("/leaves"),
        items: leavesItems,
      })
    }

    if (!isPlatformSuperAdmin && canManage) {
      list.push(
        {
          key: "reports",
          title: "Reports",
          href: "/reports/coupon-usage",
          icon: BarChart3Icon,
          isActive: (current) => current.startsWith("/reports"),
          items: [
            {
              title: "Coupon usage",
              href: "/reports/coupon-usage",
              icon: TagIcon,
              isActive: (current) => current === "/reports/coupon-usage",
            },
            {
              title: "Audit logs",
              href: "/reports/audit-logs",
              icon: BarChart3Icon,
              isActive: (current) => current === "/reports/audit-logs",
            },
          ],
        },
        {
          key: "inventory",
          title: "Inventory",
          href: "/inventory",
          icon: PackageIcon,
          isActive: (current) => current.startsWith("/inventory"),
          items: [
            { title: "Products", href: "/inventory", icon: PackageIcon, isActive: (current) => current === "/inventory" },
            {
              title: "Categories",
              href: "/inventory/categories",
              icon: TagIcon,
              isActive: (current) => current === "/inventory/categories",
            },
            {
              title: "Suppliers",
              href: "/inventory/suppliers",
              icon: UsersIcon,
              isActive: (current) => current === "/inventory/suppliers",
            },
            {
              title: "Purchases",
              href: "/inventory/purchases",
              icon: CalendarClockIcon,
              isActive: (current) => current === "/inventory/purchases",
            },
          ],
        },
        {
          key: "appointments",
          title: "Appointments",
          href: "/appointments",
          icon: CalendarClockIcon,
          isActive: (current) => current.startsWith("/appointments"),
          items: [
            {
              title: "View",
              href: "/appointments",
              icon: CalendarClockIcon,
              isActive: (current) => current === "/appointments",
            },
            {
              title: "Coupons",
              href: "/appointments/coupons",
              icon: TagIcon,
              isActive: (current) => current === "/appointments/coupons",
            },
          ],
        },
        {
          key: "services",
          title: "Services",
          href: "/services",
          icon: ScissorsIcon,
          isActive: (current) => current.startsWith("/services"),
          items: [
            { title: "Services", href: "/services", icon: ScissorsIcon, isActive: (current) => current === "/services" },
            {
              title: "Categories",
              href: "/services/categories",
              icon: TagIcon,
              isActive: (current) => current === "/services/categories",
            },
          ],
        },
        {
          key: "users",
          title: "Users",
          href: "/users",
          icon: UsersIcon,
          isActive: (current) => current === "/users" || current.startsWith("/users/"),
          items: [
            { title: "View", href: "/users", icon: UsersIcon, isActive: (current) => current === "/users" },
            ...(canInvite(role ?? null)
              ? [
                  {
                    title: "Invitees",
                    href: "/users/invites",
                    icon: MailIcon,
                    isActive: (current: string) => current === "/users/invites",
                  },
                ]
              : []),
          ],
        },
        {
          key: "shifts",
          title: "Shifts",
          href: "/shifts",
          icon: ClockIcon,
          isActive: (current) => current.startsWith("/shifts"),
          items: [
            { title: "Templates", href: "/shifts", icon: ClockIcon, isActive: (current) => current === "/shifts" },
            {
              title: "Schedules",
              href: "/shifts/schedules",
              icon: CalendarClockIcon,
              isActive: (current) => current === "/shifts/schedules",
            },
            {
              title: "Roster",
              href: "/shifts/roster",
              icon: CalendarClockIcon,
              isActive: (current) => current === "/shifts/roster",
            },
            {
              title: "Recurring plans",
              href: "/shifts/recurring",
              icon: ClockIcon,
              isActive: (current) => current === "/shifts/recurring",
            },
          ],
        }
      )
    }

    if (canManage || isPlatformConsoleUser) {
      list.push({
        key: "settings",
        title: isPlatformConsoleUser ? "Parent Console" : "Settings",
        href: isPlatformConsoleUser ? "/settings/organizations" : "/settings",
        icon: SettingsIcon,
        isActive: (current) => current.startsWith("/settings"),
        items: isPlatformConsoleUser
          ? [
                {
                  title: "Organizations",
                  href: "/settings/organizations",
                  icon: Building2Icon,
                  isActive: (current) => current === "/settings/organizations",
                },
                {
                  title: "Tenants",
                  href: "/settings/tenants",
                  icon: Building2Icon,
                  isActive: (current) => current === "/settings/tenants",
                },
              ]
          : [
              { title: "General", href: "/settings", icon: SettingsIcon, isActive: (current) => current === "/settings" },
              { title: "Modules", href: "/settings/modules", icon: PackageIcon, isActive: (current) => current === "/settings/modules" },
              { title: "Taxes", href: "/settings/taxes", icon: TagIcon, isActive: (current) => current === "/settings/taxes" },
              { title: "Seeds", href: "/settings/seeds", icon: PackageIcon, isActive: (current) => current === "/settings/seeds" },
            ],
      })
    }

    return list
  }, [canManage, isPlatformConsoleUser, isPlatformSuperAdmin, role, crmEnabled])

  const menuButtonClass = (active: boolean) =>
    cn("transition-colors", active && "bg-sidebar-primary/20 text-sidebar-primary font-semibold")

  const subButtonClass = (active: boolean) =>
    cn("transition-colors", active && "bg-sidebar-primary/20 text-sidebar-primary font-semibold")
  const navIconClass = "h-4 w-4 !text-zinc-500 dark:!text-zinc-400"

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex justify-center">
          {!logoLoadFailed ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src="/assets/images/logo.png"
              alt="LS Salon"
              className="h-auto w-[150px] max-w-full object-contain"
              onError={() => setLogoLoadFailed(true)}
            />
          ) : (
            <div className="text-sm font-semibold">LS Salon</div>
          )}
        </div>
      </SidebarHeader>
      <SidebarSeparator />
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel></SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {!isPlatformConsoleUser && navItems.map((item) => {
                const active = pathname === item.href
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={active} className={menuButtonClass(active)}>
                      <Link href={item.href} className="flex w-full items-center">
                        <item.icon className={navIconClass} />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}

              {sections.map((section) => {
                const sectionActive = section.isActive(pathname)
                const isOpen = sectionActive || openSections[section.key] === true

                return (
                  <SidebarMenuItem key={section.key}>
                    <Collapsible
                      open={isOpen}
                      onOpenChange={(open) => setOpenSections((prev) => ({ ...prev, [section.key]: open }))}
                    >
                      <CollapsibleTrigger asChild>
                        <SidebarMenuButton
                          type="button"
                          isActive={sectionActive}
                          className={menuButtonClass(sectionActive)}
                        >
                            <section.icon className={navIconClass} />
                          <span>{section.title}</span>
                          <ChevronRightIcon
                            className={cn("ml-auto h-4 w-4 transition-transform", isOpen && "rotate-90")}
                          />
                        </SidebarMenuButton>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <SidebarMenuSub>
                          {section.items.map((item) => {
                            const subActive = item.isActive(pathname)
                            return (
                              <SidebarMenuSubItem key={item.href}>
                                <SidebarMenuSubButton asChild isActive={subActive} className={subButtonClass(subActive)}>
                                  <Link href={item.href} className="flex w-full items-center">
                                    <item.icon className={navIconClass} />
                                    <span>{item.title}</span>
                                    <span
                                      className={cn(
                                        "ml-auto h-2 w-2 rounded-full",
                                        subActive ? "bg-sidebar-primary" : "bg-transparent"
                                      )}
                                    />
                                  </Link>
                                </SidebarMenuSubButton>
                              </SidebarMenuSubItem>
                            )
                          })}
                        </SidebarMenuSub>
                      </CollapsibleContent>
                    </Collapsible>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="mx-2 mb-2 flex w-[calc(100%-1rem)] items-center gap-3 rounded-md border bg-background px-3 py-2 text-left transition hover:bg-accent"
            >
              <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                {user?.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={user.image} alt={name} className="h-full w-full object-cover" />
                ) : initials ? (
                  <span>{initials}</span>
                ) : (
                  <UserIcon className="h-4 w-4" />
                )}
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{name}</div>
                {user?.email ? <div className="truncate text-xs text-muted-foreground">{user.email}</div> : null}
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="end" className="w-48">
            <DropdownMenuLabel>Account</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={(value) => setTheme(value)}>
              <DropdownMenuRadioItem value="light">
                <SunIcon />
                <span>Light</span>
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark">
                <MoonIcon />
                <span>Dark</span>
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="system">
                <span className="text-xs font-semibold">OS</span>
                <span>System</span>
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/profile" className="flex items-center gap-2">
                <UserIcon className="h-4 w-4" />
                <span>Profile</span>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="justify-start"
              onSelect={() => {
                const callbackUrl = typeof window !== "undefined" ? `${window.location.origin}/auth/signin` : "/auth/signin"
                void signOut({ callbackUrl })
              }}
            >
              <LogOutIcon className="mr-1" />
              <span>Logout</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
