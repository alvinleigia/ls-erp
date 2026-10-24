import { TeamEditor } from "@/platform/teams/controls"
export default async function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <TeamEditor sales={false} id={id === "new" ? undefined : id} /> }
