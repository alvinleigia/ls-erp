import type { BusinessModuleKey } from "../modules"

export const permissionActions = ["read", "create", "edit", "archive", "export", "assign", "approve"] as const
export type PermissionAction = typeof permissionActions[number]
const editable = ["read", "create", "edit"] as const
const records = ["read", "create", "edit", "archive"] as const
export const accessResources = {
  dashboard: { name: "Business dashboard", module: "core", actions: ["read"] },
  auditLogs: { name: "Audit reports", module: "core", actions: ["read"] },
  users: { name: "User directory (administrative)", module: "core", actions: ["read"] },
  businessSettings: { name: "Business settings", module: "core", actions: ["read", "edit"] },
  taxRates: { name: "Tax configuration", module: "core", actions: records },
  leaveRequests: { name: "My leave requests", module: "leaves", actions: ["read", "create", "archive"] },
  leaveApprovals: { name: "Leave approvals", module: "leaves", actions: ["read", "approve", "archive"] },
  leaveDefinitions: { name: "Leave definitions", module: "leaves", actions: records },
  leaveGroups: { name: "Leave groups and assignments", module: "leaves", actions: records },
  shiftTemplates: { name: "Shift templates", module: "shifts", actions: records },
  shiftSchedules: { name: "Shift schedules and assignments", module: "shifts", actions: records },
  shiftPlans: { name: "Recurring availability plans", module: "shifts", actions: records },
  shiftRoster: { name: "Roster and daily overrides", module: "shifts", actions: ["read", "edit", "archive"] },
  appointments: { name: "Bookings and calendar", module: "appointments", actions: [...records, "export"] },
  appointmentCoupons: { name: "Booking coupons", module: "appointments", actions: records },
  services: { name: "Services and packages", module: "services", actions: records },
  serviceCategories: { name: "Service categories", module: "services", actions: records },
  inventoryProducts: { name: "Inventory products and stock", module: "inventory", actions: records },
  inventoryCategories: { name: "Inventory categories", module: "inventory", actions: records },
  inventorySuppliers: { name: "Inventory suppliers", module: "inventory", actions: records },
  inventoryPurchases: { name: "Purchase orders", module: "inventory", actions: editable },
  contacts: { name: "Contacts", module: "crm", actions: records },
  accounts: { name: "Business accounts", module: "crm", actions: records },
  enquiries: { name: "Enquiries", module: "crm", actions: [...editable, "export", "assign"] },
  opportunities: { name: "Opportunities", module: "crm", actions: [...editable, "export", "assign"] },
  activities: { name: "Activities and calendar", module: "crm", actions: [...records, "export", "assign"] },
  reports: { name: "Sales and activity reports", module: "crm", actions: ["read", "export"] },
  pipelines: { name: "Pipelines", module: "crm", actions: records },
  leadSources: { name: "Lead sources", module: "crm", actions: records },
  lostReasons: { name: "Lost reasons", module: "crm", actions: records },
  activityTypes: { name: "Activity types", module: "crm", actions: records },
  activityPlans: { name: "Activity plans", module: "crm", actions: records },
  followUpRules: { name: "Follow-up rules", module: "crm", actions: records },
  salesTeams: { name: "Sales teams", module: "crm", actions: [...records, "assign"] },
  customFields: { name: "Custom field configuration", module: "crm", actions: records },
  projects: { name: "Projects and subprojects", module: "realEstate", actions: [...records, "export", "assign"] },
  projectSettings: { name: "Property choices", module: "realEstate", actions: records },
  quotations: { name: "Quotations", module: "salesDocuments", actions: [...editable, "export"] },
  quotationTemplates: { name: "Quotation templates", module: "salesDocuments", actions: records },
} as const satisfies Record<string, { name: string; module: BusinessModuleKey | "core"; actions: readonly PermissionAction[] }>
export type Resource = keyof typeof accessResources
export type Permission = `${Resource}.${PermissionAction}`
export type Requirement = Permission | { any: readonly Permission[] } | readonly Requirement[]
export const resourceKeys = Object.keys(accessResources) as Resource[]
export const allPermissions = resourceKeys.flatMap(resource => accessResources[resource].actions.map(action => `${resource}.${action}` as Permission))
export const workspaceRead: Requirement = { any: resourceKeys.filter(resource => (["crm", "realEstate", "salesDocuments", "paymentPlans"] as readonly string[]).includes(accessResources[resource].module)).map(resource => `${resource}.read` as Permission) }
export const roleTemplates = [
  { key: "manager", name: "Manager", permissions: allPermissions },
  { key: "salesperson", name: "Salesperson", permissions: allPermissions.filter(p => p.endsWith(".read") || ["contacts", "accounts", "enquiries", "opportunities", "activities", "quotations"].some(r => p.startsWith(`${r}.`) && !p.endsWith(".assign"))) },
  { key: "readonly", name: "Read-only", permissions: allPermissions.filter(p => p.endsWith(".read")) },
] as const
