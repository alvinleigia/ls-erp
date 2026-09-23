import { withCrmApi } from "@/modules/crm/http"
import { readJson } from "@/platform/business-api"
export const dynamic = "force-dynamic"
type Context = { params: Promise<{ id: string }> }
export const GET = (request: Request, context: Context) => withCrmApi(request, async service => service.getFollowUpRule((await context.params).id))
export const PATCH = (request: Request, context: Context) => withCrmApi(request, async service => service.updateFollowUpRule((await context.params).id, await readJson(request)))
