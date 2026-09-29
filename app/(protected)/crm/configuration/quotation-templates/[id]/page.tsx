import { QuotationEditor } from "@/modules/crm/components/quotations"
export default async function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <QuotationEditor template id={id === "new" ? undefined : id} /> }
