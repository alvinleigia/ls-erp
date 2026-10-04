"use client"

import * as React from "react"
import { workforceNavigation, businessNavigation, inventoryNavigation, appointmentsNavigation, servicesNavigation } from "@/application/navigation"
import { useBusinessModules } from "@/platform/module-provider"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { signOut, useSession } from "next-auth/react"
import { useTheme } from "next-themes"
import {
  BarChart3Icon,
  Building2Icon,
  ChevronRightIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  MailIcon,
  MoonIcon,
  PackageIcon,
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
  const { flags, permissions, enabled, can } = useBusinessModules()

  const name = user?.name?.trim() || user?.email?.trim() || "Guest"
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("")

  const sections = React.useMemo<NavSection[]>(() => {
    const list: NavSection[] = []
    if (!isPlatformConsoleUser && canUseCrm(role)) list.push(...businessNavigation(flags, permissions))

    if (!isPlatformSuperAdmin) list.push(...workforceNavigation(flags, permissions, role))

    if (!isPlatformSuperAdmin && canManage) {
      list.push(
        {
          key: "reports",
          title: "Reports",
          href: "/reports/coupon-usage",
          icon: BarChart3Icon,
          isActive: (current) => current.startsWith("/reports"),
          items: [
            ...(enabled("appointments") && can(["appointments.read", "appointmentCoupons.read"]) ? [{
              title: "Coupon usage",
              href: "/reports/coupon-usage",
              icon: TagIcon,
              isActive: (current: string) => current === "/reports/coupon-usage",
            }] : []),
            {
              title: "Audit logs",
              href: "/reports/audit-logs",
              icon: BarChart3Icon,
              isActive: (current) => current === "/reports/audit-logs",
            },
          ],
        },
        ...inventoryNavigation(flags, permissions),
        ...appointmentsNavigation(flags, permissions),
        ...servicesNavigation(flags, permissions),
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
              { title: "Access roles", href: "/settings/roles", icon: UsersIcon, isActive: (current) => current.startsWith("/settings/roles") },
              { title: "Modules", href: "/settings/modules", icon: PackageIcon, isActive: (current) => current === "/settings/modules" },
              { title: "Taxes", href: "/settings/taxes", icon: TagIcon, isActive: (current) => current === "/settings/taxes" },
              { title: "Seeds", href: "/settings/seeds", icon: PackageIcon, isActive: (current) => current === "/settings/seeds" },
            ],
      })
    }

    return list.flatMap(section => {
      if (isPlatformConsoleUser) return [section]
      const items = section.items.filter(item => {
        if (["/settings/roles", "/settings/modules", "/settings/seeds", "/users/invites"].includes(item.href)) return role === "ADMIN"
        if (item.href === "/reports/audit-logs") return can("auditLogs.read")
        if (item.href === "/users") return can("users.read")
        if (item.href === "/settings") return can("businessSettings.read")
        if (item.href === "/settings/taxes") return can("taxRates.read")
        return true
      })
      return items.length ? [{ ...section, items, href: items[0].href }] : []
    })
  }, [canManage, isPlatformConsoleUser, isPlatformSuperAdmin, role, flags, permissions, enabled, can])

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
              alt="Leiweissen ERP"
              className="h-auto w-[150px] max-w-full object-contain"
              onError={() => setLogoLoadFailed(true)}
            />
          ) : (
            <div className="text-sm font-semibold">Leiweissen ERP</div>
          )}
        </div>
      </SidebarHeader>
      <SidebarSeparator />
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel></SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {!isPlatformConsoleUser && navItems.filter(() => can("dashboard.read")).map((item) => {
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
