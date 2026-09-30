import type { FieldResource } from "@/platform/custom-fields/resources"
export const enquiryFields: FieldResource = { key: "enquiry", permissionResource: "enquiries", label: "Enquiries", module: "crm", table: "CrmEnquiryFieldValue", scopes: ["ENQUIRY", "SALES"] }
export const opportunityFields: FieldResource = { key: "opportunity", permissionResource: "opportunities", label: "Opportunities", module: "crm", table: "CrmOpportunityFieldValue", scopes: ["OPPORTUNITY", "SALES"] }
