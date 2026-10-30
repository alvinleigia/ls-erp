import type { Resource, Requirement } from "@/platform/access/catalog"
import { createRouteAccess } from "@/platform/access/routes"
import { crmConfigurationGroups } from "@/modules/crm/configuration"

const routes: [string, Resource][] = [
  ["/settings/tax-profiles", "taxProfiles"],
  ["/sales-orders/invoices", "customerInvoices"],
  ["/settings/documents", "documentTemplates"],
  ["/settings/customer-details", "participantSettings"],
  ["/users/teams", "teams"],
  ["/sales-orders/receivables", "receivables"],
  ["/sales-orders", "salesOrders"],
  ["/catalog", "catalogItems"],
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
  ["/crm/configuration/custom-fields", "customFields"], ["/crm/configuration/sales-teams", "teams"], ["/crm/configuration/presets", "configurationPresets"],
  ["/crm/contacts", "contacts"], ["/crm/accounts", "accounts"], ["/crm/enquiries", "enquiries"], ["/crm/opportunities", "opportunities"],
  ["/crm/activities", "activities"], ["/crm/tasks", "activities"], ["/crm/calendar", "activities"],
  ["/crm/overview", "reports"], ["/crm/sales", "reports"], ["/crm/pipelines", "pipelines"], ["/crm/lead-sources", "leadSources"],
  ["/crm/lost-reasons", "lostReasons"], ["/crm/activity-types", "activityTypes"], ["/crm/activity-plans", "activityPlans"], ["/crm/follow-up-rules", "followUpRules"],
  ["/crm/projects", "projects"], ["/crm/quotations", "quotations"],
]

const resourceFor = (path: string) => routes.find(([base]) => path === base || path.startsWith(`${base}/`))?.[1]
const configurationRequirement = (index: number): Requirement => ({ any: crmConfigurationGroups[index].items.map(item => `${resourceFor(item.href)!}.read` as const) })

export const applicationRouteAccess = createRouteAccess({
  resources: routes,
  exactResources: { "/settings": "businessSettings", "/settings/branding": "branding" },
  exactRequirements: {
    "/sales-orders/receivables": ["salesOrders.read", "receivables.read"],
    "/crm/enquiries/import": ["enquiries.create", "contacts.create"],
    "/settings": "businessSettings.read",
    "/reports/coupon-usage": ["appointmentCoupons.read", "appointments.read"],
    "/crm/overview": ["reports.read", "activities.read", "opportunities.read"],
    "/crm/configuration": configurationRequirement(0),
    "/crm/activity-configuration": configurationRequirement(1),
  },
  prefixRequirements: [["/crm/sales", ["reports.read", "enquiries.read", "opportunities.read", "activities.read"]]],
  protectedLinkPrefixes: ["/crm", "/sales-orders"],
})
export const { routeRequirement, routeResource } = applicationRouteAccess
