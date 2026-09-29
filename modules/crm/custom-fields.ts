import type { FieldResource } from "@/platform/custom-fields/resources"
export const enquiryFields: FieldResource = { key: "enquiry", label: "Enquiries", module: "crm", table: "CrmEnquiryFieldValue", scopes: ["ENQUIRY", "SALES"] }
export const opportunityFields: FieldResource = { key: "opportunity", label: "Opportunities", module: "crm", table: "CrmOpportunityFieldValue", scopes: ["OPPORTUNITY", "SALES"] }
