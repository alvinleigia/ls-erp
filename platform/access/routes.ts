import type { Resource, Requirement } from "./catalog"
import { crmConfigurationGroups } from "@/modules/crm/configuration"

const routes: [string, Resource][] = [
  ["/dashboard", "dashboard"], ["/reports/audit-logs", "auditLogs"],
  ["/users", "users"], ["/settings/taxes", "taxRates"],
  ["/leaves/requests", "leaveRequests"], ["/leaves/approvals", "leaveApprovals"], ["/leaves/groups", "leaveGroups"], ["/leaves", "leaveDefinitions"],
  ["/shifts/recurring", "shiftPlans"], ["/shifts/roster", "shiftRoster"], ["/shifts/schedules", "shiftSchedules"], ["/shifts", "shiftTemplates"],
  ["/reports/coupon-usage", "appointmentCoupons"],
  ["/appointments/coupons", "appointmentCoupons"], ["/appointments", "appointments"],
  ["/services/categories", "serviceCategories"], ["/services", "services"],
  ["/inventory/categories", "inventoryCategories"], ["/inventory/suppliers", "inventorySuppliers"],
  ["/inventory/purchases", "inventoryPurchases"], ["/inventory", "inventoryProducts"],
  ["/crm/configuration/quotation-templates", "quotationTemplates"], ["/crm/configuration/real-estate", "projectSettings"],
  ["/crm/configuration/custom-fields", "customFields"], ["/crm/configuration/sales-teams", "salesTeams"], ["/crm/configuration/presets", "pipelines"],
  ["/crm/contacts", "contacts"], ["/crm/accounts", "accounts"], ["/crm/enquiries", "enquiries"], ["/crm/opportunities", "opportunities"],
  ["/crm/activities", "activities"], ["/crm/tasks", "activities"], ["/crm/calendar", "activities"],
  ["/crm/overview", "reports"], ["/crm/sales", "reports"], ["/crm/pipelines", "pipelines"], ["/crm/lead-sources", "leadSources"],
  ["/crm/lost-reasons", "lostReasons"], ["/crm/activity-types", "activityTypes"], ["/crm/activity-plans", "activityPlans"], ["/crm/follow-up-rules", "followUpRules"],
  ["/crm/projects", "projects"], ["/crm/quotations", "quotations"],
]
export function routeResource(path: string) { if (path === "/settings") return "businessSettings"; return routes.find(([base]) => path === base || path.startsWith(`${base}/`))?.[1] }
export function routeRequirement(path: string): Requirement | undefined {
  if (path === "/settings") return "businessSettings.read"
  if (path === "/reports/coupon-usage") return ["appointmentCoupons.read", "appointments.read"]
  if (path === "/crm/overview") return ["reports.read", "activities.read", "opportunities.read"]
  if (path === "/crm/sales" || path.startsWith("/crm/sales/")) return ["reports.read", "enquiries.read", "opportunities.read", "activities.read"]
  const resource = routeResource(path)
  if (resource) return `${resource}.${path.endsWith("/new") ? "create" : "read"}`
  if (path === "/crm/configuration" || path === "/crm/activity-configuration") return { any: crmConfigurationGroups[path === "/crm/configuration" ? 0 : 1].items.map(item => `${routeResource(item.href)!}.read` as const) }
  return undefined
}
