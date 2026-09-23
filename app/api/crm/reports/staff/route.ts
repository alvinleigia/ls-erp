import { withCrmApi, queryInput } from "@/modules/crm/http"
export const dynamic = "force-dynamic"
export const GET = (request: Request) => withCrmApi(request, service => service.staffActivityReport(queryInput(request)))
