import { ActivityPlanEditor } from "@/modules/crm/components/activity-plan-editor"
export default async function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <ActivityPlanEditor key={id} id={id} /> }
