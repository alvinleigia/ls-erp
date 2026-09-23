import { EnquiryEditor } from "@/modules/crm/components/enquiry-editor"
export default async function NewEnquiryPage({ searchParams }: { searchParams: Promise<{ contactId?: string }> }) {
  return <EnquiryEditor initialContactId={(await searchParams).contactId} />
}
