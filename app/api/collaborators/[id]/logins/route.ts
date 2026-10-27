import { withCollaboratorApi, collaboratorQuery } from "@/platform/collaborators/http"
export const dynamic = "force-dynamic"
export function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withCollaboratorApi(request, async service => service.logins((await params).id, collaboratorQuery(request)))
}
