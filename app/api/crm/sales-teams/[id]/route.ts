import { withCrmApi } from "@/application/crm/http"
export const dynamic = "force-dynamic"
type Context = { params: Promise<{ id: string }> }
export function GET(request: Request, context: Context) { return withCrmApi(request, async service => service.getSalesTeam((await context.params).id)) }
export function PATCH(request: Request, context: Context) { return withCrmApi(request, async service => service.saveSalesTeam(await request.json(), (await context.params).id)) }
