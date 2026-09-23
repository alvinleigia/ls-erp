import { withCrmApi } from "@/modules/crm/http"
import { readJson } from "@/platform/business-api"
type Context = { params: Promise<{ id: string }> }
export const GET = (request: Request, context: Context) => withCrmApi(request, async service => service.getPipeline((await context.params).id))
export const PATCH = (request: Request, context: Context) => withCrmApi(request, async service => service.updatePipeline((await context.params).id, await readJson(request)))
