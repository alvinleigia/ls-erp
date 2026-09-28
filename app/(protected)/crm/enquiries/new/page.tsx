import { EnquiryEditor } from "@/modules/crm/components/enquiry-editor"
export default async function NewEnquiryPage({ searchParams }: { searchParams: Promise<{ contactId?: string; projectId?: string; subprojectId?: string }> }) {
  const query = await searchParams
  return <EnquiryEditor key={`${query.contactId}-${query.projectId}-${query.subprojectId}`} initialContactId={query.contactId} initialProjectId={query.projectId} initialSubprojectId={query.subprojectId} />
}
