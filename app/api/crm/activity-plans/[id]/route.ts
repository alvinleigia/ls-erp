import { withCrmApi } from "@/modules/crm/http"
import { readJson } from "@/platform/business-api"
export const dynamic = "force-dynamic"
type Context = { params: Promise<{ id: string }> }
export const GET = (request: Request, context: Context) => withCrmApi(request, async service => service.getActivityPlan((await context.params).id))
export const PATCH = (request: Request, context: Context) => withCrmApi(request, async service => service.updateActivityPlan((await context.params).id, await readJson(request)))
