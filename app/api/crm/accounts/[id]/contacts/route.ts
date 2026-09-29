import { withCrmApi, queryInput } from "@/application/crm/http"
export const GET = (request: Request, context: { params: Promise<{ id: string }> }) => withCrmApi(request, async service => service.listAccountContacts((await context.params).id, queryInput(request)))
