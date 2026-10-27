import { CollaboratorLogins } from "@/platform/collaborators/login-controls"
export default async function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <CollaboratorLogins key={id} id={id} /> }
