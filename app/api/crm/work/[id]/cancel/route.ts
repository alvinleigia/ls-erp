import { withCrmApi } from "@/modules/crm/http"
import { readJson } from "@/platform/business-api"
export const POST = (request: Request, context: { params: Promise<{ id: string }> }) => withCrmApi(request, async service => service.cancelWork((await context.params).id, await readJson(request)))
