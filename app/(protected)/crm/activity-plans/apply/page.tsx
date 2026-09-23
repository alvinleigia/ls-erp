import { ActivityPlanApply } from "@/modules/crm/components/activity-plan-apply"
export default async function Page({ searchParams }: { searchParams: Promise<{ planId?: string; contactId?: string; enquiryId?: string; opportunityId?: string }> }) { const query = await searchParams; return <ActivityPlanApply key={JSON.stringify(query)} initial={query} /> }
