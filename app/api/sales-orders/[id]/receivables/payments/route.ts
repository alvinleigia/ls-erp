import { withReceivablesApi } from "@/application/receivables/http"
import { readJson } from "@/platform/business-api"
export const POST = (request: Request, context: { params: Promise<{ id: string }> }) => withReceivablesApi(request, async service => service.record((await context.params).id, await readJson(request)))
