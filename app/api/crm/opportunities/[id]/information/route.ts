import { withCrmApi } from "@/application/crm/http"
import { readJson } from "@/platform/business-api"
type Context = { params: Promise<{ id: string }> }
export const GET = (request: Request, context: Context) => withCrmApi(request, async service => service.getOpportunityParticipantInformation((await context.params).id))
export const PUT = (request: Request, context: Context) => withCrmApi(request, async service => service.saveOpportunityParticipantInformation((await context.params).id, await readJson(request)))
