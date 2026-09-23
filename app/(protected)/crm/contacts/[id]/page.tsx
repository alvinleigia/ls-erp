import { ContactEditor } from "@/modules/crm/components/contact-editor"
export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) { return <ContactEditor id={(await params).id} /> }
