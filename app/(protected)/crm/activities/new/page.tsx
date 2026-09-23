import { WorkEditor } from "@/modules/crm/components/work-editor"
export default async function Page({ searchParams }: { searchParams: Promise<{ contactId?: string; enquiryId?: string; opportunityId?: string; log?: string; dueOn?: string; startsAt?: string; endsAt?: string }> }) { return <WorkEditor initial={await searchParams} /> }
