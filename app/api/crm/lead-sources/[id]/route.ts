import { withCrmApi } from "@/application/crm/http"
import { readJson } from "@/platform/business-api"
type Context = { params: Promise<{ id: string }> }
export const PATCH = (request: Request, context: Context) => withCrmApi(request, async service => service.updateLeadSource((await context.params).id, await readJson(request)))
