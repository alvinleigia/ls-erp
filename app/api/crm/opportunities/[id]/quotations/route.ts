import { withCrmApi, queryInput } from "@/application/crm/http"
import { readJson } from "@/platform/business-api"
type Context = { params: Promise<{ id: string }> }
export const GET = (request: Request, context: Context) => withCrmApi(request, async service => service.listQuotations((await context.params).id, queryInput(request)))
export const POST = (request: Request, context: Context) => withCrmApi(request, async service => service.saveQuotation((await context.params).id, await readJson(request)), 201)
