import { withTeamApi, queryInput } from "@/platform/teams/http"
export const dynamic = "force-dynamic"
export function GET(request: Request) { return withTeamApi(request, service => service.listAssignableUsers(queryInput(request))) }
