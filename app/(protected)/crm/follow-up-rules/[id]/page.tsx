import { FollowUpRuleEditor } from "@/modules/crm/components/follow-up-rule-editor"
export default async function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <FollowUpRuleEditor key={id} id={id} /> }
