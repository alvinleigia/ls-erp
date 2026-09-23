import { withCrmApi, queryInput } from "@/modules/crm/http"
export const GET = (request: Request, context: { params: Promise<{ id: string }> }) => withCrmApi(request, async service => service.listContactInteractions((await context.params).id, queryInput(request)))
