import { QuotationEditor } from "@/modules/sales-documents/components/quotations"
export default async function Page({ searchParams }: { searchParams: Promise<{ opportunityId?: string }> }) { return <QuotationEditor opportunityId={(await searchParams).opportunityId} /> }
