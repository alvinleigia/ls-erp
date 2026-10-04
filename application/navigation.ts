import type { Permission } from "@/platform/access/catalog"
import { satisfies } from "@/platform/access/policy"
import { routeRequirement, routeResource } from "@/platform/access/routes"
import { ScissorsIcon, BarChart3Icon, Building2Icon, CalendarClockIcon, FileTextIcon, MailIcon, PackageIcon, SettingsIcon, TagIcon, UsersIcon } from "lucide-react"
import { businessModules, moduleEnabled, type ModuleFlag } from "@/platform/modules"
import { crmConfigurationGroups } from "@/modules/crm/configuration"

const matches = (base: string, current: string) => current === base || current.startsWith(`${base}/`)
const configMatches = (group: typeof crmConfigurationGroups[number], current: string) => group.items.some(item => matches(item.href, current))
const entry = (title: string, href: string, icon: typeof UsersIcon, isActive = (current: string) => matches(href, current)) => ({ title, href, icon, isActive })

export function inventoryNavigation(flags: ModuleFlag[], permissions?: Permission[]) {
  if (!moduleEnabled(flags, "inventory")) return []
  const items = [entry("Products", "/inventory", PackageIcon, current => current === "/inventory"), entry("Categories", "/inventory/categories", TagIcon), entry("Suppliers", "/inventory/suppliers", UsersIcon), entry("Purchases", "/inventory/purchases", CalendarClockIcon)]
    .filter(item => satisfies({ permissions }, routeRequirement(item.href)!))
  return items.length ? [{ key: "inventory", title: "Inventory", icon: PackageIcon, href: items[0].href, items, isActive: (current: string) => matches("/inventory", current) }] : []
}

export function appointmentsNavigation(flags: ModuleFlag[], permissions?: Permission[]) {
  if (!moduleEnabled(flags, "appointments")) return []
  const items = [entry("Bookings", "/appointments", CalendarClockIcon, current => current === "/appointments" || (current.startsWith("/appointments/") && !current.startsWith("/appointments/coupons"))), entry("Coupons", "/appointments/coupons", TagIcon)]
    .filter(item => satisfies({ permissions }, routeRequirement(item.href)!))
  return items.length ? [{ key: "appointments", title: "Appointments", icon: CalendarClockIcon, href: items[0].href, items, isActive: (current: string) => matches("/appointments", current) }] : []
}

export function servicesNavigation(flags: ModuleFlag[], permissions?: Permission[]) {
  if (!moduleEnabled(flags, "services")) return []
  const items = [entry("Services", "/services", ScissorsIcon, current => current === "/services"), entry("Categories", "/services/categories", TagIcon)]
    .filter(item => satisfies({ permissions }, routeRequirement(item.href)!))
  return items.length ? [{ key: "services", title: "Services", icon: ScissorsIcon, href: items[0].href, items, isActive: (current: string) => matches("/services", current) }] : []
}

// Navigation groups share capability definitions, but are not separate databases/modules.
export function businessNavigation(flags: ModuleFlag[], permissions?: Permission[]) {
  if (!moduleEnabled(flags, "crm")) return []
  const groups = [
    { key: "crm", title: "CRM", icon: UsersIcon, items: [
      entry("Enquiries", "/crm/enquiries", MailIcon), entry("Opportunities", "/crm/opportunities", Building2Icon),
      entry("Sales reports", "/crm/sales", BarChart3Icon),
      entry("Configuration", "/crm/configuration", SettingsIcon, current => current === "/crm/configuration" || configMatches(crmConfigurationGroups[0], current)),
    ] },
    { key: "contacts", title: "Contacts", icon: UsersIcon, items: [entry("People", "/crm/contacts", UsersIcon), entry("Business accounts", "/crm/accounts", Building2Icon)] },
    { key: "activities", title: "Activities", icon: CalendarClockIcon, items: [
      entry("Overview", "/crm/overview", BarChart3Icon), entry("My Work", "/crm/activities", CalendarClockIcon, current => matches("/crm/activities", current) || matches("/crm/tasks", current)),
      entry("Calendar", "/crm/calendar", CalendarClockIcon),
      entry("Configuration", "/crm/activity-configuration", SettingsIcon, current => current === "/crm/activity-configuration" || configMatches(crmConfigurationGroups[1], current)),
    ] },
  ]
  if (moduleEnabled(flags, "salesDocuments")) groups.push({ key: "salesDocuments", title: businessModules.salesDocuments.name, icon: FileTextIcon, items: [entry("Quotations", businessModules.salesDocuments.href, FileTextIcon), entry("Templates", "/crm/configuration/quotation-templates", SettingsIcon)] })
  if (moduleEnabled(flags, "realEstate")) groups.push({ key: "realEstate", title: businessModules.realEstate.name, icon: Building2Icon, items: [entry("Projects", businessModules.realEstate.href, Building2Icon), entry("Configuration", "/crm/configuration/real-estate", SettingsIcon)] })
  return groups.map(group => ({ ...group, items: group.items.filter(item => { const requirement = routeRequirement(item.href); return !!requirement && satisfies({ permissions }, requirement) }) })).filter(group => group.items.length).map(group => ({ ...group, href: group.items[0].href, isActive: (current: string) => group.items.some(item => item.isActive(current)) }))
}

export function workforceNavigation(flags: ModuleFlag[], permissions: Permission[] | undefined, role: string | null | undefined) {
  if (!["ADMIN", "MANAGER", "STAFF"].includes(role || "")) return []
  const groups = []
  if (moduleEnabled(flags, "leaves")) {
    const items = [
      ...(role !== "ADMIN" ? [entry("Requests", "/leaves/requests", CalendarClockIcon)] : []),
      ...(role !== "STAFF" ? [entry("Approvals", "/leaves/approvals", UsersIcon), entry("Definitions", "/leaves", CalendarClockIcon, current => routeResource(current) === "leaveDefinitions"), entry("Groups", "/leaves/groups", UsersIcon)] : []),
    ].filter(item => satisfies({ permissions }, routeRequirement(item.href)!))
    if (items.length) groups.push({ key: "leaves", title: "Leaves", icon: CalendarClockIcon, href: items[0].href, items, isActive: (current: string) => matches("/leaves", current) })
  }
  if (role !== "STAFF" && moduleEnabled(flags, "shifts")) {
    const items = [entry("Templates", "/shifts", CalendarClockIcon, current => current === "/shifts"), entry("Schedules", "/shifts/schedules", CalendarClockIcon), entry("Roster", "/shifts/roster", CalendarClockIcon), entry("Recurring plans", "/shifts/recurring", CalendarClockIcon)]
      .filter(item => satisfies({ permissions }, routeRequirement(item.href)!))
    if (items.length) groups.push({ key: "shifts", title: "Shifts", icon: CalendarClockIcon, href: items[0].href, items, isActive: (current: string) => matches("/shifts", current) })
  }
  return groups
}
