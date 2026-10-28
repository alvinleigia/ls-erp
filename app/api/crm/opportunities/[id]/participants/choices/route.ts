import { withCrmApi, queryInput } from "@/application/crm/http"
type Context = { params: Promise<{ id: string }> }
export const GET = (request: Request, context: Context) => withCrmApi(request, async service => service.listOpportunityParticipantChoices((await context.params).id, queryInput(request)))
