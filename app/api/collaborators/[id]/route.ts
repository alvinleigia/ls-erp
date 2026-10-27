import { readJson } from "@/platform/business-api"
import { withCollaboratorApi } from "@/platform/collaborators/http"
export const dynamic = "force-dynamic"
type Context = { params: Promise<{ id: string }> }
export function GET(request: Request, { params }: Context) { return withCollaboratorApi(request, async service => service.get((await params).id)) }
export function PATCH(request: Request, { params }: Context) { return withCollaboratorApi(request, async service => service.update((await params).id, await readJson(request))) }
