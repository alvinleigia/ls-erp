import { withTeamApi } from "@/platform/teams/http"
import { salesTeamSchema } from "@/platform/teams/service"
export const dynamic = "force-dynamic"
type Context = { params: Promise<{ id: string }> }
const teamSchema = salesTeamSchema.omit({ workflow: true })
export function GET(request: Request, context: Context) { return withTeamApi(request, async service => service.getTeam((await context.params).id)) }
export function PATCH(request: Request, context: Context) { return withTeamApi(request, async service => service.saveTeam(teamSchema.parse(await request.json()), (await context.params).id)) }
