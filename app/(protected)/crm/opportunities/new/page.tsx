import { OpportunityEditor } from "@/modules/crm/components/opportunity-editor"
export default async function Page({ searchParams }: { searchParams: Promise<{ enquiryId?: string }> }) { return <OpportunityEditor enquiryId={(await searchParams).enquiryId} /> }
