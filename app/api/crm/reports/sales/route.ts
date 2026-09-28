import { withCrmApi, queryInput } from "@/modules/crm/http"
export async function GET(request: Request) { return withCrmApi(request, service => service.salesOverview(queryInput(request))) }
