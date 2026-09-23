import { withCrmApi, queryInput } from "@/modules/crm/http"
export const dynamic = "force-dynamic"
export const GET = (request: Request, context: { params: Promise<{ id: string }> }) => withCrmApi(request, async service => service.previewWorkFollowUp((await context.params).id, queryInput(request)))
