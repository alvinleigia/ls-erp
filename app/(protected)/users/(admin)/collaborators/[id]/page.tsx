import { CollaboratorEditor } from "@/platform/collaborators/controls"
export default async function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <CollaboratorEditor key={id} id={id} /> }
