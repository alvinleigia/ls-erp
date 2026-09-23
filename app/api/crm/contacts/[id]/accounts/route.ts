import { withCrmApi, queryInput } from "@/modules/crm/http"
import { readJson } from "@/platform/business-api"
type Context = { params: Promise<{ id: string }> }
export const GET = (request: Request, context: Context) => withCrmApi(request, async service => service.listContactAccounts((await context.params).id, queryInput(request)))
export const POST = (request: Request, context: Context) => withCrmApi(request, async service => service.linkContactAccount((await context.params).id, await readJson(request)))
