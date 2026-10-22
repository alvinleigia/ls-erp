import { withReceivablesApi } from "@/application/receivables/http"
import { readJson } from "@/platform/business-api"
export const POST = (request: Request, context: { params: Promise<{ id: string; paymentId: string }> }) => withReceivablesApi(request, async service => {
  const { id, paymentId } = await context.params
  return service.reverse(id, paymentId, await readJson(request))
})
