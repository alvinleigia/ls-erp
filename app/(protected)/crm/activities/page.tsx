import { WorkList } from "@/modules/crm/components/work-list"
export default async function Page({ searchParams }: { searchParams: Promise<{ due?: string; contactId?: string; opportunityId?: string; enquiryId?: string }> }) { const query = await searchParams; return <WorkList {...query} initialDue={query.due} /> }
