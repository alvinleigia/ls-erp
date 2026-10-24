import { withTeamApi, queryInput } from "@/platform/teams/http"
import { salesTeamSchema } from "@/platform/teams/service"
export const dynamic = "force-dynamic"
const teamSchema = salesTeamSchema.omit({ workflow: true })
export function GET(request: Request) { return withTeamApi(request, service => service.listTeams(queryInput(request))) }
export function POST(request: Request) { return withTeamApi(request, async service => service.saveTeam(teamSchema.parse(await request.json())), 201) }
