import { withCrmApi, queryInput } from "@/application/crm/http"
export const dynamic = "force-dynamic"
export function GET(request: Request) { return withCrmApi(request, service => service.listSalesTeams(queryInput(request))) }
export function POST(request: Request) { return withCrmApi(request, async service => service.saveSalesTeam(await request.json()), 201) }
