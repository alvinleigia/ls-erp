import { withCrmApi } from "@/application/crm/http"
import { csvResponse } from "@/modules/crm/csv-response"
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  return withCrmApi(request, async service => csvResponse(await service.downloadEnquiryImportErrors(id), "enquiry-corrections.csv"))
}
