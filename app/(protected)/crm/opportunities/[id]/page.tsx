import { OpportunityEditor } from "@/modules/crm/components/opportunity-editor"
export default async function Page({ params }: { params: Promise<{ id: string }> }) { return <OpportunityEditor id={(await params).id} /> }
