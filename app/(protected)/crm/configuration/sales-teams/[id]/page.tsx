import { SalesTeamEditor } from "@/modules/crm/components/sales-teams"
export default async function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <SalesTeamEditor id={id === "new" ? undefined : id} /> }
