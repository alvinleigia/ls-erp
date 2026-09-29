import { withCrmApi, queryInput } from "@/application/crm/http"
export const dynamic = "force-dynamic"
type Context = { params: Promise<{ id: string }> }
export function GET(request: Request, context: Context) { return withCrmApi(request, async service => service.listSalesTeamMembers((await context.params).id, queryInput(request))) }
export function POST(request: Request, context: Context) { return withCrmApi(request, async service => service.changeSalesTeamMember((await context.params).id, await request.json())) }
