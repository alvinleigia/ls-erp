import { EnquiryEditor } from "@/modules/crm/components/enquiry-editor"
export default async function EnquiryPage({ params }: { params: Promise<{ id: string }> }) { return <EnquiryEditor id={(await params).id} /> }
