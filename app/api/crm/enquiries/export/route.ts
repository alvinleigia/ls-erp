import { withCrmApi, queryInput } from "@/application/crm/http"
import { csvResponse } from "@/modules/crm/csv-response"
export async function GET(request: Request) {
  return withCrmApi(request, async service => csvResponse(await service.exportEnquiries(queryInput(request)), "enquiries.csv"))
}
