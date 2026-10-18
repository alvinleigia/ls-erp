import { recordTerms } from "@/platform/terminology/catalog"
export const crmTerms = recordTerms("crm", "CRM", [
  ["enquiry", "Enquiry", "Enquiries"], ["opportunity", "Opportunity", "Opportunities"],
  ["contact", "Contact", "Contacts"], ["account", "Business account", "Business accounts"],
  ["activity", "Activity", "Activities"],
])
