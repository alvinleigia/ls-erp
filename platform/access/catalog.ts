import type { BusinessModuleKey } from "../modules"

export const permissionActions = ["read", "create", "edit", "archive", "export", "assign"] as const
export type PermissionAction = typeof permissionActions[number]
const editable = ["read", "create", "edit"] as const
const records = ["read", "create", "edit", "archive"] as const
export const accessResources = {
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
} as const satisfies Record<string, { name: string; module: BusinessModuleKey; actions: readonly PermissionAction[] }>
export type Resource = keyof typeof accessResources
export type Permission = `${Resource}.${PermissionAction}`
export type Requirement = Permission | { any: readonly Permission[] } | readonly Requirement[]
export const resourceKeys = Object.keys(accessResources) as Resource[]
export const allPermissions = resourceKeys.flatMap(resource => accessResources[resource].actions.map(action => `${resource}.${action}` as Permission))
export const workspaceRead: Requirement = { any: resourceKeys.map(resource => `${resource}.read` as Permission) }
export const roleTemplates = [
  { key: "manager", name: "Manager", permissions: allPermissions },
  { key: "salesperson", name: "Salesperson", permissions: allPermissions.filter(p => p.endsWith(".read") || ["contacts", "accounts", "enquiries", "opportunities", "activities", "quotations"].some(r => p.startsWith(`${r}.`) && !p.endsWith(".assign"))) },
  { key: "readonly", name: "Read-only", permissions: allPermissions.filter(p => p.endsWith(".read")) },
] as const
