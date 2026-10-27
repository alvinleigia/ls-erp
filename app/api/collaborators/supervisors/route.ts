import { withCollaboratorApi, collaboratorQuery } from "@/platform/collaborators/http"
export const dynamic = "force-dynamic"
export function GET(request: Request) { return withCollaboratorApi(request, service => service.supervisors(collaboratorQuery(request))) }
