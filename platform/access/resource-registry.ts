import type { Prisma } from "@prisma/client"
import type { Resource } from "./catalog"
import type { ResourceRecordPolicy } from "./resource-policy"

type Models = readonly [Prisma.ModelName, ...Prisma.ModelName[]]
type Sources = readonly [Resource, ...Resource[]]
export type OwnershipPart = {
  kind: "shared" | "security" | "office" | "personal"
  roots: Models
  children?: readonly Prisma.ModelName[]
} | {
  kind: "source" | "composed"
  roots: Models
  sources: Sources
  children?: readonly Prisma.ModelName[]
}
export type ResourceOwnership = OwnershipPart | { kind: "split"; description: string; parts: Readonly<Record<string, OwnershipPart>> }
type ResourceContract = { policy: ResourceRecordPolicy; ownership: ResourceOwnership; record?: Prisma.ModelName; sharing?: Resource }

// Ownership describes existing canonical adapters, not a generic query builder.
// Source links never grant actions or require the caller to browse a private
// parent/configuration directory. Native RLS and each source adapter authorize.
// Adding a permission resource requires a contract here; model names are checked
// against the generated Prisma schema. No data/default/scope migration is implied.
export const resourceRegistry = {
  customerInvoices: { policy: "sales", ownership: { kind: "source", roots: ["CustomerInvoice"], children: ["CustomerCreditNote", "CustomerInvoiceEvent"], sources: ["salesOrders", "receivables"] }, sharing: "salesOrders" },
  invoicePayments: { policy: "sales", ownership: { kind: "source", roots: ["InvoicePaymentApplication"], children: ["InvoicePaymentRelease"], sources: ["customerInvoices", "orderPayments"] }, sharing: "salesOrders" },
  invoiceDocuments: { policy: "sales", ownership: { kind: "source", roots: ["CustomerInvoiceDocument"], sources: ["customerInvoices"] }, sharing: "salesOrders" },
  orderDocuments: { policy: "sales", ownership: { kind: "source", roots: ["SalesOrderDocument"], sources: ["salesOrders"] }, sharing: "salesOrders" },
  paymentDocuments: { policy: "sales", ownership: { kind: "source", roots: ["OrderReceiptDocument"], sources: ["orderPayments"] }, sharing: "salesOrders" },
  documentTemplates: { policy: "shared", ownership: { kind: "shared", roots: ["BusinessDocumentTemplate"] } },
  receivables: { policy: "sales", ownership: { kind: "source", roots: ["OrderReceivable"], children: ["OrderReceivableLine"], sources: ["salesOrders"] }, sharing: "salesOrders" },
  orderPayments: { policy: "sales", ownership: { kind: "source", roots: ["OrderReceipt"], children: ["OrderReceiptAllocation", "OrderReceiptReversal"], sources: ["salesOrders"] }, sharing: "salesOrders" },
  unitReservations: { policy: "sales", ownership: { kind: "source", roots: ["UnitReservation"], children: ["UnitReservationEvent"], sources: ["salesOrders", "catalogItems"] }, sharing: "salesOrders" },
  salesOrders: { policy: "sales", record: "SalesOrder", ownership: { kind: "source", roots: ["SalesOrder"], children: ["SalesOrderEvent"], sources: ["quotations"] }, sharing: "salesOrders" },
  catalogItems: { policy: "projects", ownership: { kind: "split", description: "General catalog items are shared. Industry units inherit their project; reservation availability never grants access to private orders.", parts: {
    catalog: { kind: "shared", roots: ["CatalogItem"] }, units: { kind: "source", roots: ["RealEstateUnit"], sources: ["projects"] },
    availability: { kind: "source", roots: ["CatalogReservationAvailability"], sources: ["catalogItems"] },
  } } },
  dashboard: { policy: "sources", ownership: { kind: "composed", roots: ["CrmEnquiry", "AppointmentOrder", "InventoryOfficeStock"], sources: ["enquiries", "opportunities", "activities", "quotations", "projects", "appointments", "inventoryProducts", "leaveApprovals", "services"] } },
  auditLogs: { policy: "administrative", ownership: { kind: "composed", roots: ["AuditLog"], sources: ["users", "businessSettings", "participantSettings", "documentTemplates", "orderDocuments", "paymentDocuments", "customerInvoices", "invoicePayments", "invoiceDocuments", "teams", "contacts", "accounts", "enquiries", "opportunities", "activities", "projects", "quotations", "salesOrders", "receivables", "orderPayments", "catalogItems", "unitReservations", "appointments", "appointmentCoupons", "inventoryProducts", "inventoryCategories", "inventorySuppliers", "inventoryPurchases", "services", "serviceCategories", "leaveApprovals", "leaveDefinitions", "leaveGroups", "shiftTemplates", "shiftSchedules", "shiftPlans", "shiftRoster", "branding", "taxRates", "customFields", "quotationTemplates"] } },
  users: { policy: "administrative", ownership: { kind: "security", roots: ["User"], children: ["StaffProfile", "StaffCertification", "StaffDocument", "TenantAccessRole", "TenantRoleAssignment", "TenantUserAccess", "Invitation", "BusinessCompany", "BusinessOffice", "BusinessOfficePolicy", "BusinessOfficeGrant", "BusinessCompanyGrant", "ExternalCollaborator"] } },
  assignmentTargets: { policy: "directory", ownership: { kind: "composed", roots: ["User", "BusinessTeamMember", "StaffProfile"], sources: ["teams", "enquiries", "opportunities", "projects"] } },
  restrictedFields: { policy: "shared", ownership: { kind: "composed", roots: ["CustomFieldDefinition", "CrmEnquiryFieldValue", "CrmOpportunityFieldValue", "RealEstateProjectFieldValue"], sources: ["customFields", "enquiries", "opportunities", "projects"] } },
  branding: { policy: "shared", ownership: { kind: "shared", roots: ["AppSetting"] } },
  teamMembers: { policy: "teams", ownership: { kind: "source", roots: ["BusinessTeamMember"], sources: ["teams"] } },
  projectMembers: { policy: "projects", ownership: { kind: "source", roots: ["RealEstateProjectMember"], sources: ["projects"] }, sharing: "projects" },
  participantSettings: { policy: "shared", ownership: { kind: "shared", roots: ["ParticipantFormConfiguration"] } },
  businessSettings: { policy: "shared", ownership: { kind: "shared", roots: ["AppSetting", "TenantTerminology", "TenantTerminologyRevision"], children: ["AppSettingDay", "AppSettingPeriod", "AppSettingOverride", "AppSettingOverridePeriod"] } },
  taxRates: { policy: "shared", ownership: { kind: "shared", roots: ["Tax"] } },
  leaveRequests: { policy: "personal", ownership: { kind: "personal", roots: ["LeaveRequest"] } },
  leaveApprovals: { policy: "reportingManager", ownership: { kind: "source", roots: ["LeaveRequest"], sources: ["leaveRequests"] } },
  leaveDefinitions: { policy: "shared", ownership: { kind: "shared", roots: ["LeaveDefinition"], children: ["LeaveDefinitionNonClubbable"] } },
  leaveGroups: { policy: "shared", ownership: { kind: "shared", roots: ["LeaveGroup"], children: ["LeaveGroupLeave", "LeaveGroupStaffAssignment"] } },
  shiftTemplates: { policy: "workforce", ownership: { kind: "shared", roots: ["ShiftTemplate"], children: ["ShiftTemplateBreak"] } },
  shiftSchedules: { policy: "workforce", ownership: { kind: "office", roots: ["ShiftSchedule"], children: ["ShiftScheduleBlock", "StaffScheduleAssignment"] } },
  shiftPlans: { policy: "workforce", ownership: { kind: "office", roots: ["StaffFlexibleWeekPlan", "StaffFlexiblePattern"], children: ["StaffFlexibleWeekDay", "StaffFlexibleWeekSlot", "StaffFlexibleWeekBreak", "StaffFlexiblePatternWeek", "StaffFlexiblePatternDay", "StaffFlexiblePatternSlot", "StaffFlexiblePatternBreak"] } },
  shiftRoster: { policy: "workforce", ownership: { kind: "split", description: "Daily work keeps its saved office. Roster hours and personal history retain their source privacy; office grants and dated workplaces are separate.", parts: {
    daily: { kind: "office", roots: ["StaffFlexibleAvailability", "StaffShiftOverride"] }, history: { kind: "personal", roots: ["StaffRosterHistoryDay", "StaffRosterLeaveSnapshot"] },
    placement: { kind: "personal", roots: ["StaffWorkplacePolicy", "StaffWorkplaceAssignment", "StaffProfile"] },
    browse: { kind: "composed", roots: ["StaffProfile"], sources: ["shiftSchedules", "shiftPlans", "leaveRequests"] },
  } } },
  appointments: { policy: "operations", ownership: { kind: "office", roots: ["Appointment", "AppointmentOrder"], children: ["AppointmentOrderLine", "AppointmentOrderProductLine", "AppointmentOrderCoupon", "AppointmentOrderTax"] } },
  appointmentCoupons: { policy: "shared", ownership: { kind: "shared", roots: ["Coupon"] } },
  services: { policy: "shared", ownership: { kind: "shared", roots: ["Service"], children: ["ServicePackageItem", "ServiceTax", "StaffServiceEligibility"] } },
  serviceCategories: { policy: "shared", ownership: { kind: "shared", roots: ["ServiceCategory"] } },
  inventoryProducts: { policy: "shared", ownership: { kind: "split", description: "Product definitions are shared. Stock, costs and reorder settings are limited to permitted offices; saved booking and receipt allocations retain their source.", parts: {
    catalog: { kind: "shared", roots: ["InventoryProduct"], children: ["InventoryProductSupplier", "InventoryProductTax"] },
    stock: { kind: "office", roots: ["InventoryOfficeStock", "InventoryStockMovement"] },
    bookings: { kind: "source", roots: ["InventoryBookingStock"], sources: ["appointments"] }, receipts: { kind: "source", roots: ["InventoryReceiptStock"], sources: ["inventoryPurchases"] },
  } } },
  inventoryCategories: { policy: "shared", ownership: { kind: "shared", roots: ["InventoryCategory"] } },
  inventorySuppliers: { policy: "shared", ownership: { kind: "shared", roots: ["Supplier"] } },
  inventoryPurchases: { policy: "operations", ownership: { kind: "office", roots: ["PurchaseOrder"], children: ["PurchaseOrderItem"] } },
  contacts: { policy: "sales", record: "CrmContact", ownership: { kind: "shared", roots: ["CrmContact"], children: ["CrmAccountContact"] }, sharing: "contacts" },
  accounts: { policy: "sales", record: "CrmAccount", ownership: { kind: "shared", roots: ["CrmAccount"], children: ["CrmAccountContact"] }, sharing: "accounts" },
  enquiries: { policy: "sales", record: "CrmEnquiry", ownership: { kind: "office", roots: ["CrmEnquiry", "CrmEnquiryImport"], children: ["CrmEnquiryImportRow", "CrmActivity", "RealEstateEnquiryContext", "CrmEnquiryFieldValue"] }, sharing: "enquiries" },
  opportunities: { policy: "sales", record: "CrmOpportunity", ownership: { kind: "office", roots: ["CrmOpportunity"], children: ["CrmOpportunityParticipant", "CrmOpportunityActivity", "RealEstateOpportunityContext", "CrmOpportunityFieldValue"] }, sharing: "opportunities" },
  activities: { policy: "sales", record: "CrmTask", ownership: { kind: "office", roots: ["CrmTask", "CrmPlanLaunch"], children: ["CrmTaskEvent"] }, sharing: "activities" },
  reports: { policy: "reporting", ownership: { kind: "composed", roots: ["CrmEnquiry", "CrmOpportunity", "CrmTask"], sources: ["enquiries", "opportunities", "activities", "projects", "quotations", "salesOrders", "receivables", "orderPayments"] } },
  pipelines: { policy: "shared", ownership: { kind: "shared", roots: ["CrmPipeline"], children: ["CrmStage"] } },
  configurationPresets: { policy: "shared", ownership: { kind: "composed", roots: ["CustomFieldDefinition", "CrmActivityType", "CrmLeadSource", "RealEstatePropertyCategory"], sources: ["customFields", "activityTypes", "leadSources", "projectSettings"] } },
  leadSources: { policy: "shared", ownership: { kind: "shared", roots: ["CrmLeadSource"] } },
  lostReasons: { policy: "shared", ownership: { kind: "shared", roots: ["CrmLostReason"] } },
  activityTypes: { policy: "shared", ownership: { kind: "shared", roots: ["CrmActivityType"] } },
  activityPlans: { policy: "shared", ownership: { kind: "shared", roots: ["CrmActivityPlan"] } },
  followUpRules: { policy: "shared", ownership: { kind: "shared", roots: ["CrmFollowUpRule"] } },
  teams: { policy: "teams", ownership: { kind: "shared", roots: ["BusinessTeam"] } },
  customFields: { policy: "shared", ownership: { kind: "shared", roots: ["CustomFieldDefinition"], children: ["CustomFieldOption"] } },
  projects: { policy: "projects", record: "RealEstateProject", ownership: { kind: "office", roots: ["RealEstateProject"], children: ["RealEstateProjectMember", "RealEstateProjectCategory", "RealEstateUnit", "RealEstateProjectFieldValue"] }, sharing: "projects" },
  projectSettings: { policy: "shared", ownership: { kind: "shared", roots: ["RealEstateProjectStatus", "RealEstatePropertyCategory", "RealEstateBuyingTimeframe"] } },
  quotations: { policy: "sales", record: "CrmQuotation", ownership: { kind: "source", roots: ["CrmQuotation"], children: ["CrmQuotationRevision"], sources: ["opportunities"] }, sharing: "quotations" },
  quotationTemplates: { policy: "shared", ownership: { kind: "shared", roots: ["CrmQuotationTemplate"] } },
} as const satisfies Record<Resource, ResourceContract>

