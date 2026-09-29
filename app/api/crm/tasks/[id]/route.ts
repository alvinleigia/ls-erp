import { withCrmApi } from "@/application/crm/http"
import { crmTaskCompleteSchema } from "@/modules/crm/validation"
import { readJson } from "@/platform/business-api"
export const PATCH = (request: Request, context: { params: Promise<{ id: string }> }) => withCrmApi(request, async service => {
  crmTaskCompleteSchema.parse(await readJson(request))
  return service.completeTask((await context.params).id)
})
