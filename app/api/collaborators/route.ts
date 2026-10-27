import { readJson } from "@/platform/business-api"
import { withCollaboratorApi, collaboratorQuery } from "@/platform/collaborators/http"
export const dynamic = "force-dynamic"
export function GET(request: Request) { return withCollaboratorApi(request, service => service.list(collaboratorQuery(request))) }
export function POST(request: Request) { return withCollaboratorApi(request, async service => service.create(await readJson(request)), 201) }