// Every Prisma model must be covered by a resource contract or explicitly remain
// infrastructure. A new schema model cannot silently become tenant-shared data.
type PartModels<P> = P extends { roots: readonly (infer R)[] } ? R | (P extends { children: readonly (infer C)[] } ? C : never) : never
type OwnershipModels<O> = O extends { parts: infer P } ? PartModels<P[keyof P]> : PartModels<O>
type InfrastructureModel = Exclude<Prisma.ModelName, OwnershipModels<typeof resourceRegistry[Resource]["ownership"]>>
export const infrastructureModels = {
  SalesOrderSequence: "numbering",
  ReceiptDocumentSequence: "numbering",
  CustomerInvoiceSequence: "numbering",
  TenantModule: "tenantSecurity", Tenant: "tenantBoundary", TenantDomain: "tenantBoundary",
  Organization: "controlPlane", OrganizationMembership: "controlPlane",
  Account: "authentication", Session: "authentication", VerificationToken: "authentication", PasswordResetToken: "authentication",
  RecordSharingPolicy: "sourceSecurity", RecordSharingGrant: "sourceSecurity",
} as const satisfies Record<InfrastructureModel, "tenantSecurity" | "tenantBoundary" | "controlPlane" | "authentication" | "sourceSecurity" | "numbering">

export function ownershipDescription(resource: Resource): string {
  const ownership = resourceRegistry[resource].ownership
  switch (ownership.kind) {
    case "office": return "Records keep their saved office. Current office access also bounds every action."
    case "source": return "Linked records retain their source access and office; parent browsing permissions remain separate."
    case "shared": return "Shared data remains bounded by profiles, record limits and module activation."
    case "security": return "Security administration remains tenant-admin only. Membership and business actions are separate."
    case "personal": return "Personal requests and history retain their own access rules and saved office."
    case "composed": return "Every source keeps its own privacy and permissions; filters only narrow access."
    case "split": return ownership.description
  }
}
export function ownershipParts(resource: Resource): readonly OwnershipPart[] {
  const ownership = resourceRegistry[resource].ownership
  return ownership.kind === "split" ? Object.values(ownership.parts) : [ownership]
}
