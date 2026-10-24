// Register actual business records, not configuration or access-profile records.
export const sharingRecords = {
  contacts: { model: "crmContact", table: "CrmContact", label: "Contact", title: "name", module: "crm", owner: "ownerUserId" },
  accounts: { model: "crmAccount", table: "CrmAccount", label: "Business account", title: "name", module: "crm", owner: "ownerUserId" },
  enquiries: { model: "crmEnquiry", table: "CrmEnquiry", label: "Enquiry", title: "title", module: "crm", owner: "assignedUserId" },
  opportunities: { model: "crmOpportunity", table: "CrmOpportunity", label: "Opportunity", title: "title", module: "crm", owner: "assignedUserId" },
  activities: { model: "crmTask", table: "CrmTask", label: "Activity", title: "title", module: "crm", owner: "assignedUserId" },
  projects: { model: "realEstateProject", table: "RealEstateProject", label: "Project", title: "name", module: "realEstate", owner: null },
  quotations: { model: "crmQuotation", table: "CrmQuotation", label: "Quotation", title: "id", module: "salesDocuments", owner: null },
  salesOrders: { model: "salesOrder", table: "SalesOrder", label: "Sales order", title: "title", module: "salesOrders", owner: null },
} as const
export type SharingResource = keyof typeof sharingRecords
export function sharingResource(resource: string): SharingResource | undefined {
  if (["receivables", "orderPayments", "unitReservations"].includes(resource)) return "salesOrders"
  if (resource === "projectMembers") return "projects"
  return Object.hasOwn(sharingRecords, resource) ? resource as SharingResource : undefined
}
