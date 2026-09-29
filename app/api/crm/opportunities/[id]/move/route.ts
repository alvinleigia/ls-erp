import { withCrmApi } from "@/application/crm/http"
import { readJson } from "@/platform/business-api"
export const PATCH = (request: Request, context: { params: Promise<{ id: string }> }) => withCrmApi(request, async service => service.moveOpportunity((await context.params).id, await readJson(request)))
