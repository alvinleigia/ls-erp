import type { Resource } from "./catalog"

export const recordPolicyDescriptions = {
  sales: "Sales scope: own assignments, managed teams or all records; related records inherit source access.",
  projects: "Project scope: explicit assignments and project teams; subprojects inherit their parent. General catalog items remain shared.",
  personal: "Own requests only.",
  reportingManager: "Assigned reporting manager only; team management does not grant approval authority.",
  workforce: "Workforce authority and action permissions. Shared schedules affect multiple employees.",
  operations: "Manager/Admin authority and action permissions; records have no team assignment.",
  shared: "Tenant-shared reference data, subject to module and action permissions.",
  administrative: "Administrative account authority and action permissions.",
  sources: "Each source module's record policy; filters can only narrow access.",
} as const
export type ResourceRecordPolicy = keyof typeof recordPolicyDescriptions
// Exhaustive: registering a resource also requires an explicit record policy.
export const resourceRecordPolicies = {
  receivables: "sales", orderPayments: "sales", unitReservations: "sales", salesOrders: "sales",
  catalogItems: "projects", dashboard: "sources", auditLogs: "administrative", users: "administrative",
  businessSettings: "shared", taxRates: "shared", leaveRequests: "personal", leaveApprovals: "reportingManager",
  leaveDefinitions: "shared", leaveGroups: "shared", shiftTemplates: "workforce", shiftSchedules: "workforce",
  shiftPlans: "workforce", shiftRoster: "workforce", appointments: "operations", appointmentCoupons: "shared",
  services: "shared", serviceCategories: "shared", inventoryProducts: "shared", inventoryCategories: "shared",
  inventorySuppliers: "shared", inventoryPurchases: "operations", contacts: "sales", accounts: "sales",
  enquiries: "sales", opportunities: "sales", activities: "sales", reports: "sales", pipelines: "shared",
  leadSources: "shared", lostReasons: "shared", activityTypes: "shared", activityPlans: "shared", followUpRules: "shared",
  teams: "administrative", customFields: "shared", projects: "projects", projectSettings: "shared",
  quotations: "sales", quotationTemplates: "shared",
} as const satisfies Record<Resource, ResourceRecordPolicy>
