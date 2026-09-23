import { withCrmApi } from "@/modules/crm/http"
export const DELETE = (request: Request, context: { params: Promise<{ id: string; accountId: string }> }) => withCrmApi(request, async service => {
  const { id, accountId } = await context.params
  return service.unlinkContactAccount(id, accountId)
})
