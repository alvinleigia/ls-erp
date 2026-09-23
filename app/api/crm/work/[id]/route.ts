import { withCrmApi } from "@/modules/crm/http"
import { readJson } from "@/platform/business-api"
type Context = { params: Promise<{ id: string }> }
export const GET = (request: Request, context: Context) => withCrmApi(request, async service => service.getWork((await context.params).id))
export const PATCH = (request: Request, context: Context) => withCrmApi(request, async service => service.updateWork((await context.params).id, await readJson(request)))
