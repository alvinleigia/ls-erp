import { BarChart3Icon, Building2Icon, CalendarClockIcon, FileTextIcon, MailIcon, SettingsIcon, UsersIcon } from "lucide-react"
import { businessModules, moduleEnabled, type ModuleFlag } from "@/platform/modules"
import { crmConfigurationGroups } from "@/modules/crm/configuration"

const matches = (base: string, current: string) => current === base || current.startsWith(`${base}/`)
const configMatches = (group: typeof crmConfigurationGroups[number], current: string) => group.items.some(item => matches(item.href, current))
const entry = (title: string, href: string, icon: typeof UsersIcon, isActive = (current: string) => matches(href, current)) => ({ title, href, icon, isActive })

// Navigation groups share capability definitions, but are not separate databases/modules.
export function businessNavigation(flags: ModuleFlag[]) {
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
  return groups.map(group => ({ ...group, href: group.items[0].href, isActive: (current: string) => group.items.some(item => item.isActive(current)) }))
}
