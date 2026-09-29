import { withCrmApi, queryInput } from "@/application/crm/http"
export const GET = (request: Request) => withCrmApi(request, service => service.listQuotations(undefined, queryInput(request)))
