import { EnquiryEditor } from "@/modules/crm/components/enquiry-editor"
import { OpportunityEditor } from "@/modules/crm/components/opportunity-editor"
import type { CrmCreateQuery } from "@/modules/crm/view-context"
import { realEstateViewReferences } from "@/modules/real-estate/crm-view-context"

export function NewEnquiry({ query }: { query: CrmCreateQuery }) {
  const references = realEstateViewReferences(query)
  const contactId = typeof query.contactId === "string" ? query.contactId : undefined
  return <EnquiryEditor key={JSON.stringify([contactId, references])} initialContactId={contactId} initialReferences={references} />
}

export function NewOpportunity({ query }: { query: CrmCreateQuery }) {
  const references = realEstateViewReferences(query)
  const enquiryId = typeof query.enquiryId === "string" ? query.enquiryId : undefined
  return <OpportunityEditor key={JSON.stringify([enquiryId, references])} enquiryId={enquiryId} initialReferences={references} />
}
