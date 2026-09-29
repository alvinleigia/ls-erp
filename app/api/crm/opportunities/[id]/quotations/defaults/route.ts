import { withCrmApi } from "@/application/crm/http"
export const GET = (request: Request, context: { params: Promise<{ id: string }> }) => withCrmApi(request, async service => service.quotationDefaults((await context.params).id))
